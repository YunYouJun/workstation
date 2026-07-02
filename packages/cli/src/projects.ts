import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import * as p from '@clack/prompts'
import { parse as parseYaml } from 'yaml'
import { getHomeDir, getRepoRoot } from './config'

const DEFAULT_OWNER = 'YunYouJun'
const DEFAULT_LIMIT = 50
const DEFAULT_ROOT = '~/repos'
const DEFAULT_STATUS_MAX_DEPTH = 6
const ACTIVE_PROJECT_LIMIT_ENV = 'WORKSTATION_ACTIVE_PROJECT_LIMIT'
const PROJECT_MANIFEST_CACHE_ENV = 'WORKSTATION_PROJECTS_CACHE'
const GITHUB_HOST = 'github.com'
const DEFAULT_REMOTE_MANIFEST = 'projects.yaml'
const SKIPPED_SCAN_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.nuxt',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
])
const LOCAL_MANIFEST_CANDIDATES = [
  'projects.local.yaml',
  'projects.yaml',
  'projects.yml',
  'projects.example.yaml',
]

export type CloneProtocol = 'ssh' | 'https'

type UnknownRecord = Record<string, unknown>

export interface GitHubRepository {
  nameWithOwner: string
  sshUrl: string
  url: string
  pushedAt: string | null
  isArchived: boolean
  isFork: boolean
}

interface ProjectRepository {
  name: string
  cloneUrl: string
  displayName?: string
  hint?: string
  pushedAt?: string | null
  isArchived?: boolean
  isFork?: boolean
  root?: string
  preferGhq?: boolean
}

interface CloneProjectsOptions {
  root: string
  update: boolean
  dryRun: boolean
  yes: boolean
  interactive: boolean
}

export interface CloneActiveProjectsOptions extends CloneProjectsOptions {
  owner: string
  limit: number
  protocol: CloneProtocol
  includeForks: boolean
  includeArchived: boolean
}

export interface CloneManifestProjectsOptions extends CloneProjectsOptions {
  source?: string
  file?: string
  repo?: string
  manifest?: string
  groups: string[]
  protocol: CloneProtocol
}

export interface ProjectStatusOptions {
  root: string
  all: boolean
  check: boolean
  maxDepth: number
}

interface ResolvedCloneManifestProjectsOptions extends CloneManifestProjectsOptions {
  rootOverride?: string
}

interface CommandResult {
  status: number | null
  stdout: string
  stderr: string
  error?: NodeJS.ErrnoException
}

interface CloneResult {
  repository: ProjectRepository
  status: 'created' | 'updated' | 'skipped' | 'error'
  message: string
}

interface ProjectInspection {
  path: string
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
  stashes: number
  hasHead: boolean
  detached: boolean
  upstreamGone: boolean
  error: string | null
}

interface GhRepositoryResponse {
  data?: {
    repositoryOwner?: {
      repositories?: {
        nodes?: GitHubRepository[]
      }
    } | null
  }
}

interface ResolvedManifestFile {
  filePath: string
  label: string
}

export function resolveProjectRoot(root: string): string {
  if (root === '~')
    return os.homedir()

  if (root.startsWith('~/'))
    return path.resolve(os.homedir(), root.slice(2))

  return path.resolve(root)
}

function trimGitSuffix(value: string): string {
  return value
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
}

function normalizeProjectName(name: string): string {
  return trimGitSuffix(name)
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/')
}

function projectTargetPath(root: string, name: string): string {
  return path.join(resolveProjectRoot(root), ...normalizeProjectName(name).split('/'))
}

export function activeProjectTargetPath(root: string, nameWithOwner: string): string {
  return projectTargetPath(root, `${GITHUB_HOST}/${nameWithOwner}`)
}

function parseLimit(limit: number | string): number {
  const parsedLimit = typeof limit === 'number' ? limit : Number(limit)

  if (!Number.isInteger(parsedLimit) || parsedLimit < 1)
    throw new Error(`Limit must be a positive integer, got: ${limit}`)

  if (parsedLimit > 100)
    throw new Error('Limit must be 100 or less because GitHub GraphQL returns at most 100 repositories per page')

  return parsedLimit
}

function parseMaxDepth(maxDepth: number | string): number {
  const parsedMaxDepth = typeof maxDepth === 'number' ? maxDepth : Number(maxDepth)

  if (!Number.isInteger(parsedMaxDepth) || parsedMaxDepth < 1)
    throw new Error(`Max depth must be a positive integer, got: ${maxDepth}`)

  if (parsedMaxDepth > 20)
    throw new Error('Max depth must be 20 or less')

  return parsedMaxDepth
}

function getDefaultLimit(): number {
  const envLimit = process.env[ACTIVE_PROJECT_LIMIT_ENV]
  return envLimit ? parseLimit(envLimit) : DEFAULT_LIMIT
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv = {}): CommandResult {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    env: {
      ...process.env,
      ...env,
    },
  })

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error as NodeJS.ErrnoException | undefined,
  }
}

function commandExists(command: string): boolean {
  const result = spawnSync(command, ['--help'], {
    stdio: 'ignore',
  })

  return !result.error
}

function ensureCommandSuccess(command: string, args: string[], env?: NodeJS.ProcessEnv): CommandResult {
  const result = runCommand(command, args, env)

  if (result.error) {
    if (result.error.code === 'ENOENT')
      throw new Error(`${command} is not installed or is not available in PATH`)

    throw result.error
  }

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout).trim()
    throw new Error(`${command} ${args.join(' ')} failed${details ? `: ${details}` : ''}`)
  }

  return result
}

function getCloneUrl(repository: GitHubRepository, protocol: CloneProtocol): string {
  return protocol === 'https' ? repository.url : repository.sshUrl
}

function getActiveRepositoriesQuery(options: CloneActiveProjectsOptions): string {
  const repositoryArgs = [
    'first: $limit',
    'orderBy: {field: PUSHED_AT, direction: DESC}',
    'ownerAffiliations: OWNER',
    options.includeForks ? '' : 'isFork: false',
    options.includeArchived ? '' : 'isArchived: false',
  ].filter(Boolean).join(', ')

  return `
query($owner: String!, $limit: Int!) {
  repositoryOwner(login: $owner) {
    repositories(${repositoryArgs}) {
      nodes {
        nameWithOwner
        sshUrl
        url
        pushedAt
        isArchived
        isFork
      }
    }
  }
}
`
}

function listActiveRepositories(options: CloneActiveProjectsOptions): GitHubRepository[] {
  const result = ensureCommandSuccess('gh', [
    'api',
    'graphql',
    '-F',
    `owner=${options.owner}`,
    '-F',
    `limit=${options.limit}`,
    '-f',
    `query=${getActiveRepositoriesQuery(options)}`,
  ])

  let parsed: GhRepositoryResponse
  try {
    parsed = JSON.parse(result.stdout) as GhRepositoryResponse
  }
  catch {
    throw new Error('Could not parse GitHub CLI response as JSON')
  }

  const owner = parsed.data?.repositoryOwner
  if (!owner)
    throw new Error(`GitHub owner not found or not visible to the current gh account: ${options.owner}`)

  return owner.repositories?.nodes || []
}

function toProjectRepository(repository: GitHubRepository, protocol: CloneProtocol): ProjectRepository {
  return {
    name: `${GITHUB_HOST}/${repository.nameWithOwner}`,
    cloneUrl: getCloneUrl(repository, protocol),
    displayName: repository.nameWithOwner,
    pushedAt: repository.pushedAt,
    isArchived: repository.isArchived,
    isFork: repository.isFork,
  }
}

function getRepositoryHint(repository: ProjectRepository): string {
  return repository.hint || [
    repository.pushedAt ? repository.pushedAt.slice(0, 10) : '',
    repository.isFork ? 'fork' : '',
    repository.isArchived ? 'archived' : '',
  ].filter(Boolean).join(', ')
}

async function selectRepositories(repositories: ProjectRepository[], effectiveDryRun: boolean): Promise<ProjectRepository[]> {
  const selected = await p.multiselect({
    message: effectiveDryRun ? 'Select repositories to preview' : 'Select repositories to clone/update',
    options: repositories.map((repository) => {
      const option: { value: ProjectRepository, label: string, hint?: string } = {
        value: repository,
        label: repository.displayName || repository.name,
      }
      const hint = getRepositoryHint(repository)
      if (hint)
        option.hint = hint
      return option
    }),
    initialValues: repositories,
  })

  if (p.isCancel(selected)) {
    p.cancel('Cancelled')
    process.exit(0)
  }

  return selected as ProjectRepository[]
}

function getConfiguredGhqRoots(): string[] {
  if (!commandExists('ghq'))
    return []

  const result = runCommand('git', ['config', '--get-all', 'ghq.root'])
  if (result.error || result.status !== 0)
    return []

  return result.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(resolveProjectRoot)
}

function canUseGhq(root: string): boolean {
  const resolvedRoot = resolveProjectRoot(root)
  const [primaryRoot] = getConfiguredGhqRoots()
  return primaryRoot === resolvedRoot
}

function cloneWithGhq(repository: ProjectRepository, options: CloneProjectsOptions): void {
  const args = ['get']

  if (options.update)
    args.push('--update')

  args.push(repository.cloneUrl)
  ensureCommandSuccess('ghq', args)
}

function cloneWithGit(targetPath: string, repository: ProjectRepository): void {
  if (fs.existsSync(targetPath)) {
    ensureCommandSuccess('git', ['-C', targetPath, 'pull', '--ff-only'])
    return
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  ensureCommandSuccess('git', ['clone', repository.cloneUrl, targetPath])
}

function cloneRepository(repository: ProjectRepository, options: CloneProjectsOptions, useGhq: boolean): CloneResult {
  const root = repository.root || options.root
  const targetPath = projectTargetPath(root, repository.name)
  const action = fs.existsSync(targetPath)
    ? options.update ? 'update' : 'skip'
    : 'clone'
  const effectiveUseGhq = useGhq && repository.preferGhq !== false

  if (options.dryRun || !options.yes) {
    const dryPrefix = '[dry-run]'
    if (action === 'skip') {
      return {
        repository,
        status: 'skipped',
        message: `${dryPrefix} Already exists: ${targetPath}`,
      }
    }

    return {
      repository,
      status: action === 'update' ? 'updated' : 'created',
      message: `${dryPrefix} Would ${action}: ${repository.cloneUrl} -> ${targetPath}`,
    }
  }

  if (action === 'skip') {
    return {
      repository,
      status: 'skipped',
      message: `Already exists: ${targetPath}`,
    }
  }

  try {
    if (effectiveUseGhq)
      cloneWithGhq(repository, options)
    else
      cloneWithGit(targetPath, repository)

    return {
      repository,
      status: action === 'update' ? 'updated' : 'created',
      message: `${action === 'update' ? 'Updated' : 'Cloned'}: ${targetPath}`,
    }
  }
  catch (error) {
    return {
      repository,
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function printCloneResults(results: CloneResult[]) {
  for (const result of results) {
    const icon = result.status === 'created'
      ? '+'
      : result.status === 'updated'
        ? '~'
        : result.status === 'skipped'
          ? '-'
          : 'x'

    const pushedAt = result.repository.pushedAt ? ` (${result.repository.pushedAt.slice(0, 10)})` : ''
    const label = result.repository.displayName || result.repository.name
    console.log(`  ${icon} ${label}${pushedAt}: ${result.message}`)
  }

  return {
    created: results.filter(result => result.status === 'created').length,
    updated: results.filter(result => result.status === 'updated').length,
    skipped: results.filter(result => result.status === 'skipped').length,
    errors: results.filter(result => result.status === 'error').length,
  }
}

function isGitRepository(repositoryPath: string): boolean {
  return fs.existsSync(path.join(repositoryPath, '.git'))
}

function discoverGitRepositories(root: string, maxDepth: number): string[] {
  const repositories: string[] = []
  const seenRealPaths = new Set<string>()

  function walk(directory: string, depth: number): void {
    if (depth > maxDepth)
      return

    let stat: fs.Stats
    try {
      stat = fs.statSync(directory)
    }
    catch {
      return
    }

    if (!stat.isDirectory())
      return

    let realPath: string
    try {
      realPath = fs.realpathSync(directory)
    }
    catch {
      return
    }

    if (seenRealPaths.has(realPath))
      return

    seenRealPaths.add(realPath)

    if (isGitRepository(directory)) {
      repositories.push(directory)
      return
    }

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    }
    catch {
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory())
        continue

      const childPath = path.join(directory, entry.name)
      if (SKIPPED_SCAN_DIRECTORIES.has(entry.name) && !isGitRepository(childPath))
        continue

      walk(childPath, depth + 1)
    }
  }

  walk(root, 0)
  return repositories.sort((a, b) => a.localeCompare(b))
}

function parseBranchStatus(line: string) {
  const branchStatus = line.replace(/^## /, '')
  const [trackingPart, metadataPart = ''] = branchStatus.split(' [')
  const [branchPart, upstreamPart] = trackingPart.split('...')
  const upstream = upstreamPart || null
  const detached = branchPart === 'HEAD' || branchPart.startsWith('HEAD ')
  const branch = branchPart.startsWith('No commits yet on ')
    ? branchPart.replace('No commits yet on ', '')
    : branchPart || null

  return {
    branch,
    upstream,
    detached,
    upstreamGone: /\bgone\b/.test(metadataPart),
    ahead: Number(metadataPart.match(/\bahead (\d+)/)?.[1] || 0),
    behind: Number(metadataPart.match(/\bbehind (\d+)/)?.[1] || 0),
  }
}

function parseGitStatusOutput(stdout: string) {
  const lines = stdout.split('\n').filter(Boolean)
  const branchLine = lines.find(line => line.startsWith('## '))
  const branchStatus = branchLine
    ? parseBranchStatus(branchLine)
    : {
        branch: null,
        upstream: null,
        detached: false,
        upstreamGone: false,
        ahead: 0,
        behind: 0,
      }

  let staged = 0
  let unstaged = 0
  let untracked = 0

  for (const line of lines) {
    if (line.startsWith('## '))
      continue

    const indexStatus = line[0]
    const workTreeStatus = line[1]

    if (indexStatus === '?' && workTreeStatus === '?') {
      untracked += 1
      continue
    }

    if (indexStatus && indexStatus !== ' ')
      staged += 1

    if (workTreeStatus && workTreeStatus !== ' ')
      unstaged += 1
  }

  return {
    ...branchStatus,
    staged,
    unstaged,
    untracked,
  }
}

function getCommandErrorMessage(command: string, args: string[], result: CommandResult): string {
  if (result.error) {
    if (result.error.code === 'ENOENT')
      return `${command} is not installed or is not available in PATH`

    return result.error.message
  }

  const details = (result.stderr || result.stdout).trim()
  return `${command} ${args.join(' ')} failed${details ? `: ${details}` : ''}`
}

function inspectGitRepository(repositoryPath: string): ProjectInspection {
  const statusArgs = ['-C', repositoryPath, 'status', '--porcelain=v1', '--branch', '--untracked-files=all']
  const statusResult = runCommand('git', statusArgs)
  if (statusResult.error || statusResult.status !== 0) {
    return {
      path: repositoryPath,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      stashes: 0,
      hasHead: false,
      detached: false,
      upstreamGone: false,
      error: getCommandErrorMessage('git', statusArgs, statusResult),
    }
  }

  const parsedStatus = parseGitStatusOutput(statusResult.stdout)
  const stashResult = runCommand('git', ['-C', repositoryPath, 'stash', 'list'])
  const headResult = runCommand('git', ['-C', repositoryPath, 'rev-parse', '--verify', 'HEAD'])

  return {
    path: repositoryPath,
    branch: parsedStatus.branch,
    upstream: parsedStatus.upstream,
    ahead: parsedStatus.ahead,
    behind: parsedStatus.behind,
    staged: parsedStatus.staged,
    unstaged: parsedStatus.unstaged,
    untracked: parsedStatus.untracked,
    stashes: stashResult.status === 0
      ? stashResult.stdout.split('\n').filter(Boolean).length
      : 0,
    hasHead: headResult.status === 0,
    detached: parsedStatus.detached,
    upstreamGone: parsedStatus.upstreamGone,
    error: stashResult.error || stashResult.status !== 0
      ? getCommandErrorMessage('git', ['-C', repositoryPath, 'stash', 'list'], stashResult)
      : null,
  }
}

function hasProjectAttention(inspection: ProjectInspection): boolean {
  return Boolean(
    inspection.error
    || inspection.staged > 0
    || inspection.unstaged > 0
    || inspection.untracked > 0
    || inspection.ahead > 0
    || inspection.stashes > 0
    || inspection.upstreamGone
    || (inspection.hasHead && !inspection.detached && !inspection.upstream),
  )
}

function formatInspectionPath(root: string, repositoryPath: string): string {
  const relativePath = path.relative(root, repositoryPath)
  return relativePath || repositoryPath
}

function formatBranchLabel(inspection: ProjectInspection): string {
  if (!inspection.branch)
    return ''

  const upstream = inspection.upstream ? ` -> ${inspection.upstream}` : ''
  return ` [${inspection.branch}${upstream}]`
}

function formatInspectionDetails(inspection: ProjectInspection): string {
  const details: string[] = []

  if (inspection.error)
    details.push(`error: ${inspection.error}`)

  if (inspection.staged > 0)
    details.push(`${inspection.staged} staged`)

  if (inspection.unstaged > 0)
    details.push(`${inspection.unstaged} unstaged`)

  if (inspection.untracked > 0)
    details.push(`${inspection.untracked} untracked`)

  if (inspection.ahead > 0)
    details.push(`${inspection.ahead} unpushed`)

  if (inspection.stashes > 0)
    details.push(`${inspection.stashes} stash`)

  if (inspection.upstreamGone)
    details.push('upstream gone')
  else if (inspection.hasHead && !inspection.detached && !inspection.upstream)
    details.push('no upstream')

  if (details.length === 0)
    details.push('clean')

  if (inspection.behind > 0)
    details.push(`${inspection.behind} behind`)

  return details.join(', ')
}

function printProjectStatusResults(root: string, inspections: ProjectInspection[], showAll: boolean) {
  const visibleInspections = showAll
    ? inspections
    : inspections.filter(hasProjectAttention)

  for (const inspection of visibleInspections) {
    const icon = hasProjectAttention(inspection) ? '!' : '-'
    const label = formatInspectionPath(root, inspection.path)
    console.log(`  ${icon} ${label}${formatBranchLabel(inspection)}: ${formatInspectionDetails(inspection)}`)
  }

  return {
    visible: visibleInspections.length,
    attention: inspections.filter(hasProjectAttention).length,
    errors: inspections.filter(inspection => inspection.error).length,
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: UnknownRecord, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function inferProjectNameFromUrl(value: string): string | undefined {
  const trimmed = value.trim()

  try {
    const parsed = new URL(trimmed)
    if (parsed.hostname && parsed.pathname) {
      const pathname = trimGitSuffix(decodeURIComponent(parsed.pathname))
      if (pathname)
        return normalizeProjectName(`${parsed.hostname}/${pathname}`)
    }
  }
  catch {
    // Fall through to SSH scp-like and host/path forms.
  }

  const scpLike = trimmed.match(/^(?:[^@/\s]+@)?([^:\s/]+):(.+)$/)
  if (scpLike)
    return normalizeProjectName(`${scpLike[1]}/${trimGitSuffix(scpLike[2])}`)

  const slashIndex = trimmed.indexOf('/')
  if (slashIndex > 0) {
    const host = trimmed.slice(0, slashIndex)
    const projectPath = trimmed.slice(slashIndex + 1)
    if (host.includes('.') && projectPath)
      return normalizeProjectName(`${host}/${trimGitSuffix(projectPath)}`)
  }

  return undefined
}

function projectNameToCloneUrl(name: string, protocol: CloneProtocol): string {
  const normalizedName = normalizeProjectName(name)
  const [host, ...parts] = normalizedName.split('/')

  if (!host || parts.length === 0)
    throw new Error(`Repository ${name} needs a url because a clone URL cannot be inferred from the name`)

  const repositoryPath = parts.join('/')
  return protocol === 'https'
    ? `https://${host}/${repositoryPath}.git`
    : `git@${host}:${repositoryPath}.git`
}

function isHostQualifiedProjectName(name: string): boolean {
  const [host, ...parts] = normalizeProjectName(name).split('/')
  return Boolean(host?.includes('.') && parts.length > 0)
}

function resolveHostQualifiedProjectName(name: string, host: string | undefined, context: string): string {
  const normalizedName = normalizeProjectName(name)

  if (isHostQualifiedProjectName(normalizedName))
    return normalizedName

  if (host)
    return normalizeProjectName(`${host}/${normalizedName}`)

  throw new Error(`${context} must use a Git URL, a host-qualified name, or define a manifest/group host`)
}

function shouldUseGhqForTarget(name: string, cloneUrl: string): boolean {
  const inferredName = inferProjectNameFromUrl(cloneUrl)
  return Boolean(inferredName && normalizeProjectName(name) === inferredName)
}

function parseManifestRepository(entry: unknown, groupName: string, index: number, protocol: CloneProtocol, host?: string): ProjectRepository {
  const context = `${groupName}.repositories[${index}]`

  if (typeof entry === 'string') {
    const value = entry.trim()
    if (!value)
      throw new Error(`${context} must be a Git URL, project path, or an object with name/url`)

    const isUrl = isGitRepositorySource(value)
    const name = isUrl
      ? inferProjectNameFromUrl(value)
      : resolveHostQualifiedProjectName(value, host, context)
    if (!name)
      throw new Error(`${context} must be a Git URL, project path, or an object with name/url`)

    const cloneUrl = isUrl ? value : projectNameToCloneUrl(name, protocol)

    return {
      name,
      cloneUrl,
      displayName: name,
      hint: groupName === 'default' ? undefined : groupName,
      preferGhq: shouldUseGhqForTarget(name, cloneUrl),
    }
  }

  if (!isRecord(entry))
    throw new Error(`${context} must be a Git URL or an object with name/url`)

  const rawName = readString(entry, 'name')
  const description = readString(entry, 'description')
  const repositoryPath = readString(entry, 'path')
    || readString(entry, 'remotePath')
    || readString(entry, 'repo')
    || readString(entry, 'repository')
  const sshUrl = readString(entry, 'sshUrl') || readString(entry, 'ssh')
  const httpsUrl = readString(entry, 'httpsUrl') || readString(entry, 'https')
  const url = readString(entry, 'url')
  const inferredUrlName = [sshUrl, httpsUrl, url]
    .map(value => value ? inferProjectNameFromUrl(value) : undefined)
    .find(Boolean)
  const remoteName = repositoryPath
    ? resolveHostQualifiedProjectName(repositoryPath, host, context)
    : rawName
      ? resolveHostQualifiedProjectName(rawName, host, context)
      : inferredUrlName
  const cloneUrl = protocol === 'https'
    ? httpsUrl || url || sshUrl || (remoteName ? projectNameToCloneUrl(remoteName, protocol) : undefined)
    : sshUrl || url || httpsUrl || (remoteName ? projectNameToCloneUrl(remoteName, protocol) : undefined)

  if (!cloneUrl)
    throw new Error(`${context} must define url, sshUrl, httpsUrl, or a host-qualified name`)

  const resolvedName = rawName
    ? repositoryPath ? normalizeProjectName(rawName) : resolveHostQualifiedProjectName(rawName, host, context)
    : inferProjectNameFromUrl(cloneUrl)
  if (!resolvedName)
    throw new Error(`${context} must define name because it cannot be inferred from ${cloneUrl}`)

  return {
    name: resolvedName,
    cloneUrl,
    displayName: resolvedName,
    hint: [groupName === 'default' ? '' : groupName, description || ''].filter(Boolean).join(', ') || undefined,
    preferGhq: shouldUseGhqForTarget(resolvedName, cloneUrl),
  }
}

function getManifestGroups(manifest: unknown): Array<[string, UnknownRecord]> {
  if (!isRecord(manifest))
    throw new Error('Project manifest must be a YAML object')

  const groups: Array<[string, UnknownRecord]> = []
  if (Array.isArray(manifest.repositories))
    groups.push(['default', manifest])

  if (manifest.groups !== undefined) {
    if (!isRecord(manifest.groups))
      throw new Error('Project manifest "groups" must be an object')

    for (const [groupName, group] of Object.entries(manifest.groups)) {
      if (!isRecord(group))
        throw new Error(`Project manifest group "${groupName}" must be an object`)

      groups.push([groupName, group])
    }
  }

  if (groups.length === 0)
    throw new Error('Project manifest must define repositories or groups')

  return groups
}

function collectManifestRepositories(manifest: unknown, options: ResolvedCloneManifestProjectsOptions): ProjectRepository[] {
  const manifestRoot = isRecord(manifest) ? readString(manifest, 'root') : undefined
  const manifestHost = isRecord(manifest) ? readString(manifest, 'host') : undefined
  const groups = getManifestGroups(manifest)
  const requestedGroups = new Set(options.groups)
  const availableGroups = new Set(groups.map(([groupName]) => groupName))

  for (const groupName of requestedGroups) {
    if (!availableGroups.has(groupName))
      throw new Error(`Project manifest group not found: ${groupName}`)
  }

  const selectedGroups = requestedGroups.size
    ? groups.filter(([groupName]) => requestedGroups.has(groupName))
    : groups

  return selectedGroups.flatMap(([groupName, group]) => {
    if (!Array.isArray(group.repositories))
      throw new Error(`Project manifest group "${groupName}" must define repositories`)

    const root = options.rootOverride || readString(group, 'root') || manifestRoot || options.root
    const host = readString(group, 'host') || manifestHost
    return group.repositories.map((entry, index) => ({
      ...parseManifestRepository(entry, groupName, index, options.protocol, host),
      root,
    }))
  })
}

function loadManifest(filePath: string): unknown {
  const content = fs.readFileSync(filePath, 'utf-8')
  return parseYaml(content)
}

function isGitRepositorySource(source: string): boolean {
  const trimmed = source.trim()
  return /^(?:https?|ssh|git):\/\//.test(trimmed) || /^[^@/\s]+@[^:\s/]+:.+/.test(trimmed)
}

function getManifestCacheRoot(): string {
  const cacheRoot = process.env[PROJECT_MANIFEST_CACHE_ENV]
  if (cacheRoot)
    return resolveProjectRoot(cacheRoot)

  return path.join(getHomeDir(), '.cache', 'workstation', 'project-manifests')
}

function safeCacheName(value: string): string {
  let result = ''
  let previousWasDash = false

  for (const char of value) {
    const isAsciiLetter = (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z')
    const isAsciiNumber = char >= '0' && char <= '9'
    const isAllowedSymbol = char === '.' || char === '_' || char === '-'

    if (isAsciiLetter || isAsciiNumber || isAllowedSymbol) {
      result += char
      previousWasDash = false
      continue
    }

    if (!previousWasDash) {
      result += '-'
      previousWasDash = true
    }
  }

  while (result.startsWith('-'))
    result = result.slice(1)

  while (result.endsWith('-'))
    result = result.slice(0, -1)

  return result.slice(0, 80) || 'manifest'
}

function manifestRepoCachePath(repoUrl: string): string {
  const hash = createHash('sha256').update(repoUrl).digest('hex').slice(0, 12)
  const inferredName = inferProjectNameFromUrl(repoUrl)?.split('/').slice(-2).join('-') || 'repo'
  return path.join(getManifestCacheRoot(), `${safeCacheName(inferredName)}-${hash}`)
}

function ensureManifestRepository(repoUrl: string): string {
  const cachePath = manifestRepoCachePath(repoUrl)
  const gitDir = path.join(cachePath, '.git')

  if (fs.existsSync(gitDir)) {
    ensureCommandSuccess('git', ['-C', cachePath, 'pull', '--ff-only'])
    return cachePath
  }

  if (fs.existsSync(cachePath))
    throw new Error(`Manifest cache path exists but is not a Git repository: ${cachePath}`)

  fs.mkdirSync(path.dirname(cachePath), { recursive: true })
  ensureCommandSuccess('git', ['clone', repoUrl, cachePath])
  return cachePath
}

function resolveManifestFileInDirectory(directory: string, manifestPath: string | undefined): string {
  const candidates = manifestPath ? [manifestPath] : [DEFAULT_REMOTE_MANIFEST, 'projects.yml']

  for (const candidate of candidates) {
    const candidatePath = path.resolve(directory, candidate)
    if (fs.existsSync(candidatePath))
      return candidatePath
  }

  throw new Error(`Project manifest not found in ${directory}: ${candidates.join(' or ')}`)
}

function resolveManifestFile(rawOptions: ResolvedCloneManifestProjectsOptions): ResolvedManifestFile {
  let file = rawOptions.file
  let repo = rawOptions.repo

  if (rawOptions.source) {
    if (file || repo)
      throw new Error('Use either a positional manifest source or --file/--repo, not both')

    if (isGitRepositorySource(rawOptions.source))
      repo = rawOptions.source
    else
      file = rawOptions.source
  }

  if (file && repo)
    throw new Error('Use either --file or --repo, not both')

  if (repo) {
    const repoPath = ensureManifestRepository(repo)
    const filePath = resolveManifestFileInDirectory(repoPath, rawOptions.manifest)
    return {
      filePath,
      label: `${repo}:${path.relative(repoPath, filePath)}`,
    }
  }

  if (file) {
    const filePath = resolveProjectRoot(file)
    if (!fs.existsSync(filePath))
      throw new Error(`Project manifest file not found: ${filePath}`)

    return {
      filePath,
      label: filePath,
    }
  }

  for (const candidate of LOCAL_MANIFEST_CANDIDATES) {
    const filePath = path.resolve(getRepoRoot(), candidate)
    if (fs.existsSync(filePath)) {
      return {
        filePath,
        label: filePath,
      }
    }
  }

  throw new Error(`Project manifest not found. Create projects.local.yaml or pass --file/--repo.`)
}

export async function cloneActiveProjects(rawOptions: Partial<CloneActiveProjectsOptions> = {}) {
  let options: CloneActiveProjectsOptions
  try {
    options = {
      owner: rawOptions.owner || DEFAULT_OWNER,
      limit: parseLimit(rawOptions.limit ?? getDefaultLimit()),
      root: rawOptions.root || DEFAULT_ROOT,
      protocol: rawOptions.protocol || 'ssh',
      includeForks: rawOptions.includeForks ?? false,
      includeArchived: rawOptions.includeArchived ?? false,
      update: rawOptions.update ?? false,
      dryRun: rawOptions.dryRun ?? false,
      yes: rawOptions.yes ?? false,
      interactive: rawOptions.interactive ?? false,
    }
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return
  }

  const resolvedRoot = resolveProjectRoot(options.root)
  const effectiveDryRun = options.dryRun || !options.yes

  p.intro(`Clone active projects for ${options.owner}`)
  if (effectiveDryRun)
    console.log('Dry-run mode: pass --yes to clone or update repositories')

  const s = p.spinner()
  s.start('Fetching repositories from GitHub...')
  let repositories: ProjectRepository[]
  try {
    repositories = listActiveRepositories(options).map(repository => toProjectRepository(repository, options.protocol))
    s.stop(`Fetched ${repositories.length} repositories`)
  }
  catch (error) {
    s.stop('Failed to fetch repositories')
    console.error(error instanceof Error ? error.message : String(error))
    p.outro('No repositories cloned')
    process.exitCode = 1
    return
  }

  if (repositories.length === 0) {
    p.outro('No repositories found')
    return
  }

  if (options.interactive) {
    const selectedRepositories = await selectRepositories(repositories, effectiveDryRun)
    if (selectedRepositories.length === 0) {
      p.outro('No repositories selected')
      return
    }

    if (selectedRepositories.length !== repositories.length)
      console.log(`Selected ${selectedRepositories.length}/${repositories.length} repositories`)

    repositories = selectedRepositories
  }

  const useGhq = canUseGhq(options.root)
  if (useGhq)
    console.log(`Using ghq with configured root: ${resolvedRoot}`)
  else
    console.log(`Using git clone fallback with root: ${resolvedRoot}`)

  const results = repositories.map(repository =>
    cloneRepository(repository, { ...options, dryRun: effectiveDryRun }, useGhq),
  )

  const { created, updated, skipped, errors } = printCloneResults(results)
  const createdLabel = effectiveDryRun ? 'would clone' : 'cloned'
  const updatedLabel = effectiveDryRun ? 'would update' : 'updated'
  p.outro(`Done! ${created} ${createdLabel}, ${updated} ${updatedLabel}, ${skipped} skipped, ${errors} errors`)

  if (errors > 0)
    process.exitCode = 1
}

export async function projectStatus(rawOptions: Partial<ProjectStatusOptions> = {}) {
  let options: ProjectStatusOptions
  try {
    options = {
      root: rawOptions.root || DEFAULT_ROOT,
      all: rawOptions.all ?? false,
      check: rawOptions.check ?? false,
      maxDepth: parseMaxDepth(rawOptions.maxDepth ?? DEFAULT_STATUS_MAX_DEPTH),
    }
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return
  }

  const resolvedRoot = resolveProjectRoot(options.root)

  p.intro(`Inspect local projects under ${resolvedRoot}`)

  if (!fs.existsSync(resolvedRoot)) {
    console.error(`Project root does not exist: ${resolvedRoot}`)
    p.outro('No repositories inspected')
    process.exitCode = 1
    return
  }

  if (!commandExists('git')) {
    console.error('git is not installed or is not available in PATH')
    p.outro('No repositories inspected')
    process.exitCode = 1
    return
  }

  const s = p.spinner()
  s.start('Scanning local repositories...')
  const repositories = discoverGitRepositories(resolvedRoot, options.maxDepth)
  s.stop(`Found ${repositories.length} repositories`)

  if (repositories.length === 0) {
    p.outro('No git repositories found')
    return
  }

  const inspections = repositories.map(inspectGitRepository)
  const { visible, attention, errors } = printProjectStatusResults(resolvedRoot, inspections, options.all)

  if (!options.all && visible === 0)
    console.log('  - No repositories need attention')

  p.outro(`Done! ${repositories.length} repositories, ${attention} need attention, ${errors} errors`)

  if (errors > 0 || (options.check && attention > 0))
    process.exitCode = 1
}

export async function cloneManifestProjects(rawOptions: Partial<CloneManifestProjectsOptions> = {}) {
  const options: ResolvedCloneManifestProjectsOptions = {
    source: rawOptions.source,
    file: rawOptions.file,
    repo: rawOptions.repo,
    manifest: rawOptions.manifest,
    groups: rawOptions.groups || [],
    root: rawOptions.root || DEFAULT_ROOT,
    rootOverride: rawOptions.root,
    protocol: rawOptions.protocol || 'ssh',
    update: rawOptions.update ?? false,
    dryRun: rawOptions.dryRun ?? false,
    yes: rawOptions.yes ?? false,
    interactive: rawOptions.interactive ?? false,
  }

  const effectiveDryRun = options.dryRun || !options.yes

  p.intro('Clone projects from manifest')
  if (effectiveDryRun)
    console.log('Dry-run mode: pass --yes to clone or update repositories')

  const s = p.spinner()
  s.start('Loading project manifest...')
  let repositories: ProjectRepository[]
  let manifestFile: ResolvedManifestFile
  try {
    manifestFile = resolveManifestFile(options)
    repositories = collectManifestRepositories(loadManifest(manifestFile.filePath), options)
    s.stop(`Loaded ${repositories.length} repositories from ${manifestFile.label}`)
  }
  catch (error) {
    s.stop('Failed to load project manifest')
    console.error(error instanceof Error ? error.message : String(error))
    p.outro('No repositories cloned')
    process.exitCode = 1
    return
  }

  if (repositories.length === 0) {
    p.outro('No repositories found')
    return
  }

  if (options.interactive) {
    const selectedRepositories = await selectRepositories(repositories, effectiveDryRun)
    if (selectedRepositories.length === 0) {
      p.outro('No repositories selected')
      return
    }

    if (selectedRepositories.length !== repositories.length)
      console.log(`Selected ${selectedRepositories.length}/${repositories.length} repositories`)

    repositories = selectedRepositories
  }

  console.log('Using ghq when a repository root matches the configured ghq.root; otherwise using git clone fallback')

  const results = repositories.map((repository) => {
    const root = repository.root || options.root
    return cloneRepository(repository, { ...options, dryRun: effectiveDryRun, root }, canUseGhq(root))
  })

  const { created, updated, skipped, errors } = printCloneResults(results)
  const createdLabel = effectiveDryRun ? 'would clone' : 'cloned'
  const updatedLabel = effectiveDryRun ? 'would update' : 'updated'
  p.outro(`Done! ${created} ${createdLabel}, ${updated} ${updatedLabel}, ${skipped} skipped, ${errors} errors`)

  if (errors > 0)
    process.exitCode = 1
}
