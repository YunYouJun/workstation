import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { ConfigurationEngine } from '../src/configuration/engine'
import { commitConfiguration, configurationGitStatus, transportConfiguration } from '../src/configuration/git'

let root: string
let remote: string
let a: string
let b: string
let previousHome: string | undefined
function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
function setup(cwd: string) {
  git(cwd, 'config', 'user.email', 'test@example.com')
  git(cwd, 'config', 'user.name', 'Test')
}
function commit(cwd: string, text: string) {
  fs.writeFileSync(path.join(cwd, 'config'), text)
  git(cwd, 'add', 'config')
  git(cwd, 'commit', '-m', text)
}
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'configuration-git-')))
  previousHome = process.env.DOTFILES_HOME
  process.env.DOTFILES_HOME = path.join(root, 'home')
  remote = path.join(root, 'remote.git')
  a = path.join(root, 'a')
  b = path.join(root, 'b')
  git(root, 'init', '--bare', '--initial-branch=main', remote)
  git(root, 'clone', remote, a)
  setup(a)
  commit(a, 'initial')
  git(a, 'push', '-u', 'origin', 'main')
  git(root, 'clone', remote, b)
  setup(b)
})
afterEach(() => {
  if (previousHome === undefined)
    delete process.env.DOTFILES_HOME
  else process.env.DOTFILES_HOME = previousHome
  fs.rmSync(root, { recursive: true, force: true })
})

it('shows dirty, unpushed and remote-leading states across two devices', () => {
  fs.writeFileSync(path.join(a, 'config'), 'reviewed configuration')
  let state = configurationGitStatus(a, 'private')
  expect(state.dirty).toBe(true)
  expect(state.ahead).toBe(0)
  const committed = commitConfiguration(a, 'private', state.revision, ['config'], [path.join(a, 'config')], 'Reviewed configuration')
  expect(committed.ahead).toBe(1)
  expect(committed.dirty).toBe(false)
  transportConfiguration(a, 'private', 'publish', committed.revision)
  git(b, 'fetch', 'origin')
  state = configurationGitStatus(b, 'private')
  expect(state.behind).toBe(1)
  transportConfiguration(b, 'private', 'fetch', state.revision)
  expect(fs.readFileSync(path.join(b, 'config'), 'utf8')).toBe('reviewed configuration')
  expect(configurationGitStatus(b, 'private').behind).toBe(0)
})

it('preserves both branches on divergence and fails safely when offline', () => {
  commit(a, 'device a')
  git(a, 'push')
  commit(b, 'device b')
  git(b, 'fetch')
  const state = configurationGitStatus(b, 'private')
  expect(state.diverged).toBe(true)
  expect(() => transportConfiguration(b, 'private', 'publish', state.revision)).toThrow('diverged')
  expect(fs.readFileSync(path.join(b, 'config'), 'utf8')).toBe('device b')
  fs.renameSync(remote, `${remote}.offline`)
  expect(() => transportConfiguration(b, 'private', 'fetch', configurationGitStatus(b, 'private').revision)).toThrow('failed')
  expect(fs.readFileSync(path.join(b, 'config'), 'utf8')).toBe('device b')
})

it('rejects stale reviewed content and protects unrelated staged work', () => {
  fs.writeFileSync(path.join(a, 'config'), 'first edit')
  const state = configurationGitStatus(a, 'private')
  fs.writeFileSync(path.join(a, 'config'), 'later edit')
  expect(() => commitConfiguration(a, 'private', state.revision, ['config'], [path.join(a, 'config')], 'Review')).toThrow('changed')
  fs.writeFileSync(path.join(a, 'unrelated'), 'keep staged')
  git(a, 'add', 'unrelated')
  expect(() => commitConfiguration(a, 'private', configurationGitStatus(a, 'private').revision, ['config'], [path.join(a, 'config')], 'Review')).toThrow('staged')
  expect(git(a, 'diff', '--cached', '--name-only')).toBe('unrelated')
})

it('does not commit when the secret scanner is unavailable', () => {
  fs.writeFileSync(path.join(a, 'config'), 'edited')
  const state = configurationGitStatus(a, 'private')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(bin)
  fs.symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), path.join(bin, 'git'))
  const previous = process.env.PATH
  process.env.PATH = bin
  try {
    expect(() => commitConfiguration(a, 'private', state.revision, ['config'], [path.join(a, 'config')], 'Review')).toThrow('scan failed')
  }
  finally { process.env.PATH = previous }
  expect(git(a, 'diff', '--cached', '--name-only')).toBe('')
})

it('restores a new HOME on device B from a reviewed configuration published by device A', () => {
  const homeA = path.join(root, 'home-a')
  const homeB = path.join(root, 'home-b')
  fs.mkdirSync(path.join(a, 'home'), { recursive: true })
  fs.mkdirSync(homeA)
  fs.writeFileSync(path.join(a, 'home/dot_zshrc'), '# baseline\n')
  git(a, 'add', 'home/dot_zshrc')
  git(a, 'commit', '-m', 'Declare terminal configuration')
  git(a, 'push')
  const first = new ConfigurationEngine({ home: homeA, repo: a, manifest: path.join(a, 'missing-manifest.json') })
  let row = first.inspect().items.find(row => row.id === 'file:.zshrc')!
  first.apply(first.preview([{ id: row.id, revision: row.revision, choice: 'source' }]).planId)
  fs.writeFileSync(path.join(homeA, '.zshrc'), '# device A edit\n')
  row = first.inspect().items.find(row => row.id === 'file:.zshrc')!
  expect(row.status).toBe('local-modified')
  const saved = first.apply(first.preview([{ id: row.id, revision: row.revision, choice: 'local' }]).planId)
  expect(saved.state).toBe('applied')
  const reviewed = configurationGitStatus(a, 'public')
  const committed = commitConfiguration(a, 'public', reviewed.revision, ['home/dot_zshrc'], [path.join(a, 'home/dot_zshrc')], 'Device A terminal edit')
  transportConfiguration(a, 'public', 'publish', committed.revision)
  transportConfiguration(b, 'public', 'fetch', configurationGitStatus(b, 'public').revision)
  const second = new ConfigurationEngine({ home: homeB, repo: b, manifest: path.join(b, 'missing-manifest.json') })
  row = second.inspect().items.find(row => row.id === 'file:.zshrc')!
  expect(row.status).toBe('first-adoption')
  const restore = second.preview([{ id: row.id, revision: row.revision, choice: 'source' }])
  expect(second.apply(restore.planId).state).toBe('applied')
  expect(fs.readFileSync(path.join(homeB, '.zshrc'), 'utf8')).toBe('# device A edit\n')
  expect(second.inspect().items.find(row => row.id === 'file:.zshrc')?.status).toBe('synced')
  second.restore(restore.planId)
  expect(fs.existsSync(path.join(homeB, '.zshrc'))).toBe(false)
})

it('redacts literal credentials in working and outgoing Git differences', () => {
  fs.writeFileSync(path.join(a, 'config'), 'api_key = "private-literal-never-display"\n')
  const status = configurationGitStatus(a, 'private')
  expect(status.workingDiff).toContain('api_key = [value withheld]')
  expect(JSON.stringify(status)).not.toContain('private-literal-never-display')
})
