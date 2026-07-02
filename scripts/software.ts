#!/usr/bin/env node
import type { BrewfileKind, SoftwareItem } from '../software.config'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { brewfiles, softwareGroups, softwareItems } from '../software.config'

type MasState
  = | {
    available: true
    ids: Set<number>
  }
  | {
    available: false
    ids: Set<number>
    reason: string
  }

interface ItemStatus {
  state: 'installed' | 'manual' | 'missing' | 'unknown'
  via: string
}

interface StatusOptions {
  includeManualReview: boolean
  missingOnly: boolean
}

type BrewBundleSubcommand = 'check' | 'install'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const byId = new Map<string, SoftwareItem>(softwareItems.map(item => [item.id, item]))

const command = process.argv[2] ?? 'help'
const args = process.argv.slice(3)
const helpFlags = new Set(['--help', '-h'])

if (helpFlags.has(command) || args.some(arg => helpFlags.has(arg)))
  usage()

function downloadUrl(item: SoftwareItem): string {
  return item.downloadUrl || item.url
}

function hasSeparateDownloadUrl(item: SoftwareItem): boolean {
  return Boolean(item.downloadUrl && item.downloadUrl !== item.url)
}

function usage(exitCode = 0): never {
  console.log(`Usage:
  pnpm software list
  pnpm software open <id...|all>
  pnpm software status [--missing] [--all]
  pnpm software missing [--all]
  pnpm software check --core|--apps|--all
  pnpm software install --core|--apps|--all

Examples:
  pnpm software open vscode raycast wechat
  pnpm software status --missing
  pnpm software check --apps
  pnpm software install --core --apps`)
  process.exit(exitCode)
}

function list(): void {
  for (const group of softwareGroups) {
    console.log(`\n${group.group}`)
    for (const item of group.items) {
      const defaultNote = item.defaultInstall === false ? ', manual review' : ''
      const installRef = item.cask
        ? `cask: ${item.cask}`
        : item.masId
          ? `mas: ${item.masId}`
          : 'manual'
      const suffix = ` (${installRef}${defaultNote})`
      console.log(`  ${item.id.padEnd(16)} ${item.name}${suffix}`)
      console.log(`  ${' '.repeat(16)} site:     ${item.url}`)
      if (hasSeparateDownloadUrl(item))
        console.log(`  ${' '.repeat(16)} download: ${downloadUrl(item)}`)
    }
  }
}

function run(commandName: string, commandArgs: string[]): void {
  const result = spawnSync(commandName, commandArgs, {
    cwd: rootDir,
    stdio: 'inherit',
  })

  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }

  if (typeof result.status === 'number' && result.status !== 0)
    process.exit(result.status)
}

function commandResult(commandName: string, commandArgs: string[]) {
  return spawnSync(commandName, commandArgs, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function commandExists(commandName: string): boolean {
  return commandResult('which', [commandName]).status === 0
}

function brewList(kind: '--cask', name: string): boolean {
  return commandResult('brew', ['list', kind, name]).status === 0
}

function appExists(appName?: string): boolean {
  if (!appName)
    return false

  return [
    join('/Applications', appName),
    join(homedir(), 'Applications', appName),
  ].some(path => existsSync(path))
}

function readMasState(): MasState {
  if (!commandExists('mas')) {
    return {
      available: false,
      ids: new Set<number>(),
      reason: 'mas is not installed',
    }
  }

  const result = commandResult('mas', ['list'])

  if (result.status !== 0) {
    return {
      available: false,
      ids: new Set<number>(),
      reason: result.stderr.trim() || 'mas list failed',
    }
  }

  return {
    available: true,
    ids: new Set(
      result.stdout
        .split('\n')
        .map(line => line.match(/^(\d+)/)?.[1])
        .filter(Boolean)
        .map(Number),
    ),
  }
}

function isInstallable(item: SoftwareItem): boolean {
  return Boolean(item.cask || item.masId || item.installCommand)
}

function inspectItem(item: SoftwareItem, masState: MasState): ItemStatus {
  if (item.cask) {
    if (brewList('--cask', item.cask))
      return { state: 'installed', via: 'brew cask' }

    if (appExists(item.app))
      return { state: 'installed', via: 'app bundle' }

    if (item.bin && commandExists(item.bin))
      return { state: 'installed', via: 'PATH' }

    return { state: 'missing', via: item.defaultInstall === false ? 'manual review' : 'brew cask' }
  }

  if (item.masId) {
    if (appExists(item.app))
      return { state: 'installed', via: 'app bundle' }

    if (!masState.available)
      return { state: 'missing', via: masState.reason }

    return masState.ids.has(item.masId)
      ? { state: 'installed', via: 'mas' }
      : { state: 'missing', via: 'mas' }
  }

  if (item.installCommand)
    return { state: 'unknown', via: 'script installer' }

  return { state: 'manual', via: 'manual bootstrap' }
}

function parseStatusOptions(selectedArgs: string[]): StatusOptions {
  const options: StatusOptions = {
    includeManualReview: false,
    missingOnly: false,
  }

  for (const arg of selectedArgs) {
    if (arg === '--all') {
      options.includeManualReview = true
    }
    else if (arg === '--missing') {
      options.missingOnly = true
    }
    else {
      console.error(`Unknown option: ${arg}`)
      usage(1)
    }
  }

  return options
}

function status(selectedArgs: string[]): void {
  const options = parseStatusOptions(selectedArgs)
  const masState = readMasState()
  let installedCount = 0
  let missingCount = 0
  let shownCount = 0

  for (const group of softwareGroups) {
    const rows = group.items
      .filter(item => isInstallable(item))
      .filter(item => options.includeManualReview || item.defaultInstall !== false)
      .map(item => ({
        item,
        status: inspectItem(item, masState),
      }))
      .filter(row => !options.missingOnly || row.status.state === 'missing')

    if (rows.length === 0)
      continue

    console.log(`\n${group.group}`)

    for (const row of rows) {
      shownCount += 1

      if (row.status.state === 'installed')
        installedCount += 1
      else if (row.status.state === 'missing')
        missingCount += 1

      const label = `[${row.status.state}]`.padEnd(12)
      console.log(`  ${label} ${row.item.id.padEnd(16)} ${row.item.name} (${row.status.via})`)
    }
  }

  if (shownCount === 0)
    console.log(options.missingOnly ? 'No missing software.' : 'No software matched.')
  else
    console.log(`\nSummary: ${installedCount} installed, ${missingCount} missing, ${shownCount} shown.`)
}

function openDownloadPages(selectedIds: string[]): void {
  if (process.platform !== 'darwin') {
    console.error('Opening download pages currently uses the macOS open command.')
    process.exit(1)
  }

  if (selectedIds.length === 0) {
    list()
    console.error('\nPass one or more ids, or "all", to open download pages.')
    process.exit(1)
  }

  const selected = selectedIds.includes('all')
    ? softwareItems
    : selectedIds.map((id) => {
        const item = byId.get(id)
        if (!item) {
          console.error(`Unknown software id: ${id}`)
          process.exit(1)
        }
        return item
      })

  for (const item of selected)
    run('open', [downloadUrl(item)])
}

function selectedBrewfiles(selectedArgs: string[]): string[] {
  const selected = new Set<BrewfileKind>()

  for (const arg of selectedArgs) {
    if (arg === '--all') {
      selected.add('core')
      selected.add('apps')
    }
    else if (arg === '--core') {
      selected.add('core')
    }
    else if (arg === '--apps') {
      selected.add('apps')
    }
    else {
      console.error(`Unknown option: ${arg}`)
      usage(1)
    }
  }

  if (selected.size === 0) {
    console.error('Choose --core, --apps, or --all.')
    usage(1)
  }

  return [...selected].map(name => brewfiles[name])
}

function brewBundle(subcommand: BrewBundleSubcommand, selectedArgs: string[]): void {
  for (const brewfile of selectedBrewfiles(selectedArgs)) {
    const commandArgs = subcommand === 'check'
      ? ['bundle', 'check', '--file', brewfile]
      : ['bundle', '--file', brewfile]

    console.log(`\n$ brew ${commandArgs.join(' ')}`)
    run('brew', commandArgs)
  }
}

switch (command) {
  case 'list':
    list()
    break
  case 'open':
    openDownloadPages(args)
    break
  case 'status':
    status(args)
    break
  case 'missing':
    status(['--missing', ...args])
    break
  case 'check':
    brewBundle('check', args)
    break
  case 'install':
    brewBundle('install', args)
    break
  case 'help':
  case '--help':
  case '-h':
    usage()
    break
  default:
    console.error(`Unknown command: ${command}`)
    usage(1)
}
