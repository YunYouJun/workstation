import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { decryptConfiguration, encryptConfiguration } from '../src/configuration/backup'
import { ConfigurationEngine } from '../src/configuration/engine'
import { configurationRequest } from '../src/configuration/protocol'
import { repositoryFile } from '../src/configuration/repositories'

vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>()
  return { ...actual, spawnSync: vi.fn((command, args, options) => command === 'gitleaks' ? { status: 0, stdout: '', stderr: '' } : actual.spawnSync(command, args, options)) }
})
let root: string
let home: string
let engine: ConfigurationEngine
let oldHome: string | undefined
function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}
function repository(name: string) {
  const directory = path.join(root, name)
  fs.mkdirSync(directory, { recursive: true })
  spawnSync('git', ['init', '-q', directory])
  return directory
}
function register(name: string, audience: 'personal' | 'work', server = name) {
  const directory = repository(name)
  write(path.join(directory, 'config/sync-manifest.json'), JSON.stringify({
    policy: { plaintextSecretsAllowed: false, secretSource: '1Password' },
    workstationOverlay: { contractVersion: 1, defaultMode: 'dry-run', secretSource: '1Password', allowedReadPaths: ['mcp/*'], allowedOperations: ['managed-block-fragment'] },
    mcp: { fragments: [{ id: 'main', path: 'mcp/config.toml', format: 'toml-codex', syncMode: 'install', operation: 'managed-block-fragment' }] },
  }))
  write(path.join(directory, 'mcp/config.toml'), `[mcp_servers.${server}]\ncommand = "node"\nargs = ["${name}"]\n`)
  engine.configureRepositories({ action: 'save-source', revision: engine.repositoryRegistry().revision, source: { id: name, name, kind: 'overlay', audience, root: directory, enabled: true } })
  return directory
}
function row(id: string) {
  return engine.inspect().items.find(item => item.id === id)!
}
function preview(id: string, choice: 'local' | 'source') {
  const item = row(id)
  return engine.preview([{ id, revision: item.revision, choice }])
}
function target(audience: 'personal' | 'work', sourceIds: string[], reserved = false) {
  return engine.configureRepositories({ action: 'save-target', revision: engine.repositoryRegistry().revision, target: { id: 'backup', name: 'Encrypted configuration', driver: 'workstation', audience, root: reserved ? undefined : repository('backups'), directory: 'workstation', sourceIds, keyEnvironment: 'WORKSTATION_TEST_BACKUP_KEY' } })
}
function backup(action: 'save' | 'restore', resolution?: string) {
  return engine.backupPreview({ action, targetId: 'backup', resolution, revision: engine.repositoryRegistry().revision })
}
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'configuration-repositories-')))
  home = path.join(root, 'home')
  oldHome = process.env.DOTFILES_HOME
  process.env.DOTFILES_HOME = home
  process.env.WORKSTATION_TEST_BACKUP_KEY = 'long-test-passphrase-for-isolated-fixtures'
  engine = new ConfigurationEngine({ home, repo: repository('public'), manifest: path.join(root, 'missing/config/sync-manifest.json') })
})
afterEach(() => {
  if (oldHome === undefined)
    delete process.env.DOTFILES_HOME
  else process.env.DOTFILES_HOME = oldHome
  delete process.env.WORKSTATION_TEST_BACKUP_KEY
  fs.rmSync(root, { recursive: true, force: true })
})

it('lists without persistence and adds several sources through the CLI protocol without overwriting another', () => {
  expect(fs.existsSync(engine.state)).toBe(false)
  expect(configurationRequest({ version: 1, operation: 'repositories' }, engine)).toMatchObject({ sources: [{ id: 'public' }] })
  expect(fs.existsSync(engine.state)).toBe(false)
  register('office', 'work')
  register('personal', 'personal')
  expect(engine.repositoryRegistry().sources.map(source => source.id)).toEqual(['public', 'office', 'personal'])
  expect(row('office::mcp:office')).toMatchObject({ sourceId: 'office', audience: 'work', status: 'first-adoption' })
  expect(fs.statSync(engine.registry.file).mode & 0o777).toBe(0o600)
})

it('writes each item to its original source and never adopts unrelated local servers', () => {
  const office = register('office', 'work')
  const personal = register('personal', 'personal')
  write(path.join(home, '.codex/config.toml'), '[mcp_servers.office]\ncommand = "node"\nargs = ["edited"]\n[mcp_servers.unknown]\ncommand = "node"\n')
  const untouched = fs.readFileSync(path.join(personal, 'mcp/config.toml'), 'utf8')
  engine.apply(preview('office::mcp:office', 'local').planId)
  expect(fs.readFileSync(path.join(office, 'mcp/config.toml'), 'utf8')).toContain('edited')
  expect(fs.readFileSync(path.join(personal, 'mcp/config.toml'), 'utf8')).toBe(untouched)
  expect(engine.inspect().items.filter(item => item.title === 'unknown').every(item => !item.sourcePath)).toBe(true)
})

it('blocks competing owners and cross-audience transfer, resolving same-audience ownership explicitly', () => {
  register('first', 'work', 'shared')
  register('second', 'work', 'shared')
  const item = row('first::mcp:shared')
  expect(item.status).toBe('ownership-conflict')
  expect(() => preview(item.id, 'source')).toThrow('not writable')
  engine.configureRepositories({ action: 'claim', revision: engine.repositoryRegistry().revision, resource: item.resource, sourceId: 'first' })
  expect(row(item.id).status).toBe('first-adoption')
  expect(row('second::mcp:shared').status).toBe('ownership-conflict')
  register('third', 'personal', 'shared')
  expect(() => engine.configureRepositories({ action: 'claim', revision: engine.repositoryRegistry().revision, resource: item.resource, sourceId: 'third' })).toThrow('between public, personal and work')
})

it('preserves ownership after disabling its source and invalidates plans after registry changes', () => {
  register('office', 'work')
  engine.apply(preview('office::mcp:office', 'source').planId)
  const item = row('office::mcp:office')
  const plan = preview(item.id, 'source')
  const source = engine.repositoryRegistry().sources.find(source => source.id === 'office')!
  engine.configureRepositories({ action: 'save-source', revision: engine.repositoryRegistry().revision, source: { ...source, enabled: false } })
  expect(() => engine.apply(plan.planId)).toThrow('registry changed')
  register('personal', 'personal', 'office')
  expect(row('personal::mcp:office').status).toBe('ownership-conflict')
  expect(() => engine.configureRepositories({ action: 'claim', revision: engine.repositoryRegistry().revision, resource: item.resource, sourceId: 'personal' })).toThrow('between public, personal and work')
})

it('reserves a backup without creating a repository and rejects mixed audiences and stale registration', () => {
  register('office', 'work')
  const previous = engine.repositoryRegistry().revision
  target('work', ['office'], true)
  expect(fs.existsSync(path.join(root, 'backups'))).toBe(false)
  expect(() => backup('save')).toThrow('reserved')
  expect(() => engine.configureRepositories({ action: 'remove-target', id: 'backup', revision: previous })).toThrow('changed')
  expect(() => target('personal', ['office'])).toThrow('identity is immutable')
  engine.configureRepositories({ action: 'remove-target', id: 'backup', revision: engine.repositoryRegistry().revision })
  expect(() => target('personal', ['office'])).toThrow('mix personal and work')
})

it('encrypts only declared source files, restores after restart and preserves overwritten versions in the journal', () => {
  const source = register('office', 'work')
  target('work', ['office'])
  const file = path.join(source, 'mcp/config.toml')
  const original = fs.readFileSync(file, 'utf8')
  write(path.join(source, 'unmanaged.txt'), 'never archive this')
  const saved = backup('save')
  expect(JSON.stringify(saved)).not.toContain(original)
  expect(engine.apply(saved.planId).state).toBe('applied')
  const archivePath = path.join(root, 'backups/workstation/configuration.backup.json')
  const encrypted = fs.readFileSync(archivePath, 'utf8')
  expect(encrypted).not.toContain('mcp_servers')
  const archive = decryptConfiguration(encrypted, process.env.WORKSTATION_TEST_BACKUP_KEY!)
  expect(archive.files).toEqual([{ sourceId: 'office', sourceAudience: 'work', path: 'mcp/config.toml', content: original }])
  write(file, original.replace('office', 'changed'))
  engine = new ConfigurationEngine({ home, repo: path.join(root, 'public'), manifest: path.join(root, 'missing') })
  const restored = backup('restore')
  expect(engine.apply(restored.planId).state).toBe('applied')
  expect(fs.readFileSync(file, 'utf8')).toBe(original)
  engine.restore(restored.planId)
  expect(fs.readFileSync(file, 'utf8')).toContain('changed')
})

it('retains both versions on remote backup changes and refuses stale overwrite, wrong keys and path traversal', () => {
  register('office', 'work')
  target('work', ['office'])
  const file = path.join(root, 'backups/workstation/configuration.backup.json')
  const envelope = encryptConfiguration({ version: 1, audience: 'work', files: [{ sourceId: 'office', sourceAudience: 'work', path: '../escape', content: 'unexpected' }] }, process.env.WORKSTATION_TEST_BACKUP_KEY!)
  write(file, envelope)
  expect(() => backup('save')).toThrow('Backup changed')
  expect(() => backup('restore')).toThrow('relative path')
  const plan = backup('save', 'replace')
  write(file, `${envelope} `)
  expect(() => engine.apply(plan.planId)).toThrow('changed')
  expect(() => decryptConfiguration(envelope, 'a different passphrase entirely')).toThrow('cannot be decrypted')
  expect(() => repositoryFile(root, '.git/config')).toThrow('relative path')
})

it('recovers one source without rolling back later independent source baselines and preserves later edits', () => {
  register('office', 'work')
  register('personal', 'personal')
  // Different files are needed: writes to the same MCP file intentionally conflict on recovery.
  write(path.join(root, 'public/home/dot_config/ghostty/config'), 'font-size = 14\n')
  const plan = preview('file:.config/ghostty/config', 'source')
  engine.apply(plan.planId)
  engine.apply(preview('office::mcp:office', 'source').planId)
  engine.restore(plan.planId)
  expect(row('office::mcp:office').status).toBe('synced')
  write(path.join(home, '.codex/config.toml'), '[mcp_servers.office]\ncommand = "node"\nargs = ["edit"]\n')
  const current = preview('office::mcp:office', 'local')
  engine.apply(current.planId)
  write(path.join(root, 'office/mcp/config.toml'), 'later independent edit\n')
  expect(() => engine.restore(current.planId)).toThrow('changed after')
})

it('commits a first encrypted backup into an empty target without staging another application', () => {
  register('office', 'work')
  target('work', ['office'])
  engine.apply(backup('save').planId)
  const directory = path.join(root, 'backups')
  spawnSync('git', ['-C', directory, 'config', 'user.name', 'Fixture'])
  spawnSync('git', ['-C', directory, 'config', 'user.email', 'fixture@example.com'])
  write(path.join(directory, 'other-app/file.txt'), 'unrelated')
  const status = engine.gitStatus().repositories.find(repo => repo.id === 'target:backup')!
  expect(status).not.toHaveProperty('error')
  engine.gitAction({ repository: 'target:backup', revision: 'revision' in status ? status.revision : '', action: 'commit', paths: ['workstation/configuration.backup.json'], message: 'chore(config): save encrypted backup' })
  expect(spawnSync('git', ['-C', directory, 'ls-files'], { encoding: 'utf8' }).stdout.trim()).toBe('workstation/configuration.backup.json')
  expect(fs.existsSync(path.join(directory, 'other-app/file.txt'))).toBe(true)
})

it('resumes an interrupted recovery while preserving later edits on already restored files', () => {
  write(path.join(root, 'public/home/dot_config/ghostty/config'), 'font-size = 14\n')
  write(path.join(root, 'public/home/dot_config/starship.toml'), 'add_newline = false\n')
  const rows = engine.inspect().items.filter(item => ['file:.config/ghostty/config', 'file:.config/starship.toml'].includes(item.id))
  const plan = engine.preview(rows.map(item => ({ id: item.id, revision: item.revision, choice: 'source' })))
  engine.apply(plan.planId)
  const unlink = fs.unlinkSync
  let writes = 0
  const failure = vi.spyOn(fs, 'unlinkSync').mockImplementation((file) => {
    if (String(file).includes('/home/.config/') && ++writes === 2)
      throw new Error('fixture recovery failure')
    return unlink(file)
  })
  expect(() => engine.restore(plan.planId)).toThrow('fixture recovery failure')
  failure.mockRestore()
  expect(engine.history().plans.find(item => item.planId === plan.planId)?.state).toBe('restoring')
  expect(engine.restore(plan.planId).state).toBe('restored')
  expect(fs.existsSync(path.join(home, '.config/ghostty/config'))).toBe(false)
  expect(fs.existsSync(path.join(home, '.config/starship.toml'))).toBe(false)
})

it('recovers missing and malformed source fragments using the unchanged declaration', () => {
  const directory = register('office', 'work')
  target('work', ['office'])
  const file = path.join(directory, 'mcp/config.toml')
  const original = fs.readFileSync(file, 'utf8')
  engine.apply(backup('save').planId)
  fs.unlinkSync(file)
  expect(engine.apply(backup('restore').planId).state).toBe('applied')
  expect(fs.readFileSync(file, 'utf8')).toBe(original)
  write(file, 'broken = "unterminated')
  expect(engine.apply(backup('restore').planId).state).toBe('applied')
  expect(fs.readFileSync(file, 'utf8')).toBe(original)
})

it('refuses recovery after a backup target is replaced by a different registration', () => {
  register('office', 'work')
  target('work', ['office'])
  const original = engine.repositoryRegistry().targets[0]
  const plan = backup('save')
  engine.apply(plan.planId)
  engine.configureRepositories({ action: 'remove-target', id: 'backup', revision: engine.repositoryRegistry().revision })
  engine.configureRepositories({ action: 'save-target', revision: engine.repositoryRegistry().revision, target: { ...original, root: repository('different-backup') } })
  expect(() => engine.restore(plan.planId)).toThrow('target changed')
  expect(fs.existsSync(path.join(root, 'backups/workstation/configuration.backup.json'))).toBe(true)
})

it('allows disabling a missing source without deleting its remembered ownership', () => {
  const directory = register('office', 'work')
  engine.apply(preview('office::mcp:office', 'source').planId)
  const source = engine.repositoryRegistry().sources.find(item => item.id === 'office')!
  fs.rmSync(directory, { recursive: true, force: true })
  engine.configureRepositories({ action: 'save-source', revision: engine.repositoryRegistry().revision, source: { ...source, enabled: false } })
  expect(engine.inspect().items.some(item => item.sourceId === 'office')).toBe(false)
  expect(Object.values(engine.repositoryRegistry().ownership)).toContain('office')
})
