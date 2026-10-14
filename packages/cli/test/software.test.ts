import type { SoftwareCatalogItem } from '../../../software.config'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { softwareItems } from '../../../software.config'
import { softwareOperationRequest, softwareRequest } from '../src/software'
import { cliPath, packageRoot } from './utils'

let root: string
let home: string
let applications: string

const item: SoftwareCatalogItem = {
  id: 'sample-editor',
  name: { en: 'Sample Editor', zh: '示例编辑器' },
  groupId: 'editors',
  groupLabel: { en: 'Editors', zh: '编辑器' },
  url: 'https://example.com/',
  downloadUrl: 'https://example.com/download',
  repositoryUrl: 'https://github.com/example/editor',
  app: 'Sample Editor.app',
  cask: 'sample-editor',
  bin: 'sample-editor',
  note: 'A sample editor.',
  iconUrl: 'https://example.com/icon.png',
  macosIconUrl: 'https://example.com/mac.png',
  iconStyle: 'rounded',
  iconScale: 1.25,
  installCommand: 'sh never-run-this-command',
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'workstation-software-'))
  home = path.join(root, 'home')
  applications = path.join(root, 'Applications')
  fs.mkdirSync(home)
  fs.mkdirSync(applications)
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function catalog(items: SoftwareCatalogItem[] = [item], platform: NodeJS.Platform = 'darwin') {
  return softwareRequest({ version: 1, operation: 'catalog' }, { items, platform, homeDirectory: home, systemApplicationsDirectory: applications })
}

function runSoftwareJson(input: string, args: string[] = [], environment: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', cliPath, 'software-json', ...args], {
    cwd: packageRoot,
    shell: false,
    encoding: 'utf8',
    timeout: 10000,
    input,
    env: { ...process.env, HOME: home, DOTFILES_HOME: home, DOTFILES_REPO_ROOT: root, NO_COLOR: '1', ...environment },
  })
}

describe('software catalog v1', () => {
  it('returns display metadata and package references without executable commands or local paths', () => {
    const result = catalog()
    expect(result).toEqual({
      version: 1,
      source: { id: 'workstation', title: 'Workstation', url: 'https://github.com/YunYouJun/workstation' },
      items: [{
        id: item.id,
        title: item.name,
        group: { id: item.groupId, title: item.groupLabel },
        url: item.url,
        downloadUrl: item.downloadUrl,
        repositoryUrl: item.repositoryUrl,
        iconUrl: item.iconUrl,
        macosIconUrl: item.macosIconUrl,
        iconStyle: item.iconStyle,
        iconScale: item.iconScale,
        description: item.note,
        installation: { kind: 'brew-cask', packageId: item.cask },
        status: 'not-detected',
        canInstall: true,
        canOpen: false,
      }],
    })
    expect(JSON.stringify(result)).not.toContain(item.installCommand)
    expect(JSON.stringify(result)).not.toContain(item.app)
    expect(fs.readdirSync(home)).toEqual([])
    expect(fs.readdirSync(applications)).toEqual([])
  })

  it('detects app directories in the system and user Applications folders', () => {
    fs.mkdirSync(path.join(applications, item.app!))
    expect(catalog().items[0].status).toBe('detected')
    fs.rmSync(path.join(applications, item.app!), { recursive: true })
    fs.mkdirSync(path.join(home, 'Applications', item.app!), { recursive: true })
    expect(catalog().items[0].status).toBe('detected')
  })

  it.each(['system', 'user'])('detects and opens Godot from the %s Applications folder without installing it', async (location) => {
    const godot = softwareItems.find(item => item.id === 'godot')!
    const openApplication = vi.fn(async () => {})
    const host = { items: [godot], platform: 'darwin' as const, homeDirectory: home, systemApplicationsDirectory: applications, executableDirectories: [], openApplication }
    expect(godot.defaultInstall).toBe(false)
    expect(softwareRequest({ version: 1, operation: 'catalog' }, host).items[0]).toMatchObject({
      id: 'godot',
      group: { id: 'game-development' },
      installation: { kind: 'brew-cask', packageId: 'godot' },
      status: 'not-detected',
      canInstall: true,
      canOpen: false,
    })
    await expect(softwareOperationRequest({ version: 1, operation: 'open', softwareId: 'godot' }, host)).rejects.toThrow('not detected')
    expect(openApplication).not.toHaveBeenCalled()

    const applicationPath = path.join(location === 'system' ? applications : path.join(home, 'Applications'), 'Godot.app')
    fs.mkdirSync(applicationPath, { recursive: true })
    expect(softwareRequest({ version: 1, operation: 'catalog' }, host).items[0]).toMatchObject({ status: 'detected', canInstall: false, canOpen: true })
    expect(await softwareOperationRequest({ version: 1, operation: 'open', softwareId: 'godot' }, host)).toEqual({ version: 1, softwareId: 'godot', destination: 'application' })
    expect(openApplication).toHaveBeenCalledExactlyOnceWith(applicationPath)
  })

  it('detects a standalone Godot binary without executing it', () => {
    const godot = softwareItems.find(item => item.id === 'godot')!
    const bin = path.join(root, 'bin')
    fs.mkdirSync(bin)
    fs.writeFileSync(path.join(bin, 'godot'), 'never execute this file')
    fs.chmodSync(path.join(bin, 'godot'), 0o700)
    expect(softwareRequest({ version: 1, operation: 'catalog' }, { items: [godot], platform: 'darwin', homeDirectory: home, systemApplicationsDirectory: applications, executableDirectories: [bin] }).items[0])
      .toMatchObject({ id: 'godot', status: 'detected', canInstall: false, canOpen: false })
  })

  it('does not treat a regular file as an installed application', () => {
    fs.writeFileSync(path.join(applications, item.app!), 'not an app directory')
    expect(catalog().items[0].status).toBe('not-detected')
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('reports unknown when an Applications directory cannot be inspected', () => {
    fs.chmodSync(applications, 0)
    try {
      expect(catalog().items[0].status).toBe('unknown')
    }
    finally {
      fs.chmodSync(applications, 0o700)
    }
  })

  it('reports unknown for other platforms and entries without a detectable app', () => {
    fs.mkdirSync(path.join(applications, item.app!))
    expect(catalog([item], 'win32').items[0].status).toBe('unknown')
    expect(catalog([item], 'linux').items[0].status).toBe('unknown')
    expect(catalog([{ ...item, app: undefined, bin: undefined }]).items[0].status).toBe('unknown')
    expect(catalog([{ ...item, app: undefined, cask: undefined }]).items[0].installation.kind).toBe('download')
    expect(catalog([{ ...item, app: undefined, cask: undefined, downloadUrl: undefined }]).items[0].installation.kind).toBe('manual')
  })

  it('never follows an application name outside the two Applications directories', () => {
    fs.mkdirSync(path.join(root, 'Other.app'))
    for (const app of ['../Other.app', '/Other.app', 'nested/Other.app', 'nested\\Other.app', 'Other.app\n'])
      expect(catalog([{ ...item, app }]).items[0].status).toBe('unknown')
  })

  it.each([
    null,
    [],
    {},
    { version: 2, operation: 'catalog' },
    { version: 1, operation: 'install' },
    { version: 1, operation: 'status' },
    { version: 1, operation: 'catalog', path: '/private' },
    { version: 1, operation: 'catalog', command: 'brew' },
    { version: 1, operation: 'catalog', items: [] },
  ])('rejects unsupported or expanded requests: %j', (request) => {
    expect(() => softwareRequest(request)).toThrow()
  })

  it('includes the verified AI applications and leaves unavailable source repositories absent', () => {
    const entries = softwareRequest({ version: 1, operation: 'catalog' }).items
    expect(entries.find(entry => entry.id === 'magpie')?.repositoryUrl).toBe('https://github.com/yetone/magpie')
    expect(entries.find(entry => entry.id === 'orca')?.installation).toEqual({ kind: 'brew-cask', packageId: 'stablyai/orca/orca' })
    expect(entries.find(entry => entry.id === 'vscode')?.repositoryUrl).toBe('https://github.com/microsoft/vscode')
    expect(entries.find(entry => entry.id === 'codebuddy-cn')?.downloadUrl).toBe('https://www.codebuddy.cn/downloads/')
    expect(entries.find(entry => entry.id === 'codebuddy-cn')).not.toHaveProperty('repositoryUrl')
    expect(entries.find(entry => entry.id === 'codebuddy-vscode')?.status).toBe('unknown')
  })
})

describe('software-json CLI', () => {
  it('writes exactly one JSON envelope to stdout without creating local state', () => {
    const result = runSoftwareJson(JSON.stringify({ version: 1, operation: 'catalog' }))
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, result: { version: 1, source: { id: 'workstation' } } })
    expect(fs.readdirSync(home)).toEqual([])
  })

  it.each([
    'not json with a private value',
    JSON.stringify({ version: 1, operation: 'install', command: 'secret command' }),
    JSON.stringify({ version: 1, operation: 'catalog', path: '/private/source' }),
  ])('rejects unsafe input without echoing it: %s', (input) => {
    const result = runSoftwareJson(input)
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout).ok).toBe(false)
    expect(result.stdout).not.toContain('private value')
    expect(result.stdout).not.toContain('secret command')
    expect(result.stdout).not.toContain('/private/source')
    expect(fs.readdirSync(home)).toEqual([])
  })

  it('rejects command-line directory arguments', () => {
    const result = runSoftwareJson(JSON.stringify({ version: 1, operation: 'catalog' }), ['/private/source'])
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Unused args')
  })

  it('rejects requests over the byte limit', () => {
    const result = runSoftwareJson(JSON.stringify({ version: 1, operation: 'catalog', padding: '中'.repeat(400000) }))
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout)).toEqual({ ok: false, code: 'INVALID_REQUEST', error: 'Invalid software request' })
  })

  it.skipIf(process.platform !== 'darwin')('starts the real detached CLI worker and preserves its progress after the request process exits', async () => {
    const bin = path.join(root, 'bin')
    fs.mkdirSync(bin)
    const brew = path.join(bin, 'brew')
    const apps = Object.fromEntries(softwareItems.filter(item => item.cask && item.app).map(item => [item.cask!, item.app!]))
    fs.writeFileSync(brew, `#!${process.execPath}
const fs = require('node:fs')
const path = require('node:path')
const apps = ${JSON.stringify(apps)}
console.log('Fixture download complete')
fs.mkdirSync(path.join(process.env.HOME, 'Applications', apps[process.argv.at(-1)]), { recursive: true })
`)
    fs.chmodSync(brew, 0o700)
    const environment = { PATH: bin }
    const catalogEnvelope = JSON.parse(runSoftwareJson(JSON.stringify({ version: 1, operation: 'catalog' }), [], environment).stdout)
    const selected = catalogEnvelope.result.items.find((entry: { id: string, status: string }) => entry.status === 'not-detected' && apps[softwareItems.find(item => item.id === entry.id)?.cask ?? ''])
    expect(selected).toBeDefined()
    const planEnvelope = JSON.parse(runSoftwareJson(JSON.stringify({ version: 1, operation: 'preview', softwareIds: [selected.id] }), [], environment).stdout)
    expect(planEnvelope.ok).toBe(true)
    const installEnvelope = JSON.parse(runSoftwareJson(JSON.stringify({ version: 1, operation: 'install', planId: planEnvelope.result.id, confirmed: true }), [], environment).stdout)
    expect(installEnvelope.ok).toBe(true)
    let completed: { state: string, items: { state: string, log: string }[] } | undefined
    await vi.waitFor(() => {
      const envelope = JSON.parse(runSoftwareJson(JSON.stringify({ version: 1, operation: 'run', runId: installEnvelope.result.id }), [], environment).stdout)
      expect(envelope.ok).toBe(true)
      completed = envelope.result
      expect(completed?.state).toBe('completed')
    }, { timeout: 10000, interval: 100 })
    expect(completed?.items[0]).toMatchObject({ state: 'installed', log: 'Fixture download complete\n' })
    expect(fs.existsSync(path.join(home, 'Applications', apps[softwareItems.find(item => item.id === selected.id)!.cask!]))).toBe(true)
  }, 20000)
})
