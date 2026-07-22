import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, it } from 'vitest'
import { createTempDir, removePath, writeFile } from './utils'

const guardPath = fileURLToPath(new URL('../../../home/dot_local/libexec/executable_git-confirm-large-push', import.meta.url))
const defaultRemoteUrl = 'git@github.com:example/repo.git'
const tempDirs: string[] = []

interface GuardFixture {
  repoRoot: string
  env: NodeJS.ProcessEnv
  hookInput: string
  binDir: string
  emptyRemoteUrl: string
}

interface FakeOsascriptOptions {
  markerPath?: string
  estimatePath?: string
  repositoryPath?: string
  remotePath?: string
}

function createGuardFixture(blobBytes: number, thresholdBytes: number): GuardFixture {
  const tempDir = createTempDir('git-large-push-guard-')
  const repoRoot = path.join(tempDir, 'repo')
  const homeRoot = path.join(tempDir, 'home')
  const binDir = path.join(tempDir, 'bin')
  tempDirs.push(tempDir)
  fs.mkdirSync(repoRoot)
  fs.mkdirSync(homeRoot)
  fs.mkdirSync(binDir)

  const env = {
    ...process.env,
    HOME: homeRoot,
    XDG_CONFIG_HOME: path.join(homeRoot, '.config'),
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
  }

  runGit(repoRoot, env, ['init', '-q', '-b', 'main'])
  runGit(repoRoot, env, ['config', 'user.name', 'Guard Test'])
  runGit(repoRoot, env, ['config', 'user.email', 'guard@example.com'])
  runGit(repoRoot, env, ['config', 'workstation.largePushGuardBytes', String(thresholdBytes)])
  const emptyRemoteRoot = path.join(tempDir, 'empty-remote.git')
  runGit(repoRoot, env, ['init', '--bare', '-q', emptyRemoteRoot])
  const emptyRemoteUrl = pathToFileURL(emptyRemoteRoot).href
  runGit(repoRoot, env, ['config', `url.${emptyRemoteUrl}.insteadOf`, defaultRemoteUrl])
  fs.writeFileSync(path.join(repoRoot, 'payload.bin'), randomBytes(blobBytes))
  runGit(repoRoot, env, ['add', 'payload.bin'])
  runGit(repoRoot, env, ['commit', '-q', '-m', 'test payload'])

  const oid = runGit(repoRoot, env, ['rev-parse', 'HEAD']).trim()
  const zeroOid = '0'.repeat(oid.length)

  return {
    repoRoot,
    env,
    hookInput: `refs/heads/main ${oid} refs/heads/main ${zeroOid}\n`,
    binDir,
    emptyRemoteUrl,
  }
}

function runGit(repoRoot: string, env: NodeJS.ProcessEnv, args: string[]) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    env,
  })
}

function writeFakeOsascript(binDir: string, exitCode: number, options: FakeOsascriptOptions = {}) {
  const lines = [
    '#!/bin/sh',
    options.markerPath ? `: > "${options.markerPath}"` : ':',
    options.estimatePath ? `printf '%s\n' "$4" > "${options.estimatePath}"` : ':',
    options.repositoryPath ? `printf '%s\n' "$2" > "${options.repositoryPath}"` : ':',
    options.remotePath ? `printf '%s\n' "$3" > "${options.remotePath}"` : ':',
    `exit ${exitCode}`,
    '',
  ]
  const scriptPath = path.join(binDir, 'osascript')
  writeFile(scriptPath, lines.join('\n'))
  fs.chmodSync(scriptPath, 0o755)
}

function runGuard(fixture: GuardFixture, remoteUrl = defaultRemoteUrl, remoteName = 'origin') {
  return spawnSync(guardPath, [remoteName, remoteUrl], {
    cwd: fixture.repoRoot,
    encoding: 'utf-8',
    env: fixture.env,
    input: fixture.hookInput,
  })
}

afterEach(() => {
  while (tempDirs.length > 0)
    removePath(tempDirs.pop())
})

describe('github large-push guard', () => {
  it('skips non-GitHub remotes', () => {
    const fixture = createGuardFixture(32 * 1024, 1024)
    writeFakeOsascript(fixture.binDir, 1)

    const result = runGuard(fixture, 'git@git.example.com:example/repo.git')

    assert.equal(result.status, 0, result.stderr)
  })

  it('does not prompt when the estimated pack stays below the threshold', () => {
    const fixture = createGuardFixture(128, 800 * 1024)
    const markerPath = path.join(path.dirname(fixture.repoRoot), 'prompted')
    writeFakeOsascript(fixture.binDir, 1, { markerPath })

    const result = runGuard(fixture)

    assert.equal(result.status, 0, result.stderr)
    assert.equal(fs.existsSync(markerPath), false)
  })

  it('prompts when only a stale remote-tracking ref contains the history', () => {
    const fixture = createGuardFixture(32 * 1024, 1024)
    const githubUrl = 'https://github.com/example/repo.git'
    const missingRemoteUrl = pathToFileURL(path.join(path.dirname(fixture.repoRoot), 'missing.git')).href
    runGit(fixture.repoRoot, fixture.env, ['config', `url.${missingRemoteUrl}.insteadOf`, githubUrl])
    const baseOid = runGit(fixture.repoRoot, fixture.env, ['rev-parse', 'HEAD']).trim()
    runGit(fixture.repoRoot, fixture.env, ['update-ref', 'refs/remotes/origin/main', baseOid])
    fs.writeFileSync(path.join(fixture.repoRoot, 'small-change.txt'), 'small change\n')
    runGit(fixture.repoRoot, fixture.env, ['add', 'small-change.txt'])
    runGit(fixture.repoRoot, fixture.env, ['commit', '-q', '-m', 'small change'])
    const newBranchOid = runGit(fixture.repoRoot, fixture.env, ['rev-parse', 'HEAD']).trim()
    fixture.hookInput = `refs/heads/feature ${newBranchOid} refs/heads/feature ${'0'.repeat(newBranchOid.length)}\n`
    const markerPath = path.join(path.dirname(fixture.repoRoot), 'prompted')
    writeFakeOsascript(fixture.binDir, 1, { markerPath })

    const result = runGuard(fixture, githubUrl)

    assert.equal(result.status, 1)
    assert.equal(fs.existsSync(markerPath), true)
  })

  it('does not count history advertised by another remote branch', () => {
    const fixture = createGuardFixture(32 * 1024, 1024)
    const remoteRoot = path.join(path.dirname(fixture.repoRoot), 'remote.git')
    const remoteUrl = pathToFileURL(remoteRoot).href
    const githubUrl = 'https://github.com/example/repo.git'
    runGit(fixture.repoRoot, fixture.env, ['init', '--bare', '-q', remoteRoot])
    runGit(fixture.repoRoot, fixture.env, ['remote', 'add', 'fixture', remoteUrl])
    runGit(fixture.repoRoot, fixture.env, ['push', '-q', 'fixture', 'HEAD:refs/heads/main'])
    runGit(fixture.repoRoot, fixture.env, ['config', `url.${remoteUrl}.insteadOf`, githubUrl])
    fs.writeFileSync(path.join(fixture.repoRoot, 'small-change.txt'), 'small change\n')
    runGit(fixture.repoRoot, fixture.env, ['add', 'small-change.txt'])
    runGit(fixture.repoRoot, fixture.env, ['commit', '-q', '-m', 'small change'])
    const newBranchOid = runGit(fixture.repoRoot, fixture.env, ['rev-parse', 'HEAD']).trim()
    fixture.hookInput = `refs/heads/feature ${newBranchOid} refs/heads/feature ${'0'.repeat(newBranchOid.length)}\n`
    const markerPath = path.join(path.dirname(fixture.repoRoot), 'prompted')
    writeFakeOsascript(fixture.binDir, 1, { markerPath })

    const result = runGuard(fixture, githubUrl)

    assert.equal(result.status, 0, result.stderr)
    assert.equal(fs.existsSync(markerPath), false)
  })

  it('blocks a large push when confirmation is cancelled', () => {
    const fixture = createGuardFixture(32 * 1024, 1024)
    writeFakeOsascript(fixture.binDir, 1)

    const result = runGuard(fixture)

    assert.equal(result.status, 1)
    assert.match(result.stderr, /已取消 GitHub 大流量推送/)
  })

  it('shows the exact estimated pack size when estimation completes', () => {
    const fixture = createGuardFixture(32 * 1024, 1024)
    const estimatePath = path.join(path.dirname(fixture.repoRoot), 'estimate')
    writeFakeOsascript(fixture.binDir, 1, { estimatePath })

    const result = runGuard(fixture)

    assert.equal(result.status, 1)
    const estimate = fs.readFileSync(estimatePath, 'utf-8').trim()
    assert.match(estimate, /^\d+ KiB$/)
    assert.doesNotMatch(estimate, /超过/)
  })

  it('shows the GitHub owner and repository in the prompt', () => {
    const fixture = createGuardFixture(32 * 1024, 1024)
    const repositoryPath = path.join(path.dirname(fixture.repoRoot), 'repository')
    writeFakeOsascript(fixture.binDir, 1, { repositoryPath })

    const result = runGuard(fixture)

    assert.equal(result.status, 1)
    assert.equal(fs.readFileSync(repositoryPath, 'utf-8').trim(), 'github.com/example/repo')
  })

  it('omits direct-URL credentials from every prompt field', () => {
    const fixture = createGuardFixture(32 * 1024, 1024)
    const repositoryPath = path.join(path.dirname(fixture.repoRoot), 'repository')
    const remotePath = path.join(path.dirname(fixture.repoRoot), 'remote')
    writeFakeOsascript(fixture.binDir, 1, { repositoryPath, remotePath })
    const remoteUrl = 'https://oauth2:secret@github.com/example/repo.git?access_token=secret#fragment'
    runGit(fixture.repoRoot, fixture.env, ['config', `url.${fixture.emptyRemoteUrl}.insteadOf`, remoteUrl])

    const result = runGuard(fixture, remoteUrl, remoteUrl)

    assert.equal(result.status, 1)
    assert.equal(fs.readFileSync(repositoryPath, 'utf-8').trim(), 'github.com/example/repo')
    assert.equal(fs.readFileSync(remotePath, 'utf-8').trim(), '直接地址')
  })

  it('bounds estimation at 10 MiB', () => {
    const fixture = createGuardFixture(11 * 1024 * 1024, 1024)
    const estimatePath = path.join(path.dirname(fixture.repoRoot), 'estimate')
    writeFakeOsascript(fixture.binDir, 1, { estimatePath })

    const result = runGuard(fixture)

    assert.equal(result.status, 1)
    assert.equal(fs.readFileSync(estimatePath, 'utf-8').trim(), '超过 10.0 MiB')
  })

  it('allows a large push after confirmation', () => {
    const fixture = createGuardFixture(32 * 1024, 1024)
    writeFakeOsascript(fixture.binDir, 0)

    const result = runGuard(fixture)

    assert.equal(result.status, 0, result.stderr)
  })
})
