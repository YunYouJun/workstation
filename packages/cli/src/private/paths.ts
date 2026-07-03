import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { getHomeDir } from '../config'

interface PrivateCliConfig {
  manifestPath?: string
  updatedAt?: string
}

export function defaultManifestPath(): string {
  if (process.env.WORKSTATION_PRIVATE_MANIFEST)
    return path.resolve(expandHome(process.env.WORKSTATION_PRIVATE_MANIFEST))

  const configured = readPrivateConfig().manifestPath
  if (configured) {
    const resolved = path.resolve(expandHome(configured))
    if (fs.existsSync(resolved))
      return resolved
  }

  const discovered = discoverPrivateManifestPath()
  if (discovered)
    return discovered

  return path.resolve(getHomeDir(), 'repos', 'private', 'dotfiles', 'config', 'sync-manifest.json')
}

export function privateConfigPath(): string {
  if (process.env.WORKSTATION_PRIVATE_CONFIG)
    return path.resolve(expandHome(process.env.WORKSTATION_PRIVATE_CONFIG))

  return path.join(getHomeDir(), '.config', 'workstation', 'private.json')
}

export function rememberPrivateManifestPath(manifestPath: string): void {
  const configPath = privateConfigPath()
  const config: PrivateCliConfig = {
    ...readPrivateConfig(),
    manifestPath: path.resolve(manifestPath),
    updatedAt: new Date().toISOString(),
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  fs.chmodSync(configPath, 0o600)
}

function readPrivateConfig(): PrivateCliConfig {
  const configPath = privateConfigPath()
  if (!fs.existsSync(configPath))
    return {}

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8')) as PrivateCliConfig
  }
  catch {
    return {}
  }
}

function discoverPrivateManifestPath(): string | undefined {
  for (const candidate of privateManifestCandidates()) {
    if (fs.existsSync(candidate))
      return candidate
  }

  const reposRoot = path.join(getHomeDir(), 'repos')
  if (!fs.existsSync(reposRoot))
    return undefined

  const found = findDotfilesManifests(reposRoot, 4)
  return found[0]
}

function privateManifestCandidates(): string[] {
  const home = getHomeDir()
  return [
    path.join(home, 'repos', 'private', 'dotfiles', 'config', 'sync-manifest.json'),
    path.join(home, 'repos', 'dotfiles', 'config', 'sync-manifest.json'),
  ]
}

function findDotfilesManifests(root: string, maxDepth: number): string[] {
  const found: string[] = []
  const stack: Array<{ depth: number, directory: string }> = [{ depth: 0, directory: root }]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || current.depth > maxDepth)
      continue

    for (const entry of safeReadDir(current.directory)) {
      if (!entry.isDirectory())
        continue

      if (entry.name === 'node_modules' || entry.name === '.git')
        continue

      const directory = path.join(current.directory, entry.name)
      const manifest = path.join(directory, 'config', 'sync-manifest.json')
      if (entry.name === 'dotfiles' && fs.existsSync(manifest))
        found.push(manifest)

      stack.push({ depth: current.depth + 1, directory })
    }
  }

  return found.sort((a, b) => a.localeCompare(b))
}

function safeReadDir(directory: string): fs.Dirent[] {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
  }
  catch {
    return []
  }
}

export function expandHome(value: string): string {
  if (value === '~')
    return getHomeDir()

  if (value.startsWith('~/'))
    return path.join(getHomeDir(), value.slice(2))

  if (value.startsWith('$HOME/'))
    return path.join(getHomeDir(), value.slice(6))

  return value
}

export function repoRootFromManifest(manifestPath: string): string {
  const parent = path.dirname(manifestPath)
  return parent.endsWith('/config') ? path.dirname(parent) : parent
}

export function resolvePathOption(value: string): string {
  return path.resolve(expandHome(value))
}

export function isSafeRelativePath(value: string): boolean {
  return Boolean(value)
    && !path.isAbsolute(value)
    && !value.split('/').includes('..')
}

export function resolveRepoPath(repoRoot: string, relativePath: string): string {
  if (!isSafeRelativePath(relativePath))
    throw new Error(`Unsafe relative path in private overlay manifest: ${relativePath}`)

  const absolutePath = path.resolve(repoRoot, relativePath)
  const rel = path.relative(repoRoot, absolutePath)
  if (rel.startsWith('..') || path.isAbsolute(rel))
    throw new Error(`Path escapes private overlay repository: ${relativePath}`)

  return absolutePath
}

export function resolveManifestRelativePath(manifestPath: string, value: string): string {
  if (path.isAbsolute(value))
    return value

  return resolveRepoPath(repoRootFromManifest(manifestPath), value)
}

export function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some(pattern => globToRegExp(pattern).test(value))
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')

  return new RegExp(`^${escaped}$`)
}
