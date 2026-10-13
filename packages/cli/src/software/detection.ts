import type { SoftwareCatalogItem } from '../../../../software.config'
import { accessSync, constants, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import process from 'node:process'

/** Host-only dependencies for readonly detection and fixture tests, never JSON request parameters. */
export interface SoftwareHostOptions {
  items?: readonly SoftwareCatalogItem[]
  platform?: NodeJS.Platform
  homeDirectory?: string
  systemApplicationsDirectory?: string
  executableDirectories?: readonly string[]
  environment?: NodeJS.ProcessEnv
}

export type DetectionStatus = 'detected' | 'not-detected' | 'unknown'

function validName(value: string): boolean {
  return /^[^/\\]+$/.test(value) && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

function executable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK)
    return statSync(file).isFile()
  }
  catch { return false }
}

/** Read fixed host executable directories without executing shell initialization or discovered commands. */
export function executableDirectories(options: SoftwareHostOptions): string[] {
  if (options.executableDirectories)
    return [...options.executableDirectories].filter(isAbsolute)
  const environment = options.environment ?? process.env
  const home = options.homeDirectory ?? homedir()
  const directories = [
    ...(environment.PATH ?? '').split((options.platform ?? process.platform) === 'win32' ? ';' : ':'),
    ...(environment.PNPM_HOME ? [environment.PNPM_HOME] : []),
    join(home, '.local/bin'),
    join(home, 'Library/pnpm'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ]
  const fnmRoots = [environment.FNM_DIR, join(home, 'Library/Application Support/fnm'), join(home, '.local/share/fnm'), join(home, '.fnm')].filter((value): value is string => !!value && isAbsolute(value))
  directories.push(join(home, '.local/share/pnpm'))
  for (const root of fnmRoots) {
    directories.push(join(root, 'aliases/default/bin'))
    const directory = join(root, 'node-versions')
    try {
      for (const entry of readdirSync(directory).filter(entry => /^v\d+\.\d+\.\d+$/.test(entry)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).slice(0, 20))
        directories.push(join(directory, entry, 'installation/bin'))
    }
    catch {}
  }
  return [...new Set(directories.filter(isAbsolute))]
}

/** Resolve an executable from approved host directories; return paths only inside the local engine. */
export function findExecutable(name: string, options: SoftwareHostOptions): string | undefined {
  if (!validName(name))
    return undefined
  const candidateName = (options.platform ?? process.platform) === 'win32' ? `${name}.exe` : name
  return executableDirectories(options).map(directory => join(directory, candidateName)).find(executable)
}

/** Resolve a declared macOS app in the two standard Applications folders. */
export function findApplication(item: SoftwareCatalogItem, options: SoftwareHostOptions): { path?: string, status: DetectionStatus } {
  if ((options.platform ?? process.platform) !== 'darwin' || !item.app || !validName(item.app) || !item.app.endsWith('.app'))
    return { status: 'unknown' }
  let unavailable = false
  for (const directory of [options.systemApplicationsDirectory ?? '/Applications', join(options.homeDirectory ?? homedir(), 'Applications')]) {
    try {
      const path = join(directory, item.app)
      if (statSync(path).isDirectory())
        return { status: 'detected', path }
    }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || !['ENOENT', 'ENOTDIR'].includes(String(error.code)))
        unavailable = true
    }
  }
  return { status: unavailable ? 'unknown' : 'not-detected' }
}

/** Detect native Codex app CLI binaries as well as a standalone Codex installation. */
export function findCodexExecutable(options: SoftwareHostOptions): string | undefined {
  const standalone = findExecutable('codex', options)
  if (standalone || (options.platform ?? process.platform) !== 'darwin')
    return standalone
  const candidates: string[] = []
  for (const directory of [options.systemApplicationsDirectory ?? '/Applications', join(options.homeDirectory ?? homedir(), 'Applications')]) {
    for (const app of ['Codex.app', 'ChatGPT.app']) {
      candidates.push(join(directory, app, 'Contents/Resources/codex'))
      candidates.push(join(directory, app, 'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'))
      candidates.push(join(directory, app, 'Contents/Resources/codex-cli/bin/codex'))
    }
  }
  return candidates.find(executable)
}

/** Discovery checks files only. It never runs a catalog command or equates a download link with installation. */
export function softwareStatus(item: SoftwareCatalogItem, options: SoftwareHostOptions): DetectionStatus {
  const app = findApplication(item, options)
  if (app.status === 'detected')
    return 'detected'
  if (item.bin) {
    if (item.id === 'codex-cli' ? findCodexExecutable(options) : findExecutable(item.bin, options))
      return 'detected'
    if ((options.platform ?? process.platform) === 'win32')
      return 'unknown'
    if (app.status === 'unknown' && item.app)
      return 'unknown'
    return 'not-detected'
  }
  return app.status
}
