import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import * as p from '@clack/prompts'
import { getHomeDir } from './config'

type UnknownRecord = Record<string, unknown>

type InitChangeAction = 'create' | 'update' | 'unchanged'
type InitPlanStatus = 'ready' | 'blocked'

interface InitTaskDefinition {
  id: string
  title: string
  description: string
  recommended: boolean
  createPlan: (options: ResolvedInitOptions) => Promise<InitTaskPlan> | InitTaskPlan
  apply: (plan: InitTaskPlan) => Promise<void> | void
  verify: (plan: InitTaskPlan) => Promise<InitTaskVerification> | InitTaskVerification
}

interface InitTaskPlan {
  taskId: string
  title: string
  status: InitPlanStatus
  messages: string[]
  changes: InitFileChange[]
}

interface InitFileChange {
  filePath: string
  displayPath: string
  action: InitChangeAction
  summary: string
  nextContent: string
}

interface InitTaskVerification {
  ok: boolean
  messages: string[]
}

export interface RunInitOptions {
  task?: unknown
  taskArg?: string
  all?: boolean
  list?: boolean
  yes?: boolean
  dryRun?: boolean
  interactive?: boolean
  gitProfile?: unknown
}

interface ResolvedInitOptions {
  taskIds: string[]
  all: boolean
  yes: boolean
  dryRun: boolean
  interactive: boolean
  gitProfiles: GitIdentityProfile[]
}

interface GitIdentityProfile {
  id: string
  gitdir: string
  configPath: string
  name: string
  email: string
}

const GIT_INCLUDE_IF_TASK_ID = 'git.include-if'
const DEFAULT_GIT_HOST = 'github.com'

const tasks: InitTaskDefinition[] = [
  {
    id: GIT_INCLUDE_IF_TASK_ID,
    title: 'Git includeIf identity routing',
    description: 'Configure user.useConfigOnly and per-source Git identity files.',
    recommended: true,
    createPlan: createGitIncludeIfPlan,
    apply: applyFileChangePlan,
    verify: verifyFileChangePlan,
  },
]

const taskById = new Map(tasks.map(task => [task.id, task]))

export async function runInit(rawOptions: RunInitOptions = {}) {
  if (rawOptions.list) {
    printTaskList()
    return
  }

  let options: ResolvedInitOptions
  try {
    options = await resolveInitOptions(rawOptions)
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return
  }

  let selectedTasks = selectTasks(options)

  if (options.interactive && selectedTasks.length === 0) {
    const answer = await p.multiselect({
      message: 'Select init tasks',
      options: tasks.map(task => ({
        value: task.id,
        label: task.title,
        hint: task.description,
      })),
      initialValues: tasks.filter(task => task.recommended).map(task => task.id),
      required: true,
    })

    if (p.isCancel(answer)) {
      p.cancel('Init cancelled')
      return
    }

    selectedTasks = answer.map(id => taskById.get(id)).filter((task): task is InitTaskDefinition => Boolean(task))
  }

  if (selectedTasks.length === 0) {
    console.error('No init tasks selected. Use --list to see available tasks.')
    process.exitCode = 1
    return
  }

  if (options.interactive && selectedTasks.some(task => task.id === GIT_INCLUDE_IF_TASK_ID))
    options.gitProfiles.push(...await promptForGitProfiles(options.gitProfiles))

  const effectiveDryRun = options.dryRun || !options.yes

  p.intro('Initialize workstation tasks')
  if (effectiveDryRun)
    console.log('Dry-run mode: pass --yes to apply planned changes')

  let blocked = 0
  let errors = 0
  let changed = 0

  for (const task of selectedTasks) {
    const plan = await task.createPlan(options)
    printPlan(plan)

    if (plan.status === 'blocked') {
      blocked += 1
      continue
    }

    changed += plan.changes.filter(change => change.action !== 'unchanged').length

    if (effectiveDryRun)
      continue

    try {
      await task.apply(plan)
      const verification = await task.verify(plan)
      for (const message of verification.messages)
        console.log(`  - ${message}`)

      if (!verification.ok)
        errors += 1
    }
    catch (error) {
      errors += 1
      console.error(error instanceof Error ? error.message : String(error))
    }
  }

  const actionLabel = effectiveDryRun ? 'planned' : 'applied'
  p.outro(`Done! ${changed} file changes ${actionLabel}, ${blocked} blocked, ${errors} errors`)

  if (blocked > 0 || errors > 0)
    process.exitCode = 1
}

function printTaskList() {
  p.intro('Available init tasks')
  for (const task of tasks) {
    const marker = task.recommended ? 'recommended' : 'optional'
    console.log(`- ${task.id} (${marker})`)
    console.log(`  ${task.description}`)
  }
  p.outro(`Use: workstation init --task ${GIT_INCLUDE_IF_TASK_ID}`)
}

async function resolveInitOptions(rawOptions: RunInitOptions): Promise<ResolvedInitOptions> {
  const interactive = Boolean(rawOptions.interactive) || shouldPrompt()
  const taskIds = [
    ...parseCommaList(rawOptions.task),
    ...parseCommaList(rawOptions.taskArg),
  ]

  return {
    taskIds,
    all: rawOptions.all ?? false,
    yes: rawOptions.yes ?? false,
    dryRun: rawOptions.dryRun ?? false,
    interactive,
    gitProfiles: parseGitProfileOptions(rawOptions.gitProfile),
  }
}

function shouldPrompt() {
  return !process.env.CI && process.stdin.isTTY && process.stdout.isTTY
}

function selectTasks(options: ResolvedInitOptions) {
  if (options.taskIds.length > 0) {
    const selectedTasks: InitTaskDefinition[] = []

    for (const taskId of options.taskIds) {
      const task = taskById.get(taskId)
      if (!task)
        throw new Error(`Unknown init task: ${taskId}`)
      selectedTasks.push(task)
    }

    return selectedTasks
  }

  if (options.all)
    return tasks

  return options.interactive ? [] : tasks.filter(task => task.recommended)
}

function printPlan(plan: InitTaskPlan) {
  console.log(`\n${plan.title} (${plan.taskId})`)
  for (const message of plan.messages)
    console.log(`  - ${message}`)

  for (const change of plan.changes)
    console.log(`  - [${change.action}] ${change.displayPath}: ${change.summary}`)
}

function createGitIncludeIfPlan(options: ResolvedInitOptions): InitTaskPlan {
  const profiles = resolveGitProfiles(options.gitProfiles)

  if (profiles.length === 0) {
    return {
      taskId: GIT_INCLUDE_IF_TASK_ID,
      title: 'Git includeIf identity routing',
      status: 'blocked',
      messages: [
        'No Git identity profile is available.',
        'Pass --git-profile "host=github.com;name=Your Name;email=you@example.com" or run interactively.',
      ],
      changes: [],
    }
  }

  const globalGitConfigPath = path.join(getHomeDir(), '.gitconfig')
  const globalOriginal = readTextFile(globalGitConfigPath)
  let globalNext = setGitConfigValue(globalOriginal, '[user]', 'useConfigOnly', 'true')
  globalNext = removeGitConfigValue(globalNext, '[user]', 'name')
  globalNext = removeGitConfigValue(globalNext, '[user]', 'email')

  for (const profile of profiles) {
    globalNext = setGitConfigValue(
      globalNext,
      `[includeIf "gitdir:${profile.gitdir}"]`,
      'path',
      profile.configPath,
    )
  }

  const changes: InitFileChange[] = [
    makeFileChange(
      globalGitConfigPath,
      globalOriginal,
      globalNext,
      `enable user.useConfigOnly, remove default identity, and route ${profiles.length} Git source${profiles.length === 1 ? '' : 's'}`,
    ),
  ]

  const identityFiles = new Map<string, GitIdentityProfile[]>()
  for (const profile of profiles)
    identityFiles.set(profile.configPath, [...(identityFiles.get(profile.configPath) || []), profile])

  for (const [configPath, configProfiles] of identityFiles) {
    const [profile] = configProfiles
    const conflictingProfile = configProfiles.find(candidate =>
      candidate.name !== profile.name || candidate.email !== profile.email,
    )
    if (conflictingProfile) {
      throw new Error(
        `Git profiles "${profile.id}" and "${conflictingProfile.id}" use the same config path with different identities: ${displayPath(configPath)}`,
      )
    }

    const profileOriginal = readTextFile(configPath)
    let profileNext = setGitConfigValue(profileOriginal, '[user]', 'name', profile.name)
    profileNext = setGitConfigValue(profileNext, '[user]', 'email', profile.email)
    const profileIds = configProfiles.map(candidate => candidate.id).join(', ')
    changes.push(makeFileChange(
      configPath,
      profileOriginal,
      profileNext,
      `${profileIds} identity ${profile.name} <${profile.email}>`,
    ))
  }

  return {
    taskId: GIT_INCLUDE_IF_TASK_ID,
    title: 'Git includeIf identity routing',
    status: 'ready',
    messages: [
      'Commit identity is selected by checkout path; remote authentication stays in SSH or credential helpers.',
      'Global Git config remains a router instead of carrying a default user.name/user.email.',
    ],
    changes,
  }
}

function applyFileChangePlan(plan: InitTaskPlan) {
  for (const change of plan.changes) {
    if (change.action === 'unchanged')
      continue

    fs.mkdirSync(path.dirname(change.filePath), { recursive: true })
    fs.writeFileSync(change.filePath, change.nextContent, 'utf-8')
  }
}

function verifyFileChangePlan(plan: InitTaskPlan): InitTaskVerification {
  const messages: string[] = []
  let ok = true

  for (const change of plan.changes) {
    const actual = readTextFile(change.filePath)
    if (actual !== change.nextContent) {
      ok = false
      messages.push(`verification failed for ${change.displayPath}`)
    }
  }

  if (ok)
    messages.push('verified planned file contents')

  return { ok, messages }
}

function resolveGitProfiles(profiles: GitIdentityProfile[]): GitIdentityProfile[] {
  if (profiles.length > 0)
    return profiles

  const inferred = inferDefaultGitHubProfile()
  return inferred ? [inferred] : []
}

function inferDefaultGitHubProfile(): GitIdentityProfile | undefined {
  const home = getHomeDir()
  const configPath = path.join(home, '.gitconfig-github')
  const identity = readGitIdentity(configPath) || readGitIdentity(path.join(home, '.gitconfig'))

  if (!identity)
    return undefined

  return normalizeGitProfile({
    host: DEFAULT_GIT_HOST,
    name: identity.name,
    email: identity.email,
  })
}

async function promptForGitProfiles(existingProfiles: GitIdentityProfile[]) {
  const profiles = [...existingProfiles]

  if (profiles.length > 0) {
    const addMore = await p.confirm({
      message: 'Add another Git identity source?',
      initialValue: false,
    })

    if (p.isCancel(addMore) || !addMore)
      return []
  }

  const collected: GitIdentityProfile[] = []
  let shouldContinue = true

  while (shouldContinue) {
    const existing = collected[0] || inferDefaultGitHubProfile()
    const host = await p.text({
      message: 'Git host',
      placeholder: DEFAULT_GIT_HOST,
      defaultValue: existing ? hostFromGitdir(existing.gitdir) : DEFAULT_GIT_HOST,
      validate: requiredText,
    })

    if (p.isCancel(host)) {
      p.cancel('Init cancelled')
      return []
    }

    const name = await p.text({
      message: 'Git user.name for this source',
      defaultValue: existing?.name,
      validate: requiredText,
    })

    if (p.isCancel(name)) {
      p.cancel('Init cancelled')
      return []
    }

    const email = await p.text({
      message: 'Git user.email for this source',
      defaultValue: existing?.email,
      validate: requiredText,
    })

    if (p.isCancel(email)) {
      p.cancel('Init cancelled')
      return []
    }

    collected.push(normalizeGitProfile({
      host: String(host),
      name: String(name),
      email: String(email),
    }))

    const addAnother = await p.confirm({
      message: 'Add another Git identity source?',
      initialValue: false,
    })

    if (p.isCancel(addAnother)) {
      p.cancel('Init cancelled')
      return collected
    }

    shouldContinue = Boolean(addAnother)
  }

  return collected
}

function parseGitProfileOptions(value: unknown): GitIdentityProfile[] {
  return parseRepeatedOption(value).map((spec) => {
    const rawProfile = parseProfileSpec(spec)
    return normalizeGitProfile(rawProfile)
  })
}

function parseProfileSpec(spec: string): UnknownRecord {
  const values: UnknownRecord = {}

  for (const part of spec.split(';')) {
    const trimmed = part.trim()
    if (!trimmed)
      continue

    const index = trimmed.indexOf('=')
    if (index === -1)
      throw new Error(`Invalid --git-profile entry "${trimmed}". Use key=value pairs separated by semicolons.`)

    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim()
    values[key] = value
  }

  return values
}

function normalizeGitProfile(rawProfile: UnknownRecord): GitIdentityProfile {
  const host = readString(rawProfile, 'host')
  const id = sanitizeProfileId(readString(rawProfile, 'id') || defaultProfileId(host || DEFAULT_GIT_HOST))
  const gitdir = normalizeGitdir(
    readString(rawProfile, 'gitdir')
    || readString(rawProfile, 'dir')
    || readString(rawProfile, 'root')
    || path.join(getHomeDir(), 'repos', host || id),
  )
  const configPath = normalizePath(
    readString(rawProfile, 'config')
    || readString(rawProfile, 'configPath')
    || readString(rawProfile, 'path')
    || path.join(getHomeDir(), `.gitconfig-${id}`),
  )
  const name = readString(rawProfile, 'name')
  const email = readString(rawProfile, 'email')

  if (!name || !email)
    throw new Error(`Git profile "${id}" must define name and email.`)

  return {
    id,
    gitdir,
    configPath,
    name,
    email,
  }
}

function readGitIdentity(configPath: string) {
  const content = readTextFile(configPath)
  const name = getGitConfigValue(content, '[user]', 'name')
  const email = getGitConfigValue(content, '[user]', 'email')

  return name && email ? { name, email } : undefined
}

function readTextFile(filePath: string) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : ''
}

function makeFileChange(filePath: string, original: string, nextContent: string, summary: string): InitFileChange {
  return {
    filePath,
    displayPath: displayPath(filePath),
    action: !original ? 'create' : original === nextContent ? 'unchanged' : 'update',
    summary,
    nextContent,
  }
}

function setGitConfigValue(content: string, section: string, key: string, value: string) {
  const normalizedContent = content ? ensureTrailingNewline(content) : ''
  const lines = normalizedContent ? normalizedContent.split('\n') : []
  if (lines.at(-1) === '')
    lines.pop()

  const sectionIndex = lines.findIndex(line => line.trim() === section)

  if (sectionIndex === -1) {
    if (lines.length > 0)
      lines.push('')
    lines.push(section)
    lines.push(`\t${key} = ${value}`)
    return `${lines.join('\n')}\n`
  }

  const nextSectionIndex = findNextSectionIndex(lines, sectionIndex + 1)
  const valueLineIndex = findKeyIndex(lines, sectionIndex + 1, nextSectionIndex, key)
  if (valueLineIndex === -1) {
    lines.splice(nextSectionIndex, 0, `\t${key} = ${value}`)
  }
  else {
    lines[valueLineIndex] = `${getIndent(lines[valueLineIndex])}${key} = ${value}`
  }

  return `${lines.join('\n')}\n`
}

function removeGitConfigValue(content: string, section: string, key: string) {
  const normalizedContent = content ? ensureTrailingNewline(content) : ''
  if (!normalizedContent)
    return ''

  const lines = normalizedContent.split('\n')
  if (lines.at(-1) === '')
    lines.pop()

  const sectionIndex = lines.findIndex(line => line.trim() === section)
  if (sectionIndex === -1)
    return normalizedContent

  const nextSectionIndex = findNextSectionIndex(lines, sectionIndex + 1)
  const valueLineIndex = findKeyIndex(lines, sectionIndex + 1, nextSectionIndex, key)
  if (valueLineIndex === -1)
    return normalizedContent

  lines.splice(valueLineIndex, 1)
  return `${lines.join('\n')}\n`
}

function getGitConfigValue(content: string, section: string, key: string) {
  const lines = content.split('\n')
  const sectionIndex = lines.findIndex(line => line.trim() === section)
  if (sectionIndex === -1)
    return undefined

  const nextSectionIndex = findNextSectionIndex(lines, sectionIndex + 1)
  const valueLineIndex = findKeyIndex(lines, sectionIndex + 1, nextSectionIndex, key)
  if (valueLineIndex === -1)
    return undefined

  const line = lines[valueLineIndex]
  const index = line.indexOf('=')
  return index === -1 ? undefined : line.slice(index + 1).trim()
}

function findNextSectionIndex(lines: string[], startIndex: number) {
  const index = lines.findIndex((line, lineIndex) => lineIndex >= startIndex && line.trim().startsWith('['))
  return index === -1 ? lines.length : index
}

function findKeyIndex(lines: string[], startIndex: number, endIndex: number, key: string) {
  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`)
  for (let index = startIndex; index < endIndex; index += 1) {
    if (keyPattern.test(lines[index]))
      return index
  }
  return -1
}

function ensureTrailingNewline(value: string) {
  return value.endsWith('\n') ? value : `${value}\n`
}

function getIndent(line: string) {
  return line.match(/^\s*/)?.[0] || '\t'
}

function normalizeGitdir(value: string) {
  const normalized = normalizePath(value)
  return normalized.endsWith(path.sep) ? normalized : `${normalized}${path.sep}`
}

function normalizePath(value: string) {
  if (value === '~')
    return getHomeDir()

  if (value.startsWith(`~${path.sep}`))
    return path.join(getHomeDir(), value.slice(2))

  return path.resolve(value)
}

function displayPath(filePath: string) {
  const home = getHomeDir()
  if (filePath === home)
    return '~'

  if (filePath.startsWith(`${home}${path.sep}`))
    return `~/${path.relative(home, filePath)}`

  return filePath
}

function hostFromGitdir(gitdir: string) {
  const reposSegment = `${path.sep}repos${path.sep}`
  const index = gitdir.indexOf(reposSegment)
  if (index === -1)
    return DEFAULT_GIT_HOST

  const host = gitdir.slice(index + reposSegment.length).split(path.sep)[0]
  return host || DEFAULT_GIT_HOST
}

function parseCommaList(value: unknown): string[] {
  return parseRepeatedOption(value)
    .flatMap(item => item.split(','))
    .map(item => item.trim())
    .filter(Boolean)
}

function parseRepeatedOption(value: unknown): string[] {
  if (Array.isArray(value))
    return value.flatMap(item => parseRepeatedOption(item))

  if (typeof value !== 'string')
    return []

  return [value].filter(Boolean)
}

function readString(record: UnknownRecord, key: string) {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function sanitizeProfileId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'git'
}

function defaultProfileId(host: string) {
  return host === DEFAULT_GIT_HOST ? 'github' : host
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function requiredText(value: string | undefined) {
  return value?.trim() ? undefined : 'Required'
}
