import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, it } from 'vitest'
import { createTempDir, removePath, writeFile } from './utils'

const guardPath = fileURLToPath(new URL('../../../home/dot_local/libexec/executable_git-confirm-large-push', import.meta.url))
const tempDirs: string[] = []

interface GuardFixture {
  repoRoot: string
  env: NodeJS.ProcessEnv
  hookInput: string
  binDir: string
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
  }
}

function runGit(repoRoot: string, env: NodeJS.ProcessEnv, args: string[]) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    env,
  })
}

function writeFakeOsascript(binDir: string, exitCode: number, markerPath?: string, estimatePath?: string) {
  const lines = [
    '#!/bin/sh',
    markerPath ? `: > "${markerPath}"` : ':',
    estimatePath ? `printf '%s\n' "$4" > "${estimatePath}"` : ':',
    `exit ${exitCode}`,
    '',
  ]
  const scriptPath = path.join(binDir, 'osascript')
  writeFile(scriptPath, lines.join('\n'))
  fs.chmodSync(scriptPath, 0o755)
}

function runGuard(fixture: GuardFixture, remoteUrl = 'git@github.com:example/repo.git') {
  return spawnSync(guardPath, ['origin', remoteUrl], {
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
    writeFakeOsascript(fixture.binDir, 1, markerPath)

    const result = runGuard(fixture)

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
    writeFakeOsascript(fixture.binDir, 1, undefined, estimatePath)

    const result = runGuard(fixture)

    assert.equal(result.status, 1)
    const estimate = fs.readFileSync(estimatePath, 'utf-8').trim()
    assert.match(estimate, /^\d+ KiB$/)
    assert.doesNotMatch(estimate, /超过/)
  })

  it('bounds estimation at 10 MiB', () => {
    const fixture = createGuardFixture(11 * 1024 * 1024, 1024)
    const estimatePath = path.join(path.dirname(fixture.repoRoot), 'estimate')
    writeFakeOsascript(fixture.binDir, 1, undefined, estimatePath)

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
