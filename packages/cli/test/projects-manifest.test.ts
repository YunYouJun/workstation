import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { hostCapabilities, hostRequest } from '../src/host-protocol'
import { validateProjectManifest } from '../src/projects'
import { projectManifestSchema, projectManifestSchemaUrl } from '../src/projects-manifest'
import { packageRoot } from './utils'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) }
})

const require = createRequire(import.meta.url)
let buildRoot: string
let fixtureRoot: string
beforeAll(() => {
  const cache = path.join(packageRoot, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  buildRoot = fs.mkdtempSync(path.join(cache, 'projects-validation-'))
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workstation-project-validation-'))
  const build = spawnSync(process.execPath, [require.resolve('tsup/dist/cli-default.js'), '--out-dir', buildRoot], { cwd: packageRoot, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 })
  expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0)
  fs.writeFileSync(path.join(buildRoot, 'package.json'), '{"type":"module"}\n')
}, 30000)
afterEach(() => {
  vi.restoreAllMocks()
})
afterAll(() => {
  if (buildRoot)
    fs.rmSync(buildRoot, { recursive: true, force: true })
  if (fixtureRoot)
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
})

function compiledRequest(input: unknown) {
  return spawnSync(process.execPath, [path.join(buildRoot, 'cli.js'), 'host-json'], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, HOME: path.join(fixtureRoot, 'home'), DOTFILES_HOME: path.join(fixtureRoot, 'home'), DOTFILES_REPO_ROOT: fixtureRoot, WORKSTATION_PRIVATE_MANIFEST: path.join(fixtureRoot, 'private.json'), PATH: '' },
  })
}

const compatibleManifests = [
  'repositories: [github.com/example/service]',
  'host: git.example.com\nrepositories: [example/service]',
  'groups:\n  common:\n    host: git.example.com\n    root: ~/repos\n    repositories: [example/service]',
  'repositories: [https://git.example.com/example/service.git, "git@git.example.com:example/other.git"]',
  'host: git.example.com\nrepositories: [{name: example/service}]',
  'repositories: [{url: https://git.example.com/example/service.git}]',
  'host: git.example.com\nrepositories: [{name: local-alias/service, path: example/service, description: description}]',
  'repositories: []\nextra: {custom: retained}',
]

describe('pure project manifest validation', () => {
  it.each(compatibleManifests)('supports an existing versionless form: %s', (content) => {
    expect(validateProjectManifest(content)).toMatchObject({ version: 1, valid: true, issues: [] })
  })

  it.each(['path', 'remotePath', 'repo', 'repository', 'url', 'sshUrl', 'ssh', 'httpsUrl', 'https'])('shares repository field %s with the generated editor schema', (field) => {
    const value = ['path', 'remotePath', 'repo', 'repository'].includes(field) ? 'example/service' : 'https://git.example.com/example/service.git'
    const report = validateProjectManifest(`host: git.example.com\nrepositories: [{${field}: ${value}}]`)
    expect(report).toMatchObject({ valid: true, summary: { repositories: 1, groups: 1 } })
    expect(projectManifestSchema.$defs.repository.anyOf[1]).toMatchObject({ properties: { [field]: { type: 'string', pattern: '\\S' } } })
  })

  it('detects host inheritance and duplicate targets with safe structural paths', () => {
    const report = validateProjectManifest('host: git.example.com\ngroups:\n  private-token-group:\n    root: secret-root-path\n    repositories: [example/service, "git@git.example.com:example/service.git"]')
    expect(report).toEqual({ version: 1, valid: false, issues: [{ code: 'duplicate-target', path: 'groups[0].repositories[1]', message: 'Repository entries resolve to the same target path.' }] })
    expect(JSON.stringify(report)).not.toMatch(/private-token-group|secret-root-path|example\/service|git@/)
  })

  it('does not read configuration, resolve HOME, write, fetch or probe while validating content', () => {
    const unexpected = () => {
      throw new Error('Unexpected validation side effect')
    }
    const read = vi.spyOn(fs, 'readFileSync').mockImplementation(unexpected)
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(unexpected)
    const mkdir = vi.spyOn(fs, 'mkdirSync').mockImplementation(unexpected)
    const home = vi.spyOn(os, 'homedir').mockImplementation(unexpected)
    const cwd = vi.spyOn(process, 'cwd').mockImplementation(unexpected)
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(unexpected)
    const subprocesses = vi.mocked(spawnSync).mock.calls.length
    expect(validateProjectManifest('root: ~/repos\nhost: git.example.com\nrepositories: [example/service]')).toMatchObject({ valid: true })
    for (const operation of [read, write, mkdir, home, cwd, fetch])
      expect(operation).not.toHaveBeenCalled()
    expect(vi.mocked(spawnSync).mock.calls.length).toBe(subprocesses)
  })

  it('does not echo malformed YAML, unknown group keys or credential URL values', () => {
    const contents = [
      'groups: {token-secret-group: {repositories: ["https://user:private-token@git.example.com/example/service.git", "https://user:private-token@git.example.com/example/service.git"]}}',
      'groups: {token-secret-group: {repositories: [secret-repository]}}',
      'groups: {"token-secret-group": not-a-group}',
      'repositories: [https://user:private-token@git.example.com/[',
      'groups: {"$credential-key": {root: [], repositories: []}}',
    ]
    for (const content of contents) {
      const report = validateProjectManifest(content)
      expect(report.valid).toBe(false)
      expect(JSON.stringify(report)).not.toMatch(/token-secret-group|private-token|secret-repository|credential-key|not-a-group|user:/)
      for (const issue of report.issues)
        expect(issue.path).toMatch(/^(?:\$|(?:root|host|repositories|groups)(?:\[\d+\]|\.(?:root|host|repositories))*)$/)
    }
  })

  it.each([
    'repositories: !include /private/credentials.yaml',
    'repositories: &loop [*loop]',
    'a: &a [one, two, three]\nb: &b [*a, *a, *a]\nc: &c [*b, *b, *b]\nrepositories: [*c, *c, *c]',
    'repositories: [example/service]\nrepositories: [other/service]',
  ])('rejects unsafe YAML without executing its contents: %s', (content) => {
    const report = validateProjectManifest(content)
    expect(report).toEqual({ version: 1, valid: false, issues: [{ code: 'invalid-yaml', path: '$', message: 'Project manifest YAML is invalid.' }] })
  })

  it('bounds UTF-8 content, tree depth and issue count', () => {
    expect(validateProjectManifest(`# ${'é'.repeat(140000)}`)).toMatchObject({ valid: false, issues: [{ code: 'manifest-limit' }] })
    expect(validateProjectManifest(`repositories: []\nextra: ${'['.repeat(40)}value${']'.repeat(40)}`)).toMatchObject({ valid: false, issues: [{ code: 'manifest-limit' }] })
    expect(validateProjectManifest(`repositories: []\nextra: [${Array.from({ length: 10000 }).fill('x').join(',')}]`)).toMatchObject({ valid: false, issues: [{ code: 'manifest-limit' }] })
    const report = validateProjectManifest(`repositories: [${Array.from({ length: 150 }).fill('{}').join(',')}]`)
    expect(report.valid).toBe(false)
    expect(report.issues).toHaveLength(100)
    expect(report.issues.at(-1)?.code).toBe('issue-limit')
  })

  it('adds validation capability on every platform and keeps other request shapes strict', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const)
      expect(hostCapabilities(platform)).toMatchObject({ protocols: { repositoryValidation: 1 }, operations: { repositoryValidation: { supported: true } } })
    for (const input of [
      { version: 1, operation: 'doctor', content: 'repositories: []' },
      { version: 1, operation: 'capabilities', content: 'repositories: []' },
      { version: 1, operation: 'validate-projects', content: 3 },
      { version: 1, operation: 'validate-projects', content: 'repositories: []', file: '/private' },
    ])
      expect(() => hostRequest(input)).toThrow('Invalid host request')
  })

  it('keeps the generated schema in sync and documents its old supported shapes', () => {
    const schema = JSON.parse(fs.readFileSync(path.resolve(packageRoot, '../../schemas/projects.schema.json'), 'utf8'))
    expect(schema).toEqual(projectManifestSchema)
    expect(schema.$id).toBe(projectManifestSchemaUrl)
    expect(schema.required).toBeUndefined()
    expect(schema.properties.groups.type).toBe('object')
    expect(schema.properties.groups.additionalProperties.$ref).toBe('#/$defs/group')
    expect(schema.$defs.repositories.type).toBe('array')
    expect(schema.additionalProperties).toBe(true)
  })

  it('runs the compiled CLI and returns exactly one JSON envelope without real state writes', () => {
    const before = fs.readdirSync(fixtureRoot)
    const output = compiledRequest({ version: 1, operation: 'validate-projects', content: 'host: git.example.com\nrepositories: [example/service]' })
    expect(output.status).toBe(0)
    expect(output.stderr).toBe('')
    expect(output.stdout.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(output.stdout)).toEqual({ ok: true, result: { version: 1, valid: true, issues: [], summary: { repositories: 1, groups: 1 } } })
    const invalid = compiledRequest({ version: 1, operation: 'validate-projects', content: 'groups: {private-token-group: {repositories: [private-token]}}' })
    expect(invalid.status).toBe(0)
    expect(invalid.stderr).toBe('')
    expect(JSON.parse(invalid.stdout)).toMatchObject({ ok: true, result: { valid: false, issues: [{ code: 'missing-host', path: 'groups[0].repositories[0]' }] } })
    expect(invalid.stdout).not.toContain('private-token')
    const malicious = compiledRequest({ version: 1, operation: 'validate-projects', content: 'repositories: !include /private/credentials.yaml' })
    expect(malicious.stderr).toBe('')
    expect(JSON.parse(malicious.stdout)).toMatchObject({ ok: true, result: { valid: false, issues: [{ code: 'invalid-yaml' }] } })
    expect(malicious.stdout).not.toContain('/private/credentials.yaml')
    expect(fs.readdirSync(fixtureRoot)).toEqual(before)
    expect(fs.existsSync(path.join(fixtureRoot, 'home'))).toBe(false)
  })
})
