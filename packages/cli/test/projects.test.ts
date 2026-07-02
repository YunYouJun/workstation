import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, it } from 'vitest'
import { createTempDir, removePath, runCli, writeFile } from './utils'

interface FakeRepo {
  nameWithOwner: string
  sshUrl: string
  url: string
  pushedAt: string
  isArchived: boolean
  isFork: boolean
}

let tempDir: string | undefined

function makeRepo(nameWithOwner: string): FakeRepo {
  const [owner, name] = nameWithOwner.split('/')
  return {
    nameWithOwner,
    sshUrl: `git@github.com:${owner}/${name}.git`,
    url: `https://github.com/${owner}/${name}`,
    pushedAt: '2026-07-01T08:44:46Z',
    isArchived: false,
    isFork: false,
  }
}

function writeExecutable(filePath: string, lines: string[]) {
  writeFile(filePath, [
    `#!${process.execPath}`,
    ...lines,
    '',
  ].join('\n'))
  fs.chmodSync(filePath, 0o755)
}

function writeFakeGh(binDir: string, repositories: FakeRepo[]) {
  writeExecutable(path.join(binDir, 'gh'), [
    'const fs = require("node:fs")',
    'const args = process.argv.slice(2)',
    'const callsPath = process.env.FAKE_GH_CALLS',
    'if (callsPath) {',
    '  const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, "utf-8")) : []',
    '  calls.push(args)',
    '  fs.writeFileSync(callsPath, JSON.stringify(calls))',
    '}',
    'const response = { data: { repositoryOwner: { repositories: { nodes: JSON.parse(process.env.FAKE_GH_REPOS || "[]") } } } }',
    'process.stdout.write(JSON.stringify(response))',
  ])

  writeFile(path.join(binDir, 'gh.cmd'), [
    '@echo off',
    `node "${path.join(binDir, 'gh')}" %*`,
    '',
  ].join('\r\n'))

  return {
    FAKE_GH_REPOS: JSON.stringify(repositories),
  }
}

function writeFakeGit(binDir: string) {
  writeExecutable(path.join(binDir, 'git'), [
    'const fs = require("node:fs")',
    'const path = require("node:path")',
    'const args = process.argv.slice(2)',
    'const callsPath = process.env.FAKE_GIT_CALLS',
    'if (callsPath) {',
    '  const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, "utf-8")) : []',
    '  calls.push(args)',
    '  fs.writeFileSync(callsPath, JSON.stringify(calls))',
    '}',
    'if (args.join(" ") === "config --get-all ghq.root") {',
    '  if (process.env.FAKE_GHQ_ROOTS) {',
    '    process.stdout.write(process.env.FAKE_GHQ_ROOTS)',
    '    process.exit(0)',
    '  }',
    '  process.exit(1)',
    '}',
    'if (args[0] === "clone") {',
    '  if (process.env.FAKE_GIT_MANIFEST_REPO && args[1] === process.env.FAKE_GIT_MANIFEST_REPO) {',
    '    const target = args[2]',
    '    fs.mkdirSync(path.join(target, ".git"), { recursive: true })',
    '    fs.writeFileSync(path.join(target, "projects.yaml"), process.env.FAKE_GIT_MANIFEST_CONTENT || "")',
    '    process.exit(0)',
    '  }',
    '  const target = args[2]',
    '  fs.mkdirSync(target, { recursive: true })',
    '  fs.writeFileSync(path.join(target, ".fake-clone"), args[1])',
    '  process.exit(0)',
    '}',
    'if (args[0] === "-C" && args[2] === "pull") {',
    '  process.exit(0)',
    '}',
    'process.exit(0)',
  ])

  writeFile(path.join(binDir, 'git.cmd'), [
    '@echo off',
    `node "${path.join(binDir, 'git')}" %*`,
    '',
  ].join('\r\n'))
}

function writeFakeGhq(binDir: string) {
  writeExecutable(path.join(binDir, 'ghq'), [
    'const fs = require("node:fs")',
    'const args = process.argv.slice(2)',
    'const callsPath = process.env.FAKE_GHQ_CALLS',
    'if (callsPath) {',
    '  const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, "utf-8")) : []',
    '  calls.push(args)',
    '  fs.writeFileSync(callsPath, JSON.stringify(calls))',
    '}',
    'process.exit(0)',
  ])

  writeFile(path.join(binDir, 'ghq.cmd'), [
    '@echo off',
    `node "${path.join(binDir, 'ghq')}" %*`,
    '',
  ].join('\r\n'))
}

function createProjectsFixture(repositories: FakeRepo[]) {
  tempDir = createTempDir('dotfiles-projects-')
  const repoRoot = path.join(tempDir, 'repo')
  const homeRoot = path.join(tempDir, 'home')
  const binDir = path.join(tempDir, 'bin')
  const projectsRoot = path.join(tempDir, 'repos')
  fs.mkdirSync(repoRoot)
  fs.mkdirSync(homeRoot)
  fs.mkdirSync(binDir)

  const ghEnv = writeFakeGh(binDir, repositories)
  writeFakeGit(binDir)

  return {
    tempDir,
    repoRoot,
    homeRoot,
    binDir,
    projectsRoot,
    env: {
      PATH: binDir,
      ...ghEnv,
    },
  }
}

function runGit(args: string[], cwd: string) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
  })

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return result
}

function createLocalGitRepo(projectsRoot: string, name: string) {
  const repositoryPath = path.join(projectsRoot, ...name.split('/'))
  fs.mkdirSync(repositoryPath, { recursive: true })
  runGit(['init'], repositoryPath)
  return repositoryPath
}

function createStatusFixture() {
  tempDir = createTempDir('dotfiles-projects-status-')
  const repoRoot = path.join(tempDir, 'repo')
  const homeRoot = path.join(tempDir, 'home')
  const projectsRoot = path.join(tempDir, 'repos')
  fs.mkdirSync(repoRoot)
  fs.mkdirSync(homeRoot)
  fs.mkdirSync(projectsRoot)

  return {
    tempDir,
    repoRoot,
    homeRoot,
    projectsRoot,
  }
}

afterEach(() => {
  removePath(tempDir)
  tempDir = undefined
})

describe('projects CLI', () => {
  it('previews active repository clones by default', () => {
    const fixture = createProjectsFixture([makeRepo('YunYouJun/workstation')])
    const result = runCli(['projects', 'clone-active', '--root', fixture.projectsRoot], fixture.repoRoot, fixture.homeRoot, fixture.env)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /\[dry-run\] Would clone/)
    assert.match(`${result.stdout}\n${result.stderr}`, /YunYouJun\/workstation/)
    assert.equal(fs.existsSync(path.join(fixture.projectsRoot, 'github.com', 'YunYouJun', 'workstation')), false)
  })

  it('supports the short projects alias', () => {
    const fixture = createProjectsFixture([makeRepo('YunYouJun/workstation')])
    const result = runCli(['p', 'active', '--root', fixture.projectsRoot], fixture.repoRoot, fixture.homeRoot, fixture.env)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /\[dry-run\] Would clone/)
    assert.match(`${result.stdout}\n${result.stderr}`, /YunYouJun\/workstation/)
  })

  it('previews repositories from a local project manifest', () => {
    const fixture = createProjectsFixture([])
    const manifestPath = path.join(fixture.repoRoot, 'projects.local.yaml')
    writeFile(manifestPath, [
      'groups:',
      '  work:',
      '    repositories:',
      '      - name: git.example.com/example/service',
      '        url: git@git.example.com:example/service.git',
      '',
    ].join('\n'))

    const result = runCli(['projects', 'manifest', '--file', manifestPath, '--root', fixture.projectsRoot], fixture.repoRoot, fixture.homeRoot, fixture.env)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /\[dry-run\] Would clone/)
    assert.match(`${result.stdout}\n${result.stderr}`, /git\.example\.com\/example\/service/)
    assert.match(`${result.stdout}\n${result.stderr}`, /git@git\.example\.com:example\/service\.git/)
    assert.equal(fs.existsSync(path.join(fixture.projectsRoot, 'git.example.com', 'example', 'service')), false)
  })

  it('clones repositories from a local project manifest', () => {
    const fixture = createProjectsFixture([])
    const callsPath = path.join(fixture.tempDir, 'git-calls.json')
    const manifestPath = path.join(fixture.repoRoot, 'projects.local.yaml')
    writeFile(manifestPath, [
      'groups:',
      '  work:',
      `    root: ${fixture.projectsRoot}`,
      '    repositories:',
      '      - name: git.example.com/example/service',
      '        url: git@git.example.com:example/service.git',
      '',
    ].join('\n'))

    const result = runCli(['projects', 'manifest', '--file', manifestPath, '--yes'], fixture.repoRoot, fixture.homeRoot, {
      ...fixture.env,
      FAKE_GIT_CALLS: callsPath,
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)

    const targetPath = path.join(fixture.projectsRoot, 'git.example.com', 'example', 'service')
    assert.equal(fs.existsSync(path.join(targetPath, '.fake-clone')), true)

    const gitCalls = JSON.parse(fs.readFileSync(callsPath, 'utf-8'))
    assert.deepEqual(gitCalls.at(-1), [
      'clone',
      'git@git.example.com:example/service.git',
      targetPath,
    ])
  })

  it('reads a project manifest from a private configuration repository', () => {
    const fixture = createProjectsFixture([])
    const callsPath = path.join(fixture.tempDir, 'git-calls.json')
    const manifestRepo = 'https://git.example.com/example/config'
    const manifest = [
      'groups:',
      '  common:',
      '    repositories:',
      '      - name: git.example.com/example/service',
      '',
    ].join('\n')

    const result = runCli(['p', 'manifest', manifestRepo, '--group', 'common', '--root', fixture.projectsRoot], fixture.repoRoot, fixture.homeRoot, {
      ...fixture.env,
      FAKE_GIT_CALLS: callsPath,
      FAKE_GIT_MANIFEST_REPO: manifestRepo,
      FAKE_GIT_MANIFEST_CONTENT: manifest,
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /\[dry-run\] Would clone: git@git\.example\.com:example\/service\.git/)
    assert.match(`${result.stdout}\n${result.stderr}`, /git\.example\.com\/example\/service/)

    const gitCalls = JSON.parse(fs.readFileSync(callsPath, 'utf-8'))
    const manifestCachePath = gitCalls[0][2]
    const manifestCachePrefix = path.join(fixture.homeRoot, '.cache', 'workstation', 'project-manifests', 'example-config-')
    assert.equal(gitCalls[0][0], 'clone')
    assert.equal(gitCalls[0][1], manifestRepo)
    assert.equal(manifestCachePath.startsWith(manifestCachePrefix), true)
    assert.equal(path.basename(manifestCachePath).length, 'example-config-'.length + 12)
  })

  it('uses the configured active project limit from the environment', () => {
    const fixture = createProjectsFixture([makeRepo('YunYouJun/workstation')])
    const callsPath = path.join(fixture.tempDir, 'gh-calls.json')
    const result = runCli(['projects', 'clone-active', '--root', fixture.projectsRoot], fixture.repoRoot, fixture.homeRoot, {
      ...fixture.env,
      FAKE_GH_CALLS: callsPath,
      WORKSTATION_ACTIVE_PROJECT_LIMIT: '12',
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)

    const ghCalls = JSON.parse(fs.readFileSync(callsPath, 'utf-8'))
    assert.equal(ghCalls[0].includes('limit=12'), true)
  })

  it('clones missing repositories with explicit git paths when ghq is unavailable', () => {
    const fixture = createProjectsFixture([makeRepo('YunYouJun/workstation')])
    const callsPath = path.join(fixture.tempDir, 'git-calls.json')
    const result = runCli(['projects', 'clone-active', '--root', fixture.projectsRoot, '--yes'], fixture.repoRoot, fixture.homeRoot, {
      ...fixture.env,
      FAKE_GIT_CALLS: callsPath,
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)

    const targetPath = path.join(fixture.projectsRoot, 'github.com', 'YunYouJun', 'workstation')
    assert.equal(fs.existsSync(path.join(targetPath, '.fake-clone')), true)

    const gitCalls = JSON.parse(fs.readFileSync(callsPath, 'utf-8'))
    assert.deepEqual(gitCalls.at(-1), [
      'clone',
      'git@github.com:YunYouJun/workstation.git',
      targetPath,
    ])
  })

  it('skips existing repositories unless update is requested', () => {
    const fixture = createProjectsFixture([makeRepo('YunYouJun/workstation')])
    const targetPath = path.join(fixture.projectsRoot, 'github.com', 'YunYouJun', 'workstation')
    fs.mkdirSync(targetPath, { recursive: true })

    const result = runCli(['projects', 'clone-active', '--root', fixture.projectsRoot, '--yes'], fixture.repoRoot, fixture.homeRoot, fixture.env)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /Already exists/)
  })

  it('uses ghq when the primary ghq root matches the requested root', () => {
    const fixture = createProjectsFixture([makeRepo('YunYouJun/workstation')])
    writeFakeGhq(fixture.binDir)
    const callsPath = path.join(fixture.tempDir, 'ghq-calls.json')

    const result = runCli(['projects', 'clone-active', '--root', fixture.projectsRoot, '--yes'], fixture.repoRoot, fixture.homeRoot, {
      ...fixture.env,
      FAKE_GHQ_ROOTS: fixture.projectsRoot,
      FAKE_GHQ_CALLS: callsPath,
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /Using ghq/)

    const ghqCalls = JSON.parse(fs.readFileSync(callsPath, 'utf-8'))
    assert.deepEqual(ghqCalls.at(-1), [
      'get',
      'git@github.com:YunYouJun/workstation.git',
    ])
  })

  it('reports local repositories with uncommitted files', () => {
    const fixture = createStatusFixture()
    const repositoryPath = createLocalGitRepo(fixture.projectsRoot, 'github.com/YunYouJun/workstation')
    writeFile(path.join(repositoryPath, 'notes.md'), 'draft\n')

    const result = runCli(['projects', 'status', '--root', fixture.projectsRoot], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /github\.com\/YunYouJun\/workstation/)
    assert.match(`${result.stdout}\n${result.stderr}`, /1 untracked/)
  })

  it('exits non-zero in check mode when repositories need attention', () => {
    const fixture = createStatusFixture()
    const repositoryPath = createLocalGitRepo(fixture.projectsRoot, 'github.com/YunYouJun/workstation')
    writeFile(path.join(repositoryPath, 'notes.md'), 'draft\n')

    const result = runCli(['p', 'status', '--root', fixture.projectsRoot, '--check'], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /need attention/)
  })

  it('shows clean repositories when requested', () => {
    const fixture = createStatusFixture()
    createLocalGitRepo(fixture.projectsRoot, 'github.com/YunYouJun/workstation')

    const result = runCli(['p', 'status', '--root', fixture.projectsRoot, '--all'], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /github\.com\/YunYouJun\/workstation/)
    assert.match(`${result.stdout}\n${result.stderr}`, /clean/)
  })
})
