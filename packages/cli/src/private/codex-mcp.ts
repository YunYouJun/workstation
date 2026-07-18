import type { McpFragment, PrivateManifest } from './types'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { getHomeDir } from '../config'
import { assertAllowedRead, privateMcpFragments } from './manifest'
import { repoRootFromManifest, resolveRepoPath } from './paths'

interface MarkerPair {
  end: string
  start: string
}

interface TomlBlock {
  lines: string[]
  section?: string
}

const privateMarkers: MarkerPair = {
  start: '# >>> workstation managed private mcp',
  end: '# <<< workstation managed private mcp',
}

const allowedTopLevelKeys = new Set([
  'mcp_oauth_callback_port',
  'mcp_oauth_callback_url',
])

function configPath(): string {
  return process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME, 'config.toml')
    : path.join(getHomeDir(), '.codex', 'config.toml')
}

function normalizeContent(content: string): string {
  return `${content.replace(/\r\n/g, '\n').trim()}\n`
}

function stripInlineComment(line: string): string {
  const index = line.indexOf('#')
  return index === -1 ? line : line.slice(0, index)
}

function tomlBlocks(content: string): TomlBlock[] {
  const blocks: TomlBlock[] = []
  let current: TomlBlock = { lines: [] }

  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    const match = stripInlineComment(line).trim().match(/^\[([^\]]+)\]$/)
    if (match) {
      blocks.push(current)
      current = {
        lines: [line],
        section: match[1],
      }
    }
    else {
      current.lines.push(line)
    }
  }

  blocks.push(current)
  return blocks.filter(block => block.lines.some(line => line.length > 0))
}

function meaningfulBlockLines(block: TomlBlock): string[] {
  return block.lines
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
}

function blockIsDesiredSubset(existing: TomlBlock, desired: TomlBlock): boolean {
  const desiredLines = new Set(meaningfulBlockLines(desired))
  return meaningfulBlockLines(existing).every(line => desiredLines.has(line))
}

function adoptMatchingSections(existing: string, fragment: string): string {
  const fragmentBlocks = tomlBlocks(fragment).filter(block => block.section)
  const fragmentSections = new Map<string, TomlBlock>()

  for (const block of fragmentBlocks) {
    const section = block.section as string
    if (fragmentSections.has(section))
      throw new Error(`Duplicate private MCP section: ${section}`)
    fragmentSections.set(section, block)
  }

  const conflicts: string[] = []
  const remaining = tomlBlocks(existing).filter((block) => {
    if (!block.section)
      return true

    const desired = fragmentSections.get(block.section)
    if (!desired)
      return true

    if (!blockIsDesiredSubset(block, desired)) {
      conflicts.push(block.section)
      return true
    }

    return false
  })

  if (conflicts.length > 0)
    throw new Error(`Private MCP sections already exist with different content: ${conflicts.join(', ')}`)

  return remaining.map(block => block.lines.join('\n')).join('\n').trimEnd()
}

function validateFragment(fragment: string, source: string): void {
  let section: string | undefined

  for (const [index, rawLine] of fragment.replace(/\r\n/g, '\n').split('\n').entries()) {
    const line = stripInlineComment(rawLine).trim()
    if (!line)
      continue

    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      section = sectionMatch[1]
      const allowed = section.startsWith('mcp_servers.')
        || (section.startsWith('plugins.') && section.includes('.mcp_servers.'))
      if (!allowed)
        throw new Error(`Unsupported private MCP section in ${source} on line ${index + 1}: [${section}]`)
      continue
    }

    if (!section && line.includes('=')) {
      const key = line.split('=')[0].trim()
      if (!allowedTopLevelKeys.has(key))
        throw new Error(`Unsupported private MCP top-level key in ${source} on line ${index + 1}: ${key}`)
    }
  }
}

function readFragment(manifestPath: string, manifest: PrivateManifest, fragment: McpFragment): string {
  if (fragment.format && fragment.format !== 'toml-codex')
    throw new Error(`Unsupported private MCP fragment format for ${fragment.id}: ${fragment.format}`)

  assertAllowedRead(fragment.path, manifest.workstationOverlay || {})
  const source = resolveRepoPath(repoRootFromManifest(manifestPath), fragment.path)
  if (!fs.existsSync(source))
    throw new Error(`Private MCP fragment not found: ${source}`)

  const content = normalizeContent(fs.readFileSync(source, 'utf8'))
  validateFragment(content, source)
  return content
}

function stripManagedBlock(content: string, markers: MarkerPair): { content: string, removed: boolean } {
  const result: string[] = []
  let inside = false
  let removed = false

  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    if (line.trim() === markers.start) {
      if (inside)
        throw new Error(`Nested managed MCP block: ${markers.start}`)
      inside = true
      removed = true
      continue
    }

    if (inside && line.trim() === markers.end) {
      inside = false
      continue
    }

    if (!inside)
      result.push(line)
  }

  if (inside)
    throw new Error(`Found ${markers.start} without matching ${markers.end}`)

  return {
    content: `${result.join('\n').trimEnd()}\n`,
    removed,
  }
}

function composeConfig(existing: string, fragment: string): string {
  const stripped = stripManagedBlock(existing, privateMarkers)
  const trimmedFragment = fragment.trim()
  if (!trimmedFragment)
    return stripped.content.trim() ? `${stripped.content.trimEnd()}\n` : ''

  const block = [
    privateMarkers.start,
    trimmedFragment,
    privateMarkers.end,
  ].join('\n')
  const base = adoptMatchingSections(stripped.content, trimmedFragment)
  return base ? `${base}\n\n${block}\n` : `${block}\n`
}

export function applyPrivateCodexMcp(manifestPath: string, manifest: PrivateManifest, dryRun: boolean): void {
  const fragments = privateMcpFragments(manifest)
  const fragment = fragments
    .map(item => readFragment(manifestPath, manifest, item).trim())
    .filter(Boolean)
    .join('\n\n')
  const destination = configPath()
  const existing = fs.existsSync(destination) ? fs.readFileSync(destination, 'utf8') : ''
  const next = composeConfig(existing, fragment)

  if (next === existing) {
    console.log('[skip] private Codex MCP config is already up to date')
    return
  }

  console.log(`${dryRun ? '[dry-run]' : '[apply]'} private Codex MCP -> ${destination}`)
  if (dryRun)
    return

  fs.mkdirSync(path.dirname(destination), { recursive: true })
  if (fs.existsSync(destination)) {
    const backup = `${destination}.backup.${Date.now()}`
    fs.copyFileSync(destination, backup)
    console.log(`[backup] ${backup}`)
  }

  const temporary = `${destination}.tmp.${process.pid}`
  try {
    fs.writeFileSync(temporary, next, 'utf8')
    fs.renameSync(temporary, destination)
  }
  finally {
    fs.rmSync(temporary, { force: true })
  }
  console.log('[ok] applied private Codex MCP config')
}
