import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, it } from 'vitest'
import { createTempDir, gitLargePushGuardPath, removePath, runCli, writeFile } from './utils'

let tempDir: string | undefined

function createInitFixture() {
  tempDir = createTempDir('workstation-init-')
  const repoRoot = path.join(tempDir, 'repo')
  const homeRoot = path.join(tempDir, 'home')
  fs.mkdirSync(repoRoot)
  fs.mkdirSync(homeRoot)

  return {
    repoRoot,
    homeRoot,
  }
}

function gitConfigPath(homeRoot: string) {
  return path.join(homeRoot, '.gitconfig')
}

function githubConfigPath(homeRoot: string) {
  return path.join(homeRoot, '.gitconfig-github')
}

function workConfigPath(homeRoot: string) {
  return path.join(homeRoot, '.gitconfig-work')
}

function countOccurrences(value: string, pattern: string) {
  return value.split(pattern).length - 1
}

function writeFakeGit(binDir: string, version = '2.55.0') {
  const scriptPath = path.join(binDir, 'git')
  writeFile(scriptPath, [
    '#!/usr/bin/env node',
    `console.log("git version ${version}")`,
    '',
  ].join('\n'))
  fs.chmodSync(scriptPath, 0o755)

  writeFile(path.join(binDir, 'git.cmd'), [
    '@echo off',
    `node "${scriptPath}" %*`,
    '',
  ].join('\r\n'))
}

afterEach(() => {
  removePath(tempDir)
  tempDir = undefined
})

describe('init CLI', () => {
  it('lists available init tasks', () => {
    const fixture = createInitFixture()
    const result = runCli(['init', '--list'], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /git\.include-if/)
    assert.match(result.stdout, /git\.large-push-guard/)
    assert.match(result.stdout, /recommended/)
    assert.match(result.stdout, /optional/)
  })

  it('blocks the large-push guard setup until its executable is synced', () => {
    const fixture = createInitFixture()
    const binDir = path.join(tempDir!, 'bin')
    writeFakeGit(binDir)

    const result = runCli(
      ['init', 'git.large-push-guard', '--yes'],
      fixture.repoRoot,
      fixture.homeRoot,
      { PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}` },
    )

    assert.equal(result.status, 1)
    assert.match(`${result.stdout}\n${result.stderr}`, /missing or not executable/)
    assert.match(`${result.stdout}\n${result.stderr}`, /dotfiles chezmoi apply/)
    assert.equal(fs.existsSync(gitConfigPath(fixture.homeRoot)), false)
  })

  it('installs the Git 2.55 configured hook idempotently', () => {
    const fixture = createInitFixture()
    const binDir = path.join(tempDir!, 'bin')
    const guardPath = gitLargePushGuardPath(fixture.homeRoot)
    writeFakeGit(binDir)
    writeFile(guardPath, '#!/bin/sh\nexit 0\n')
    fs.chmodSync(guardPath, 0o755)

    const args = ['init', 'git.large-push-guard', '--yes']
    const env = { PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}` }
    const first = runCli(args, fixture.repoRoot, fixture.homeRoot, env)
    const second = runCli(args, fixture.repoRoot, fixture.homeRoot, env)

    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`)
    assert.match(second.stdout, /\[unchanged\] ~\/\.gitconfig/)

    const globalConfig = fs.readFileSync(gitConfigPath(fixture.homeRoot), 'utf-8')
    assert.equal(countOccurrences(globalConfig, '[hook "workstation-large-push-guard"]'), 1)
    assert.match(globalConfig, /command = ~\/\.local\/libexec\/git-confirm-large-push/)
    assert.match(globalConfig, /event = pre-push/)
  })

  it('requires Git 2.55 for the configured large-push hook', () => {
    const fixture = createInitFixture()
    const binDir = path.join(tempDir!, 'bin')
    const guardPath = gitLargePushGuardPath(fixture.homeRoot)
    writeFakeGit(binDir, '2.54.0')
    writeFile(guardPath, '#!/bin/sh\nexit 0\n')
    fs.chmodSync(guardPath, 0o755)

    const result = runCli(
      ['init', 'git.large-push-guard', '--yes'],
      fixture.repoRoot,
      fixture.homeRoot,
      { PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}` },
    )

    assert.equal(result.status, 1)
    assert.match(`${result.stdout}\n${result.stderr}`, /Git 2\.54\.0 is too old/)
    assert.equal(fs.existsSync(gitConfigPath(fixture.homeRoot)), false)
  })

  it('previews git includeIf identity routing by default', () => {
    const fixture = createInitFixture()
    const result = runCli([
      'init',
      'git.include-if',
      '--git-profile',
      'id=github;host=github.com;name=YunYouJun;email=me@yunyoujun.cn',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /Dry-run mode/)
    assert.match(result.stdout, /\[create\] ~\/\.gitconfig/)
    assert.equal(fs.existsSync(gitConfigPath(fixture.homeRoot)), false)
    assert.equal(fs.existsSync(githubConfigPath(fixture.homeRoot)), false)
  })

  it('applies git includeIf identity routing for multiple profiles', () => {
    const fixture = createInitFixture()
    const result = runCli([
      'init',
      'git.include-if',
      '--git-profile',
      'id=github;host=github.com;name=YunYouJun;email=me@yunyoujun.cn',
      '--git-profile',
      'id=work;host=git.example.com;name=Work User;email=you@company.example',
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /verified planned file contents/)

    const globalConfig = fs.readFileSync(gitConfigPath(fixture.homeRoot), 'utf-8')
    assert.match(globalConfig, /\[user\]\n\tuseConfigOnly = true/)
    assert.match(globalConfig, new RegExp(`\\[includeIf "gitdir:${escapeRegExp(path.join(fixture.homeRoot, 'repos', 'github.com'))}/"\\]`))
    assert.match(globalConfig, new RegExp(`\\[includeIf "gitdir:${escapeRegExp(path.join(fixture.homeRoot, 'repos', 'git.example.com'))}/"\\]`))
    assert.match(globalConfig, new RegExp(`path = ${escapeRegExp(githubConfigPath(fixture.homeRoot))}`))
    assert.match(globalConfig, new RegExp(`path = ${escapeRegExp(workConfigPath(fixture.homeRoot))}`))

    assert.equal(fs.readFileSync(githubConfigPath(fixture.homeRoot), 'utf-8'), [
      '[user]',
      '\tname = YunYouJun',
      '\temail = me@yunyoujun.cn',
      '',
    ].join('\n'))
    assert.equal(fs.readFileSync(workConfigPath(fixture.homeRoot), 'utf-8'), [
      '[user]',
      '\tname = Work User',
      '\temail = you@company.example',
      '',
    ].join('\n'))
  })

  it('updates existing git config idempotently', () => {
    const fixture = createInitFixture()
    const args = [
      'init',
      'git.include-if',
      '--git-profile',
      'id=github;host=github.com;name=YunYouJun;email=me@yunyoujun.cn',
      '--yes',
    ]

    const first = runCli(args, fixture.repoRoot, fixture.homeRoot)
    const second = runCli(args, fixture.repoRoot, fixture.homeRoot)

    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`)
    assert.match(second.stdout, /\[unchanged\] ~\/\.gitconfig/)
    assert.match(second.stdout, /\[unchanged\] ~\/\.gitconfig-github/)

    const globalConfig = fs.readFileSync(gitConfigPath(fixture.homeRoot), 'utf-8')
    assert.equal(countOccurrences(globalConfig, '[includeIf "gitdir:'), 1)
    assert.equal(countOccurrences(globalConfig, 'useConfigOnly = true'), 1)
  })

  it('removes default global git identity when includeIf routing is applied', () => {
    const fixture = createInitFixture()
    writeFile(gitConfigPath(fixture.homeRoot), [
      '[user]',
      '\tname = Old Default',
      '\temail = old@example.com',
      '',
    ].join('\n'))

    const result = runCli([
      'init',
      'git.include-if',
      '--git-profile',
      'id=github;host=github.com;name=YunYouJun;email=me@yunyoujun.cn',
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)

    const globalConfig = fs.readFileSync(gitConfigPath(fixture.homeRoot), 'utf-8')
    assert.match(globalConfig, /\[user\]\n\tuseConfigOnly = true/)
    assert.doesNotMatch(globalConfig, /name = Old Default/)
    assert.doesNotMatch(globalConfig, /email = old@example\.com/)
    assert.equal(fs.readFileSync(githubConfigPath(fixture.homeRoot), 'utf-8'), [
      '[user]',
      '\tname = YunYouJun',
      '\temail = me@yunyoujun.cn',
      '',
    ].join('\n'))
  })

  it('allows multiple includeIf routes to share one identity file', () => {
    const fixture = createInitFixture()
    const githubConfig = githubConfigPath(fixture.homeRoot)
    const result = runCli([
      'init',
      'git.include-if',
      '--git-profile',
      `id=github;gitdir=~/repos/github.com;configPath=${githubConfig};name=YunYouJun;email=me@yunyoujun.cn`,
      '--git-profile',
      `id=github-legacy;gitdir=~/repos/gh;configPath=${githubConfig};name=YunYouJun;email=me@yunyoujun.cn`,
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)

    const globalConfig = fs.readFileSync(gitConfigPath(fixture.homeRoot), 'utf-8')
    assert.equal(countOccurrences(globalConfig, '[includeIf "gitdir:'), 2)
    assert.equal(fs.readFileSync(githubConfig, 'utf-8'), [
      '[user]',
      '\tname = YunYouJun',
      '\temail = me@yunyoujun.cn',
      '',
    ].join('\n'))
  })

  it('infers the default github profile from an existing identity file', () => {
    const fixture = createInitFixture()
    writeFile(githubConfigPath(fixture.homeRoot), [
      '[user]',
      '\tname = Existing User',
      '\temail = existing@example.com',
      '',
    ].join('\n'))

    const result = runCli(['init', 'git.include-if', '--yes'], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const globalConfig = fs.readFileSync(gitConfigPath(fixture.homeRoot), 'utf-8')
    assert.match(globalConfig, new RegExp(`path = ${escapeRegExp(githubConfigPath(fixture.homeRoot))}`))
  })
})

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
