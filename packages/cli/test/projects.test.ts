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
  const nodePath = process.execPath.replace(/'/g, `'\\''`)
  writeFile(filePath, [
    '#!/bin/sh',
    `exec '${nodePath}' - "$@" <<'__WORKSTATION_FAKE_NODE__'`,
    ...lines,
    '__WORKSTATION_FAKE_NODE__',
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

function writeFakeCurl(binDir: string) {
  writeExecutable(path.join(binDir, 'curl'), [
    'const fs = require("node:fs")',
    'const args = process.argv.slice(2)',
    'const url = args.at(-1)',
    'const callsPath = process.env.FAKE_CURL_CALLS',
    'if (callsPath) {',
    '  const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, "utf-8")) : []',
    '  calls.push(args)',
    '  fs.writeFileSync(callsPath, JSON.stringify(calls))',
    '}',
    'const responses = JSON.parse(process.env.FAKE_CURL_RESPONSES || "{}")',
    'if (!(url in responses)) {',
    '  process.stderr.write("No fake curl response for " + url)',
    '  process.exit(22)',
    '}',
    'process.stdout.write(responses[url])',
  ])

  writeFile(path.join(binDir, 'curl.cmd'), [
    '@echo off',
    `node "${path.join(binDir, 'curl')}" %*`,
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
  writeFakeCurl(binDir)

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

  it('previews host-scoped shorthand repositories from a local project manifest', () => {
    const fixture = createProjectsFixture([])
    const manifestPath = path.join(fixture.repoRoot, 'projects.local.yaml')
    writeFile(manifestPath, [
      'groups:',
      '  work:',
      '    host: git.example.com',
      '    repositories:',
      '      - example/service',
      '',
    ].join('\n'))

    const result = runCli(['projects', 'manifest', '--file', manifestPath, '--root', fixture.projectsRoot], fixture.repoRoot, fixture.homeRoot, fixture.env)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /\[dry-run\] Would clone/)
    assert.match(`${result.stdout}\n${result.stderr}`, /git\.example\.com\/example\/service/)
    assert.match(`${result.stdout}\n${result.stderr}`, /git@git\.example\.com:example\/service\.git/)
    assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(path.join(fixture.projectsRoot, 'git.example.com', 'example', 'service').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  })

  it('validates latest project manifest format without clone preview', () => {
    const fixture = createProjectsFixture([])
    const manifestPath = path.join(fixture.repoRoot, 'projects.local.yaml')
    writeFile(manifestPath, [
      'groups:',
      '  work:',
      '    host: git.example.com',
      '    repositories:',
      '      - example/service',
      '',
    ].join('\n'))

    const result = runCli(['projects', 'manifest', '--file', manifestPath, '--root', fixture.projectsRoot, '--validate'], fixture.repoRoot, fixture.homeRoot, fixture.env)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /Project manifest is valid! 1 repositories/)
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Would clone/)
  })

  it('reports a helpful validation error when shorthand repositories are missing host', () => {
    const fixture = createProjectsFixture([])
    const manifestPath = path.join(fixture.repoRoot, 'projects.local.yaml')
    writeFile(manifestPath, [
      'groups:',
      '  work:',
      '    repositories:',
      '      - example/service',
      '',
    ].join('\n'))

    const result = runCli(['projects', 'manifest', '--file', manifestPath, '--root', fixture.projectsRoot], fixture.repoRoot, fixture.homeRoot, fixture.env)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /Invalid project manifest/)
    assert.match(`${result.stdout}\n${result.stderr}`, /groups\.work\.repositories\[0\]/)
    assert.match(`${result.stdout}\n${result.stderr}`, /Short project paths require a manifest or group host/)
    assert.match(`${result.stdout}\n${result.stderr}`, /Add host: git\.example\.com/)
  })

  it('reports duplicate manifest target paths before cloning', () => {
    const fixture = createProjectsFixture([])
    const manifestPath = path.join(fixture.repoRoot, 'projects.local.yaml')
    writeFile(manifestPath, [
      'groups:',
      '  work:',
      '    host: git.example.com',
      '    repositories:',
      '      - example/service',
      '      - name: git.example.com/example/service',
      '',
    ].join('\n'))

    const result = runCli(['projects', 'manifest', '--file', manifestPath, '--root', fixture.projectsRoot, '--yes'], fixture.repoRoot, fixture.homeRoot, fixture.env)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /Duplicate target path/)
    assert.match(`${result.stdout}\n${result.stderr}`, /First defined at groups\.work\.repositories\[0\]/)
    assert.equal(fs.existsSync(path.join(fixture.projectsRoot, 'git.example.com', 'example', 'service')), false)
  })

  it('reports missing requested manifest groups with available groups', () => {
    const fixture = createProjectsFixture([])
    const manifestPath = path.join(fixture.repoRoot, 'projects.local.yaml')
    writeFile(manifestPath, [
      'groups:',
      '  common:',
      '    host: git.example.com',
      '    repositories:',
      '      - example/service',
      '',
    ].join('\n'))

    const result = runCli(['projects', 'manifest', '--file', manifestPath, '--group', 'missing', '--validate'], fixture.repoRoot, fixture.homeRoot, fixture.env)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /--group missing/)
    assert.match(`${result.stdout}\n${result.stderr}`, /Available groups: common/)
  })

  it('supports the short manifest alias and group option', () => {
    const fixture = createProjectsFixture([])
    const manifestPath = path.join(fixture.repoRoot, 'projects.local.yaml')
    writeFile(manifestPath, [
      'groups:',
      '  common:',
      '    host: git.example.com',
      '    repositories:',
      '      - example/common',
      '  ai:',
      '    host: git.example.com',
      '    repositories:',
      '      - example/agent',
      '',
    ].join('\n'))

    const result = runCli(['p', 'm', '--file', manifestPath, '-g', 'ai', '--root', fixture.projectsRoot], fixture.repoRoot, fixture.homeRoot, fixture.env)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /git\.example\.com\/example\/agent/)
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /git\.example\.com\/example\/common/)
  })

  it('supports the connect manifest alias', () => {
    const fixture = createProjectsFixture([])
    const manifestPath = path.join(fixture.repoRoot, 'projects.local.yaml')
    writeFile(manifestPath, [
      'groups:',
      '  common:',
      '    host: git.example.com',
      '    repositories:',
      '      - example/service',
      '',
    ].join('\n'))

    const result = runCli(['p', 'connect', '--file', manifestPath, '-g', 'common', '--root', fixture.projectsRoot], fixture.repoRoot, fixture.homeRoot, fixture.env)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /git\.example\.com\/example\/service/)
  })

  it('filters manifest repositories by target name', () => {
    const fixture = createProjectsFixture([])
    const manifestPath = path.join(fixture.repoRoot, 'projects.local.yaml')
    writeFile(manifestPath, [
      'groups:',
      '  ai:',
      '    host: git.example.com',
      '    repositories:',
      '      - example/agent',
      '      - example/docs',
      '',
    ].join('\n'))

    const result = runCli(['p', 'm', '--file', manifestPath, '-g', 'ai', '--repository', 'git.example.com/example/agent', '--root', fixture.projectsRoot], fixture.repoRoot, fixture.homeRoot, fixture.env)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /git\.example\.com\/example\/agent/)
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /git\.example\.com\/example\/docs/)
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

  it('falls back to explicit git clone when manifest target path differs from clone URL', () => {
    const fixture = createProjectsFixture([])
    writeFakeGhq(fixture.binDir)
    const gitCallsPath = path.join(fixture.tempDir, 'git-calls.json')
    const ghqCallsPath = path.join(fixture.tempDir, 'ghq-calls.json')
    const manifestPath = path.join(fixture.repoRoot, 'projects.local.yaml')
    writeFile(manifestPath, [
      'groups:',
      '  work:',
      `    root: ${fixture.projectsRoot}`,
      '    host: git.example.com',
      '    repositories:',
      '      - name: aliases/service',
      '        path: example/service',
      '',
    ].join('\n'))

    const result = runCli(['projects', 'manifest', '--file', manifestPath, '--yes'], fixture.repoRoot, fixture.homeRoot, {
      ...fixture.env,
      FAKE_GIT_CALLS: gitCallsPath,
      FAKE_GHQ_ROOTS: fixture.projectsRoot,
      FAKE_GHQ_CALLS: ghqCallsPath,
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)

    const targetPath = path.join(fixture.projectsRoot, 'aliases', 'service')
    assert.equal(fs.existsSync(path.join(targetPath, '.fake-clone')), true)

    const gitCalls = JSON.parse(fs.readFileSync(gitCallsPath, 'utf-8'))
    assert.deepEqual(gitCalls.at(-1), [
      'clone',
      'git@git.example.com:example/service.git',
      targetPath,
    ])

    const ghqCalls = JSON.parse(fs.readFileSync(ghqCallsPath, 'utf-8'))
    assert.equal(ghqCalls.some((args: string[]) => args[0] === 'get'), false)
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

  it('reads a project manifest from a remote raw file URL', () => {
    const fixture = createProjectsFixture([])
    const callsPath = path.join(fixture.tempDir, 'curl-calls.json')
    const manifestUrl = 'https://git.example.com/example/config/raw/main/projects.yaml'
    const manifest = [
      'groups:',
      '  ai:',
      '    host: git.example.com',
      '    repositories:',
      '      - example/agent',
      '      - example/docs',
      '',
    ].join('\n')

    const result = runCli(['p', 'm', manifestUrl, '-g', 'ai', '--repository', 'agent', '--root', fixture.projectsRoot], fixture.repoRoot, fixture.homeRoot, {
      ...fixture.env,
      FAKE_CURL_CALLS: callsPath,
      FAKE_CURL_RESPONSES: JSON.stringify({
        [manifestUrl]: manifest,
      }),
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /git\.example\.com\/example\/agent/)
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /git\.example\.com\/example\/docs/)

    const curlCalls = JSON.parse(fs.readFileSync(callsPath, 'utf-8'))
    assert.deepEqual(curlCalls.at(-1), ['-fsSL', manifestUrl])
  })

  it('normalizes remote blob manifest URLs to raw URLs', () => {
    const fixture = createProjectsFixture([])
    const callsPath = path.join(fixture.tempDir, 'curl-calls.json')
    const blobUrl = 'https://git.example.com/example/config/blob/main/projects.yaml'
    const rawUrl = 'https://git.example.com/example/config/raw/main/projects.yaml'
    const manifest = [
      'groups:',
      '  common:',
      '    host: git.example.com',
      '    repositories:',
      '      - example/service',
      '',
    ].join('\n')

    const result = runCli(['p', 'm', blobUrl, '-g', 'common', '--root', fixture.projectsRoot], fixture.repoRoot, fixture.homeRoot, {
      ...fixture.env,
      FAKE_CURL_CALLS: callsPath,
      FAKE_CURL_RESPONSES: JSON.stringify({
        [rawUrl]: manifest,
      }),
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /git\.example\.com\/example\/service/)

    const curlCalls = JSON.parse(fs.readFileSync(callsPath, 'utf-8'))
    assert.deepEqual(curlCalls.at(-1), ['-fsSL', rawUrl])
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

  it('skips unsafe updates for existing non-git paths', () => {
    const fixture = createProjectsFixture([makeRepo('YunYouJun/workstation')])
    const targetPath = path.join(fixture.projectsRoot, 'github.com', 'YunYouJun', 'workstation')
    fs.mkdirSync(targetPath, { recursive: true })

    const result = runCli(['projects', 'clone-active', '--root', fixture.projectsRoot, '--update', '--yes'], fixture.repoRoot, fixture.homeRoot, fixture.env)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /Needs attention before update/)
    assert.match(`${result.stdout}\n${result.stderr}`, /existing path is not a git repository/)
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

  it('prints local repository status as json', () => {
    const fixture = createStatusFixture()
    const repositoryPath = createLocalGitRepo(fixture.projectsRoot, 'github.com/YunYouJun/workstation')
    writeFile(path.join(repositoryPath, 'notes.md'), 'draft\n')

    const result = runCli(['p', 'status', '--root', fixture.projectsRoot, '--json'], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const payload = JSON.parse(result.stdout)
    assert.equal(payload.root, fixture.projectsRoot)
    assert.equal(payload.summary.repositories, 1)
    assert.equal(payload.summary.visible, 1)
    assert.equal(payload.summary.attention, 1)
    assert.equal(payload.summary.errors, 0)
    assert.equal(payload.repositories[0].relativePath, 'github.com/YunYouJun/workstation')
    assert.equal(payload.repositories[0].untracked, 1)
    assert.equal(payload.repositories[0].fetchStatus, 'not-requested')
    assert.equal(payload.repositories[0].needsAttention, true)
  })

  it('reports fetch errors when remote refresh is requested', () => {
    const fixture = createStatusFixture()
    const repositoryPath = createLocalGitRepo(fixture.projectsRoot, 'github.com/YunYouJun/workstation')
    runGit(['remote', 'add', 'origin', path.join(fixture.tempDir, 'missing.git')], repositoryPath)

    const result = runCli(['p', 'status', '--root', fixture.projectsRoot, '--fetch', '--json'], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const payload = JSON.parse(result.stdout)
    assert.equal(payload.fetch, true)
    assert.equal(payload.summary.repositories, 1)
    assert.equal(payload.summary.visible, 1)
    assert.equal(payload.summary.attention, 1)
    assert.equal(payload.summary.errors, 1)
    assert.equal(payload.repositories[0].fetchStatus, 'error')
    assert.match(payload.repositories[0].fetchError, /fetch --all --prune --quiet failed/)
    assert.equal(payload.repositories[0].needsAttention, true)
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

  it('keeps scanning when a parent directory has an invalid git marker', () => {
    const fixture = createStatusFixture()
    fs.mkdirSync(path.join(fixture.projectsRoot, '.git', 'broken'), { recursive: true })
    createLocalGitRepo(fixture.projectsRoot, 'github.com/YunYouJun/workstation')

    const result = runCli(['p', 'status', '--root', fixture.projectsRoot, '--all'], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /Found 1 repositories/)
    assert.match(`${result.stdout}\n${result.stderr}`, /github\.com\/YunYouJun\/workstation/)
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /fatal: not a git repository/)
  })

  it('previews canonical layout migrations by default', () => {
    const fixture = createStatusFixture()
    const sourcePath = createLocalGitRepo(fixture.projectsRoot, 'gh/yyj/workstation')
    runGit(['remote', 'add', 'origin', 'git@github.com:YunYouJun/workstation.git'], sourcePath)

    const result = runCli(['p', 'migrate-layout', '--root', fixture.projectsRoot], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /\[dry-run\] Would move/)
    assert.match(`${result.stdout}\n${result.stderr}`, /gh\/yyj\/workstation -> github\.com\/YunYouJun\/workstation/)
    assert.equal(fs.existsSync(sourcePath), true)
    assert.equal(fs.existsSync(path.join(fixture.projectsRoot, 'github.com', 'YunYouJun', 'workstation')), false)
  })

  it('moves clean repositories into canonical layout when confirmed', () => {
    const fixture = createStatusFixture()
    const sourcePath = createLocalGitRepo(fixture.projectsRoot, 'gh/yyj/workstation')
    const targetPath = path.join(fixture.projectsRoot, 'github.com', 'YunYouJun', 'workstation')
    runGit(['remote', 'add', 'origin', 'git@github.com:YunYouJun/workstation.git'], sourcePath)

    const result = runCli(['p', 'migrate-layout', '--root', fixture.projectsRoot, '--yes'], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /Moved/)
    assert.equal(fs.existsSync(sourcePath), false)
    assert.equal(fs.existsSync(path.join(targetPath, '.git')), true)
  })

  it('skips layout migrations for repositories that need attention', () => {
    const fixture = createStatusFixture()
    const sourcePath = createLocalGitRepo(fixture.projectsRoot, 'gh/yyj/workstation')
    const targetPath = path.join(fixture.projectsRoot, 'github.com', 'YunYouJun', 'workstation')
    runGit(['remote', 'add', 'origin', 'git@github.com:YunYouJun/workstation.git'], sourcePath)
    writeFile(path.join(sourcePath, 'notes.md'), 'draft\n')

    const result = runCli(['p', 'migrate-layout', '--root', fixture.projectsRoot, '--yes'], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /needs attention: 1 untracked/)
    assert.equal(fs.existsSync(sourcePath), true)
    assert.equal(fs.existsSync(targetPath), false)
  })

  it('skips duplicate canonical migration targets', () => {
    const fixture = createStatusFixture()
    const firstPath = createLocalGitRepo(fixture.projectsRoot, 'gh/yyj/workstation')
    const secondPath = createLocalGitRepo(fixture.projectsRoot, 'play/workstation')
    const targetPath = path.join(fixture.projectsRoot, 'github.com', 'YunYouJun', 'workstation')
    runGit(['remote', 'add', 'origin', 'git@github.com:YunYouJun/workstation.git'], firstPath)
    runGit(['remote', 'add', 'origin', 'git@github.com:YunYouJun/workstation.git'], secondPath)

    const result = runCli(['p', 'migrate-layout', '--root', fixture.projectsRoot, '--yes'], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /duplicate target path in migration plan/)
    assert.equal(fs.existsSync(firstPath), true)
    assert.equal(fs.existsSync(secondPath), true)
    assert.equal(fs.existsSync(targetPath), false)
  })
})
