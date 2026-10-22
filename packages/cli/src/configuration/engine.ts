import type { SkillsAuditReport } from '../skills'
import type { ConfigurationDecision, ConfigurationItem, ConfigurationPreview, ConfigurationSkillsAudit } from './model'
import type { ConfigurationSource, ConfigurationTarget } from './repositories'
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
import { isSafeSkillName, workstationSkillLockPath } from '../skill-provenance'
import { auditSkills, skillsRegistryLockPath } from '../skills'
import { decryptConfiguration, encryptConfiguration } from './backup'
import { commitConfiguration, configurationGitStatus, transportConfiguration } from './git'
import { previewText } from './preview-text'
import { ConfigurationRepositoryRegistry, repositoryFile } from './repositories'

type Value = Record<string, unknown>
interface Snapshot { path: string, content: string | null, revision: string, mode?: number, identity?: string }
interface Entry {
  item: ConfigurationItem
  sourceRoot?: string
  manifestPath?: string
  local: Snapshot
  source?: Snapshot
  server?: string
  localValue: unknown
  sourceValue: unknown
}
interface Change { before: Snapshot, after: string | null, appliedRevision?: string, restoredRevision?: string, direction: 'to-local' | 'to-source' | 'to-backup' }
interface Plan { sourceBindings?: Record<string, string>, backupBinding?: string, registryRevision?: string, backupTarget?: string, claims?: Record<string, string>, version: 1, id: string, createdAt?: string, reads: Snapshot[], skillOwnershipPaths?: string[], changes: Change[], baselines: Record<string, string>, previousBaselines: Record<string, string>, state: 'preview' | 'applying' | 'applied' | 'failed' | 'restoring' | 'restored', error?: string }

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

/** Readable text previews and conservative masking for structured MCP values. */
function display(value: unknown): string {
  if (value === undefined || value === null)
    return '(absent)'
  if (typeof value === 'string')
    return previewText(value)
  return JSON.stringify(mask(value), null, 2)
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

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function linked(file: string): boolean {
  let current = path.resolve(file)
  while (true) {
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        return true
    }
    catch {}
    const parent = path.dirname(current)
    if (parent === current)
      return false
    current = parent
  }
}

function auditMessage(code: string): string {
  // Names, dependency records and parser errors may contain credential literals.
  // Display only fixed guidance; the terminal audit retains its full diagnostics.
  const messages: Record<string, string> = {
    'invalid-skill-symlink': 'Skill symlink could not be followed safely.',
    'skill-discovery-limit-exceeded': 'Skill discovery stopped at its safety limit.',
    'unreadable-skill-directory': 'Skill directory could not be read.',
    'invalid-skill-frontmatter': 'Invalid SKILL.md frontmatter.',
    'nonstandard-skill-name': 'Skill names should use at most 64 lowercase letters, digits, and single hyphens.',
    'invalid-skill-openai-config': 'Invalid agents/openai.yaml configuration.',
    'verbose-skill-description': 'Skill descriptions exceed the recommended 500 characters and consume extra always-on context.',
    'oversized-skill-body': 'Skill bodies exceed 500 lines; move detailed material to references/.',
    'missing-apm-lock': 'Global APM manifest exists but apm.lock.yaml is missing.',
    'missing-apm-manifest': 'Global APM lock exists but apm.yml is missing.',
    'invalid-apm-manifest': 'Global APM manifest is invalid.',
    'invalid-apm-lock': 'Global APM lock is invalid.',
    'missing-apm-lock-dependency': 'Global APM lock is missing manifest dependencies.',
    'invalid-apm-deployed-path': 'APM-deployed paths escape the shared Skills directory.',
    'missing-apm-deployed-file': 'Files declared by the global APM lock are missing.',
    'modified-apm-deployed-file': 'APM-managed files do not match the global lock.',
    'invalid-skills-registry-lock': 'Global skills.sh lock is invalid.',
    'invalid-workstation-skill-lock': 'Workstation Skill provenance lock is invalid.',
    'missing-workstation-skill': 'Workstation-managed Skill deployment is missing or unreadable.',
    'modified-workstation-skill': 'Workstation-managed Skill does not match its provenance lock.',
    'unmanaged-shared-skill': 'Shared Skills are not declared by the global APM, skills.sh, or Workstation provenance lock.',
    'missing-apm-deployment': 'APM-managed Skill is missing from the shared Skills directory.',
    'skill-directory-name-mismatch': 'Skill directory names do not match their frontmatter names.',
    'duplicate-skill-name': 'Skill name is present in multiple discovery roots.',
    'duplicate-skill-name-in-root': 'Skill name is present multiple times in the same discovery root.',
  }
  return Object.hasOwn(messages, code) ? messages[code] : 'Review the affected Skill files in the original manager.'
}

/** Workstation owns plans, persistence and filesystem operations. Construct only on a trusted local host. */
export class ConfigurationEngine {
  readonly home: string
  readonly codex: string
  readonly repo: string
  readonly manifest: string
  readonly state: string
  readonly registry: ConfigurationRepositoryRegistry
  constructor(options: { home?: string, repo?: string, manifest?: string, state?: string } = {}) {
    this.home = localPath(options.home ?? getHomeDir())
    this.codex = options.home ? path.join(this.home, '.codex') : localPath(process.env.CODEX_HOME ?? path.join(this.home, '.codex'))
    this.repo = localPath(options.repo ?? getRepoRoot())
    this.manifest = localPath(options.manifest ?? defaultManifestPath())
    this.state = options.state ?? path.join(this.home, '.local/state/workstation/configuration-v1')
    this.registry = new ConfigurationRepositoryRegistry(this.state, [
      { id: 'public', name: 'Public configuration', kind: 'dotfiles', audience: 'public', root: this.repo, enabled: true },
      ...(fs.existsSync(this.manifest) ? [{ id: 'private', name: 'Private configuration', kind: 'overlay' as const, audience: 'unclassified' as const, root: repoRootFromManifest(this.manifest), manifest: path.relative(repoRootFromManifest(this.manifest), this.manifest), enabled: true }] : []),
    ])
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

  private skillsAudit(projectPath?: string): { report?: SkillsAuditReport, display: ConfigurationSkillsAudit } {
    const checkedAt = new Date().toISOString()
    try {
      const report = auditSkills({ home: this.home, codexHome: this.codex, includeProject: Boolean(projectPath), projectRoot: projectPath })
      const { skillFileCount, implicitSkillCount, explicitOnlySkillCount, warningCount, errorCount } = report.summary
      return { report, display: {
        state: 'available',
        checkedAt,
        summary: { skillFileCount, implicitSkillCount, explicitOnlySkillCount, warningCount, errorCount },
        findings: report.findings.flatMap((finding) => {
          const chunks = Array.from({ length: Math.max(1, Math.ceil(finding.paths.length / 20)) }, (_, index) => finding.paths.slice(index * 20, index * 20 + 20))
          return chunks.map(paths => ({ ...finding, paths, message: auditMessage(finding.code) }))
        }).slice(0, 1000),
      } }
    }
    catch {
      return { display: { state: 'error', checkedAt, findings: [], message: 'Skills audit unavailable. Check discovery roots, permissions and lock files.' } }
    }
  }

  private sourceEntries(sourceConfig: ConfigurationSource, audit: SkillsAuditReport | null): Entry[] {
    const manifestPath = sourceConfig.kind === 'overlay' ? repositoryFile(sourceConfig.root, sourceConfig.manifest ?? 'config/sync-manifest.json') : this.manifest
    const sourceKey = (id: string) => ['public', 'private'].includes(sourceConfig.id) ? id : `${sourceConfig.id}::${id}`
    const entries: Entry[] = []
    const baselines = this.baselines()
    const add = (id: string, title: string, kind: ConfigurationItem['kind'], local: Snapshot, source?: Snapshot, server?: string, owner: ConfigurationItem['owner'] = 'user', origin: ConfigurationItem['origin'] = 'public') => {
      id = sourceKey(id)
      const localValue = server ? portable(managedMcp(record(parseTomlDocument(local.content ?? '').mcp_servers)[server]), sourceConfig.root) : local.content
      const sourceValue = server ? portable(managedMcp(record(parseTomlDocument(source?.content ?? '').mcp_servers)[server]), sourceConfig.root) : source?.content
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
      entries.push({ local, source, server, localValue, sourceValue, sourceRoot: sourceConfig.root, manifestPath: sourceConfig.kind === 'overlay' ? manifestPath : undefined, item: {
        id,
        sourceId: source ? sourceConfig.id : undefined,
        audience: source ? sourceConfig.audience : undefined,
        resource: `${local.path}${server ? `#mcp:${server}` : ''}`,
        title,
        kind,
        owner,
        origin: source ? origin : 'local',
        localPath: local.path,
        sourcePath: source?.path,
        status,
        revision: digest([sourceConfig, local.revision, source?.revision, baselines[id]]),
        local: display(localValue),
        source: display(sourceValue),
        fields: server ? changedFields(localValue, sourceValue) : textFields(localValue, sourceValue),
        scope: 'global',
        ...(kind !== 'terminal' ? { client: kind === 'skill' && within(path.join(this.home, '.agents/skills'), local.path) ? 'shared' : 'codex' } : {}),
        manager: owner === 'installer' ? 'unknown' : source ? 'workstation' : 'unknown',
        provenance: { label: source ? origin === 'private' ? 'Workstation private manifest' : 'Workstation configuration source' : 'Local configuration; manager unknown', path: source ? origin === 'private' ? manifestPath : source.path : local.path },
        ...(owner !== 'user' ? { management: owner === 'installer' ? 'Use the original skill/plugin installer' : 'Manage through the project configuration' } : {}),
      } })
    }
    const errorRow = (id: string, title: string, kind: ConfigurationItem['kind'], file: string) => {
      entries.push({ local: { path: file, content: null, revision: '' }, localValue: null, sourceValue: null, item: { id: sourceKey(id), sourceId: sourceConfig.id, audience: sourceConfig.audience, title, kind, owner: 'user', origin: 'local', localPath: file, status: 'error', revision: '', local: '(unavailable)', source: '(unavailable)', fields: [], scope: 'global', client: kind === 'terminal' ? undefined : kind === 'skill' && within(path.join(this.home, '.agents/skills'), file) ? 'shared' : 'codex', manager: 'unknown', provenance: { label: 'Configuration scan unavailable', path: file }, management: 'Scan failed. Check permissions, links and syntax; no writes are available.' } })
    }
    const codex = this.codex
    for (const entry of (sourceConfig.kind === 'dotfiles' ? dotfiles : []).filter(entry => ['.zshrc', '.config/starship.toml', '.config/ghostty/config', '.codex/AGENTS.md'].includes(entry.target))) {
      try {
        add(`file:${entry.target}`, entry.description ?? entry.target, entry.target.endsWith('AGENTS.md') ? 'instructions' : 'terminal', snapshot(path.join(this.home, entry.target)), snapshot(path.join(sourceConfig.root, entry.source)))
      }
      catch {
        errorRow(`file:${entry.target}`, entry.description ?? entry.target, 'terminal', path.join(this.home, entry.target))
      }
    }
    let manifest: ReturnType<typeof readPrivateManifest> | undefined
    try {
      if (sourceConfig.kind === 'overlay' && fs.existsSync(this.registry.file) && !fs.existsSync(manifestPath))
        throw new Error('Missing registered manifest')
      if (sourceConfig.kind === 'overlay' && fs.existsSync(manifestPath)) {
        assertPath(manifestPath)
        manifest = readPrivateManifest(manifestPath)
        if (validatePrivateManifest(manifest).length)
          throw new Error('Invalid private manifest')
      }
    }
    catch {
      manifest = undefined
      errorRow('manifest', 'Private configuration source', 'mcp', manifestPath)
    }
    if (sourceConfig.kind === 'overlay') {
      try {
        const local = snapshot(path.join(codex, 'config.toml'))
        const localDoc = parseTomlDocument(local.content ?? '')
        const sources = new Map<string, Snapshot>()
        const protectedSources = new Set<string>()
        let fallbackSource: Snapshot | undefined
        if (manifest) {
          for (const fragment of privateMcpFragments(manifest).filter(fragment => fragment.format === 'toml-codex')) {
            assertAllowedRead(fragment.path, manifest.workstationOverlay ?? {})
            const source = snapshot(resolveRepoPath(sourceConfig.root, fragment.path))
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
        for (const server of new Set([...Object.keys(record(localDoc.mcp_servers)), ...sources.keys(), ...Object.keys(baselines).filter(id => id.startsWith(sourceKey('mcp:'))).map(id => id.slice(sourceKey('mcp:').length))]))
          add(`mcp:${server}`, server, 'mcp', local, sources.get(server) ?? (baselines[sourceKey(`mcp:${server}`)] || !fs.existsSync(this.registry.file) ? fallbackSource : undefined), server, 'user', 'private')
        for (const entry of entries) {
          if (entry.source && protectedSources.has(entry.source.path)) {
            entry.item.status = 'read-only'
            entry.item.management = 'This source is declared inventory-only in the private manifest'
          }
        }
        for (const plugin of Object.keys(record(localDoc.plugins))) {
          if (record(record(localDoc.plugins)[plugin]).mcp_servers) {
            add(`plugin:${plugin}`, plugin, 'mcp', local, undefined, undefined, 'installer')
            Object.assign(entries.at(-1)!.item, { manager: 'native-plugin', provenance: { label: 'Codex native plugin configuration', path: local.path } })
          }
        }
      }
      catch {
        errorRow('mcp-scan', 'Codex MCP scan', 'mcp', path.join(codex, 'config.toml'))
      }
    }
    const protectedSkill = (target: string) => audit?.managedRoots.find(root => within(root.path, target))
      ?? audit?.skills.find(skill => within(path.dirname(skill.path), target) && ['apm', 'skills-cli', 'native-plugin', 'external'].includes(skill.manager))
    const ownershipFailed = !audit || audit.findings.some(finding => ['invalid-apm-lock', 'invalid-skills-registry-lock', 'invalid-workstation-skill-lock'].includes(finding.code))
    if (fs.existsSync(path.join(codex, 'plugins/cache'))) {
      add('installer:codex-plugins', 'Codex plugin skills', 'skill', { path: path.join(codex, 'plugins/cache'), content: null, revision: '' }, undefined, undefined, 'installer')
      Object.assign(entries.at(-1)!.item, { client: 'codex', manager: 'native-plugin', provenance: { label: 'Codex native plugin cache', path: path.join(codex, 'plugins/cache') } })
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
          if (ownershipFailed || linked(targetRoot) || (protectedSkill(targetRoot) && protectedSkill(targetRoot)?.manager !== 'workstation') || skill.source.type !== 'local' || !skill.source.path) {
            add(`installed-skill:${name}`, name, 'skill', { path: targetRoot, content: null, revision: '' }, undefined, undefined, 'installer')
            continue
          }
          assertAllowedRead(skill.source.path, manifest.workstationOverlay ?? {})
          const sourceRoot = resolveRepoPath(sourceConfig.root, skill.source.path)
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
          if (entry.name.startsWith('.') || entry.isSymbolicLink() || ownershipFailed || protectedSkill(target)) {
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
    for (const entry of entries.filter(entry => entry.item.kind === 'skill' && entry.item.manager !== 'native-plugin')) {
      const owner = protectedSkill(entry.item.localPath)
      const instance = audit?.skills.find(skill => skill.path === entry.item.localPath || within(path.dirname(skill.path), entry.item.localPath))
      if (owner || instance) {
        const metadata = owner ?? instance!
        entry.item.manager = metadata.manager
        entry.item.provenance = metadata.provenance
        if (['apm', 'skills-cli', 'native-plugin', 'external'].includes(metadata.manager) || (metadata.manager === 'workstation' && owner && !entry.source)) {
          entry.item.owner = 'installer'
          entry.item.status = 'read-only'
          entry.item.management = 'Use the original Skill installer; global configuration synchronization does not replace this deployment.'
        }
      }
      // Private manifest ownership remains authoritative for reviewed user trees.
      if (entry.source) {
        entry.item.manager = 'workstation'
        entry.item.provenance = { label: 'Workstation private manifest', path: manifestPath }
      }
      else if (entry.item.id.startsWith('installed-skill:') && !owner && (!instance || instance.manager === 'unknown') && !linked(entry.item.localPath)) {
        entry.item.manager = 'workstation'
        entry.item.provenance = { label: 'Workstation private manifest', path: manifestPath }
      }
      else if (entry.item.owner === 'installer' && !owner && !instance) {
        if (within(path.join(codex, 'skills/.system'), entry.item.localPath)) {
          entry.item.manager = 'native-plugin'
          entry.item.provenance = { label: 'Codex bundled Skills', path: path.join(codex, 'skills/.system') }
        }
        else if (linked(entry.item.localPath)) {
          entry.item.manager = 'external'
          entry.item.provenance = { label: 'External symbolic link', path: entry.item.localPath }
        }
      }
    }
    return entries
  }

  private entries(audit: SkillsAuditReport | null = this.skillsAudit().report ?? null): Entry[] {
    const registry = this.registry.read()
    const entries = registry.sources.filter(source => source.enabled).flatMap(source => this.sourceEntries(source, audit))
    const managed = entries.filter(entry => entry.source)
    const resources = new Map<string, Entry[]>()
    for (const entry of managed) {
      const key = entry.item.resource!
      resources.set(key, [...(resources.get(key) ?? []), entry])
    }
    for (const [resource, candidates] of resources) {
      const claimed = registry.ownership[resource]
      if (candidates.length > 1 || (claimed && claimed !== candidates[0].item.sourceId)) {
        for (const entry of candidates) {
          entry.item.competingSources = candidates.map(candidate => candidate.item.sourceId!)
          if (claimed !== entry.item.sourceId) {
            entry.item.status = 'ownership-conflict'
            entry.item.management = 'Select the owning source before writing. Configuration never moves between audiences automatically.'
          }
        }
      }
    }
    // Each local-only observation appears once; managed sources carry their own stable IDs.
    const seen = new Set<string>()
    return entries.filter((entry) => {
      if (entry.source)
        return true
      const key = `${entry.item.localPath}#${entry.server ?? entry.item.id.split('::').at(-1)}`
      if (managed.some(other => other.local.path === entry.local.path && other.server === entry.server) || seen.has(key))
        return false
      seen.add(key)
      return true
    })
  }

  /** Register existing checkouts and reserved backup targets without applying configuration. */
  repositoryRegistry() { return this.registry.read() }

  configureRepositories(input: Parameters<ConfigurationRepositoryRegistry['update']>[0]) {
    if (input.action === 'claim') {
      const entries = this.entries().filter(entry => entry.item.resource === input.resource && entry.source)
      const selected = entries.find(entry => entry.item.sourceId === input.sourceId)
      if (!selected || entries.some(entry => entry.item.audience !== selected.item.audience))
        throw new Error('Repository ownership cannot transfer between public, personal and work scopes')
    }
    return this.registry.update(input)
  }

  private skillOwnershipPaths(): string[] {
    return [path.join(this.home, '.apm/apm.lock.yaml'), skillsRegistryLockPath(this.home), workstationSkillLockPath(this.home)]
  }

  private skillPlanRoots(plan: Plan): string[] {
    const roots = new Set<string>()
    for (const id of Object.keys(plan.baselines).map(id => id.split('::').at(-1)!).filter(id => id.startsWith('skill:'))) {
      const file = path.resolve(this.home, id.slice('skill:'.length))
      for (const root of [path.join(this.home, '.agents/skills'), path.join(this.codex, 'skills')]) {
        if (within(root, file)) {
          const name = path.relative(root, file).split(path.sep)[0]
          if (name)
            roots.add(path.join(root, name))
        }
      }
    }
    return [...roots]
  }

  private assertSkillRecoveryOwnership(plan: Plan, roots: string[]): void {
    if (!roots.length)
      return
    const frozenPaths = plan.skillOwnershipPaths ?? this.skillOwnershipPaths()
    for (const read of plan.reads.filter(read => frozenPaths.includes(read.path))) {
      if (snapshot(read.path).revision !== read.revision)
        throw new Error('Skill ownership changed after application. Review the original installer before recovery.')
    }
    // Older plans have no ownership snapshots. Re-check current ownership without
    // requiring restored/deleted files to still appear in the user tree inventory.
    const audit = this.skillsAudit().report
    if (!audit || audit.findings.some(finding => ['invalid-apm-lock', 'invalid-skills-registry-lock', 'invalid-workstation-skill-lock'].includes(finding.code)))
      throw new Error('Skill ownership is unavailable. Check installer locks before recovery.')
    if (roots.some(root => audit.managedRoots.some(owner => owner.manager !== 'workstation' && within(owner.path, root))
      || audit.skills.some(skill => within(root, skill.path) && ['apm', 'skills-cli', 'native-plugin', 'external'].includes(skill.manager)))) {
      throw new Error('Skill ownership changed after application. Review the original installer before recovery.')
    }
  }

  private backupPath(target: ConfigurationTarget): string {
    if (!target.root)
      throw new Error('Backup target is reserved; connect an existing checkout first')
    return repositoryFile(target.root, `${target.directory}/configuration.backup.json`)
  }

  private backupBaselinesPath(): string { return path.join(this.state, 'backup-baselines.json') }

  private declaredBackupPath(source: ConfigurationSource, file: string): { destination: string, manifest?: string } {
    const destination = repositoryFile(source.root, file)
    if (source.kind === 'dotfiles') {
      if (!dotfiles.some(entry => ['.zshrc', '.config/starship.toml', '.config/ghostty/config', '.codex/AGENTS.md'].includes(entry.target) && entry.source === file))
        throw new Error('Backup file is not declared by its original source')
      return { destination }
    }
    const manifestPath = repositoryFile(source.root, source.manifest ?? 'config/sync-manifest.json')
    const manifest = readPrivateManifest(manifestPath)
    if (validatePrivateManifest(manifest).length)
      throw new Error('Backup source manifest is invalid')
    assertAllowedRead(file, manifest.workstationOverlay ?? {})
    const fragment = privateMcpFragments(manifest).some(fragment => fragment.format === 'toml-codex' && (!fragment.syncMode || fragment.syncMode === 'install') && fragment.path === file)
    const skill = privateSkillInstalls(manifest).some(skill => skill.source.type === 'local' && skill.source.path && file.startsWith(`${skill.source.path}/`)
      && !file.slice(skill.source.path.length + 1).split('/').some(part => part.startsWith('.') || ['node_modules', '__pycache__', 'cache', 'logs', 'auth.json', 'credentials.json', 'sessions', 'history.jsonl'].includes(part)))
    if (!fragment && !skill)
      throw new Error('Backup file is not declared by its original source')
    return { destination, manifest: manifestPath }
  }

  /** Encrypt allowlisted source files, or restore a verified archive back to its original sources. */
  backupPreview(input: { targetId?: string, action?: string, resolution?: string, revision?: string }): ConfigurationPreview {
    const registry = this.registry.read()
    if (registry.revision !== input.revision)
      throw new Error('Repository registry changed. Refresh before backing up.')
    const target = registry.targets.find(target => target.id === input.targetId)
    if (!target || target.driver !== 'workstation' || !['save', 'restore'].includes(input.action ?? ''))
      throw new Error('Backup target or action is unavailable')
    const passphrase = process.env[target.keyEnvironment ?? '']
    if (!passphrase)
      throw new Error('Backup passphrase environment variable is unavailable on this host')
    const backup = snapshot(this.backupPath(target))
    const selectedEntries = this.entries().filter(entry => target.sourceIds.includes(entry.item.sourceId!))
    const entries = selectedEntries.filter(entry => entry.source)
    if (!target.sourceIds.length || target.sourceIds.some(id => !registry.sources.some(source => source.id === id && source.enabled && (source.audience === 'public' || source.audience === target.audience))))
      throw new Error('Backup requires enabled configuration sources')
    if (input.action === 'save' && selectedEntries.some(entry => ['error', 'ownership-conflict', 'read-only'].includes(entry.item.status)))
      throw new Error('Backup source ownership must be resolved before backing up or restoring')
    const files = new Map<string, Entry>()
    for (const entry of entries) files.set(entry.source!.path, entry)
    if (input.action === 'save' && !files.size)
      throw new Error('Backup contains no declared configuration files')
    const baseline = snapshot(this.backupBaselinesPath())
    const remembered = JSON.parse(baseline.content ?? '{}') as Record<string, string>
    const plan: Plan = { version: 1, id: randomUUID(), createdAt: new Date().toISOString(), state: 'preview', registryRevision: registry.revision, backupTarget: target.id, backupBinding: this.targetBinding(target), sourceBindings: Object.fromEntries(registry.sources.filter(source => target.sourceIds.includes(source.id)).map(source => [source.id, this.sourceBinding(source)])), reads: [snapshot(this.registry.file), backup, baseline], changes: [], baselines: {}, previousBaselines: this.baselines() }
    for (const entry of files.values()) {
      plan.reads.push(entry.source!)
      if (entry.manifestPath)
        plan.reads.push(snapshot(entry.manifestPath))
    }
    if (input.action === 'save') {
      if (backup.content !== null && remembered[target.id] !== contentHash(backup.content) && input.resolution !== 'replace')
        throw new Error('Backup changed in the repository. Restore it or explicitly review replacing it; both versions are preserved in recovery history.')
      const archive = { version: 1 as const, audience: target.audience, files: [...files.values()].map(entry => ({ sourceId: entry.item.sourceId!, sourceAudience: entry.item.audience as 'public' | 'personal' | 'work', path: path.relative(entry.sourceRoot!, entry.source!.path), content: entry.source!.content })) }
      plan.changes.push({ before: backup, after: encryptConfiguration(archive, passphrase), direction: 'to-backup' })
    }
    else {
      if (!backup.content)
        throw new Error('Backup archive is missing')
      const archive = decryptConfiguration(backup.content, passphrase)
      if (archive.audience !== target.audience)
        throw new Error('Backup audience does not match this target')
      const seen = new Set<string>()
      for (const file of archive.files) {
        const source = registry.sources.find(source => source.id === file.sourceId && target.sourceIds.includes(source.id))
        if (!source || file.sourceAudience !== source.audience || (source.audience !== 'public' && source.audience !== target.audience))
          throw new Error('Backup source does not belong to this target')
        const { destination, manifest } = this.declaredBackupPath(source, file.path)
        const before = snapshot(destination)
        if (manifest)
          plan.reads.push(snapshot(manifest))
        plan.reads.push(before)
        if (seen.has(destination))
          throw new Error('Backup file is not declared by its original source')
        seen.add(destination)
        if (before.content !== file.content)
          plan.changes.push({ before, after: file.content, direction: 'to-source' })
      }
    }
    this.save(this.planPath(plan.id), plan)
    return this.present(plan)
  }

  private repositories(): { id: string, root: string }[] {
    const registry = this.registry.read()
    return [...registry.sources.map(source => ({ id: source.id, root: source.root })), ...registry.targets.filter(target => target.root && target.driver === 'workstation').map(target => ({ id: `target:${target.id}`, root: target.root! }))]
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
    return withFileLock(this.registry.file, false, () => this.performGitAction(input))
  }

  private performGitAction(input: { repository?: string, revision?: string, action?: string, paths?: string[], message?: string }) {
    const repo = this.repositories().find(repo => repo.id === input.repository)
    if (!repo || typeof input.revision !== 'string')
      throw new Error('Unknown repository or missing review revision')
    if (input.action === 'commit') {
      const target = this.registry.read().targets.find(target => `target:${target.id}` === repo.id)
      if (target?.driver === 'external')
        throw new Error('Repository external backups are managed by their original application')
      const allowed = target ? [this.backupPath(target)] : this.entries().filter(entry => entry.item.owner === 'user' && entry.item.status !== 'error').flatMap(entry => entry.source ? [entry.source.path] : [])
      return { version: 1, repository: commitConfiguration(repo.root, repo.id, input.revision, input.paths ?? [], allowed, input.message ?? '') }
    }
    if (this.registry.read().targets.some(target => `target:${target.id}` === repo.id && target.driver === 'external'))
      throw new Error('Repository external backups are managed by their original application')
    if (input.action !== 'fetch' && input.action !== 'publish')
      throw new Error('Invalid Git operation')
    return { version: 1, repository: transportConfiguration(repo.root, repo.id, input.action, input.revision) }
  }

  /** Read-only inventory. A failed scan never becomes an empty synchronized result. */
  inspect(projectPath?: string): { version: 1, items: ConfigurationItem[], skillsAudit: ConfigurationSkillsAudit, registry: ReturnType<ConfigurationRepositoryRegistry['read']> } {
    const audit = this.skillsAudit(projectPath)
    const items = this.entries(audit.report ?? null).map(entry => entry.item)
    if (projectPath) {
      const file = path.join(localPath(projectPath), '.codex/config.toml')
      try {
        const state = snapshot(file)
        const servers = record(parseTomlDocument(state.content ?? '').mcp_servers)
        for (const name of Object.keys(servers)) items.push({ id: `project-mcp:${name}`, title: name, kind: 'mcp', owner: 'project', origin: 'local', localPath: file, status: 'read-only', revision: state.revision, local: display(managedMcp(servers[name])), source: '(project-owned)', fields: [], client: 'codex', scope: 'project', manager: 'project', provenance: { label: 'Project repository', path: projectPath }, management: 'Edit this project configuration in its repository; global synchronization does not replace project overrides.' })
      }
      catch { items.push({ id: 'project-scan', title: 'Project configuration scan', kind: 'mcp', owner: 'project', origin: 'local', localPath: file, status: 'error', revision: '', local: '(unavailable)', source: '(unavailable)', fields: [], client: 'codex', scope: 'project', manager: 'project', provenance: { label: 'Project repository', path: projectPath } }) }
    }
    for (const skill of audit.report?.skills ?? []) {
      if (items.some(item => item.kind === 'skill' && (item.localPath === skill.path || item.localPath === path.dirname(skill.path))))
        continue
      items.push({ id: `audit-skill:${skill.path}`, title: skill.name, kind: 'skill', owner: skill.scope === 'project' ? 'project' : 'installer', origin: 'local', localPath: skill.path, status: 'read-only', revision: '', local: '(read-only audit inventory)', source: '(managed through the original tool)', fields: [], client: skill.client, scope: skill.scope, manager: skill.manager, provenance: skill.provenance, management: skill.scope === 'project' ? 'Manage this Skill in the project repository.' : 'Use the original Skill manager; audit inventory does not authorize writes.' })
    }
    return { version: 1, items, skillsAudit: audit.display, registry: this.registry.read() }
  }

  private sourceBinding(source: ConfigurationSource): string {
    return digest([source.id, source.root, source.kind, source.manifest, source.audience])
  }

  private targetBinding(target: ConfigurationTarget): string {
    return digest([target.id, target.root, target.directory, target.driver, target.audience])
  }

  private assertRecoveryBindings(plan: Plan): void {
    const registry = this.registry.read()
    for (const [id, expected] of Object.entries(plan.sourceBindings ?? {})) {
      const source = registry.sources.find(source => source.id === id)
      if (!source || this.sourceBinding(source) !== expected)
        throw new Error('Repository ownership changed. Review the recovery destination.')
    }
    if (Object.entries(plan.claims ?? {}).some(([resource, sourceId]) => registry.ownership[resource] && registry.ownership[resource] !== sourceId))
      throw new Error('Repository ownership changed. Review the recovery destination.')
    if (plan.backupBinding && plan.changes.some(change => change.direction === 'to-backup')) {
      const target = registry.targets.find(target => target.id === plan.backupTarget)
      if (!target || this.targetBinding(target) !== plan.backupBinding)
        throw new Error('Repository backup target changed. Review the recovery destination.')
    }
  }

  /** Freeze source/target revisions and keep raw contents in protected local state. */
  preview(decisions: ConfigurationDecision[]): ConfigurationPreview {
    if (!Array.isArray(decisions) || !decisions.length || decisions.length > 1000)
      throw new Error('Select configuration items')
    const registry = this.registry.read()
    const entries = this.entries()
    const plan: Plan = { version: 1, id: randomUUID(), createdAt: new Date().toISOString(), state: 'preview', registryRevision: registry.revision, sourceBindings: {}, claims: {}, reads: [snapshot(this.registry.file)], changes: [], baselines: {}, previousBaselines: this.baselines() }
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
      if (!entry.source || ['error', 'read-only', 'ownership-conflict'].includes(entry.item.status))
        throw new Error('Configuration is not writable or managed')
      if (!['local', 'source', 'merge'].includes(decision.choice))
        throw new Error('Invalid decision')
      if (entry.item.kind === 'skill') {
        plan.skillOwnershipPaths ??= this.skillOwnershipPaths()
        for (const file of plan.skillOwnershipPaths) {
          if (!plan.reads.some(read => read.path === file))
            plan.reads.push(snapshot(file))
        }
      }
      if (entry.manifestPath)
        plan.reads.push(snapshot(entry.manifestPath))
      if (entry.item.resource && entry.item.sourceId) {
        plan.claims![entry.item.resource] = entry.item.sourceId
        plan.sourceBindings![entry.item.sourceId] = this.sourceBinding(registry.sources.find(source => source.id === entry.item.sourceId)!)
      }
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
            after = after.replaceAll('{{WORKSTATION_PRIVATE_REPO_ROOT}}', JSON.stringify(entry.sourceRoot!).slice(1, -1))
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
    return { version: 1, planId: plan.id, changes: plan.changes.map(change => ({ path: change.before.path, direction: change.direction, before: change.direction === 'to-backup' ? '(encrypted backup)' : display(change.before.content), after: change.direction === 'to-backup' ? '(encrypted backup)' : display(change.after), deletion: change.after === null })) }
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
    return this.locked([this.registry.file, this.baselinePath(), this.planPath(id), ...initial.reads.map(read => read.path)], () => {
      const plan = this.load(id)
      if (plan.state === 'applied')
        return { version: 1, planId: id, state: plan.state }
      if (plan.state !== 'preview')
        throw new Error('Plan is not applicable; inspect recovery first')
      if (Object.keys(plan.baselines).some(key => this.baselines()[key] !== plan.previousBaselines[key]))
        throw new Error('Baseline changed. Refresh and preview again.')
      if (plan.registryRevision && this.registry.read().revision !== plan.registryRevision)
        throw new Error('Repository registry changed. Refresh and preview again.')
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
          this.save(this.planPath(id), plan)
        }
        if (plan.claims && Object.keys(plan.claims).length) {
          const registry = this.registry.read()
          this.save(this.registry.file, { version: 1, sources: registry.sources, targets: registry.targets, ownership: { ...registry.ownership, ...plan.claims } })
        }
        this.save(this.baselinePath(), { ...this.baselines(), ...plan.baselines })
        if (plan.backupTarget) {
          const remembered = JSON.parse(snapshot(this.backupBaselinesPath()).content ?? '{}')
          const target = this.registry.read().targets.find(target => target.id === plan.backupTarget)!
          this.save(this.backupBaselinesPath(), { ...remembered, [target.id]: contentHash(snapshot(this.backupPath(target)).content ?? '') })
        }
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
    const skillRoots = this.skillPlanRoots(initial)
    return this.locked([this.registry.file, this.baselinePath(), this.planPath(id), ...initial.reads.map(read => read.path), ...(skillRoots.length ? this.skillOwnershipPaths() : [])], () => {
      const plan = this.load(id)
      if (plan.state === 'preview')
        throw new Error('Plan has not been applied')
      if (plan.state === 'restored')
        return { version: 1, planId: id, state: 'restored' }
      this.assertRecoveryBindings(plan)
      const currentBaseline = this.baselines()
      const afterBaseline = { ...plan.previousBaselines, ...plan.baselines }
      if (Object.keys(plan.baselines).some(key => currentBaseline[key] !== plan.previousBaselines[key] && currentBaseline[key] !== afterBaseline[key]))
        throw new Error('Later configuration activity prevents recovery of this plan')
      this.assertSkillRecoveryOwnership(plan, skillRoots)
      const changes = plan.changes.map((change) => {
        const current = snapshot(change.before.path)
        if (change.restoredRevision && current.revision !== change.restoredRevision)
          throw new Error('File changed after recovery. Preserve the newer edits before retrying.')
        if (!change.restoredRevision && change.appliedRevision && current.revision !== change.appliedRevision && !(plan.state === 'restoring' && current.content === change.before.content))
          throw new Error('File changed after application. Preserve the newer edits before recovery.')
        if (current.content !== change.after && current.content !== change.before.content)
          throw new Error('File changed after application. Preserve the newer edits before recovery.')
        return { before: current, after: change.before.content, direction: change.direction, restoreMode: change.before.mode, original: change }
      })
      plan.state = 'restoring'
      this.save(this.planPath(id), plan)
      for (const change of changes.reverse()) {
        if (change.before.content !== change.after)
          this.write(change)
        if (change.after !== null && change.restoreMode !== undefined)
          fs.chmodSync(change.before.path, change.restoreMode)
        change.original.restoredRevision = snapshot(change.before.path).revision
        this.save(this.planPath(id), plan)
      }
      for (const key of Object.keys(plan.baselines)) {
        if (plan.previousBaselines[key] === undefined)
          delete currentBaseline[key]
        else currentBaseline[key] = plan.previousBaselines[key]
      }
      this.save(this.baselinePath(), currentBaseline)
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
