import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigurationEngine } from '../src/configuration/engine'

let root: string
let home: string
let repo: string
let manifest: string
let engine: ConfigurationEngine
let oldHome: string | undefined
function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true,
  })
  fs.writeFileSync(file, content)
}
function local(content: string) {
  write(path.join(home, '.codex/config.toml'), content)
}
function source(content: string) {
  write(path.join(repo, 'mcp/config.toml'), content)
}
function item() {
  return engine.inspect().items.find(item => item.id === 'mcp:demo')!
}
function preview(choice: 'local' | 'source' | 'merge', fields?: Record<string, 'local' | 'source'>) {
  const row = item()
  return engine.preview([{ id: row.id, revision: row.revision, choice, fields }])
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'workstation-configuration-'))
  home = path.join(root, 'home')
  repo = path.join(root, 'repo')
  manifest = path.join(repo, 'config/sync-manifest.json')
  oldHome = process.env.DOTFILES_HOME
  process.env.DOTFILES_HOME = home
  write(manifest, JSON.stringify({ policy: { plaintextSecretsAllowed: false, secretSource: '1Password' }, workstationOverlay: { contractVersion: 1, defaultMode: 'dry-run', secretSource: '1Password', allowedReadPaths: ['mcp/*'], allowedOperations: ['managed-block-fragment'] }, mcp: { fragments: [{ id: 'test', path: 'mcp/config.toml', format: 'toml-codex', syncMode: 'install', operation: 'managed-block-fragment' }] } }))
  engine = new ConfigurationEngine({ home, repo, manifest })
  local('model = "kept"\n[mcp_servers.demo]\ncommand = "local"\n')
  source('[mcp_servers.demo]\ncommand = "source"\n')
})
afterEach(() => {
  if (oldHome === undefined)
    delete process.env.DOTFILES_HOME
  else process.env.DOTFILES_HOME = oldHome
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('configuration v1', () => {
  it('inspects without state writes and labels first adoption', () => {
    expect(item().status).toBe('first-adoption')
    expect(item().fields).toEqual(['command'])
    expect(fs.existsSync(engine.state)).toBe(false)
    expect(item().local).not.toContain('"local"')
  })
  it('previews, applies one MCP without touching unrelated settings, repeats and restores', () => {
    const plan = preview('source')
    expect(plan.changes[0].direction).toBe('to-local')
    expect(fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8')).toContain('"local"')
    expect(engine.apply(plan.planId).state).toBe('applied')
    expect(item().status).toBe('synced')
    expect(fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8')).toContain('model = "kept"')
    expect(engine.apply(plan.planId).state).toBe('applied')
    engine.restore(plan.planId)
    expect(item().status).toBe('first-adoption')
    expect(fs.statSync(path.join(engine.state, `${plan.planId}.json`)).mode & 0o777).toBe(0o600)
  })
  it('rejects stale previews on either side', () => {
    const plan = preview('source')
    source('[mcp_servers.demo]\ncommand = "new source"\n')
    expect(() => engine.apply(plan.planId)).toThrow('changed')
    expect(fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8')).toContain('"local"')
  })
  it('distinguishes local, source and conflicting edits using the successful baseline', () => {
    engine.apply(preview('source').planId)
    local('[mcp_servers.demo]\ncommand = "changed local"\n')
    expect(item().status).toBe('local-modified')
    source('[mcp_servers.demo]\ncommand = "changed source"\n')
    expect(item().status).toBe('conflict')
    local('[mcp_servers.demo]\ncommand = "source"\n')
    expect(item().status).toBe('source-modified')
  })
  it('requires explicit field decisions for first-adoption merge', () => {
    source('[mcp_servers.demo]\ncommand = "source"\nargs = ["a"]\n')
    expect(() => preview('merge', { command: 'local' })).toThrow('every changed field')
    const plan = preview('merge', { command: 'local', args: 'source' })
    expect(plan.changes.map(change => change.direction)).toEqual(['to-local', 'to-source'])
    engine.apply(plan.planId)
    expect(item().status).toBe('synced')
  })
  it('withholds raw credentials from inspect, preview and errors and refuses unsafe export', () => {
    local('[mcp_servers.demo]\ncommand = "local"\n[mcp_servers.demo.env]\nTOKEN = "very-secret-value"\n')
    expect(JSON.stringify(engine.inspect())).not.toContain('very-secret-value')
    expect(() => preview('local')).toThrow('credentials')
    expect(JSON.stringify(preview('source'))).not.toContain('very-secret-value')
  })
  it('refuses recovery over later edits', () => {
    const plan = preview('source')
    engine.apply(plan.planId)
    local('[mcp_servers.demo]\ncommand = "later"\n')
    expect(() => engine.restore(plan.planId)).toThrow('changed after')
  })
  it('reports parsing failure without returning secret parser diagnostics', () => {
    local('secret = "very-secret-value')
    const result = engine.inspect()
    expect(result.items.find(item => item.id === 'mcp-scan')?.status).toBe('error')
    expect(JSON.stringify(result)).not.toContain('very-secret-value')
  })
  it('rejects symlink parents and does not overwrite installer skills', () => {
    fs.mkdirSync(path.join(home, '.codex/skills'), { recursive: true })
    fs.symlinkSync(repo, path.join(home, '.codex/skills/installed'))
    const row = engine.inspect().items.find(item => item.title === 'installed')!
    expect(row.owner).toBe('installer')
    expect(row.status).toBe('read-only')
    const plan = preview('source')
    fs.renameSync(path.join(home, '.codex'), path.join(home, 'moved'))
    fs.symlinkSync(path.join(home, 'moved'), path.join(home, '.codex'))
    expect(() => engine.apply(plan.planId)).toThrow('linked')
  })
})

it('recovers a new device and restores the previously absent file', () => {
  fs.unlinkSync(path.join(home, '.codex/config.toml'))
  const plan = preview('source')
  expect(engine.apply(plan.planId).state).toBe('applied')
  expect(item().status).toBe('synced')
  engine.restore(plan.planId)
  expect(fs.existsSync(path.join(home, '.codex/config.toml'))).toBe(false)
})

it('keeps a deleted MCP source tracked and can apply and restore deletion', () => {
  engine.apply(preview('source').planId)
  source('')
  expect(item().status).toBe('source-modified')
  const plan = preview('source')
  engine.apply(plan.planId)
  expect(item().status).toBe('synced')
  engine.restore(plan.planId)
  expect(fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8')).toContain('[mcp_servers.demo]')
})

it('does not migrate execution approvals and keeps local approvals untouched', () => {
  local('[mcp_servers.demo]\ncommand = "local"\ndefault_tools_approval_mode = "always"\n')
  source('[mcp_servers.demo]\ncommand = "source"\ndefault_tools_approval_mode = "never"\n')
  expect(item().fields).toEqual(['command'])
  const plan = preview('source')
  engine.apply(plan.planId)
  expect(fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8')).toContain('"always"')
})

it('invalidates the plan when source ownership changes', () => {
  const plan = preview('source')
  write(manifest, '{}')
  expect(() => engine.apply(plan.planId)).toThrow('changed')
})

it('applies and recovers declared user skill trees, including deletion', () => {
  const value = JSON.parse(fs.readFileSync(manifest, 'utf8'))
  value.workstationOverlay.allowedReadPaths.push('skills/*')
  value.skills = { install: [{ id: 'notes', root: 'codex', source: { type: 'local', path: 'skills/notes' } }] }
  write(manifest, JSON.stringify(value))
  write(path.join(repo, 'skills/notes/SKILL.md'), '# Notes\n')
  write(path.join(repo, 'skills/notes/references/guide.md'), 'source\n')
  write(path.join(home, '.codex/skills/notes/SKILL.md'), '# Local\n')
  write(path.join(home, '.codex/skills/notes/obsolete.md'), 'delete me\n')
  const rows = engine.inspect().items.filter(row => row.kind === 'skill' && row.sourcePath)
  const plan = engine.preview(rows.map(row => ({ id: row.id, revision: row.revision, choice: 'source' })))
  expect(plan.changes.some(change => change.deletion)).toBe(true)
  expect(engine.apply(plan.planId).state).toBe('applied')
  expect(fs.existsSync(path.join(home, '.codex/skills/notes/obsolete.md'))).toBe(false)
  expect(fs.readFileSync(path.join(home, '.codex/skills/notes/references/guide.md'), 'utf8')).toBe('source\n')
  engine.restore(plan.planId)
  expect(fs.readFileSync(path.join(home, '.codex/skills/notes/obsolete.md'), 'utf8')).toBe('delete me\n')
})

it('returns readable text with original line positions for inspection and change previews', () => {
  const localText = '# Local instructions\n\nUse conventional commits.\n'
  const sourceText = '# Shared instructions\n\nReview configuration before applying.\n'
  write(path.join(home, '.codex/AGENTS.md'), localText)
  write(path.join(repo, 'home/dot_codex/AGENTS.md'), sourceText)
  const row = engine.inspect().items.find(row => row.kind === 'instructions')!
  expect(row.local).toBe(localText)
  expect(row.source).toBe(sourceText)
  expect(fs.existsSync(engine.state)).toBe(false)
  const plan = engine.preview([{ id: row.id, revision: row.revision, choice: 'source' }])
  expect(plan.changes[0].before).toBe(localText)
  expect(plan.changes[0].after).toBe(sourceText)
  expect(fs.readFileSync(path.join(home, '.codex/AGENTS.md'), 'utf8')).toBe(localText)
})

it('applies terminal configurations independently of MCP and restores them', () => {
  write(path.join(repo, 'home/dot_zshrc'), '# source\n')
  write(path.join(home, '.zshrc'), '# local\n')
  const row = engine.inspect().items.find(row => row.id === 'file:.zshrc')!
  const plan = engine.preview([{ id: row.id, revision: row.revision, choice: 'source' }])
  engine.apply(plan.planId)
  expect(fs.readFileSync(path.join(home, '.zshrc'), 'utf8')).toBe('# source\n')
  expect(item().status).toBe('first-adoption')
  engine.restore(plan.planId)
  expect(fs.readFileSync(path.join(home, '.zshrc'), 'utf8')).toBe('# local\n')
})

it('blocks source writes when the required scanner is unavailable', () => {
  const plan = preview('local')
  const oldPath = process.env.PATH
  process.env.PATH = root
  try {
    expect(engine.apply(plan.planId).state).toBe('failed')
    expect(fs.readFileSync(path.join(repo, 'mcp/config.toml'), 'utf8')).toContain('"source"')
    expect(engine.history().plans.find(entry => entry.planId === plan.planId)?.state).toBe('failed')
    engine.restore(plan.planId)
  }
  finally { process.env.PATH = oldPath }
})

it('retains a partial-application journal and recovers all prior files', () => {
  write(path.join(repo, 'home/dot_zshrc'), '# source\n')
  write(path.join(home, '.zshrc'), '# local\n')
  const rows = engine.inspect().items.filter(row => row.id === 'file:.zshrc' || row.id === 'mcp:demo')
  const plan = engine.preview(rows.map(row => ({ id: row.id, revision: row.revision, choice: 'source' })))
  const rename = fs.renameSync
  const mock = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to).endsWith('/.codex/config.toml'))
      throw new Error('simulated disk failure')
    return rename(from, to)
  })
  expect(engine.apply(plan.planId).state).toBe('failed')
  expect(fs.readFileSync(path.join(home, '.zshrc'), 'utf8')).toBe('# source\n')
  mock.mockRestore()
  engine.restore(plan.planId)
  expect(fs.readFileSync(path.join(home, '.zshrc'), 'utf8')).toBe('# local\n')
})

it('rejects replacing a file modified while its temporary write was prepared', () => {
  const plan = preview('source')
  const writeFile = fs.writeFileSync
  let edited = false
  const mock = vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
    const result = writeFile(file, data, options)
    if (!edited && String(file).includes('/.codex/config.toml.tmp.')) {
      edited = true
      writeFile(path.join(home, '.codex/config.toml'), '[mcp_servers.demo]\ncommand = "concurrent"\n')
    }
    return result
  })
  expect(engine.apply(plan.planId).state).toBe('failed')
  mock.mockRestore()
  expect(fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8')).toContain('concurrent')
  expect(() => engine.restore(plan.planId)).toThrow('changed after')
})

it('merges text with explicit choices for each aligned changed line', () => {
  write(path.join(repo, 'home/dot_zshrc'), '# source\n# same\n')
  write(path.join(home, '.zshrc'), '# local\n# same\n# extra\n')
  const row = engine.inspect().items.find(row => row.id === 'file:.zshrc')!
  const fields: Record<string, 'local' | 'source'> = Object.fromEntries(row.fields.map(field => [field, 'source' as const]))
  fields['line:3'] = 'local'
  fields['line:4'] = 'local'
  const plan = engine.preview([{ id: row.id, revision: row.revision, choice: 'merge', fields }])
  expect(engine.apply(plan.planId).state).toBe('applied')
  expect(fs.readFileSync(path.join(home, '.zshrc'), 'utf8')).toBe('# source\n# same\n# extra\n')
})

it('displays project configuration separately and cannot select it for global writes', () => {
  const project = path.join(root, 'project')
  write(path.join(project, '.codex/config.toml'), '[mcp_servers.project]\ncommand = "node"\n')
  const row = engine.inspect(project).items.find(row => row.id === 'project-mcp:project')!
  expect(row.owner).toBe('project')
  expect(row.status).toBe('read-only')
  expect(() => engine.preview([{ id: row.id, revision: row.revision, choice: 'local' }])).toThrow('changed')
})

it('handles different decisions for two servers without losing unrelated MCP content', () => {
  local('[mcp_servers.demo]\ncommand = "node"\n[mcp_servers.second]\ncommand = "uvx"\n[mcp_servers.unrelated]\ncommand = "keep"\n')
  source('[mcp_servers.demo]\ncommand = "npx"\n[mcp_servers.second]\ncommand = "python"\n')
  const rows = engine.inspect().items
  const one = rows.find(row => row.id === 'mcp:demo')!
  const two = rows.find(row => row.id === 'mcp:second')!
  const plan = engine.preview([{ id: one.id, revision: one.revision, choice: 'source' }, { id: two.id, revision: two.revision, choice: 'local' }])
  expect(engine.apply(plan.planId).state).toBe('applied')
  const content = fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8')
  expect(content).toContain('"npx"')
  expect(content).toContain('"uvx"')
  expect(content).toContain('"keep"')
  expect(fs.readFileSync(path.join(repo, 'mcp/config.toml'), 'utf8')).toContain('"uvx"')
})

it('refuses restoration after a file permission change', () => {
  const plan = preview('source')
  engine.apply(plan.planId)
  const file = path.join(home, '.codex/config.toml')
  fs.chmodSync(file, 0o400)
  expect(() => engine.restore(plan.planId)).toThrow('changed after')
})
