import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { readPrivateManifest, validatePrivateManifest } from '../private/manifest'
import { atomicWrite, contentHash, withFileLock } from '../private/safe-file'

export type ConfigurationAudience = 'public' | 'personal' | 'work' | 'unclassified'
export interface ConfigurationSource {
  id: string
  name: string
  kind: 'dotfiles' | 'overlay'
  audience: ConfigurationAudience
  root: string
  manifest?: string
  enabled: boolean
}
export interface ConfigurationTarget {
  id: string
  name: string
  audience: 'personal' | 'work'
  driver: 'workstation' | 'external'
  root?: string
  directory: string
  sourceIds: string[]
  keyEnvironment?: string
}
export interface ConfigurationRepositories {
  version: 1
  sources: ConfigurationSource[]
  targets: ConfigurationTarget[]
  ownership: Record<string, string>
}

function text(value: unknown, limit = 4096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
}
function id(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value)
}
export function regularPath(file: string): void {
  let current = path.resolve(file)
  while (true) {
    try {
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
        throw new Error('Repository paths must use regular files and directories')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }
    const parent = path.dirname(current)
    if (parent === current)
      return
    current = parent
  }
}
export function repositoryFile(root: string, relative: string): string {
  if (!text(relative) || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(part => !part || ['.', '..', '.git'].includes(part)))
    throw new Error('Repository file must be a bounded relative path')
  const file = path.join(root, relative)
  regularPath(file)
  return file
}
function checkout(root: unknown): string {
  if (!text(root) || !path.isAbsolute(root))
    throw new Error('Repository requires an absolute local checkout path')
  root = fs.realpathSync(root as string)
  regularPath(root as string)
  const result = spawnSync('git', ['-C', root as string, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 10000 })
  if (result.status !== 0 || fs.realpathSync(root as string) !== fs.realpathSync(result.stdout.trim()))
    throw new Error('Repository must be an existing Git checkout root')
  return fs.realpathSync(root as string)
}

/** Device-local registry. It never clones repositories, stores credentials or grants execution trust. */
export class ConfigurationRepositoryRegistry {
  readonly file: string
  constructor(state: string, private readonly defaults: ConfigurationSource[]) {
    this.file = path.join(state, 'repositories.json')
  }

  read(): ConfigurationRepositories & { revision: string } {
    regularPath(this.file)
    let content = ''
    try {
      if (fs.statSync(this.file).size > 256 * 1024)
        throw new Error('Repository registry exceeds its limit')
      content = fs.readFileSync(this.file, 'utf8')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }
    const value: ConfigurationRepositories = content ? JSON.parse(content) : { version: 1, sources: this.defaults, targets: [], ownership: {} }
    if (value.version !== 1 || !Array.isArray(value.sources) || !Array.isArray(value.targets) || !value.ownership || typeof value.ownership !== 'object' || Array.isArray(value.ownership))
      throw new Error('Repository registry is invalid')
    return { ...value, revision: contentHash(content || JSON.stringify(value)) }
  }

  /** Compare-and-swap changes preserve other registrations and reject stale UI requests. */
  update(input: { revision?: string, action?: string, source?: ConfigurationSource, target?: ConfigurationTarget, id?: string, resource?: string, sourceId?: string }): ReturnType<ConfigurationRepositoryRegistry['read']> {
    return withFileLock(this.file, false, () => {
      const current = this.read()
      if (current.revision !== input.revision)
        throw new Error('Repository registry changed. Refresh before editing.')
      const next: ConfigurationRepositories = { version: 1, sources: [...current.sources], targets: [...current.targets], ownership: { ...current.ownership } }
      if (input.action === 'save-source') {
        const source = input.source
        if (!source || !id(source.id) || !text(source.name, 128) || !['dotfiles', 'overlay'].includes(source.kind) || !['public', 'personal', 'work', ...(current.sources.some(item => item.id === source.id && item.audience === 'unclassified') ? ['unclassified'] : [])].includes(source.audience) || typeof source.enabled !== 'boolean')
          throw new Error('Repository source is invalid')
        if ((source.id === 'public' && (source.kind !== 'dotfiles' || source.audience !== 'public')) || (source.id === 'private' && source.kind !== 'overlay'))
          throw new Error('Repository legacy source IDs retain their original format')
        const previous = next.sources.find(item => item.id === source.id)
        const root = previous && !source.enabled && source.root === previous.root ? previous.root : checkout(source.root)
        const manifest = source.kind === 'overlay' ? source.manifest ?? 'config/sync-manifest.json' : undefined
        if (source.enabled && manifest && validatePrivateManifest(readPrivateManifest(repositoryFile(root, manifest))).length)
          throw new Error('Repository source manifest is invalid')
        if (previous && (previous.root !== root || (previous.audience !== 'unclassified' && previous.audience !== source.audience) || previous.kind !== source.kind || previous.manifest !== manifest))
          throw new Error('Repository source identity is immutable. Add a different source instead.')
        if (!previous && next.sources.some(item => item.id !== source.id && (item.root === root || root.startsWith(`${item.root}${path.sep}`) || item.root.startsWith(`${root}${path.sep}`))))
          throw new Error('Repository source overlaps an existing checkout')
        if (next.targets.some(item => item.root && (item.root === root || root.startsWith(`${item.root}${path.sep}`) || item.root.startsWith(`${root}${path.sep}`))))
          throw new Error('Repository source overlaps a backup target')
        next.sources = [...next.sources.filter(item => item.id !== source.id), { id: source.id, name: source.name, kind: source.kind, audience: source.audience, root, manifest, enabled: source.enabled }]
      }
      else if (input.action === 'save-target') {
        const target = input.target
        if (!target || !id(target.id) || !text(target.name, 128) || !['personal', 'work'].includes(target.audience) || !['workstation', 'external'].includes(target.driver) || !Array.isArray(target.sourceIds) || target.sourceIds.length > 32 || new Set(target.sourceIds).size !== target.sourceIds.length)
          throw new Error('Repository backup target is invalid')
        const root = target.root ? checkout(target.root) : undefined
        const previous = next.targets.find(item => item.id === target.id)
        if (previous && ((previous.root && previous.root !== root) || previous.audience !== target.audience || previous.directory !== target.directory || previous.driver !== target.driver))
          throw new Error('Repository backup identity is immutable. Add a different target instead.')
        if (root && next.targets.some(item => item.id !== target.id && item.root === root && item.audience !== target.audience))
          throw new Error('Repository backup cannot mix personal and work configuration')
        repositoryFile(root ?? path.dirname(this.file), target.directory)
        if (target.driver === 'workstation' && (!text(target.keyEnvironment, 128) || !/^[A-Z][A-Z0-9_]*$/.test(target.keyEnvironment)))
          throw new Error('Repository backup requires an environment variable name for its passphrase')
        if (target.driver === 'external' && target.sourceIds.length)
          throw new Error('Repository external backups are managed by their original application')
        for (const sourceId of target.sourceIds) {
          const source = next.sources.find(item => item.id === sourceId)
          if (!source || (source.audience !== 'public' && source.audience !== target.audience))
            throw new Error('Repository backup cannot mix personal and work configuration')
        }
        if (root && next.sources.some(item => item.root === root || root.startsWith(`${item.root}${path.sep}`) || item.root.startsWith(`${root}${path.sep}`)))
          throw new Error('Repository backup target overlaps a configuration source')
        if (root && next.targets.some(item => item.id !== target.id && item.root === root && (item.directory === target.directory || item.directory.startsWith(`${target.directory}/`) || target.directory.startsWith(`${item.directory}/`))))
          throw new Error('Repository backup target overlaps another target directory')
        next.targets = [...next.targets.filter(item => item.id !== target.id), { id: target.id, name: target.name, audience: target.audience, driver: target.driver, root, directory: target.directory, sourceIds: [...target.sourceIds], ...(target.driver === 'workstation' ? { keyEnvironment: target.keyEnvironment } : {}) }]
      }
      else if (input.action === 'remove-source') {
        if (next.targets.some(target => target.sourceIds.includes(input.id ?? '')) || Object.values(next.ownership).includes(input.id ?? ''))
          throw new Error('Repository source is still referenced. Disable it or remove its backup targets first.')
        next.sources = next.sources.filter(source => source.id !== input.id)
      }
      else if (input.action === 'remove-target') {
        next.targets = next.targets.filter(target => target.id !== input.id)
      }
      else if (input.action === 'claim') {
        if (!text(input.resource, 4096) || !next.sources.some(source => source.id === input.sourceId && source.enabled))
          throw new Error('Repository ownership selection is invalid')
        const previous = next.sources.find(source => source.id === next.ownership[input.resource!])
        const selected = next.sources.find(source => source.id === input.sourceId)!
        if (previous && previous.audience !== 'unclassified' && previous.audience !== selected.audience)
          throw new Error('Repository ownership cannot transfer between public, personal and work scopes')
        next.ownership[input.resource] = input.sourceId!
      }
      else {
        throw new Error('Repository registry action is invalid')
      }
      if (next.sources.length > 32 || next.targets.length > 32 || Object.keys(next.ownership).length > 10000)
        throw new Error('Repository registry exceeds its limit')
      regularPath(this.file)
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 })
      atomicWrite(this.file, `${JSON.stringify(next, null, 2)}\n`)
      return this.read()
    })
  }
}
