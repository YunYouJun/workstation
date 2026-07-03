import path from 'node:path'
import process from 'node:process'
import { getHomeDir } from '../config'

export function defaultManifestPath(): string {
  if (process.env.WORKSTATION_PRIVATE_MANIFEST)
    return path.resolve(expandHome(process.env.WORKSTATION_PRIVATE_MANIFEST))

  return path.resolve(getHomeDir(), 'repos', 'dotfiles', 'config', 'sync-manifest.json')
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
