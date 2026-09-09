import type { ConfigurationDecision, ConfigurationItem, ConfigurationPreview } from './model'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { stringify } from 'smol-toml'
import { dotfiles, getHomeDir, getRepoRoot } from '../config'
import { assertAllowedRead, privateMcpFragments, privateSkillInstalls, readPrivateManifest, validatePrivateManifest } from '../private/manifest'
import { composeExportContent, extractMcpServerBlocks, preserveOtherServers } from '../private/mcp-export'
import { defaultManifestPath, repoRootFromManifest, resolveRepoPath } from '../private/paths'
import { atomicWrite, contentHash, withFileLock } from '../private/safe-file'
import { parseTomlDocument } from '../private/toml'
import { isSafeSkillName, readWorkstationSkillLock, workstationSkillLockPath } from '../skill-provenance'
import { commitConfiguration, configurationGitStatus, transportConfiguration } from './git'

type Value = Record<string, unknown>
interface Snapshot { path: string, content: string | null, revision: string, mode?: number, identity?: string }
interface Entry {
  item: ConfigurationItem
  local: Snapshot
  source?: Snapshot
  server?: string
  localValue: unknown
  sourceValue: unknown
}
interface Change { before: Snapshot, after: string | null, appliedRevision?: string, direction: 'to-local' | 'to-source' }
interface Plan { version: 1, id: string, createdAt?: string, reads: Snapshot[], changes: Change[], baselines: Record<string, string>, previousBaselines: Record<string, string>, state: 'preview' | 'applying' | 'applied' | 'failed' | 'restored', error?: string }

function localPath(value: string): string {
  const absolute = path.resolve(value)
  let parent = absolute
  while (!fs.existsSync(parent)) parent = path.dirname(parent)
  return path.join(fs.realpathSync(parent), path.relative(parent, absolute))
}
function record(value: unknown): Value {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Value : {}
}
function equal(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b)
}
function canonical(value: unknown): string {
  if (value === undefined)
    return 'missing'
  if (Array.isArray(value))
    return `[${value.map(canonical).join(',')}]`
  if (value instanceof Date)
    return value.toISOString()
  if (value && typeof value === 'object')
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(record(value)[key])}`).join(',')}}`
  return `${typeof value}:${String(value)}`
}
function digest(value: unknown): string {
  return contentHash(canonical(value))
}

/** Reject links in every path component, including dangling links and special files. */
function assertPath(file: string): void {
  let current = path.resolve(file)
  while (true) {
    try {
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
        throw new Error('Unsupported linked or special configuration path')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }
    const parent = path.dirname(current)
    if (parent === current)
      break
    current = parent
  }
}
function snapshot(file: string): Snapshot {
  assertPath(file)
  let content: string | null = null
  let mode: number | undefined
  let identity: string | undefined
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024)
      throw new Error('Configuration is not a bounded text file')
    mode = stat.mode & 0o777
    identity = `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}`
    content = fs.readFileSync(file, 'utf8')
    if (content.includes('\0'))
      throw new Error('Binary configuration is not supported')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw error
  }
  return { path: file, content, mode, identity, revision: digest([content, mode, identity]) }
}
function writable(file: string): boolean {
  try {
    assertPath(file)
    let parent = file
    while (!fs.existsSync(parent)) parent = path.dirname(parent)
    fs.accessSync(parent, fs.constants.W_OK)
    return Boolean(fs.statSync(parent).mode & 0o222)
  }
  catch {
    return false
  }
}

/** Conservative presentation: omit all literal values, comments and prose, including unknown secret formats. */
function display(value: unknown): string {
  if (value === undefined || value === null)
    return '(absent)'
  if (typeof value === 'string')
    return value.split('\n').map((line, index) => `${index + 1}: ${line.trim() ? '[content withheld]' : ''}`).join('\n')
  return JSON.stringify(mask(value), null, 2)
}
function displayDifference(value: unknown, other: unknown): string {
  if (typeof value !== 'string')
    return display(value)
  const lines = value.split('\n')
  const comparison = typeof other === 'string' ? other.split('\n') : []
  const rendered = lines.slice(0, 200).map((line, index) => `${index + 1}: ${line === comparison[index] ? '=' : '!'} ${line.trim() ? '[content withheld]' : ''}`)
  if (lines.length > 200)
    rendered.push(`[${lines.length - 200} additional lines withheld]`)
  return rendered.join('\n')
}
function mask(value: unknown, field = ''): unknown {
  if (['enabled', 'startup_timeout_sec', 'tool_timeout_sec'].includes(field) && ['number', 'boolean', 'bigint'].includes(typeof value))
    return typeof value === 'bigint' ? String(value) : value
  if (typeof value === 'string') {
    if (/^(?:\$\{[A-Z_][A-Z0-9_]*\}|op:\/\/\S+)$/.test(value))
      return value
    if (field === 'bearer_token_env_var' && /^[A-Z_][A-Z0-9_]*$/.test(value))
      return value
    if (field === 'command' && /^(?:node|npx|npm|pnpm|bun|uv|uvx|python3?|docker)$/.test(value))
      return value
    if (field === 'url') {
      try {
        const url = new URL(value)
        return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}/[path and credentials withheld]`
      }
      catch { return '[value withheld]' }
    }
  }
  if (Array.isArray(value))
    return value.map(item => mask(item))
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).map(key => [key, mask(record(value)[key], key)]))
  return '[value withheld]'
}
const authorizationKeys = new Set(['default_tools_approval_mode', 'approval_policy', 'sandbox_mode', 'tools', 'permissions'])
function managedMcp(value: unknown): unknown {
  if (value === undefined)
    return undefined
  return Object.fromEntries(Object.entries(record(value)).filter(([key]) => !authorizationKeys.has(key)))
}
function portable(value: unknown, repo: string): unknown {
  if (typeof value === 'string')
    return value.replaceAll(repo, '{{WORKSTATION_PRIVATE_REPO_ROOT}}')
  if (Array.isArray(value))
    return value.map(item => portable(item, repo))
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, value]) => [key, portable(value, repo)]))
  return value
}
function textLines(value: unknown): string[] {
  return typeof value === 'string' ? value.split('\n') : []
}
function textFields(a: unknown, b: unknown): string[] {
  const left = textLines(a)
  const right = textLines(b)
  return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => index).filter(index => left[index] !== right[index]).map(index => `line:${index + 1}`)
}
function changedFields(a: unknown, b: unknown): string[] {
  return [...new Set([...Object.keys(record(a)), ...Object.keys(record(b))])].filter(key => !equal(record(a)[key], record(b)[key])).sort()
}

function treeFiles(root: string): string[] {
  assertPath(root)
  if (!fs.existsSync(root))
    return []
  const files: string[] = []
  const walk = (directory: string, depth: number) => {
    if (depth > 24 || files.length > 2000)
      throw new Error('Skill exceeds scan limits')
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new Error('Linked skill content requires its installer')
      if (['.git', 'node_modules', '__pycache__', '.DS_Store', '.cache', 'cache', 'logs', 'auth.json', 'credentials.json', '.env', '.env.local', 'sessions', 'history.jsonl'].includes(entry.name))
        continue
      const file = path.join(directory, entry.name)
      if (entry.isDirectory())
        walk(file, depth + 1)
      else if (entry.isFile())
        files.push(path.relative(root, file))
      else throw new Error('Special skill file')
    }
  }
  walk(root, 0)
  return files
}

/** Workstation owns plans, persistence and filesystem operations. Construct only on a trusted local host. */
export class ConfigurationEngine {
  readonly home: string
  readonly codex: string
  readonly repo: string
  readonly manifest: string
  readonly state: string
  constructor(options: { home?: string, repo?: string, manifest?: string, state?: string } = {}) {
    this.home = localPath(options.home ?? getHomeDir())
    this.codex = options.home ? path.join(this.home, '.codex') : localPath(process.env.CODEX_HOME ?? path.join(this.home, '.codex'))
    this.repo = localPath(options.repo ?? getRepoRoot())
    this.manifest = localPath(options.manifest ?? defaultManifestPath())
    this.state = options.state ?? path.join(this.home, '.local/state/workstation/configuration-v1')
  }

  private baselinePath(): string { return path.join(this.state, 'baselines.json') }
  private baselines(): Record<string, string> {
    const content = snapshot(this.baselinePath()).content
    if (!content)
      return {}
    const value = JSON.parse(content)
    if (!value || typeof value !== 'object' || Object.values(value).some(hash => typeof hash !== 'string'))
      throw new Error('Invalid configuration baseline')
    return value
  }

  private save(file: string, value: unknown): void {
    assertPath(file)
    fs.mkdirSync(this.state, { recursive: true, mode: 0o700 })
    atomicWrite(file, `${JSON.stringify(value)}\n`)
  }

  private planPath(id: string): string {
    if (!/^[\da-f-]{36}$/.test(id))
      throw new Error('Invalid plan identifier')
    return path.join(this.state, `${id}.json`)
  }

  private load(id: string): Plan {
    const value = JSON.parse(snapshot(this.planPath(id)).content ?? 'null') as Plan | null
    if (!value || value.version !== 1 || value.id !== id)
      throw new Error('Plan unavailable')
    return value
  }

  private entries(): Entry[] {
    const entries: Entry[] = []
    const baselines = this.baselines()
    const add = (id: string, title: string, kind: ConfigurationItem['kind'], local: Snapshot, source?: Snapshot, server?: string, owner: ConfigurationItem['owner'] = 'user', origin: ConfigurationItem['origin'] = 'public') => {
      const localValue = server ? portable(managedMcp(record(parseTomlDocument(local.content ?? '').mcp_servers)[server]), repoRootFromManifest(this.manifest)) : local.content
      const sourceValue = server ? portable(managedMcp(record(parseTomlDocument(source?.content ?? '').mcp_servers)[server]), repoRootFromManifest(this.manifest)) : source?.content
      const status = owner !== 'user' || !writable(local.path) || (source && !writable(source.path))
        ? 'read-only'
        : !source || (server && sourceValue === undefined && !baselines[id])
            ? 'unmanaged'
            : equal(localValue, sourceValue)
              ? 'synced'
              : !baselines[id]
                  ? 'first-adoption'
                  : digest(localValue) === baselines[id]
                    ? 'source-modified'
                    : digest(sourceValue) === baselines[id] ? 'local-modified' : 'conflict'
      entries.push({ local, source, server, localValue, sourceValue, item: {
        id,
        title,
        kind,
        owner,
        origin: source ? origin : 'local',
        localPath: local.path,
        sourcePath: source?.path,
        status,
        revision: digest([local.revision, source?.revision, baselines[id]]),
        local: displayDifference(localValue, sourceValue),
        source: displayDifference(sourceValue, localValue),
        fields: server ? changedFields(localValue, sourceValue) : textFields(localValue, sourceValue),
        ...(owner !== 'user' ? { management: owner === 'installer' ? 'Use the original skill/plugin installer' : 'Manage through the project configuration' } : {}),
      } })
    }
    const errorRow = (id: string, title: string, kind: ConfigurationItem['kind'], file: string) => {
      entries.push({ local: { path: file, content: null, revision: '' }, localValue: null, sourceValue: null, item: { id, title, kind, owner: 'user', origin: 'local', localPath: file, status: 'error', revision: '', local: '(unavailable)', source: '(unavailable)', fields: [], management: 'Scan failed. Check permissions, links and syntax; no writes are available.' } })
    }
    const codex = this.codex
    for (const entry of dotfiles.filter(entry => ['.zshrc', '.config/starship.toml', '.config/ghostty/config', '.codex/AGENTS.md'].includes(entry.target))) {
      try {
        add(`file:${entry.target}`, entry.description ?? entry.target, entry.target.endsWith('AGENTS.md') ? 'instructions' : 'terminal', snapshot(path.join(this.home, entry.target)), snapshot(path.join(this.repo, entry.source)))
      }
      catch {
        errorRow(`file:${entry.target}`, entry.description ?? entry.target, 'terminal', path.join(this.home, entry.target))
      }
    }
    let manifest: ReturnType<typeof readPrivateManifest> | undefined
    try {
      if (fs.existsSync(this.manifest)) {
        assertPath(this.manifest)
        manifest = readPrivateManifest(this.manifest)
        if (validatePrivateManifest(manifest).length)
          throw new Error('Invalid private manifest')
      }
    }
    catch {
      manifest = undefined
      errorRow('manifest', 'Private configuration source', 'mcp', this.manifest)
    }
    try {
      const local = snapshot(path.join(codex, 'config.toml'))
      const localDoc = parseTomlDocument(local.content ?? '')
      const sources = new Map<string, Snapshot>()
      const protectedSources = new Set<string>()
      let fallbackSource: Snapshot | undefined
      if (manifest) {
        for (const fragment of privateMcpFragments(manifest).filter(fragment => fragment.format === 'toml-codex')) {
          assertAllowedRead(fragment.path, manifest.workstationOverlay ?? {})
          const source = snapshot(resolveRepoPath(repoRootFromManifest(this.manifest), fragment.path))
          if (source.content === null)
            throw new Error('Missing declared fragment')
          if (fragment.syncMode && fragment.syncMode !== 'install')
            protectedSources.add(source.path)
          else fallbackSource ??= source
          for (const server of Object.keys(record(parseTomlDocument(source.content).mcp_servers))) {
            if (sources.has(server))
              throw new Error('Duplicate source server')
            sources.set(server, source)
          }
        }
      }
      for (const server of new Set([...Object.keys(record(localDoc.mcp_servers)), ...sources.keys(), ...Object.keys(baselines).filter(id => id.startsWith('mcp:')).map(id => id.slice(4))]))
        add(`mcp:${server}`, server, 'mcp', local, sources.get(server) ?? fallbackSource, server, 'user', 'private')
      for (const entry of entries) {
        if (entry.source && protectedSources.has(entry.source.path)) {
          entry.item.status = 'read-only'
          entry.item.management = 'This source is declared inventory-only in the private manifest'
        }
      }
      for (const plugin of Object.keys(record(localDoc.plugins))) {
        if (record(record(localDoc.plugins)[plugin]).mcp_servers)
          add(`plugin:${plugin}`, plugin, 'mcp', local, undefined, undefined, 'installer')
      }
    }
    catch {
      errorRow('mcp-scan', 'Codex MCP scan', 'mcp', path.join(codex, 'config.toml'))
    }
    const externalSkills = new Set<string>()
    let externalLockFailed = false
    try {
      const lock = snapshot(path.join(this.home, '.agents/.skill-lock.json')).content
      if (lock) {
        for (const name of Object.keys(record(JSON.parse(lock).skills))) externalSkills.add(name)
      }
    }
    catch { externalLockFailed = true }
    if (fs.existsSync(path.join(codex, 'plugins/cache'))) {
      add('installer:codex-plugins', 'Codex plugin skills', 'skill', { path: path.join(codex, 'plugins/cache'), content: null, revision: '' }, undefined, undefined, 'installer')
    }
    const managedSkillRoots = new Set<string>()
    if (manifest) {
      for (const skill of privateSkillInstalls(manifest)) {
        const name = skill.targetName ?? skill.id
        const targetRoot = path.join(skill.root === 'shared' ? path.join(this.home, '.agents/skills') : path.join(codex, 'skills'), name)
        try {
          if (!isSafeSkillName(name) || name.startsWith('.'))
            throw new Error('Invalid skill name')
          managedSkillRoots.add(targetRoot)
          if (externalLockFailed || externalSkills.has(name) || skill.source.type !== 'local' || !skill.source.path) {
            add(`installed-skill:${name}`, name, 'skill', { path: targetRoot, content: null, revision: '' }, undefined, undefined, 'installer')
            continue
          }
          assertAllowedRead(skill.source.path, manifest.workstationOverlay ?? {})
          const sourceRoot = resolveRepoPath(repoRootFromManifest(this.manifest), skill.source.path)
          const files = new Set([...treeFiles(sourceRoot), ...treeFiles(targetRoot)])
          for (const file of files) {
            add(`skill:${path.relative(this.home, path.join(targetRoot, file))}`, `${name}/${file}`, 'skill', snapshot(path.join(targetRoot, file)), snapshot(path.join(sourceRoot, file)), undefined, 'user', 'private')
          }
        }
        catch {
          errorRow(`skill-error:${name}`, name, 'skill', targetRoot)
        }
      }
    }
    const skillLock = readWorkstationSkillLock(workstationSkillLockPath(this.home))
    // Inventory unmanaged user skills without following links or inspecting installer payloads.
    for (const root of [path.join(codex, 'skills'), path.join(this.home, '.agents/skills')]) {
      if (!fs.existsSync(root))
        continue
      try {
        assertPath(root)
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
          if (managedSkillRoots.has(path.join(root, entry.name)))
            continue
          const target = path.join(root, entry.name, 'SKILL.md')
          const id = `skill:${path.relative(this.home, target)}`
          if (entry.name.startsWith('.') || entry.isSymbolicLink() || externalLockFailed || externalSkills.has(entry.name) || skillLock.error || skillLock.lock.skills[entry.name]) {
            const blank = { path: target, content: null, revision: '' }
            add(id, entry.name, 'skill', blank, undefined, undefined, 'installer')
            continue
          }
          if (!entry.isDirectory())
            continue
          try {
            add(id, entry.name, 'skill', snapshot(target))
          }
          catch {
            errorRow(id, entry.name, 'skill', target)
          }
        }
      }
      catch {
        errorRow(`root:${root}`, 'Skills scan', 'skill', root)
      }
    }
    return entries
  }

  private repositories(): { id: string, root: string }[] {
    return [{ id: 'public', root: this.repo }, ...(fs.existsSync(this.manifest) ? [{ id: 'private', root: repoRootFromManifest(this.manifest) }] : [])]
  }

  /** Unified display-safe repository states, including errors and unknown upstreams. */
  gitStatus() {
    return { version: 1, repositories: this.repositories().map((repo) => {
      try {
        return configurationGitStatus(repo.root, repo.id)
      }
      catch {
        return { ...repo, error: 'Repository status unavailable. Check branch and permissions.',
        }
      }
    }) }
  }

  /** Explicit commit or transport, separate from saving configuration. */
  gitAction(input: { repository?: string, revision?: string, action?: string, paths?: string[], message?: string }) {
    const repo = this.repositories().find(repo => repo.id === input.repository)
    if (!repo || typeof input.revision !== 'string')
      throw new Error('Unknown repository or missing review revision')
    if (input.action === 'commit') {
      const allowed = this.entries().filter(entry => entry.item.owner === 'user' && entry.item.status !== 'error').flatMap(entry => entry.source ? [entry.source.path] : [])
      return { version: 1, repository: commitConfiguration(repo.root, repo.id, input.revision, input.paths ?? [], allowed, input.message ?? '') }
    }
    if (input.action !== 'fetch' && input.action !== 'publish')
      throw new Error('Invalid Git operation')
    return { version: 1, repository: transportConfiguration(repo.root, repo.id, input.action, input.revision) }
  }

  /** Read-only inventory. A failed scan never becomes an empty synchronized result. */
  inspect(projectPath?: string): { version: 1, items: ConfigurationItem[] } {
    const items = this.entries().map(entry => entry.item)
    if (projectPath) {
      const file = path.join(localPath(projectPath), '.codex/config.toml')
      try {
        const state = snapshot(file)
        const servers = record(parseTomlDocument(state.content ?? '').mcp_servers)
        for (const name of Object.keys(servers)) items.push({ id: `project-mcp:${name}`, title: name, kind: 'mcp', owner: 'project', origin: 'local', localPath: file, status: 'read-only', revision: state.revision, local: display(managedMcp(servers[name])), source: '(project-owned)', fields: [], management: 'Edit this project configuration in its repository; global synchronization does not replace project overrides.' })
      }
      catch { items.push({ id: 'project-scan', title: 'Project configuration scan', kind: 'mcp', owner: 'project', origin: 'local', localPath: file, status: 'error', revision: '', local: '(unavailable)', source: '(unavailable)', fields: [] }) }
    }
    return { version: 1, items }
  }

  /** Freeze source/target revisions and keep raw contents in protected local state. */
  preview(decisions: ConfigurationDecision[]): ConfigurationPreview {
    if (!Array.isArray(decisions) || !decisions.length || decisions.length > 1000)
      throw new Error('Select configuration items')
    const entries = this.entries()
    const plan: Plan = { version: 1, id: randomUUID(), createdAt: new Date().toISOString(), state: 'preview', reads: [snapshot(this.manifest)], changes: [], baselines: {}, previousBaselines: this.baselines() }
    const next = new Map<string, Change>()
    const seen = new Set<string>()
    for (const decision of decisions) {
      if (seen.has(decision.id))
        throw new Error('Duplicate decision')
      seen.add(decision.id)
      if (decision.choice === 'skip')
        continue
      const entry = entries.find(entry => entry.item.id === decision.id)
      if (!entry || entry.item.revision !== decision.revision)
        throw new Error('Configuration changed. Refresh and review again.')
      if (!entry.source || ['error', 'read-only'].includes(entry.item.status))
        throw new Error('Configuration is not writable or managed')
      if (!['local', 'source', 'merge'].includes(decision.choice))
        throw new Error('Invalid decision')
      plan.reads.push(entry.local, entry.source)
      let value = decision.choice === 'local' ? entry.localValue : entry.sourceValue
      if (decision.choice === 'merge') {
        const fields = entry.server ? changedFields(entry.localValue, entry.sourceValue) : textFields(entry.localValue, entry.sourceValue)
        if (fields.some(field => !['local', 'source'].includes(decision.fields?.[field] ?? '')))
          throw new Error('Choose a side for every changed field')
        if (!entry.server) {
          const left = textLines(entry.localValue)
          const right = textLines(entry.sourceValue)
          value = Array.from({ length: Math.max(left.length, right.length) }, (_, index) => {
            const key = `line:${index + 1}`
            return left[index] === right[index] || decision.fields?.[key] === 'local' ? left[index] : right[index]
          }).filter(line => line !== undefined).join('\n')
        }
        else {
          value = { ...record(entry.localValue) }
          for (const field of fields) {
            const selected = record(decision.fields?.[field] === 'local' ? entry.localValue : entry.sourceValue)[field]
            if (selected === undefined)
              delete record(value)[field]
            else Object.defineProperty(record(value), field, { value: selected, enumerable: true, configurable: true, writable: true })
          }
        }
      }
      const targets: [Snapshot, Change['direction']][] = decision.choice === 'merge' ? [[entry.local, 'to-local'], [entry.source, 'to-source']] : decision.choice === 'local' ? [[entry.source, 'to-source']] : [[entry.local, 'to-local']]
      for (const [target, direction] of targets) {
        const current = next.get(target.path)?.after ?? target.content
        let after = value === undefined ? null : value as string | null
        if (entry.server) {
          const base = preserveOtherServers(current ?? '', [entry.server]).split('\n').filter(line => !/^# (?:>>>|<<<) workstation managed private mcp$/.test(line.trim())).join('\n')
          const existingValue = record(record(parseTomlDocument(current ?? '').mcp_servers)[entry.server])
          const protectedFields = Object.fromEntries(Object.entries(existingValue).filter(([key]) => authorizationKeys.has(key)))
          if (value === undefined && Object.keys(protectedFields).length)
            throw new Error('Configuration contains execution authorization; remove it in the agent settings before deleting this server')
          let block = value === undefined ? '' : stringify({ mcp_servers: { [entry.server]: { ...record(value), ...protectedFields } } })
          if (direction === 'to-source' && block) {
            const safe = composeExportContent(extractMcpServerBlocks(block, [entry.server]))
            // A sanitizing export must not silently change the proposed value.
            if (!equal(parseTomlDocument(block), parseTomlDocument(safe)))
              throw new Error('Replace literal credentials with environment or secret-store references before exporting')
            block = safe
          }
          after = `${base.trimEnd()}${base.trim() && block ? '\n\n' : ''}${block}`
          if (direction === 'to-local')
            after = after.replaceAll('{{WORKSTATION_PRIVATE_REPO_ROOT}}', JSON.stringify(repoRootFromManifest(this.manifest)).slice(1, -1))
          parseTomlDocument(after)
        }
        if (after !== null && /starship\.toml$/.test(target.path))
          parseTomlDocument(after)
        if (after !== null && /(?:\.zshrc|dot_zshrc)$/.test(target.path)) {
          const syntax = spawnSync('zsh', ['-n', '-f'], { input: after, encoding: 'utf8', timeout: 10000 })
          if (syntax.status !== 0)
            throw new Error('Invalid Zsh syntax or parser unavailable')
        }
        next.set(target.path, { before: target, after, direction })
      }
      plan.baselines[entry.item.id] = digest(value)
    }
    plan.changes = [...next.values()].filter(change => change.before.content !== change.after)
    // Plan persistence is local-only and never commits or publishes configuration.
    this.save(this.planPath(plan.id), plan)
    return this.present(plan)
  }

  private present(plan: Plan): ConfigurationPreview {
    return { version: 1, planId: plan.id, changes: plan.changes.map(change => ({ path: change.before.path, direction: change.direction, before: displayDifference(change.before.content, change.after), after: displayDifference(change.after, change.before.content), deletion: change.after === null })) }
  }

  private locked<T>(paths: string[], callback: () => T): T {
    const unique = [...new Set(paths)].sort()
    const run = (index: number): T => index === unique.length ? callback() : withFileLock(unique[index], false, () => run(index + 1))
    return run(0)
  }

  private scanExport(change: Change): void {
    if (change.direction !== 'to-source' || change.after === null)
      return
    const directory = fs.mkdtempSync(path.join(this.state, 'scan-'))
    try {
      fs.writeFileSync(path.join(directory, 'configuration'), change.after, { mode: 0o600 })
      const result = spawnSync('gitleaks', ['dir', '--redact', '--no-banner', '--no-color', directory], { encoding: 'utf8', timeout: 30000, stdio: 'pipe' })
      if (result.status !== 0)
        throw new Error('Secret scan failed or unavailable')
    }
    finally { fs.rmSync(directory, { recursive: true, force: true }) }
  }

  private write(change: Change): void {
    const current = snapshot(change.before.path)
    if (current.revision !== change.before.revision)
      throw new Error('File changed during planning; no stale overwrite allowed')
    if (change.after === null) {
      if (current.content !== null)
        fs.unlinkSync(current.path)
    }
    else {
      atomicWrite(current.path, change.after, current.content ?? '', () => {
        if (snapshot(current.path).revision !== current.revision)
          throw new Error('File changed before replacement')
      })
      if (current.mode !== undefined)
        fs.chmodSync(current.path, current.mode)
    }
  }

  /** Apply a reviewed plan with a recovery journal that survives partial failure. */
  apply(id: string): { version: 1, planId: string, state: Plan['state'], error?: string } {
    const initial = this.load(id)
    return this.locked([this.baselinePath(), this.planPath(id), ...initial.reads.map(read => read.path)], () => {
      const plan = this.load(id)
      if (plan.state === 'applied')
        return { version: 1, planId: id, state: plan.state }
      if (plan.state !== 'preview')
        throw new Error('Plan is not applicable; inspect recovery first')
      if (!equal(this.baselines(), plan.previousBaselines))
        throw new Error('Baseline changed. Refresh and preview again.')
      for (const read of plan.reads) {
        if (snapshot(read.path).revision !== read.revision)
          throw new Error('Configuration changed. Refresh and preview again.')
      }
      plan.state = 'applying'
      this.save(this.planPath(id), plan)
      let phase = 'secret scan'
      try {
        for (const change of plan.changes) this.scanExport(change)
        phase = 'safe write'
        for (const change of plan.changes) {
          this.write(change)
          change.appliedRevision = snapshot(change.before.path).revision
        }
        this.save(this.baselinePath(), { ...plan.previousBaselines, ...plan.baselines })
        plan.state = 'applied'
      }
      catch {
        plan.state = 'failed'
        plan.error = `Apply failed during ${phase}. The backup is retained; review recovery before retrying.`
      }
      this.save(this.planPath(id), plan)
      return { version: 1, planId: id, state: plan.state, error: plan.error }
    })
  }

  /** Restore unchanged plan outputs while preserving subsequent independent edits. */
  restore(id: string): { version: 1, planId: string, state: 'restored' } {
    const initial = this.load(id)
    return this.locked([this.baselinePath(), this.planPath(id), ...initial.reads.map(read => read.path)], () => {
      const plan = this.load(id)
      if (plan.state === 'preview')
        throw new Error('Plan has not been applied')
      if (plan.state === 'restored')
        return { version: 1, planId: id, state: 'restored' }
      const currentBaseline = this.baselines()
      const afterBaseline = { ...plan.previousBaselines, ...plan.baselines }
      if (!equal(currentBaseline, plan.previousBaselines) && !equal(currentBaseline, afterBaseline))
        throw new Error('Later configuration activity prevents recovery of this plan')
      const changes = plan.changes.map((change) => {
        const current = snapshot(change.before.path)
        if (change.appliedRevision && current.revision !== change.appliedRevision)
          throw new Error('File changed after application. Preserve the newer edits before recovery.')
        if (current.content !== change.after && current.content !== change.before.content)
          throw new Error('File changed after application. Preserve the newer edits before recovery.')
        return { before: current, after: change.before.content, direction: change.direction, restoreMode: change.before.mode }
      })
      for (const change of changes.reverse()) {
        if (change.before.content !== change.after)
          this.write(change)
        if (change.after !== null && change.restoreMode !== undefined)
          fs.chmodSync(change.before.path, change.restoreMode)
      }
      this.save(this.baselinePath(), plan.previousBaselines)
      plan.state = 'restored'
      this.save(this.planPath(id), plan)
      return { version: 1, planId: id, state: 'restored' }
    })
  }

  /** Return display-safe history without raw backup contents. */
  history(): { version: 1, plans: { planId: string, state: Plan['state'], createdAt?: string, paths: string[], error?: string }[] } {
    if (!fs.existsSync(this.state))
      return { version: 1, plans: [] }
    assertPath(this.state)
    return { version: 1, plans: fs.readdirSync(this.state).filter(name => /^[\da-f-]{36}\.json$/.test(name)).map((name) => {
      const plan = this.load(name.slice(0, -5))
      return { planId: plan.id, state: plan.state, createdAt: plan.createdAt, paths: plan.changes.map(change => change.before.path), error: plan.error }
    }) }
  }
}
