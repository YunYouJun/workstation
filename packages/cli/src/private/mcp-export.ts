import type { McpFragment, McpSource, PrivateManifest, PrivateOptions } from './types'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { assertAllowedRead, privateMcpFragments } from './manifest'
import { expandHome, repoRootFromManifest, resolveManifestRelativePath, resolveRepoPath } from './paths'

interface ExportBlock {
  lines: string[]
  server: string
}

const secretLikeKeyPattern = /api[_-]?key|authorization|bearer|cookie|password|secret|token/i
const secretValueHintPattern = /--?(?:api[-_]?key|auth|authorization|bearer|cookie|password|secret|token)\b|[?&](?:api[-_]?key|password|secret|token)=|bearer\s+/i

export function exportMcpServers(manifestPath: string, manifest: PrivateManifest, options: PrivateOptions): void {
  const servers = normalizeServerOptions(options.servers)
  if (servers.length === 0)
    throw new Error('Pass at least one MCP server name with --server <name>[,<name>]')

  const source = resolveMcpExportSource(manifest, options)
  const output = resolveMcpExportOutput(manifestPath, manifest, options)
  const sourceContent = readSourceContent(source)
  const blocks = extractMcpServerBlocks(sourceContent, servers)
  const exportedServers = new Set(blocks.map(block => block.server))
  const missing = servers.filter(server => !exportedServers.has(server))

  if (missing.length === 1)
    throw new Error(`Requested MCP server was not found: ${missing[0]}`)
  if (missing.length > 1)
    throw new Error(`Requested MCP servers were not found: ${missing.join(', ')}`)

  const content = composeExportContent(blocks)
  const dryRun = options.dryRun || !options.yes
  const label = servers.join(', ')

  if (dryRun) {
    console.log(`[dry-run] export MCP servers ${label} from ${source} to ${output}`)
    console.log('')
    process.stdout.write(content)
    return
  }

  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, content, 'utf-8')
  console.log(`[export] wrote MCP overlay ${output}`)
  console.log(`[export] servers: ${label}`)
}

function normalizeServerOptions(values: string[] | undefined): string[] {
  const seen = new Set<string>()
  const servers: string[] = []

  for (const value of values || []) {
    for (const server of value.split(',').map(item => item.trim()).filter(Boolean)) {
      if (seen.has(server))
        continue

      seen.add(server)
      servers.push(server)
    }
  }

  return servers
}

function resolveMcpExportSource(manifest: PrivateManifest, options: PrivateOptions): string {
  if (options.source)
    return options.source

  const source = preferredCodexSource(manifest)
  if (!source)
    throw new Error('No toml-codex MCP source is configured in the private manifest')

  return path.resolve(expandHome(source.path))
}

function preferredCodexSource(manifest: PrivateManifest): McpSource | undefined {
  return manifest.mcp?.sources?.find(source => source.format === 'toml-codex' && source.id === 'codex-user')
    || manifest.mcp?.sources?.find(source => source.format === 'toml-codex' && source.path.includes('.codex/config.toml'))
    || manifest.mcp?.sources?.find(source => source.format === 'toml-codex')
}

function resolveMcpExportOutput(manifestPath: string, manifest: PrivateManifest, options: PrivateOptions): string {
  const fragment = options.output
    ? fragmentForOutput(manifestPath, manifest, options.output)
    : preferredCodexFragment(manifest)
  if (!fragment)
    throw new Error(options.output ? `Output path is not a declared MCP fragment: ${options.output}` : 'No toml-codex MCP fragment is configured in the private manifest')

  if (manifest.workstationOverlay)
    assertAllowedRead(fragment.path, manifest.workstationOverlay)

  return resolveRepoPath(repoRootFromManifest(manifestPath), fragment.path)
}

function preferredCodexFragment(manifest: PrivateManifest): McpFragment | undefined {
  return privateMcpFragments(manifest).find(fragment => fragment.format === 'toml-codex' && fragment.syncMode === 'install')
    || privateMcpFragments(manifest).find(fragment => fragment.format === 'toml-codex')
}

function fragmentForOutput(manifestPath: string, manifest: PrivateManifest, output: string): McpFragment | undefined {
  const requested = resolveManifestRelativePath(manifestPath, output)
  const repoRoot = repoRootFromManifest(manifestPath)

  return privateMcpFragments(manifest)
    .find(fragment => resolveRepoPath(repoRoot, fragment.path) === requested)
}

function readSourceContent(source: string): string {
  if (!fs.existsSync(source))
    throw new Error(`Codex MCP source file not found: ${source}`)

  return fs.readFileSync(source, 'utf-8').replace(/\r\n/g, '\n')
}

function extractMcpServerBlocks(content: string, servers: string[]): ExportBlock[] {
  const requested = new Set(servers)
  const blocks: ExportBlock[] = []
  let current: ExportBlock | undefined

  for (const line of content.split('\n')) {
    const header = parseTableHeader(line)
    if (header) {
      const server = mcpServerNameFromSection(header)
      current = server && requested.has(server)
        ? { lines: [line], server }
        : undefined

      if (current)
        blocks.push(current)

      continue
    }

    if (current)
      current.lines.push(line)
  }

  return blocks
}

function parseTableHeader(line: string): string | undefined {
  const match = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/)
  return match?.[1].trim()
}

function mcpServerNameFromSection(section: string): string | undefined {
  const parts = parseDottedTomlName(section)
  if (parts[0] === 'mcp_servers')
    return parts[1]

  const mcpServersIndex = parts.indexOf('mcp_servers')
  if (mcpServersIndex > 0 && parts[mcpServersIndex + 1])
    return parts[mcpServersIndex + 1]

  return undefined
}

function parseDottedTomlName(value: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: '"' | '\'' | undefined
  let escaped = false

  for (const char of value.trim()) {
    if (quote) {
      if (escaped) {
        current += char
        escaped = false
      }
      else if (char === '\\' && quote === '"') {
        escaped = true
      }
      else if (char === quote) {
        quote = undefined
      }
      else {
        current += char
      }
      continue
    }

    if (char === '"' || char === '\'') {
      quote = char
    }
    else if (char === '.') {
      parts.push(current.trim())
      current = ''
    }
    else {
      current += char
    }
  }

  if (current.trim())
    parts.push(current.trim())

  return parts
}

function composeExportContent(blocks: ExportBlock[]): string {
  const lines = [
    '# Private Codex MCP fragment.',
    '# Exported by `wst private mcp-export`.',
    '# Keep real tokens in 1Password or local environment variables.',
    '',
  ]

  for (const [index, block] of blocks.entries()) {
    if (index > 0)
      lines.push('')

    lines.push(...sanitizeBlock(block))
  }

  return `${lines.join('\n').trimEnd()}\n`
}

function sanitizeBlock(block: ExportBlock): string[] {
  const sanitized: string[] = []
  let sectionParts: string[] = []

  for (const line of block.lines) {
    const header = parseTableHeader(line)
    if (header) {
      sectionParts = parseDottedTomlName(header)
      sanitized.push(line)
      continue
    }

    sanitized.push(sanitizeAssignmentLine(line, block.server, sectionParts))
  }

  return trimTrailingBlankLines(sanitized)
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const result = [...lines]
  while (result.length > 0 && result[result.length - 1].trim() === '')
    result.pop()

  return result
}

function sanitizeAssignmentLine(line: string, server: string, sectionParts: string[]): string {
  const assignment = parseAssignment(line)
  if (!assignment)
    return line

  const normalizedKey = normalizeTomlKey(assignment.key)
  const envTable = sectionParts[sectionParts.length - 1] === 'env'
  const envHeaderTable = sectionParts[sectionParts.length - 1] === 'env_http_headers'
  const headerTable = isHeaderKey(sectionParts[sectionParts.length - 1] || '')

  if (envTable)
    return sanitizeEnvValueAssignment(line, server, normalizedKey, assignment.value)

  if (envHeaderTable)
    return line

  if (normalizedKey === 'env' && assignment.value.trim().startsWith('{'))
    return replaceAssignmentValue(line, assignment.value, sanitizeInlineEnvTable(server, assignment.value))

  if (normalizedKey === 'bearer_token_env_var')
    return sanitizeBearerTokenEnvVarAssignment(line, server, assignment.value)

  if (headerTable || secretLikeKeyPattern.test(normalizedKey))
    return sanitizeSecretValueAssignment(line, server, normalizedKey, assignment.value)

  if (isHeaderKey(normalizedKey))
    return replaceAssignmentValue(line, assignment.value, sanitizeInlineSecretTable(server, assignment.value))

  if ((normalizedKey === 'args' || normalizedKey === 'url') && secretValueHintPattern.test(assignment.value))
    assertNoLiteralSecretStrings(server, normalizedKey, assignment.value)

  return line
}

function parseAssignment(line: string): { key: string, value: string } | undefined {
  if (line.trim().startsWith('#'))
    return undefined

  const index = line.indexOf('=')
  if (index === -1)
    return undefined

  const key = line.slice(0, index).trim()
  const value = line.slice(index + 1).trimStart()
  if (!isSimpleTomlKey(key) || !value)
    return undefined

  return {
    key,
    value,
  }
}

function isSimpleTomlKey(key: string): boolean {
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith('\'') && key.endsWith('\'')))
    return true

  return /^[\w-]+$/.test(key)
}

function isHeaderKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return normalized === 'header' || normalized === 'headers' || normalized === 'http_headers'
}

function normalizeTomlKey(key: string): string {
  const trimmed = key.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\'')))
    return trimmed.slice(1, -1)

  return trimmed
}

function sanitizeEnvValueAssignment(line: string, server: string, envName: string, value: string): string {
  if (!secretLikeKeyPattern.test(envName))
    return line

  const stringValue = parseBareStringLiteral(value)
  if (!stringValue || isSafeSecretReference(stringValue.value))
    return line

  return replaceAssignmentValue(line, value, `${stringValue.quote}\${${envNameFromServerAndKey(server, envName)}}${stringValue.quote}${stringValue.trailing}`)
}

function parseBareStringLiteral(value: string): { quote: string, trailing: string, value: string } | undefined {
  const match = value.match(/^(['"])(.*?)\1(\s*(?:#.*)?)$/)
  if (!match)
    return undefined

  return {
    quote: match[1],
    trailing: match[3],
    value: match[2],
  }
}

function replaceAssignmentValue(line: string, oldValue: string, newValue: string): string {
  const index = line.indexOf(oldValue)
  if (index === -1)
    return line

  return `${line.slice(0, index)}${newValue}`
}

function sanitizeInlineEnvTable(server: string, value: string): string {
  return value.replace(/("[^"]+"|'[^']+'|[a-z_][\w.-]*)\s*=\s*(['"])(.*?)\2/gi, (full, rawKey: string, quote: string, rawValue: string) => {
    const envName = normalizeTomlKey(rawKey)
    if (!secretLikeKeyPattern.test(envName))
      return full

    if (isSafeSecretReference(rawValue))
      return full

    return `${rawKey} = ${quote}\${${envNameFromServerAndKey(server, envName)}}${quote}`
  })
}

function sanitizeBearerTokenEnvVarAssignment(line: string, server: string, value: string): string {
  const stringValue = parseBareStringLiteral(value)
  if (!stringValue)
    return line

  if (isEnvVarName(stringValue.value))
    return line

  return replaceAssignmentValue(line, value, `${stringValue.quote}${envNameFromKey(`${server}_token`)}${stringValue.quote}${stringValue.trailing}`)
}

function sanitizeSecretValueAssignment(line: string, server: string, key: string, value: string): string {
  if (value.trim().startsWith('{'))
    return replaceAssignmentValue(line, value, sanitizeInlineSecretTable(server, value))

  const stringValue = parseBareStringLiteral(value)
  if (stringValue && !isSafeSecretReference(stringValue.value))
    return replaceAssignmentValue(line, value, `${stringValue.quote}${secretReplacement(server, key, stringValue.value)}${stringValue.quote}${stringValue.trailing}`)

  assertNoLiteralSecretStrings(server, key, value)
  return line
}

function sanitizeInlineSecretTable(server: string, value: string): string {
  return value.replace(/("[^"]+"|'[^']+'|[a-z_][\w.-]*)\s*=\s*(['"])(.*?)\2/gi, (full, rawKey: string, quote: string, rawValue: string) => {
    if (isSafeSecretReference(rawValue))
      return full

    return `${rawKey} = ${quote}${secretReplacement(server, normalizeTomlKey(rawKey), rawValue)}${quote}`
  })
}

function assertNoLiteralSecretStrings(server: string, key: string, value: string): void {
  for (const literal of parseStringLiterals(value)) {
    if (isSafeSecretReference(literal) || isPlainFlag(literal))
      continue

    throw new Error(`Refusing to export literal secret-like value for ${server}.${key}. Replace it with an env reference or an op:// reference.`)
  }
}

function isPlainFlag(value: string): boolean {
  return value.startsWith('-') && !value.includes('=') && !/\s/.test(value)
}

function isSafeSecretReference(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length === 0
    || trimmed.startsWith('op://')
    || /^\$\{[a-z_]\w*\}$/i.test(trimmed)
    || /^bearer\s+\$\{[a-z_]\w*\}$/i.test(trimmed)
}

function isEnvVarName(value: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(value)
}

function parseStringLiterals(value: string): string[] {
  const literals: string[] = []
  let quote: '"' | '\'' | undefined
  let escaped = false
  let current = ''

  for (const char of value) {
    if (!quote) {
      if (char === '"' || char === '\'') {
        quote = char
        current = ''
      }
      continue
    }

    if (escaped) {
      current += char
      escaped = false
    }
    else if (char === '\\' && quote === '"') {
      escaped = true
    }
    else if (char === quote) {
      literals.push(current)
      quote = undefined
      current = ''
    }
    else {
      current += char
    }
  }

  return literals
}

function envNameFromKey(key: string): string {
  return key
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase() || 'MCP_SECRET'
}

function envNameFromServerAndKey(server: string, key: string): string {
  const normalizedServer = envNameFromKey(server)
  const normalizedKey = envNameFromKey(key)
  if (normalizedKey.startsWith(`${normalizedServer}_`))
    return normalizedKey

  return `${normalizedServer}_${normalizedKey}`
}

function secretReplacement(server: string, key: string, value: string): string {
  if (key.toLowerCase() === 'authorization' && value.toLowerCase().startsWith('bearer '))
    return `Bearer \${${envNameFromKey(`${server}_token`)}}`

  return `\${${envNameFromServerAndKey(server, key)}}`
}
