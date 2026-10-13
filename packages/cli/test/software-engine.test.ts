import type { SoftwareCatalogItem } from '../../../software.config'
import type { SoftwareEngineOptions, SoftwareInstallationPlan, SoftwareInstallationRun } from '../src/software'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createServer } from 'node:http'
import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSoftwareWorker, softwareOperationRequest, softwareRequest } from '../src/software'
import * as terminal from '../src/software/terminal-output'

let root: string
let applications: string
let options: SoftwareEngineOptions
let started: string[]

const editor: SoftwareCatalogItem = {
  id: 'sample-editor',
  name: { en: 'Sample Editor' },
  groupId: 'editors',
  groupLabel: { en: 'Editors' },
  url: 'https://example.com/',
  downloadUrl: 'https://example.com/download',
  app: 'sample-editor.app',
  cask: 'sample-editor',
  installCommand: 'sh should-never-run',
}
const manual: SoftwareCatalogItem = { ...editor, id: 'manual-app', app: 'manual-app.app', cask: undefined }

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'workstation-software-engine-'))
  applications = path.join(root, 'Applications')
  fs.mkdirSync(applications)
  fs.mkdirSync(path.join(root, 'bin'))
  started = []
  const brew = path.join(root, 'brew')
  fs.writeFileSync(brew, `#!${process.execPath}
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
fs.appendFileSync(process.env.TEST_RECORD, JSON.stringify({ args: process.argv.slice(2), flags: ['HOMEBREW_NO_AUTO_UPDATE', 'HOMEBREW_NO_INSTALL_UPGRADE', 'HOMEBREW_NO_INSTALL_CLEANUP', 'HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK', 'HOMEBREW_NO_ANALYTICS', 'NONINTERACTIVE', 'CI'].map(key => [key, process.env[key]]), options: process.env.NODE_OPTIONS, caskOptions: process.env.HOMEBREW_CASK_OPTS }) + '\\n')
console.log('Downloading selected package')
if (process.env.TEST_MODE === 'frames') {
  process.stdout.write('\\x1B[?25l⠋ Cask editor ## Downloading 25.0MB/100.0MB\\x1B[')
  setTimeout(() => process.stdout.write('K\\x1B[0G'), 20)
  const timer = setInterval(() => {
    if (fs.existsSync(process.env.TEST_CONTINUE)) {
      clearInterval(timer)
      process.stdout.write('✔︎ Cask editor Downloaded 100.0MB/100.0MB\\x1B[K\\n==> Installing Cask sample-editor\\n')
      setTimeout(() => process.exit(1), 1000)
    }
  }, 20)
}
else if (process.env.TEST_MODE === 'download') {
  fs.writeFileSync(process.env.TEST_TTY, JSON.stringify({ tty: !!process.stdout.isTTY }))
  const curl = spawn('/usr/bin/curl', ['--fail', '--progress-bar', '--limit-rate', '64K', '--output', process.env.TEST_DOWNLOAD_FILE, process.env.TEST_DOWNLOAD_URL], { stdio: ['ignore', 'ignore', 'inherit'] })
  curl.on('close', code => {
    if (code !== 0) process.exit(code || 1)
    console.log('==> Installing Cask sample-editor')
    const timer = setInterval(() => {
      if (fs.existsSync(process.env.TEST_CONTINUE)) {
        clearInterval(timer)
        fs.mkdirSync(path.join(process.env.TEST_APPS, 'sample-editor.app'))
      }
    }, 20)
  })
}
else if (process.env.TEST_MODE === 'long') { console.log(Array.from({ length: 100 }, () => '中'.repeat(200)).join('\\n')); process.exit(1) }
else if (process.env.TEST_MODE === 'descendant') {
  const helper = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  fs.writeFileSync(process.env.TEST_HELPER, String(helper.pid))
  process.on('SIGTERM', () => process.exit(0))
  setTimeout(() => process.exit(0), 20000)
}
else if (process.env.TEST_MODE === 'wait') { setTimeout(() => process.exit(0), 20000) }
else if (process.env.TEST_MODE === 'secret') {
  process.stdout.write('https://audit-user:audit-secret-')
  process.stderr.write('Authorization: Bearer audit-secret-')
  fs.writeFileSync(process.env.TEST_SECRET_PENDING, '1')
  setTimeout(() => {
    process.stdout.write('token-12345@example.test/package\\n' + process.env.TEST_API_KEY + '\\nsocks5://proxy-user:audit-secret-token-12345@proxy.test:1080\\n{"password":"json-password-not-in-env"}\\n')
    process.stderr.write('token-12345\\nAPI_KEY=audit-secret-token-12345\\nCookie: session=audit-secret-token-12345; theme=dark\\nSet-Cookie: session=audit-secret-token-12345\\n{"api_key":"json-api-key-not-in-env"}\\n')
    process.exit(1)
  }, 400)
}
else if (process.env.TEST_MODE === 'fail') { console.error('Fixture installer failed'); process.exit(1) }
else if (process.env.TEST_MODE !== 'no-artifact') { fs.mkdirSync(path.join(process.env.TEST_APPS, process.argv.at(-1) + '.app'), { recursive: true }) }
`)
  fs.chmodSync(brew, 0o700)
  options = {
    items: [editor, manual],
    platform: 'darwin',
    homeDirectory: path.join(root, 'home'),
    systemApplicationsDirectory: applications,
    executableDirectories: [path.join(root, 'bin')],
    stateDirectory: path.join(root, 'state'),
    brewCommand: brew,
    environment: { ...process.env, TEST_APPS: applications, TEST_RECORD: path.join(root, 'commands.jsonl'), NODE_OPTIONS: '--bad-option', HOMEBREW_CASK_OPTS: '--force' },
    startWorker: async (runId) => {
      started.push(runId)
      return undefined
    },
  }
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

async function preview(ids = [editor.id], host = options): Promise<SoftwareInstallationPlan> {
  return await softwareOperationRequest({ version: 1, operation: 'preview', softwareIds: ids }, host) as SoftwareInstallationPlan
}

async function start(plan: SoftwareInstallationPlan, host = options): Promise<SoftwareInstallationRun> {
  return await softwareOperationRequest({ version: 1, operation: 'install', planId: plan.id, confirmed: true }, host) as SoftwareInstallationRun
}

async function run(id: string, host = options): Promise<SoftwareInstallationRun> {
  return await softwareOperationRequest({ version: 1, operation: 'run', runId: id }, host) as SoftwareInstallationRun
}

function commands(): { args: string[], flags: [string, string][], options?: string, caskOptions?: string }[] {
  return fs.existsSync(path.join(root, 'commands.jsonl')) ? fs.readFileSync(path.join(root, 'commands.jsonl'), 'utf8').trim().split('\n').map(text => JSON.parse(text)) : []
}

describe('confirmed software plans', () => {
  it('previews explicit selection only, skips installed software, and leaves manual items for download', async () => {
    fs.mkdirSync(path.join(applications, editor.app!))
    const plan = await preview([editor.id, manual.id])
    expect(plan).toMatchObject({ version: 1, sourceId: 'workstation', prerequisites: [], items: [{ softwareId: editor.id, action: 'skip' }, { softwareId: manual.id, action: 'manual' }] })
    expect(started).toEqual([])
    expect(commands()).toEqual([])
    expect(JSON.stringify(plan)).not.toContain('should-never-run')
  })

  it('reports a Homebrew prerequisite without executing its bootstrap script', async () => {
    const host = { ...options, brewCommand: undefined }
    const plan = await preview([editor.id], host)
    expect(plan.prerequisites[0]).toContain('https://brew.sh/')
    await expect(start(plan, host)).rejects.toThrow('Homebrew is unavailable')
    expect(started).toEqual([])
    expect(commands()).toEqual([])
  })

  it.each([
    { version: 1, operation: 'preview', softwareIds: [] },
    { version: 1, operation: 'preview', softwareIds: [editor.id, editor.id] },
    { version: 1, operation: 'preview', softwareIds: ['../sample-editor'] },
    { version: 1, operation: 'preview', softwareIds: [editor.id], command: 'brew' },
    { version: 1, operation: 'install', planId: 'a', confirmed: true },
    { version: 1, operation: 'run', runId: '../somewhere' },
    { version: 1, operation: 'catalog', installCommand: 'sh anything' },
    { version: 1, operation: 'open', softwareId: editor.id, path: '/Applications/Other.app' },
  ])('rejects client commands, paths, duplicates and invalid identifiers before creating state: %j', async (request) => {
    await expect(softwareOperationRequest(request, options)).rejects.toThrow()
    expect(fs.existsSync(options.stateDirectory!)).toBe(false)
  })

  it('requires confirmation and starts the same confirmed plan idempotently', async () => {
    const plan = await preview()
    await expect(softwareOperationRequest({ version: 1, operation: 'install', planId: plan.id, confirmed: false }, options)).rejects.toThrow('explicit confirmed plan')
    const first = await start(plan)
    const second = await start(plan)
    expect(first.id).toBe(second.id)
    expect(started).toEqual([first.id])
    expect(commands()).toEqual([])
  })

  it('rejects stale catalog plans and plans older than thirty minutes', async () => {
    const plan = await preview()
    await expect(start(plan, { ...options, items: [{ ...editor, cask: 'different-package' }, manual] })).rejects.toThrow('catalog changed')
    await expect(start(plan, { ...options, now: () => Date.parse(plan.createdAt) + 31 * 60 * 1000 })).rejects.toThrow('expired')
    expect(started).toEqual([])
  })

  it('prevents a second selected installation while another is active', async () => {
    const first = await preview()
    const second = await preview()
    await start(first)
    await expect(start(second)).rejects.toThrow('already active')
  })

  it('cannot delete a newer lock owner when a stale-lock reclaimer resumes late', async () => {
    const plan = await preview()
    const lock = path.join(options.stateDirectory!, 'lock')
    const staleOwner = 'owner-2147483647-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const nextOwner = `owner-${process.pid}-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`
    fs.mkdirSync(lock)
    fs.writeFileSync(path.join(lock, staleOwner), '2147483647')
    const unlink = fs.unlinkSync
    let reclaimed = false
    const spy = vi.spyOn(fs, 'unlinkSync').mockImplementation((file) => {
      if (!reclaimed && String(file) === path.join(lock, staleOwner)) {
        reclaimed = true
        // Another claimant replaces the dead snapshot before this one unlinks it.
        unlink(path.join(lock, staleOwner))
        fs.rmdirSync(lock)
        const claim = path.join(options.stateDirectory!, 'competing-claim')
        fs.mkdirSync(claim)
        fs.writeFileSync(path.join(claim, nextOwner), String(process.pid))
        fs.renameSync(claim, lock)
      }
      unlink(file)
    })
    syncBuiltinESMExports()
    try {
      await expect(start(plan)).rejects.toThrow('updating state')
      expect(fs.readFileSync(path.join(lock, nextOwner), 'utf8')).toBe(String(process.pid))
      expect(started).toEqual([])
    }
    finally {
      spy.mockRestore()
      syncBuiltinESMExports()
      fs.rmSync(lock, { recursive: true, force: true })
    }
    const first = await start(plan)
    const repeated = await start(plan)
    expect(first.id).toBe(repeated.id)
    expect(started).toEqual([first.id])
  })

  it('retains an active queued run if worker spawning succeeded but parent PID bookkeeping cannot acquire a lock', async () => {
    const plan = await preview()
    const lock = path.join(options.stateDirectory!, 'lock')
    const owner = `owner-${process.pid}-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`
    options.startWorker = async (runId) => {
      started.push(runId)
      fs.mkdirSync(lock)
      fs.writeFileSync(path.join(lock, owner), String(process.pid))
      return process.pid
    }
    const installation = await start(plan)
    expect(installation.state).toBe('queued')
    expect(installation.items[0].state).toBe('queued')
    expect(started).toEqual([installation.id])
    fs.rmSync(lock, { recursive: true, force: true })
    const another = await preview()
    await expect(start(another)).rejects.toThrow('already active')
  })

  it('does not run packages with malformed references or execute installCommand', async () => {
    const host = { ...options, items: [{ ...editor, cask: '--force', formula: 'anything' }] }
    const plan = await preview([editor.id], host)
    expect(plan.items[0].action).toBe('manual')
    const installation = await start(plan, host)
    await runSoftwareWorker(installation.id, host)
    expect((await run(installation.id, host)).state).toBe('waiting')
    expect(commands()).toEqual([])
  })
})

describe('durable software installation worker', () => {
  it('installs only the selected missing package using fixed argv, sanitized environment and fresh detection', async () => {
    const installation = await start(await preview())
    await runSoftwareWorker(installation.id, options)
    expect(await run(installation.id)).toMatchObject({ state: 'completed', items: [{ softwareId: editor.id, state: 'installed', log: 'Downloading selected package\n' }] })
    expect(commands()).toEqual([{ args: ['install', '--cask', '--', 'sample-editor'], flags: [
      ['HOMEBREW_NO_AUTO_UPDATE', '1'],
      ['HOMEBREW_NO_INSTALL_UPGRADE', '1'],
      ['HOMEBREW_NO_INSTALL_CLEANUP', '1'],
      ['HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK', '1'],
      ['HOMEBREW_NO_ANALYTICS', '1'],
      ['NONINTERACTIVE', '1'],
      ['CI', '1'],
    ] }])
    await runSoftwareWorker(installation.id, options)
    expect(commands()).toHaveLength(1)
    expect(fs.existsSync(path.join(applications, manual.app!))).toBe(false)
  })

  it('honors cancellation received during terminal setup before launching Homebrew', async () => {
    const installation = await start(await preview())
    const allocate = terminal.terminalOutput
    const spy = vi.spyOn(terminal, 'terminalOutput').mockImplementation(async (environment) => {
      const output = await allocate(environment)
      await softwareOperationRequest({ version: 1, operation: 'cancel', runId: installation.id }, options)
      return output
    })
    try {
      await runSoftwareWorker(installation.id, options)
      expect((await run(installation.id)).state).toBe('cancelled')
      expect((await run(installation.id)).items[0]).not.toHaveProperty('progress')
      expect(commands()).toEqual([])
    }
    finally { spy.mockRestore() }
  })

  it('reads chunked terminal redraws without newlines and clears progress after installer failure', async () => {
    Object.assign(options.environment!, { TEST_MODE: 'frames', TEST_CONTINUE: path.join(root, 'continue') })
    const installation = await start(await preview())
    const worker = runSoftwareWorker(installation.id, options)
    try {
      await vi.waitFor(async () => expect((await run(installation.id)).items[0].progress).toEqual({ phase: 'downloading', percent: 25, resource: 'Cask editor' }))
      fs.writeFileSync(path.join(root, 'continue'), '')
      await vi.waitFor(async () => expect((await run(installation.id)).items[0].progress).toEqual({ phase: 'installing' }))
      await worker
      const failed = await run(installation.id)
      expect(failed.state).toBe('failed')
      expect(failed.items[0]).not.toHaveProperty('progress')
      expect(failed.items[0].log).toContain('Installing Cask sample-editor')
    }
    finally {
      await softwareOperationRequest({ version: 1, operation: 'cancel', runId: installation.id }, options)
      await worker
    }
  })

  it.skipIf(process.platform !== 'darwin')('persists real curl download progress through a terminal and switches to installation before detection', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Length': String(256 * 1024) })
      response.end(Buffer.alloc(256 * 1024, 'x'))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    Object.assign(options.environment!, {
      TEST_MODE: 'download',
      TEST_DOWNLOAD_URL: `http://127.0.0.1:${address.port}/fixture`,
      TEST_DOWNLOAD_FILE: path.join(root, 'download'),
      TEST_TTY: path.join(root, 'tty.json'),
      TEST_CONTINUE: path.join(root, 'continue'),
    })
    const installation = await start(await preview())
    const worker = runSoftwareWorker(installation.id, options)
    try {
      await vi.waitFor(async () => {
        const progress = (await run(installation.id)).items[0].progress
        expect(progress?.phase).toBe('downloading')
        expect(progress?.percent).toBeGreaterThan(0)
        expect(progress?.percent).toBeLessThan(100)
      }, { timeout: 7000, interval: 50 })
      expect(JSON.parse(fs.readFileSync(path.join(root, 'tty.json'), 'utf8'))).toEqual({ tty: true })
      // A new client reads the same persisted observation; it does not restart the worker.
      const history = await softwareOperationRequest({ version: 1, operation: 'runs' }, options) as { runs: SoftwareInstallationRun[] }
      expect(history.runs[0].items[0].progress?.percent).toBeGreaterThan(0)
      expect(commands()).toHaveLength(1)
      const terminalPids = JSON.parse(fs.readFileSync(path.join(options.stateDirectory!, 'runs', `${installation.id}.json`), 'utf8')).terminalPids as number[]
      expect(terminalPids).toHaveLength(2)
      await vi.waitFor(async () => expect((await run(installation.id)).items[0].progress).toEqual({ phase: 'installing' }), { timeout: 7000 })
      expect(fs.statSync(path.join(root, 'download')).size).toBe(256 * 1024)
      expect((await run(installation.id)).items[0].state).toBe('running')
      fs.writeFileSync(path.join(root, 'continue'), '')
      await worker
      expect((await run(installation.id)).items[0]).toMatchObject({ state: 'installed' })
      expect((await run(installation.id)).items[0]).not.toHaveProperty('progress')
      const record = JSON.parse(fs.readFileSync(path.join(options.stateDirectory!, 'runs', `${installation.id}.json`), 'utf8'))
      expect(record).not.toHaveProperty('terminalPids')
      await vi.waitFor(() => {
        for (const pid of terminalPids)
          expect(() => process.kill(pid, 0)).toThrow()
      })
    }
    finally {
      await softwareOperationRequest({ version: 1, operation: 'cancel', runId: installation.id }, options)
      await worker
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }, 15000)

  it('uses the formula installer for declared formulas', async () => {
    const host = { ...options, items: [{ ...editor, cask: undefined, formula: 'sample-editor' }] }
    const installation = await start(await preview([editor.id], host), host)
    await runSoftwareWorker(installation.id, host)
    expect(commands()[0].args).toEqual(['install', '--formula', '--', 'sample-editor'])
  })

  it('skips software installed externally between preview and execution', async () => {
    const installation = await start(await preview())
    fs.mkdirSync(path.join(applications, editor.app!))
    await runSoftwareWorker(installation.id, options)
    expect(await run(installation.id)).toMatchObject({ state: 'completed', items: [{ state: 'skipped' }] })
    expect(commands()).toEqual([])
  })

  it('keeps exit zero without a detectable installation failed', async () => {
    options.environment!.TEST_MODE = 'no-artifact'
    const installation = await start(await preview())
    await runSoftwareWorker(installation.id, options)
    expect(await run(installation.id)).toMatchObject({ state: 'failed', items: [{ state: 'failed', message: expect.stringContaining('not detected') }] })
  })

  it('records failure and retries only selected failed software through a fresh confirmed plan', async () => {
    const second = { ...editor, id: 'second-editor', app: 'second-editor.app', cask: 'second-editor' }
    options.items = [editor, second]
    fs.mkdirSync(path.join(applications, editor.app!))
    options.environment!.TEST_MODE = 'fail'
    const failed = await start(await preview([editor.id, second.id]))
    await runSoftwareWorker(failed.id, options)
    expect((await run(failed.id)).items.map(item => item.state)).toEqual(['skipped', 'failed'])
    delete options.environment!.TEST_MODE
    const retried = await start(await preview([second.id]))
    await runSoftwareWorker(retried.id, options)
    expect((await run(retried.id)).items.map(item => item.state)).toEqual(['installed'])
    expect(commands().map(command => command.args.at(-1))).toEqual([second.id, second.id])
    expect((await run(failed.id)).items[1].state).toBe('failed')
  })

  it('retains a bounded log tail in bytes', async () => {
    options.environment!.TEST_MODE = 'long'
    const installation = await start(await preview())
    await runSoftwareWorker(installation.id, options)
    const result = await run(installation.id)
    expect(Buffer.byteLength(result.items[0].log)).toBeLessThanOrEqual(16384)
    expect(result.items[0].log).toContain('中')
    expect(result.items[0].log).not.toContain('\uFFFD')
  })

  it('redacts credentials before publishing or persisting logs even when stdout and stderr split tokens across chunks', async () => {
    options.environment!.TEST_MODE = 'secret'
    options.environment!.TEST_SECRET_PENDING = path.join(root, 'secret-pending')
    options.environment!.TEST_API_KEY = 'audit-secret-token-12345'
    const installation = await start(await preview())
    const worker = runSoftwareWorker(installation.id, options)
    await vi.waitFor(() => expect(fs.existsSync(options.environment!.TEST_SECRET_PENDING!)).toBe(true), { timeout: 5000 })
    const progress = await run(installation.id)
    expect(progress.items[0].log).not.toContain('audit-user')
    expect(progress.items[0].log).not.toContain('audit-secret-')
    await worker
    const completed = await run(installation.id)
    expect(completed.items[0].log).toContain('[redacted]')
    expect(completed.items[0].log).not.toContain('audit-user')
    expect(completed.items[0].log).not.toContain('audit-secret-token-12345')
    expect(completed.items[0].log).not.toContain('proxy-user')
    expect(completed.items[0].log).not.toContain('json-password-not-in-env')
    expect(completed.items[0].log).not.toContain('json-api-key-not-in-env')
    const persisted = fs.readFileSync(path.join(options.stateDirectory!, 'runs', `${installation.id}.json`), 'utf8')
    expect(persisted).not.toContain('audit-secret-token-12345')
    expect(persisted).not.toContain('audit-user')
    expect(persisted).not.toContain('proxy-user')
    expect(persisted).not.toContain('json-password-not-in-env')
    expect(persisted).not.toContain('json-api-key-not-in-env')
  })

  it('reports cancelling until the process stops and does not start subsequent selected software', async () => {
    options.environment!.TEST_MODE = 'wait'
    options.items = [editor, { ...editor, id: 'second-editor', app: 'second-editor.app', cask: 'second-editor' }]
    const installation = await start(await preview([editor.id, 'second-editor']))
    const worker = runSoftwareWorker(installation.id, options)
    await vi.waitFor(async () => expect((await run(installation.id)).items[0].log).toContain('Downloading'), { timeout: 5000 })
    const cancelling = await softwareOperationRequest({ version: 1, operation: 'cancel', runId: installation.id }, options) as SoftwareInstallationRun
    expect(cancelling.state).toBe('cancelling')
    await worker
    expect(await run(installation.id)).toMatchObject({ state: 'cancelled', items: [{ state: 'cancelled' }, { state: 'cancelled' }] })
    expect(commands()).toHaveLength(1)
    expect(fs.existsSync(path.join(applications, editor.app!))).toBe(false)
  })

  it('finishes cancellation requested before the worker starts without launching the installer', async () => {
    const installation = await start(await preview())
    await softwareOperationRequest({ version: 1, operation: 'cancel', runId: installation.id }, options)
    await runSoftwareWorker(installation.id, options)
    expect(await run(installation.id)).toMatchObject({ state: 'cancelled', items: [{ state: 'cancelled' }] })
    expect(commands()).toEqual([])
  })

  it('times out an installer and retains retryable failure', async () => {
    options.environment!.TEST_MODE = 'wait'
    options.installerTimeoutMs = 30
    const installation = await start(await preview())
    await runSoftwareWorker(installation.id, options)
    expect(await run(installation.id)).toMatchObject({ state: 'failed', items: [{ state: 'failed', message: expect.stringContaining('timed out') }] })
  })

  it.skipIf(process.platform === 'win32')('kills helpers that ignore SIGTERM even after the brew group leader exits', async () => {
    options.environment!.TEST_MODE = 'descendant'
    options.environment!.TEST_HELPER = path.join(root, 'helper.pid')
    const installation = await start(await preview())
    const worker = runSoftwareWorker(installation.id, options)
    await vi.waitFor(() => expect(fs.existsSync(options.environment!.TEST_HELPER!)).toBe(true), { timeout: 5000 })
    const helper = Number(fs.readFileSync(options.environment!.TEST_HELPER!, 'utf8'))
    try {
      // Allow the helper to register its signal handler before cancelling its parent.
      await new Promise(resolve => setTimeout(resolve, 150))
      await softwareOperationRequest({ version: 1, operation: 'cancel', runId: installation.id }, options)
      await worker
      expect((await run(installation.id)).state).toBe('cancelled')
      await vi.waitFor(() => expect(() => process.kill(helper, 0)).toThrow(), { timeout: 2000 })
    }
    finally {
      try {
        process.kill(helper, 'SIGKILL')
      }
      catch {}
    }
  }, 10000)

  it('reconciles an interrupted worker after restart without automatically repeating commands', async () => {
    const installation = await start(await preview())
    const file = path.join(options.stateDirectory!, 'runs', `${installation.id}.json`)
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'))
    stored.workerPid = 2147483647
    stored.run.state = 'running'
    stored.run.items[0].state = 'running'
    stored.run.updatedAt = new Date(Date.now() - 60000).toISOString()
    fs.writeFileSync(file, JSON.stringify(stored))
    expect(await run(installation.id)).toMatchObject({ state: 'interrupted', items: [{ state: 'interrupted' }] })
    await runSoftwareWorker(installation.id, options)
    expect(commands()).toEqual([])
    expect(await softwareOperationRequest({ version: 1, operation: 'runs' }, options)).toMatchObject({ version: 1, runs: [{ id: installation.id, state: 'interrupted' }] })
  })

  it.skipIf(process.platform === 'win32')('kills a remaining installer group when both its worker and leader have exited', async () => {
    const installation = await start(await preview())
    const pidFile = path.join(root, 'orphan-helper.pid')
    const leader = spawn(process.execPath, ['-e', `
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const helper = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: 'ignore' })
fs.writeFileSync(process.argv[1], String(helper.pid))
helper.unref()
process.exit(0)
`, pidFile], { detached: true, shell: false, stdio: 'ignore' })
    await new Promise<void>((resolve, reject) => {
      leader.once('error', reject)
      leader.once('close', () => resolve())
    })
    const helper = Number(fs.readFileSync(pidFile, 'utf8'))
    try {
      expect(() => process.kill(helper, 0)).not.toThrow()
      expect(() => process.kill(leader.pid!, 0)).toThrow()
      const file = path.join(options.stateDirectory!, 'runs', `${installation.id}.json`)
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'))
      stored.workerPid = 2147483647
      stored.childPid = leader.pid
      stored.run.state = 'running'
      stored.run.items[0].state = 'running'
      stored.run.updatedAt = new Date(Date.now() - 60000).toISOString()
      fs.writeFileSync(file, JSON.stringify(stored))
      expect(await run(installation.id)).toMatchObject({ state: 'interrupted', items: [{ state: 'interrupted' }] })
      await vi.waitFor(() => expect(() => process.kill(helper, 0)).toThrow(), { timeout: 2000 })
      const next = await start(await preview())
      expect(next.state).toBe('queued')
    }
    finally {
      try {
        process.kill(-leader.pid!, 'SIGKILL')
      }
      catch {}
    }
  })

  it('marks worker launch errors failed rather than reporting queued forever', async () => {
    options.startWorker = async () => {
      throw new Error('private worker diagnostic')
    }
    const installation = await start(await preview())
    expect(installation).toMatchObject({ state: 'failed', items: [{ state: 'failed' }] })
    expect(JSON.stringify(installation)).not.toContain('private worker diagnostic')
  })

  it('stops the spawned installer before failing when its initial process metadata cannot be persisted', async () => {
    const installation = await start(await preview())
    const recordFile = path.join(options.stateDirectory!, 'runs', `${installation.id}.json`)
    const rename = fs.renameSync
    let childPid: number | undefined
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (String(destination) === recordFile && !childPid) {
        const next = JSON.parse(fs.readFileSync(source, 'utf8'))
        if (next.childPid) {
          childPid = next.childPid
          throw Object.assign(new Error('fixture metadata write denied'), { code: 'EACCES' })
        }
      }
      rename(source, destination)
    })
    syncBuiltinESMExports()
    try {
      await runSoftwareWorker(installation.id, options)
      expect(childPid).toBeDefined()
      expect(() => process.kill(childPid!, 0)).toThrow()
      expect((await run(installation.id)).state).toBe('failed')
    }
    finally {
      spy.mockRestore()
      syncBuiltinESMExports()
      if (childPid) {
        try {
          process.kill(-childPid, 'SIGKILL')
        }
        catch {}
      }
    }
  })
})

describe('application and executable detection', () => {
  it('opens only a freshly detected declared application path', async () => {
    const open = vi.fn(async () => {})
    options.openApplication = open
    await expect(softwareOperationRequest({ version: 1, operation: 'open', softwareId: editor.id }, options)).rejects.toThrow('not detected')
    expect(open).not.toHaveBeenCalled()
    fs.mkdirSync(path.join(applications, editor.app!))
    expect(await softwareOperationRequest({ version: 1, operation: 'open', softwareId: editor.id }, options)).toEqual({ version: 1, softwareId: editor.id, destination: 'application' })
    expect(open).toHaveBeenCalledExactlyOnceWith(path.join(applications, editor.app!))
    fs.rmSync(path.join(applications, editor.app!), { recursive: true })
    await expect(softwareOperationRequest({ version: 1, operation: 'open', softwareId: editor.id }, options)).rejects.toThrow('not detected')
  })

  it('detects executable files without invoking them and never reports a CLI as an openable GUI app', () => {
    const bin = path.join(root, 'bin', 'sample-editor')
    fs.writeFileSync(bin, '#!/bin/sh\nexit 99\n')
    fs.chmodSync(bin, 0o700)
    const result = softwareRequest({ version: 1, operation: 'catalog' }, { ...options, items: [{ ...editor, app: undefined, bin: 'sample-editor' }] })
    expect(result.items[0]).toMatchObject({ status: 'detected', canInstall: false, canOpen: false })
  })

  it('detects the actual Codex CLI inside the official native application', () => {
    const codex = path.join(applications, 'ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex')
    fs.mkdirSync(path.dirname(codex), { recursive: true })
    fs.writeFileSync(codex, '#!/bin/sh\nexit 99\n')
    fs.chmodSync(codex, 0o700)
    const result = softwareRequest({ version: 1, operation: 'catalog' }, { ...options, items: [{ ...editor, id: 'codex-cli', app: undefined, bin: 'codex' }] })
    expect(result.items[0]).toMatchObject({ status: 'detected', canInstall: false, canOpen: false })
  })
})
