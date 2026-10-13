import type { LocalizedText, SoftwareCatalogItem } from '../../../../software.config'
import type { SoftwareCatalogEntry, SoftwareCatalogResult } from '../software'
import type { SoftwareHostOptions } from './detection'
import type { SoftwareInstallationProgress } from './download-progress'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import process from 'node:process'
import { softwareItems } from '../../../../software.config'
import { softwareInstallation, softwareRequest } from '../software'
import { findApplication, findExecutable, softwareStatus } from './detection'
import { downloadProgress } from './download-progress'
import { terminalOutput } from './terminal-output'

export interface SoftwareInstallationPlan {
  version: 1
  id: string
  sourceId: 'workstation'
  createdAt: string
  items: { softwareId: string, title: LocalizedText, action: 'install' | 'skip' | 'manual', installation: SoftwareCatalogEntry['installation'], reason?: string }[]
  prerequisites: string[]
}

export interface SoftwareInstallationRun {
  version: 1
  id: string
  sourceId: 'workstation'
  planId: string
  createdAt: string
  updatedAt: string
  state: 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'waiting'
  items: { softwareId: string, title: LocalizedText, state: 'queued' | 'running' | 'installed' | 'skipped' | 'failed' | 'manual' | 'cancelled' | 'interrupted', message?: string, log: string, progress?: SoftwareInstallationProgress }[]
  retryOf?: string
}

interface StoredPlan { plan: SoftwareInstallationPlan, fingerprint: string, runId?: string }
interface StoredRun { run: SoftwareInstallationRun, workerPid?: number, childPid?: number, terminalPids?: number[], cancelRequested?: boolean }

/** Overrides are host-side only. No JSON client can select a command, environment, state path, or worker. */
export interface SoftwareEngineOptions extends SoftwareHostOptions {
  stateDirectory?: string
  brewCommand?: string
  startWorker?: (runId: string) => Promise<number | undefined>
  openApplication?: (path: string) => Promise<void>
  now?: () => number
  installerTimeoutMs?: number
}

type SoftwareOperationResult = SoftwareCatalogResult | SoftwareInstallationPlan | SoftwareInstallationRun | { version: 1, runs: SoftwareInstallationRun[] } | { version: 1, softwareId: string, destination: 'application' }

const activeStates = ['queued', 'running', 'cancelling']
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const maxLogLength = 16384

function alive(pid: number | undefined): boolean {
  if (!pid || !Number.isSafeInteger(pid) || pid < 1)
    return false
  try {
    process.kill(pid, 0)
    return true
  }
  catch { return false }
}

function groupAlive(pid: number | undefined): boolean {
  if (!pid || !Number.isSafeInteger(pid) || pid < 1)
    return false
  try {
    process.kill(-pid, 0)
    return true
  }
  catch (error) { return errorCode(error) === 'EPERM' }
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

function now(options: SoftwareEngineOptions): string {
  return new Date(options.now?.() ?? Date.now()).toISOString()
}

function stateDirectory(options: SoftwareEngineOptions): string {
  if (options.stateDirectory)
    return options.stateDirectory
  const home = options.homeDirectory ?? homedir()
  const platform = options.platform ?? process.platform
  if (platform === 'darwin')
    return join(home, 'Library/Application Support/Workstation/software-v1')
  if (platform === 'win32')
    return join((options.environment ?? process.env).LOCALAPPDATA ?? join(home, 'AppData/Local'), 'Workstation/software-v1')
  const xdg = (options.environment ?? process.env).XDG_STATE_HOME
  return join(xdg && isAbsolute(xdg) ? xdg : join(home, '.local/state'), 'workstation/software-v1')
}

function ensureState(options: SoftwareEngineOptions): string {
  const state = stateDirectory(options)
  mkdirSync(join(state, 'plans'), { recursive: true, mode: 0o700 })
  mkdirSync(join(state, 'runs'), { recursive: true, mode: 0o700 })
  return state
}

function recordPath(options: SoftwareEngineOptions, kind: 'plans' | 'runs', id: string): string {
  if (!validId(id))
    throw new Error('Invalid software request')
  return join(stateDirectory(options), kind, `${id}.json`)
}

function readRecord<T>(options: SoftwareEngineOptions, kind: 'plans' | 'runs', id: string): T {
  try {
    return JSON.parse(readFileSync(recordPath(options, kind, id), 'utf8')) as T
  }
  catch (error) {
    if (errorCode(error) === 'ENOENT')
      throw new Error(kind === 'plans' ? 'Software installation plan was not found' : 'Software installation run was not found')
    throw new Error('Software state is unavailable or invalid')
  }
}

function writeRecord(options: SoftwareEngineOptions, kind: 'plans' | 'runs', id: string, record: unknown): void {
  const destination = recordPath(options, kind, id)
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 })
  renameSync(temporary, destination)
}

function withLock<T>(options: SoftwareEngineOptions, action: () => T): T {
  const state = ensureState(options)
  const lock = join(state, 'lock')
  const ownerName = `owner-${process.pid}-${randomUUID()}`
  const candidate = join(state, `lock-claim-${randomUUID()}`)
  mkdirSync(candidate, { mode: 0o700 })
  writeFileSync(join(candidate, ownerName), String(process.pid), { mode: 0o600 })
  const deadline = Date.now() + 2000
  const pause = new Int32Array(new SharedArrayBuffer(4))
  let acquired = false
  try {
    while (true) {
      try {
        // The candidate is already nonempty. A competing claimant cannot replace it.
        renameSync(candidate, lock)
        acquired = true
        break
      }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(errorCode(error) ?? ''))
          throw new Error('Software state is unavailable or invalid')
        let owners: string[] = []
        try {
          owners = readdirSync(lock).filter(file => /^owner-\d+-[0-9a-f-]+$/.test(file) || file === 'owner')
        }
        catch {
          if (!existsSync(lock))
            continue
        }
        for (const file of owners) {
          let pid: number | undefined
          try {
            pid = Number(readFileSync(join(lock, file), 'utf8'))
          }
          catch { continue }
          if (alive(pid))
            continue
          // Remove only this snapshot's unique owner. Never recursively remove the
          // shared lock path: another process may have acquired a new lock there.
          try {
            unlinkSync(join(lock, file))
          }
          catch {}
        }
        try {
          rmdirSync(lock)
        }
        catch {}
        if (Date.now() >= deadline)
          throw new Error('Another software operation is updating state; retry shortly')
        Atomics.wait(pause, 0, 0, 10)
      }
    }
    return action()
  }
  finally {
    if (acquired) {
      try {
        unlinkSync(join(lock, ownerName))
      }
      catch {}
      try {
        rmdirSync(lock)
      }
      catch {}
    }
    else { rmSync(candidate, { recursive: true, force: true }) }
  }
}

function declaredItems(options: SoftwareEngineOptions): readonly SoftwareCatalogItem[] {
  return options.items ?? softwareItems
}

function fingerprint(ids: readonly string[], options: SoftwareEngineOptions): string {
  return createHash('sha256').update(JSON.stringify(ids.map((id) => {
    const item = declaredItems(options).find(item => item.id === id)
    if (!item)
      throw new Error('Software catalog changed; preview the installation again')
    return { id: item.id, app: item.app, bin: item.bin, installation: softwareInstallation(item), url: item.url, downloadUrl: item.downloadUrl }
  }))).digest('hex')
}

function brewCommand(options: SoftwareEngineOptions): string | undefined {
  return options.brewCommand ?? findExecutable('brew', options)
}

function preview(ids: string[], options: SoftwareEngineOptions): SoftwareInstallationPlan {
  const items = ids.map((softwareId): SoftwareInstallationPlan['items'][number] => {
    const item = declaredItems(options).find(item => item.id === softwareId)
    if (!item)
      throw new Error('Unknown software id')
    const installation = softwareInstallation(item)
    const status = softwareStatus(item, options)
    const base = { softwareId, title: { ...item.name }, installation }
    if (status === 'detected')
      return { ...base, action: 'skip', reason: 'Already installed; no upgrade will run.' }
    if ((options.platform ?? process.platform) !== 'darwin')
      return { ...base, action: 'manual', reason: 'Automatic installation is currently supported on macOS only. Use the official download page.' }
    if (status === 'unknown')
      return { ...base, action: 'manual', reason: 'Installation could not be verified. Review the application and its official download page manually.' }
    if (!installation.packageId || !['brew-cask', 'brew-formula'].includes(installation.kind))
      return { ...base, action: 'manual', reason: 'This catalog entry requires installation from its official download page.' }
    return { ...base, action: 'install' }
  })
  const prerequisites = items.some(item => item.action === 'install') && !brewCommand(options)
    ? ['Install Homebrew from https://brew.sh/ in a terminal, then preview this selection again. Craft Hub does not execute the Homebrew bootstrap script.']
    : []
  const plan: SoftwareInstallationPlan = { version: 1, id: randomUUID(), sourceId: 'workstation', createdAt: now(options), items, prerequisites }
  withLock(options, () => writeRecord(options, 'plans', plan.id, { plan, fingerprint: fingerprint(ids, options) } satisfies StoredPlan))
  return plan
}

function reconcile(record: StoredRun, options: SoftwareEngineOptions): StoredRun {
  if (!activeStates.includes(record.run.state))
    return record
  const age = (options.now?.() ?? Date.now()) - Date.parse(record.run.updatedAt)
  if (alive(record.workerPid) || (!record.workerPid && age < 15000))
    return record
  record.run.state = record.cancelRequested ? 'cancelled' : 'interrupted'
  record.run.updatedAt = now(options)
  for (const item of record.run.items) {
    if (['running', 'queued'].includes(item.state)) {
      delete item.progress
      item.state = record.cancelRequested ? 'cancelled' : 'interrupted'
      item.message = record.cancelRequested ? 'Installation was cancelled.' : 'The installation worker stopped. Preview unfinished software again to retry.'
    }
  }
  if (groupAlive(record.childPid)) {
    try {
      process.kill(-record.childPid!, 'SIGKILL')
    }
    catch (error) {
      if (errorCode(error) !== 'ESRCH')
        throw new Error('Software installer processes could not stop; finish or stop them manually before retrying')
    }
  }
  for (const pid of record.terminalPids ?? []) {
    try {
      process.kill(-pid, 'SIGKILL')
    }
    catch { /* Terminal helper already exited. */ }
  }
  delete record.terminalPids
  delete record.childPid
  writeRecord(options, 'runs', record.run.id, record)
  return record
}

function records(options: SoftwareEngineOptions): StoredRun[] {
  const directory = join(stateDirectory(options), 'runs')
  if (!existsSync(directory))
    return []
  return readdirSync(directory).filter(file => uuidPattern.test(file.replace(/\.json$/, '')) && file.endsWith('.json')).map(file => reconcile(readRecord<StoredRun>(options, 'runs', file.slice(0, -5)), options)).sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt))
}

function validatePlan(stored: StoredPlan, options: SoftwareEngineOptions): void {
  const age = (options.now?.() ?? Date.now()) - Date.parse(stored.plan.createdAt)
  if (!Number.isFinite(age) || age < 0 || age > 30 * 60 * 1000)
    throw new Error('Software installation plan expired; preview the installation again')
  if (stored.fingerprint !== fingerprint(stored.plan.items.map(item => item.softwareId), options))
    throw new Error('Software catalog changed; preview the installation again')
  if (stored.plan.prerequisites.length || (stored.plan.items.some(item => item.action === 'install') && !brewCommand(options)))
    throw new Error('Homebrew is unavailable; complete the prerequisite and preview again')
}

/** Detached worker is the installed CLI itself, never a client-supplied command or path. */
async function startWorker(runId: string, options: SoftwareEngineOptions): Promise<number | undefined> {
  if (options.startWorker)
    return options.startWorker(runId)
  if (!process.argv[1] || !isAbsolute(process.argv[1]))
    throw new Error('Software worker could not start')
  const child = spawn(process.execPath, [...process.execArgv, process.argv[1], 'software-worker', runId], {
    detached: true,
    stdio: 'ignore',
    shell: false,
    env: installerEnvironment(options),
  })
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  child.unref()
  return child.pid
}

async function install(planId: string, options: SoftwareEngineOptions): Promise<SoftwareInstallationRun> {
  let fresh = false
  const run = withLock(options, () => {
    const stored = readRecord<StoredPlan>(options, 'plans', planId)
    if (stored.runId)
      return reconcile(readRecord<StoredRun>(options, 'runs', stored.runId), options).run
    validatePlan(stored, options)
    if (records(options).some(record => activeStates.includes(record.run.state)))
      throw new Error('Another software installation is already active')
    const date = now(options)
    const run: SoftwareInstallationRun = {
      version: 1,
      id: randomUUID(),
      sourceId: 'workstation',
      planId,
      createdAt: date,
      updatedAt: date,
      state: 'queued',
      items: stored.plan.items.map(item => ({ softwareId: item.softwareId, title: { ...item.title }, state: item.action === 'skip' ? 'skipped' : item.action === 'manual' ? 'manual' : 'queued', ...(item.reason ? { message: item.reason } : {}), log: '' })),
    }
    writeRecord(options, 'runs', run.id, { run } satisfies StoredRun)
    stored.runId = run.id
    writeRecord(options, 'plans', planId, stored)
    fresh = true
    return run
  })
  if (fresh) {
    let workerPid: number | undefined
    let workerStarted = false
    try {
      workerPid = await startWorker(run.id, options)
      workerStarted = true
    }
    catch {
      withLock(options, () => {
        const record = readRecord<StoredRun>(options, 'runs', run.id)
        record.run.state = 'failed'
        record.run.updatedAt = now(options)
        for (const item of record.run.items) {
          if (item.state === 'queued') {
            delete item.progress
            item.state = 'failed'
            item.message = 'The installation worker could not start. Preview this software again to retry.'
          }
        }
        writeRecord(options, 'runs', run.id, record)
      })
    }
    if (workerStarted) {
      try {
        withLock(options, () => {
          const record = readRecord<StoredRun>(options, 'runs', run.id)
          if (activeStates.includes(record.run.state))
            record.workerPid = workerPid
          writeRecord(options, 'runs', run.id, record)
        })
      }
      catch {
        // The spawned worker registers itself. A failed bookkeeping write must
        // never mark a live worker failed or permit a second concurrent installer.
      }
    }
  }
  return readRecord<StoredRun>(options, 'runs', run.id).run
}

function installerEnvironment(options: SoftwareEngineOptions): NodeJS.ProcessEnv {
  const environment = { ...(options.environment ?? process.env) }
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'BASH_ENV', 'ENV', 'HOMEBREW_CASK_OPTS', 'HOMEBREW_BREW_FILE', 'HOMEBREW_CASK_COMMAND', 'HOMEBREW_SUDO'])
    delete environment[key]
  return {
    ...environment,
    HOMEBREW_NO_AUTO_UPDATE: '1',
    HOMEBREW_NO_INSTALL_UPGRADE: '1',
    HOMEBREW_NO_INSTALL_CLEANUP: '1',
    HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK: '1',
    HOMEBREW_NO_ANALYTICS: '1',
    NONINTERACTIVE: '1',
    CI: '1',
  }
}

function appendLog(log: string, chunk: string, options: SoftwareEngineOptions): string {
  // Strip escape/control sequences, preserve line breaks, and retain only a bounded tail.
  // eslint-disable-next-line no-control-regex
  let clean = chunk.replace(/\x1B\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/g, '').replace(/[\x00-\x08\v\f\x0E-\x1F\x7F]/g, '')
  clean = clean.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/]+@/gi, '$1[redacted]@')
    .replace(/\b((?:bearer|basic)\s+)\S+/gi, '$1[redacted]')
    .replace(/((?:set-cookie|cookie)\s*:)[^\r\n]+/gi, '$1 [redacted]')
    .replace(/(\b(?:authorization|api[-_]?key|access[-_]?token|token|password|secret|credential)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s;&]+)/gi, '$1[redacted]')
  for (const [key, value] of Object.entries(options.environment ?? process.env)) {
    if (value && /token|secret|password|cookie|auth|credential|api.?key|(?:^|_)proxy$/i.test(key)) {
      for (const secret of value.split(/[\r\n]+/).filter(Boolean))
        clean = clean.split(secret).join('[redacted]')
    }
  }
  const combined = Buffer.from(`${log}${clean}`)
  return combined.subarray(Math.max(0, combined.length - maxLogLength)).toString('utf8').replace(/^\uFFFD/, '')
}

function finishState(run: SoftwareInstallationRun, cancelled: boolean): SoftwareInstallationRun['state'] {
  if (cancelled)
    return 'cancelled'
  if (run.items.some(item => item.state === 'failed' || item.state === 'interrupted'))
    return 'failed'
  if (run.items.some(item => item.state === 'manual'))
    return 'waiting'
  return 'completed'
}

async function installer(command: string, args: string[], runId: string, softwareId: string, options: SoftwareEngineOptions): Promise<{ code: number | null, cancelled: boolean, timedOut: boolean, terminationBlocked: boolean }> {
  const environment = installerEnvironment(options)
  const terminal = await terminalOutput(environment)
  try {
    if (readRecord<StoredRun>(options, 'runs', runId).cancelRequested) {
      await terminal?.close()
      return { code: null, cancelled: true, timedOut: false, terminationBlocked: false }
    }
  }
  catch {
    await terminal?.close()
    throw new Error('Software state is unavailable or invalid')
  }
  const child = spawn(command, args, { shell: false, detached: true, stdio: ['ignore', terminal?.fd ?? 'pipe', 'pipe'], env: { ...environment, TERM: 'xterm-256color', COLUMNS: '180', LINES: '24' } })
  const execution = new Promise<number | null>((resolve) => {
    child.once('error', () => resolve(-1))
    child.once('close', code => resolve(code))
  })
  const update = (action: (record: StoredRun) => void) => withLock(options, () => {
    const record = readRecord<StoredRun>(options, 'runs', runId)
    action(record)
    record.run.updatedAt = now(options)
    writeRecord(options, 'runs', runId, record)
  })
  let cancelled = false
  let timedOut = false
  let sentSignal = false
  let terminationError = false
  let stateError = false
  const started = Date.now()
  let killAfter = 0
  const stop = (force = false) => {
    if (!child.pid)
      return
    try {
      process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
    }
    catch (error) { terminationError ||= errorCode(error) !== 'ESRCH' }
  }
  try {
    update((record) => {
      record.childPid = child.pid
      record.terminalPids = terminal?.pids
    })
  }
  catch {
    stop(true)
    await execution
    await terminal?.close()
    throw new Error('Software state is unavailable or invalid')
  }
  let observed: SoftwareInstallationProgress | undefined
  let published = ''
  let lastProgressAt = 0
  const poll = setInterval(() => {
    try {
      cancelled = !!readRecord<StoredRun>(options, 'runs', runId).cancelRequested
      if (observed && JSON.stringify(observed) !== published && Date.now() - lastProgressAt >= 250) {
        update((record) => {
          record.run.items.find(item => item.softwareId === softwareId)!.progress = observed
        })
        published = JSON.stringify(observed)
        lastProgressAt = Date.now()
      }
    }
    catch {
      stateError = true
      stop(true)
    }
    timedOut ||= Date.now() - started > (options.installerTimeoutMs ?? 30 * 60 * 1000)
    if ((cancelled || timedOut) && !sentSignal) {
      stop()
      sentSignal = true
      killAfter = Date.now() + 2000
    }
    else if (sentSignal && Date.now() >= killAfter) {
      stop(true)
    }
  }, 200)
  const writeLog = (line: string) => {
    if (stateError)
      return
    try {
      const clean = appendLog('', line, options)
      if (!clean.trim())
        return
      const progress = downloadProgress(clean, observed)
      if (progress) {
        const changedPhase = observed?.phase !== progress.phase
        observed = progress
        const value = JSON.stringify(progress)
        if (published === value || (!changedPhase && progress.percent !== 100 && Date.now() - lastProgressAt < 250))
          return
        published = value
        lastProgressAt = Date.now()
      }
      update((record) => {
        const item = record.run.items.find(item => item.softwareId === softwareId)!
        if (progress)
          item.progress = progress
        // Terminal redraws must not flood the bounded diagnostic log.
        if (!progress || progress.percent === undefined)
          item.log = appendLog(item.log, clean, options)
      })
    }
    catch {
      stateError = true
      stop(true)
    }
  }
  // Never publish partial lines: a credential can be split across arbitrary stdout chunks.
  const buffers = [{ pending: '', omitted: false }, { pending: '', omitted: false }]
  const receive = (buffer: typeof buffers[number], chunk: string) => {
    // Cursor moves/clears delimit Homebrew redraws as well as CR curl progress.
    // Keep incomplete escape sequences in pending until the next chunk.
    buffer.pending += chunk
    // eslint-disable-next-line no-control-regex
    const pieces = buffer.pending.split(/\r\n?|\n|\x1B\[[\x30-\x3F]*[\x20-\x2F]*[ABGHJKf]/)
    buffer.pending = ''
    for (let index = 0; index < pieces.length; index++) {
      buffer.pending += pieces[index]
      if (Buffer.byteLength(buffer.pending) > 32768) {
        buffer.pending = ''
        buffer.omitted = true
      }
      if (index < pieces.length - 1) {
        writeLog(buffer.omitted ? '[Oversized installer log line omitted]\n' : `${buffer.pending}\n`)
        buffer.pending = ''
        buffer.omitted = false
      }
    }
  }
  if (terminal)
    terminal.output.setEncoding('utf8').on('data', chunk => receive(buffers[0], chunk))
  else
    child.stdout!.setEncoding('utf8').on('data', chunk => receive(buffers[0], chunk))
  child.stderr!.setEncoding('utf8').on('data', chunk => receive(buffers[1], chunk))
  const code = await execution
  await terminal?.close()
  clearInterval(poll)
  for (const buffer of buffers) {
    if (buffer.pending || buffer.omitted)
      writeLog(buffer.omitted ? '[Oversized installer log line omitted]\n' : buffer.pending)
  }
  // The brew leader can exit after SIGTERM while installer helpers continue running.
  // Keep escalation independent of the leader's close event and terminate the whole group.
  cancelled ||= !!readRecord<StoredRun>(options, 'runs', runId).cancelRequested
  if (cancelled || timedOut) {
    if (!sentSignal) {
      stop()
      killAfter = Date.now() + 2000
    }
    while (groupAlive(child.pid) && Date.now() < killAfter)
      await new Promise(resolve => setTimeout(resolve, 40))
    if (groupAlive(child.pid))
      stop(true)
  }
  const terminationBlocked = terminationError && groupAlive(child.pid)
  update((record) => {
    cancelled ||= !!record.cancelRequested
    if (terminationBlocked) {
      record.cancelRequested = true
      record.run.state = 'cancelling'
      record.run.items.find(item => item.softwareId === softwareId)!.message = 'Installer processes require manual termination. Another installation cannot start until they stop.'
    }
    else { delete record.childPid }
    delete record.terminalPids
  })
  return { code: stateError ? -1 : code, cancelled, timedOut, terminationBlocked }
}

/** Execute one previously confirmed immutable plan. A worker restart never reruns completed items. */
export async function runSoftwareWorker(runId: string, options: SoftwareEngineOptions = {}): Promise<void> {
  if (!validId(runId))
    throw new Error('Invalid software request')
  const initial = withLock(options, () => {
    const record = readRecord<StoredRun>(options, 'runs', runId)
    if (!['queued', 'cancelling'].includes(record.run.state))
      return undefined
    if (record.workerPid && record.workerPid !== process.pid && alive(record.workerPid))
      return undefined
    record.workerPid = process.pid
    record.run.state = record.cancelRequested ? 'cancelling' : 'running'
    record.run.updatedAt = now(options)
    writeRecord(options, 'runs', runId, record)
    return record
  })
  if (!initial)
    return
  const stored = readRecord<StoredPlan>(options, 'plans', initial.run.planId)
  try {
    if (!initial.cancelRequested)
      validatePlan(stored, options)
    for (const planned of stored.plan.items) {
      const source = declaredItems(options).find(item => item.id === planned.softwareId)!
      const next = withLock(options, () => {
        const record = readRecord<StoredRun>(options, 'runs', runId)
        if (record.cancelRequested)
          return 'cancel'
        const current = record.run.items.find(item => item.softwareId === planned.softwareId)!
        if (current.state !== 'queued')
          return 'skip'
        const status = softwareStatus(source, options)
        if (status !== 'not-detected') {
          current.state = status === 'detected' ? 'skipped' : 'manual'
          current.message = status === 'detected' ? 'Installed since preview; skipped without upgrading.' : 'Installation state is unknown; review manually.'
        }
        else {
          current.state = 'running'
          current.progress = { phase: 'preparing' }
        }
        record.run.updatedAt = now(options)
        writeRecord(options, 'runs', runId, record)
        return status === 'not-detected' ? 'install' : 'skip'
      })
      if (next === 'cancel')
        break
      if (next !== 'install')
        continue
      const installation = softwareInstallation(source)
      const result = await installer(brewCommand(options)!, ['install', installation.kind === 'brew-cask' ? '--cask' : '--formula', '--', installation.packageId!], runId, source.id, options)
      if (result.terminationBlocked)
        return
      withLock(options, () => {
        const latest = readRecord<StoredRun>(options, 'runs', runId)
        const item = latest.run.items.find(item => item.softwareId === source.id)!
        delete item.progress
        const detected = softwareStatus(source, options) === 'detected'
        if (result.cancelled) {
          delete item.progress
          item.state = 'cancelled'
          item.message = 'Installation was cancelled. Partially downloaded or installed files may remain; refresh detection before retrying.'
        }
        else if (result.code === 0 && detected) {
          item.state = 'installed'
          item.message = 'Installation finished and the application or executable was detected.'
        }
        else {
          delete item.progress
          item.state = 'failed'
          item.message = result.timedOut ? 'Installation timed out. Review the log and retry.' : result.code === 0 ? 'The installer exited successfully, but the declared application or executable was not detected. Refresh detection or install manually.' : 'Installation failed. Review the log. An installer requiring administrator interaction must be completed in a terminal or from the official download.'
        }
        latest.run.updatedAt = now(options)
        writeRecord(options, 'runs', runId, latest)
      })
    }
  }
  catch {
    withLock(options, () => {
      const record = readRecord<StoredRun>(options, 'runs', runId)
      for (const item of record.run.items) {
        if (['queued', 'running'].includes(item.state)) {
          delete item.progress
          item.state = 'failed'
          item.message = 'The installation plan or worker is no longer valid. Preview the remaining software again.'
        }
      }
      writeRecord(options, 'runs', runId, record)
    })
  }
  withLock(options, () => {
    const record = readRecord<StoredRun>(options, 'runs', runId)
    if (record.cancelRequested) {
      for (const item of record.run.items) {
        if (['queued', 'running'].includes(item.state)) {
          delete item.progress
          item.state = 'cancelled'
          item.message = 'Installation was cancelled before this item completed.'
        }
      }
    }
    record.run.state = finishState(record.run, !!record.cancelRequested)
    record.run.updatedAt = now(options)
    delete record.workerPid
    delete record.childPid
    writeRecord(options, 'runs', runId, record)
  })
}

async function openApplication(softwareId: string, options: SoftwareEngineOptions): Promise<{ version: 1, softwareId: string, destination: 'application' }> {
  const item = declaredItems(options).find(item => item.id === softwareId)
  if (!item)
    throw new Error('Unknown software id')
  const application = findApplication(item, options)
  if (!application.path)
    throw new Error('Software application was not detected; refresh the catalog or use its official download page')
  if (options.openApplication) {
    await options.openApplication(application.path)
  }
  else {
    const child = spawn('/usr/bin/open', [application.path], { shell: false, stdio: 'ignore', env: installerEnvironment(options) })
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    if (code !== 0)
      throw new Error('Software application could not open')
  }
  return { version: 1, softwareId, destination: 'application' }
}

/** Versioned software API accepts only catalog identifiers and confirmation tokens; never executable commands. */
export async function softwareOperationRequest(input: unknown, options: SoftwareEngineOptions = {}): Promise<SoftwareOperationResult> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid software request')
  const request = input as Record<string, unknown>
  if (request.version !== 1)
    throw new Error('Unsupported software protocol version')
  const operation = request.operation
  const keys: Record<string, string[]> = { catalog: [], preview: ['softwareIds'], install: ['planId', 'confirmed'], runs: [], run: ['runId'], cancel: ['runId'], open: ['softwareId'] }
  if (typeof operation !== 'string' || !Object.hasOwn(keys, operation))
    throw new Error('Unsupported software operation')
  if (Object.keys(request).some(key => !['version', 'operation', ...keys[operation]].includes(key)))
    throw new Error('Invalid software request')
  if (operation === 'catalog')
    return softwareRequest(request, options)
  if (operation === 'preview') {
    if (!Array.isArray(request.softwareIds) || !request.softwareIds.length || request.softwareIds.length > 50 || request.softwareIds.some(id => typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id)) || new Set(request.softwareIds).size !== request.softwareIds.length)
      throw new Error('Invalid software request')
    return preview(request.softwareIds as string[], options)
  }
  if (operation === 'install') {
    if (!validId(request.planId) || request.confirmed !== true)
      throw new Error('Software installation requires an explicit confirmed plan')
    return install(request.planId, options)
  }
  if (operation === 'open') {
    if (typeof request.softwareId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(request.softwareId))
      throw new Error('Invalid software request')
    return openApplication(request.softwareId, options)
  }
  if (operation === 'runs') {
    if (!existsSync(stateDirectory(options)))
      return { version: 1, runs: [] }
    return withLock(options, () => ({ version: 1, runs: records(options).slice(0, 20).map(record => record.run) }))
  }
  if (!validId(request.runId))
    throw new Error('Invalid software request')
  return withLock(options, () => {
    const record = reconcile(readRecord<StoredRun>(options, 'runs', request.runId as string), options)
    if (operation === 'cancel' && activeStates.includes(record.run.state)) {
      record.cancelRequested = true
      record.run.state = 'cancelling'
      record.run.updatedAt = now(options)
      writeRecord(options, 'runs', record.run.id, record)
    }
    return record.run
  })
}
