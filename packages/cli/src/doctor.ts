import type { DotfileEntry } from './config'
import type { PrivateManifest } from './private/types'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import * as p from '@clack/prompts'
import consola from 'consola'
import { parseDocument } from 'yaml'
import { dotfiles, getHomeDir, getRepoRoot } from './config'
import { validatePrivateManifest } from './private/manifest'
import { expandHome, privateConfigPath } from './private/paths'
import { findPlaceholders } from './secrets'

export interface DoctorCheck {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
  path?: string
}

/** Read-only readiness report, without file contents, secret names or subprocess output. */
export interface DoctorReport {
  version: 1
  checkedAt: string
  checks: DoctorCheck[]
  summary: { errors: number, warnings: number, passed: number }
}

export type DoctorProbeResult = 'available' | 'missing' | 'failed'

/** Local injection only: JSON callers cannot choose paths, executables or probes. */
export interface DoctorOptions {
  repoRoot?: string
  manifestPath?: string | null
  platform?: NodeJS.Platform
  entries?: DotfileEntry[]
  now?: () => Date
  probe?: (command: string, args: string[]) => DoctorProbeResult
}

const maxBytes = 1024 * 1024
const maxChecks = 200

function displayPath(file: string): string | undefined {
  return file.length <= 4096 && !/\p{Cc}/u.test(file) ? file : undefined
}

/** Bound reads even when another process changes the file after opening it. */
function readBounded(file: string): string | undefined {
  let descriptor: number | undefined
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0))
    if (!fs.fstatSync(descriptor).isFile())
      throw new Error('Unreadable diagnostic source')
    const buffer = Buffer.alloc(maxBytes + 1)
    let length = 0
    while (length < buffer.length) {
      const count = fs.readSync(descriptor, buffer, length, buffer.length - length, null)
      if (!count)
        break
      length += count
    }
    if (length > maxBytes)
      throw new Error('Unreadable diagnostic source')
    const content = buffer.subarray(0, length).toString('utf8')
    if (content.includes('\0'))
      throw new Error('Unreadable diagnostic source')
    return content
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return undefined
    throw error
  }
  finally {
    if (descriptor !== undefined)
      fs.closeSync(descriptor)
  }
}

/** Respect existing private connections while bounding fallback discovery and config reads. */
function doctorManifestPath(): string {
  if (process.env.WORKSTATION_PRIVATE_MANIFEST)
    return path.resolve(expandHome(process.env.WORKSTATION_PRIVATE_MANIFEST))
  const configuration = readBounded(privateConfigPath())
  if (configuration !== undefined) {
    const value = JSON.parse(configuration) as { manifestPath?: unknown }
    if (typeof value?.manifestPath === 'string') {
      const configured = path.resolve(expandHome(value.manifestPath))
      if (fs.existsSync(configured))
        return configured
    }
  }
  const home = getHomeDir()
  const fallback = path.join(home, 'repos', 'private', 'dotfiles', 'config', 'sync-manifest.json')
  for (const candidate of [fallback, path.join(home, 'repos', 'dotfiles', 'config', 'sync-manifest.json')]) {
    if (fs.existsSync(candidate))
      return candidate
  }
  const repos = path.join(home, 'repos')
  if (!fs.existsSync(repos))
    return fallback
  const started = Date.now()
  const stack = [{ directory: repos, depth: 0 }]
  const found: string[] = []
  let directories = 0
  let entries = 0
  while (stack.length) {
    const current = stack.pop()!
    if (current.depth > 4)
      continue
    if (++directories > 512 || Date.now() - started > 1000)
      throw new Error('Private discovery exceeds limit')
    let directory: fs.Dir
    try {
      directory = fs.opendirSync(current.directory)
    }
    catch { continue }
    try {
      let entry: fs.Dirent | null
      // eslint-disable-next-line no-cond-assign
      while ((entry = directory.readSync()) !== null) {
        if (++entries > 4096 || Date.now() - started > 1000)
          throw new Error('Private discovery exceeds limit')
        if (!entry.isDirectory() || ['node_modules', '.git'].includes(entry.name))
          continue
        const child = path.join(current.directory, entry.name)
        const manifest = path.join(child, 'config', 'sync-manifest.json')
        if (entry.name === 'dotfiles' && fs.existsSync(manifest))
          found.push(manifest)
        stack.push({ directory: child, depth: current.depth + 1 })
      }
    }
    finally { directory.closeSync() }
  }
  return found.sort((left, right) => left.localeCompare(right))[0] ?? fallback
}

/** Bounded executable probe; output is deliberately discarded. */
export function probeDoctorDependency(command: string, args: string[]): DoctorProbeResult {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 1000,
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024,
    })
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT')
      return 'missing'
    return !result.error && result.status === 0 ? 'available' : 'failed'
  }
  catch { return 'failed' }
}

/** Shared inspection kernel for terminal doctor and the versioned host protocol. */
export function inspectDoctor(options: DoctorOptions = {}): DoctorReport {
  const repoRoot = options.repoRoot ?? getRepoRoot()
  const platform = options.platform ?? process.platform
  const checks: DoctorCheck[] = []
  let truncated = false
  const add = (code: string, severity: DoctorCheck['severity'], message: string, file?: string) => {
    if (checks.length >= maxChecks - 1) {
      truncated = true
      return
    }
    checks.push({ code, severity, message, ...(file && displayPath(file) ? { path: file } : {}) })
  }
  const read = (file: string, code: string): string | undefined => {
    try {
      return readBounded(file)
    }
    catch {
      add(`${code}-unreadable`, 'error', 'Diagnostic source is not a readable bounded text file.', file)
      return undefined
    }
  }
  const source = (file: string, code: string, validate?: (text: string) => boolean) => {
    const start = checks.length
    const content = read(file, code)
    if (content === undefined) {
      if (checks.length === start)
        add(`${code}-missing`, 'error', 'Declared configuration source is missing.', file)
      return undefined
    }
    if (validate) {
      try {
        if (!validate(content))
          throw new Error('Invalid source')
      }
      catch {
        add(`${code}-invalid`, 'error', 'Configuration source is invalid. Review its syntax in the original tool.', file)
        return undefined
      }
    }
    add(`${code}-ready`, 'info', 'Declared configuration source is available.', file)
    return content
  }

  source(path.join(repoRoot, '.chezmoiroot'), 'chezmoi-root', text => text.trim() === 'home')
  const homeSourcePath = path.join(repoRoot, 'home')
  try {
    if (!fs.statSync(homeSourcePath).isDirectory())
      throw new Error('Invalid directory')
    add('home-source-ready', 'info', 'Home source tree is available.', homeSourcePath)
  }
  catch { add('home-source-missing', 'error', 'Home source tree is missing or unreadable.', homeSourcePath) }
  for (const [code, file] of [
    ['apm-manifest', path.join(homeSourcePath, 'dot_apm', 'apm.yml')],
    ['apm-lock', path.join(homeSourcePath, 'dot_apm', 'private_apm.lock.yaml')],
  ]) {
    source(file, code, (text) => {
      const document = parseDocument(text)
      const value: unknown = document.toJS({ maxAliasCount: 100 })
      return !document.errors.length && !!value && typeof value === 'object' && !Array.isArray(value)
    })
  }

  const secretsContent = read(path.join(repoRoot, '.env.local'), 'secrets-file')
  const secrets = new Set<string>()
  for (const line of (secretsContent ?? '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#'))
      continue
    const split = trimmed.indexOf('=')
    if (split > 0 && trimmed.slice(split + 1).replace(/^['"]|['"]$/g, '').trim())
      secrets.add(trimmed.slice(0, split).trim())
  }
  const entries = options.entries ?? dotfiles
  for (const entry of entries.slice(0, 80)) {
    const sourcePath = path.resolve(repoRoot, entry.source)
    if (platform !== 'darwin' && entry.source.split(/[\\/]/).includes('Library')) {
      add('source-platform-skipped', 'info', 'This source is used by macOS clients only.', sourcePath)
      continue
    }
    const content = source(sourcePath, 'source')
    if (content !== undefined && findPlaceholders(content).some(key => !secrets.has(key)))
      add('source-secrets-missing', 'error', 'Declared configuration source has unresolved local secret placeholders.', sourcePath)
  }
  if (entries.length > 80)
    truncated = true

  try {
    const manifestPath = options.manifestPath === undefined ? doctorManifestPath() : options.manifestPath
    if (manifestPath) {
      const start = checks.length
      const content = read(manifestPath, 'private-manifest')
      if (content === undefined) {
        if (checks.length === start)
          add('private-manifest-missing', 'warning', 'Private configuration manifest is not connected.', manifestPath)
      }
      else {
        try {
          const manifest = JSON.parse(content) as PrivateManifest
          if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || validatePrivateManifest(manifest).length)
            throw new Error('Invalid manifest')
          add('private-manifest-ready', 'info', 'Private configuration manifest is valid.', manifestPath)
        }
        catch { add('private-manifest-invalid', 'error', 'Private configuration manifest is invalid. Review it in the original tool.', manifestPath) }
      }
    }
  }
  catch { add('private-manifest-unavailable', 'error', 'Private configuration manifest could not be inspected.') }

  const probe = options.probe ?? probeDoctorDependency
  for (const command of ['git', 'chezmoi', 'apm', 'gitleaks', ...(platform !== 'win32' ? ['zsh'] : []), ...(platform === 'darwin' ? ['brew'] : [])]) {
    let state: DoctorProbeResult = 'failed'
    try {
      state = probe(command, [command === 'gitleaks' ? 'version' : '--version'])
    }
    catch {}
    add(`dependency-${command}-${state === 'available' ? 'ready' : state === 'missing' ? 'missing' : 'failed'}`, state === 'available' ? 'info' : 'warning', state === 'available' ? `${command} executable is available.` : state === 'missing' ? `${command} executable is not installed.` : `${command} executable check failed or timed out.`)
  }
  if (platform !== 'darwin')
    add('software-platform-unsupported', 'info', 'Automatic software installation and application opening require macOS.')
  if (platform === 'win32')
    add('configuration-platform-read-only', 'warning', 'Configuration writing and remote operations are unavailable on this platform.')
  if (truncated)
    checks.push({ code: 'doctor-report-truncated', severity: 'warning', message: 'Additional checks exceeded the diagnostic report limit.' })

  return {
    version: 1,
    checkedAt: (options.now?.() ?? new Date()).toISOString(),
    checks,
    summary: {
      errors: checks.filter(check => check.severity === 'error').length,
      warnings: checks.filter(check => check.severity === 'warning').length,
      passed: checks.filter(check => check.severity === 'info').length,
    },
  }
}

/** Render the shared report for terminal users without expanding private diagnostics. */
export function doctor(options: DoctorOptions = {}) {
  p.intro('Workstation Doctor')
  const report = inspectDoctor(options)
  for (const check of report.checks) {
    const message = `${check.message}${check.path ? ` (${check.path})` : ''}`
    if (check.severity === 'error')
      consola.error(message)
    else if (check.severity === 'warning')
      consola.warn(message)
    else consola.success(message)
  }
  p.outro(report.summary.errors || report.summary.warnings
    ? `Doctor found ${report.summary.errors} errors and ${report.summary.warnings} warnings`
    : 'Doctor checks passed')
  return report.summary
}
