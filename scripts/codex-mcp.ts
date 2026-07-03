#!/usr/bin/env node
import type { PrivateManifest } from '../packages/cli/src/private/types'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { assertAllowedRead, privateMcpFragments, readPrivateManifest } from '../packages/cli/src/private/manifest'
import { expandHome, repoRootFromManifest, resolveRepoPath } from '../packages/cli/src/private/paths'

interface Options {
  dest: string
  dryRun: boolean
  manifest: string
  privateManifest?: string
  source?: string
}

type Command = 'check' | 'install' | 'list' | 'status'

interface ManagedBlock {
  content: string
  endLine: number
  startLine: number
}

interface StrippedConfig {
  content: string
  removed: boolean
}

interface SourceFragment {
  content: string
  source: string
}

const helpFlags = new Set(['--help', '-h'])
const managedStart = '# >>> workstation managed mcp'
const managedEnd = '# <<< workstation managed mcp'
const allowedTopLevelKeys = new Set([
  'mcp_oauth_callback_port',
  'mcp_oauth_callback_url',
])

function usage(exitCode = 0): never {
  console.log(`Usage:
  pnpm mcp:list
  pnpm mcp:status
  pnpm mcp:check
  pnpm mcp:install [--dry-run] [--manifest <path>] [--source <path>] [--dest <path>] [--private-manifest <path>]

Examples:
  pnpm mcp:list
  pnpm mcp:status
  pnpm mcp:install --dry-run
  pnpm mcp:install --private-manifest ~/repos/private/dotfiles/config/sync-manifest.json`)
  process.exit(exitCode)
}

function defaultManifestPath(): string {
  return resolve(import.meta.dirname, '..', 'config', 'codex-tools.manifest.json')
}

function defaultConfigPath(): string {
  return process.env.CODEX_HOME
    ? resolve(process.env.CODEX_HOME, 'config.toml')
    : resolve(homedir(), '.codex', 'config.toml')
}

function defaultPrivateManifestPath(): string | undefined {
  return process.env.WORKSTATION_PRIVATE_MANIFEST
    ? resolve(expandHome(process.env.WORKSTATION_PRIVATE_MANIFEST))
    : undefined
}

function parseCommand(value: string | undefined): Command {
  if (!value || value.startsWith('-'))
    return 'status'

  if (['check', 'install', 'list', 'status'].includes(value))
    return value as Command

  console.error(`Unknown MCP command: ${value}`)
  usage(1)
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    dest: defaultConfigPath(),
    dryRun: false,
    manifest: defaultManifestPath(),
    privateManifest: defaultPrivateManifestPath(),
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (helpFlags.has(arg))
      usage()

    if (arg === '--') {
      continue
    }
    else if (arg === '--dry-run') {
      options.dryRun = true
    }
    else if (arg === '--source') {
      const value = args[index + 1]
      if (!value) {
        console.error('--source requires a path')
        usage(1)
      }
      options.source = resolve(value)
      index += 1
    }
    else if (arg === '--manifest') {
      const value = args[index + 1]
      if (!value) {
        console.error('--manifest requires a path')
        usage(1)
      }
      options.manifest = resolve(expandHome(value))
      index += 1
    }
    else if (arg === '--dest') {
      const value = args[index + 1]
      if (!value) {
        console.error('--dest requires a path')
        usage(1)
      }
      options.dest = resolve(value)
      index += 1
    }
    else if (arg === '--private-manifest') {
      const value = args[index + 1]
      if (!value) {
        console.error('--private-manifest requires a path')
        usage(1)
      }
      options.privateManifest = resolve(expandHome(value))
      index += 1
    }
    else {
      console.error(`Unknown option: ${arg}`)
      usage(1)
    }
  }

  return options
}

function normalizeContent(content: string): string {
  return `${content.replace(/\r\n/g, '\n').trim()}\n`
}

function nonCommentContent(content: string): string[] {
  return content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
}

function hasManagedEntries(fragment: string): boolean {
  return nonCommentContent(fragment).length > 0
}

function isAllowedSection(section: string): boolean {
  return section.startsWith('mcp_servers.')
    || (section.startsWith('plugins.') && section.includes('.mcp_servers.'))
}

function stripInlineComment(line: string): string {
  const index = line.indexOf('#')
  return index === -1 ? line : line.slice(0, index)
}

function validateMcpFragment(fragment: string): void {
  let section: string | null = null

  for (const [index, rawLine] of fragment.replace(/\r\n/g, '\n').split('\n').entries()) {
    const line = stripInlineComment(rawLine).trim()
    if (!line)
      continue

    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      section = sectionMatch[1]
      if (!isAllowedSection(section)) {
        throw new Error(`Unsupported MCP fragment section on line ${index + 1}: [${section}]`)
      }
      continue
    }

    if (!section && line.includes('=')) {
      const key = line.split('=')[0].trim()
      if (!allowedTopLevelKeys.has(key)) {
        throw new Error(`Unsupported top-level MCP config key on line ${index + 1}: ${key}`)
      }
    }
  }
}

function extractSections(fragment: string): string[] {
  const sections: string[] = []

  for (const rawLine of fragment.replace(/\r\n/g, '\n').split('\n')) {
    const line = stripInlineComment(rawLine).trim()
    const match = line.match(/^\[([^\]]+)\]$/)
    if (match)
      sections.push(match[1])
  }

  return sections
}

function extractTopLevelKeys(fragment: string): string[] {
  const keys: string[] = []
  let section: string | null = null

  for (const rawLine of fragment.replace(/\r\n/g, '\n').split('\n')) {
    const line = stripInlineComment(rawLine).trim()
    if (!line)
      continue

    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      section = sectionMatch[1]
      continue
    }

    if (!section && line.includes('=')) {
      const key = line.split('=')[0].trim()
      keys.push(key)
    }
  }

  return keys
}

function readFragmentContent(source: string): string {
  if (!existsSync(source))
    throw new Error(`MCP source file not found: ${source}`)

  const fragment = normalizeContent(readFileSync(source, 'utf-8'))
  validateMcpFragment(fragment)
  return fragment
}

function readManifest(path: string): PrivateManifest {
  if (!existsSync(path))
    throw new Error(`Codex tools manifest not found: ${path}`)

  return JSON.parse(readFileSync(path, 'utf-8')) as PrivateManifest
}

function manifestSourceFragments(manifestPath: string | undefined, requireAllowlist: boolean): SourceFragment[] {
  if (!manifestPath)
    return []

  const manifest = requireAllowlist ? readPrivateManifest(manifestPath) : readManifest(manifestPath)
  const repoRoot = repoRootFromManifest(manifestPath)
  const fragments = privateMcpFragments(manifest)

  return fragments
    .map((fragment) => {
      if (fragment.format && fragment.format !== 'toml-codex')
        throw new Error(`Unsupported MCP fragment format for ${fragment.id}: ${fragment.format}`)

      if (requireAllowlist)
        assertAllowedRead(fragment.path, manifest.workstationOverlay || {})

      const source = resolveRepoPath(repoRoot, fragment.path)

      return {
        content: readFragmentContent(source),
        source: `${manifestPath}:${fragment.path}`,
      }
    })
}

function readSourceFragments(options: Options): SourceFragment[] {
  if (options.source) {
    return [
      {
        content: readFragmentContent(options.source),
        source: options.source,
      },
      ...manifestSourceFragments(options.privateManifest, true),
    ]
  }

  return [
    ...manifestSourceFragments(options.manifest, false),
    ...manifestSourceFragments(options.privateManifest, true),
  ]
}

function combineFragments(fragments: SourceFragment[]): string {
  return normalizeContent(
    fragments
      .map(fragment => fragment.content.trim())
      .filter(Boolean)
      .join('\n\n'),
  )
}

function readConfig(dest: string): string {
  if (!existsSync(dest))
    return ''

  return readFileSync(dest, 'utf-8').replace(/\r\n/g, '\n')
}

function extractManagedBlock(content: string): ManagedBlock | null {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  let startLine = -1
  const blockLines: string[] = []

  for (const [index, line] of lines.entries()) {
    if (line.trim() === managedStart) {
      startLine = index
      continue
    }

    if (startLine >= 0 && line.trim() === managedEnd) {
      return {
        content: normalizeContent(blockLines.join('\n')),
        endLine: index,
        startLine,
      }
    }

    if (startLine >= 0)
      blockLines.push(line)
  }

  if (startLine >= 0)
    throw new Error(`Found ${managedStart} without matching ${managedEnd}`)

  return null
}

function stripManagedBlock(content: string): StrippedConfig {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const result: string[] = []
  let inside = false
  let removed = false

  for (const line of lines) {
    if (line.trim() === managedStart) {
      inside = true
      removed = true
      continue
    }

    if (inside && line.trim() === managedEnd) {
      inside = false
      continue
    }

    if (!inside)
      result.push(line)
  }

  if (inside)
    throw new Error(`Found ${managedStart} without matching ${managedEnd}`)

  return {
    content: `${result.join('\n').trimEnd()}\n`,
    removed,
  }
}

function composeManagedConfig(existingConfig: string, fragment: string): string {
  const stripped = stripManagedBlock(existingConfig)

  if (!hasManagedEntries(fragment))
    return stripped.content.trim() ? `${stripped.content.trimEnd()}\n` : ''

  const managedBlock = [
    managedStart,
    fragment.trimEnd(),
    managedEnd,
  ].join('\n')

  const base = stripped.content.trimEnd()
  return base ? `${base}\n\n${managedBlock}\n` : `${managedBlock}\n`
}

function backupPath(dest: string): string {
  return `${dest}.backup.${Date.now()}`
}

function sourceLabel(fragments: SourceFragment[]): string {
  return fragments.map(fragment => fragment.source).join(', ')
}

function printList(fragments: SourceFragment[], fragment: string): void {
  const topLevelKeys = extractTopLevelKeys(fragment)
  const sections = extractSections(fragment)

  console.log('Sources:')
  for (const source of fragments)
    console.log(`  - ${source.source}`)

  if (topLevelKeys.length === 0 && sections.length === 0) {
    console.log('No managed MCP config entries.')
    return
  }

  for (const key of topLevelKeys)
    console.log(`top-level: ${key}`)

  for (const section of sections)
    console.log(`section:   [${section}]`)
}

function status(dest: string, fragment: string): 'empty' | 'installed' | 'missing' | 'outdated' {
  const targetConfig = readConfig(dest)
  const block = extractManagedBlock(targetConfig)
  const hasEntries = hasManagedEntries(fragment)

  if (!hasEntries)
    return block ? 'outdated' : 'empty'

  if (!block)
    return 'missing'

  return block.content === normalizeContent(fragment) ? 'installed' : 'outdated'
}

function printStatus(source: string, dest: string, fragment: string, check: boolean): void {
  const state = status(dest, fragment)
  console.log(`[${state}] ${source} -> ${dest}`)

  if (check && (state === 'missing' || state === 'outdated'))
    process.exitCode = 1
}

async function install(source: string, dest: string, fragment: string, dryRun: boolean): Promise<void> {
  const existingConfig = readConfig(dest)
  const existingBlock = extractManagedBlock(existingConfig)

  if (!hasManagedEntries(fragment) && !existingBlock) {
    console.log(`[skip] No managed MCP config entries in ${source}`)
    return
  }

  const nextConfig = composeManagedConfig(existingConfig, fragment)

  if (nextConfig === existingConfig) {
    console.log(`[skip] MCP config already up to date at ${dest}`)
    return
  }

  const action = hasManagedEntries(fragment) ? 'update' : 'remove'
  console.log(`${dryRun ? '[dry-run]' : '[install]'} ${action} managed MCP block in ${dest}`)

  if (dryRun)
    return

  mkdirSync(dirname(dest), { recursive: true })

  if (existsSync(dest)) {
    const backup = backupPath(dest)
    await copyFile(dest, backup)
    console.log(`[backup] ${backup}`)
  }

  writeFileSync(dest, nextConfig, 'utf-8')
  console.log(`[ok] synced MCP config from ${source}`)
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2])
  const optionArgs = process.argv[2]?.startsWith('-')
    ? process.argv.slice(2)
    : process.argv.slice(3)
  const options = parseOptions(optionArgs)
  const fragments = readSourceFragments(options)
  const fragment = combineFragments(fragments)
  const source = sourceLabel(fragments)

  if (command === 'list') {
    printList(fragments, fragment)
  }
  else if (command === 'install') {
    await install(source, options.dest, fragment, options.dryRun)
  }
  else {
    printStatus(source, options.dest, fragment, command === 'check')
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
