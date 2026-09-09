import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import { syncGitRepository } from '../src/git-sync'
import { createTempDir, removePath, runCli, writeFile } from './utils'

let root: string
let first: string
let second: string
let remote: string
let bin: string

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function commit(repo: string, name: string): string {
  writeFile(path.join(repo, name), `${name}\n`)
  git(repo, 'add', name)
  git(repo, 'commit', '-m', name)
  return git(repo, 'rev-parse', 'HEAD')
}

beforeEach(() => {
  root = createTempDir('workstation-git-sync-')
  first = path.join(root, 'first')
  second = path.join(root, 'second')
  remote = path.join(root, 'remote.git')
  bin = path.join(root, 'bin')
  // Isolate user hooks, signing, Git configuration and credentials.
  vi.stubEnv('GIT_CONFIG_GLOBAL', path.join(root, 'gitconfig'))
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  vi.stubEnv('GIT_AUTHOR_NAME', 'Sync Test')
  vi.stubEnv('GIT_AUTHOR_EMAIL', 'sync@example.com')
  vi.stubEnv('GIT_COMMITTER_NAME', 'Sync Test')
  vi.stubEnv('GIT_COMMITTER_EMAIL', 'sync@example.com')
  git(root, 'init', '--bare', '--initial-branch=main', remote)
  git(root, 'clone', remote, first)
  writeFile(path.join(first, 'config', 'sync-manifest.json'), JSON.stringify({ policy: { plaintextSecretsAllowed: false }, workstationOverlay: { contractVersion: 1, defaultMode: 'dry-run', secretSource: '1Password', allowedReadPaths: ['config/sync-manifest.json'] } }))
  git(first, 'add', '.')
  git(first, 'commit', '-m', 'initial')
  git(first, 'push', '-u', 'origin', 'main')
  git(root, 'clone', remote, second)
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  removePath(root)
})

describe('shared Git repository sync', () => {
  it('previews without fetching and fast-forwards only on confirmation', () => {
    const original = git(first, 'rev-parse', 'HEAD')
    const incoming = commit(second, 'remote-change')
    git(second, 'push')
    const preview = runCli(['df', 'fetch'], first, path.join(root, 'home'))
    assert.equal(preview.status, 0, preview.stderr)
    assert.equal(git(first, 'rev-parse', 'HEAD'), original)
    assert.equal(git(first, 'rev-parse', 'origin/main'), original)
    const applied = runCli(['private', 'fetch', '--manifest', path.join(first, 'config', 'sync-manifest.json'), '--yes'], first, path.join(root, 'home'))
    assert.equal(applied.status, 0, applied.stderr)
    assert.equal(git(first, 'rev-parse', 'HEAD'), incoming)
    syncGitRepository(first, 'fetch', false)
    assert.equal(git(first, 'rev-parse', 'HEAD'), incoming)
  })

  it('preserves both histories on divergence', () => {
    const local = commit(first, 'local-change')
    const other = commit(second, 'other-change')
    git(second, 'push')
    for (const action of ['fetch', 'publish'] as const)
      assert.throws(() => syncGitRepository(first, action, false), /diverged/)
    assert.equal(git(first, 'rev-parse', 'HEAD'), local)
    assert.equal(git(remote, 'rev-parse', 'main'), other)
    assert.equal(git(first, 'status', '--porcelain'), '')
  })

  it('rejects untracked, staged and unstaged changes without discarding them', () => {
    writeFile(path.join(first, 'new-file'), 'keep\n')
    assert.throws(() => syncGitRepository(first, 'fetch', false), /uncommitted or untracked/)
    git(first, 'add', 'new-file')
    assert.throws(() => syncGitRepository(first, 'publish', false), /uncommitted or untracked/)
    git(first, 'commit', '-m', 'new file')
    writeFile(path.join(first, 'new-file'), 'edited\n')
    assert.throws(() => syncGitRepository(first, 'fetch', false), /uncommitted or untracked/)
    assert.equal(fs.readFileSync(path.join(first, 'new-file'), 'utf8'), 'edited\n')
  })

  it('requires upstream and refuses detached HEAD or unfinished operations', () => {
    git(first, 'branch', '--unset-upstream')
    assert.throws(() => syncGitRepository(first, 'fetch', false), /Git config failed/)
    git(first, 'branch', '--set-upstream-to=origin/main')
    git(first, 'checkout', '--detach')
    assert.throws(() => syncGitRepository(first, 'fetch', false), /symbolic-ref/)
    git(first, 'checkout', 'main')
    writeFile(path.join(first, '.git', 'CHERRY_PICK_HEAD'), `${git(first, 'rev-parse', 'HEAD')}\n`)
    assert.throws(() => syncGitRepository(first, 'fetch', false), /unfinished/)
  })

  it('does not publish while behind or when fetch and push URLs differ', () => {
    const incoming = commit(second, 'incoming')
    git(second, 'push')
    assert.throws(() => syncGitRepository(first, 'publish', false), /Remote is ahead/)
    assert.equal(git(remote, 'rev-parse', 'main'), incoming)
    git(first, 'remote', 'set-url', '--push', 'origin', path.join(root, 'elsewhere'))
    assert.throws(() => syncGitRepository(first, 'publish', false), /matching fetch\/push URL/)
  })

  it('scans the outgoing commit range and blocks publishing on scanner failure', () => {
    const original = git(remote, 'rev-parse', 'main')
    const outgoing = commit(first, 'outgoing')
    const scanner = path.join(bin, 'gitleaks')
    const scannerLog = path.join(root, 'scanner-args')
    writeFile(scanner, '#!/bin/sh\nprintf "%s\\n" "$@" > "$SCANNER_LOG"\nexit 1\n')
    fs.chmodSync(scanner, 0o755)
    vi.stubEnv('SCANNER_LOG', scannerLog)
    vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env.PATH}`)
    assert.throws(() => syncGitRepository(first, 'publish', false), /scan failed/)
    assert.equal(git(remote, 'rev-parse', 'main'), original)
    assert.match(fs.readFileSync(scannerLog, 'utf8'), new RegExp(`--log-opts=${original}\\.\\.${outgoing}`))
    writeFile(scanner, '#!/bin/sh\nexit 0\n')
    syncGitRepository(first, 'publish', false)
    assert.equal(git(remote, 'rev-parse', 'main'), outgoing)
    syncGitRepository(first, 'publish', false)
    assert.equal(git(remote, 'rev-parse', 'main'), outgoing)
  })

  it('rejects a concurrent sync lock and releases its own lock on fetch failure', () => {
    const lock = path.join(first, '.git', 'workstation-sync.lock')
    writeFile(lock, '')
    assert.throws(() => syncGitRepository(first, 'fetch', false), /sync locked/)
    fs.unlinkSync(lock)
    git(first, 'remote', 'set-url', 'origin', path.join(root, 'missing.git'))
    assert.throws(() => syncGitRepository(first, 'fetch', false), /Git fetch failed/)
    assert.equal(fs.existsSync(lock), false)
  })

  it('does not overwrite a remote update that arrives during the outgoing scan', () => {
    const local = commit(first, 'local-publish')
    const concurrent = commit(second, 'concurrent-publish')
    const scanner = path.join(bin, 'gitleaks')
    writeFile(scanner, '#!/bin/sh\ngit -C "$OTHER_REPO" push >/dev/null 2>&1\n')
    fs.chmodSync(scanner, 0o755)
    vi.stubEnv('OTHER_REPO', second)
    vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env.PATH}`)
    assert.throws(() => syncGitRepository(first, 'publish', false), /Git push failed/)
    assert.equal(git(first, 'rev-parse', 'HEAD'), local)
    assert.equal(git(remote, 'rev-parse', 'main'), concurrent)
  })

  it.skipIf(spawnSync('gitleaks', ['version']).status !== 0)('uses real gitleaks to detect a value removed in a later outgoing commit', () => {
    const original = git(remote, 'rev-parse', 'main')
    const config = path.join(root, 'gitleaks.toml')
    writeFile(config, '[[rules]]\nid = "sync-test"\ndescription = "Harmless test sentinel"\nregex = "SYNC_TEST_SENTINEL"\n')
    vi.stubEnv('GITLEAKS_CONFIG', config)
    commit(first, 'SYNC_TEST_SENTINEL')
    git(first, 'rm', 'SYNC_TEST_SENTINEL')
    git(first, 'commit', '-m', 'remove test sentinel')
    assert.throws(() => syncGitRepository(first, 'publish', false), /scan failed/)
    assert.equal(git(remote, 'rev-parse', 'main'), original)
  })
})
