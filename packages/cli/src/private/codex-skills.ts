import type { PrivateManifest, PrivateSkill, PrivateSkillPolicy } from './types'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { parseDocument } from 'yaml'
import { getHomeDir } from '../config'
import { isSafeSkillName, readWorkstationSkillLock, skillDirectoryDigest, workstationSkillLockPath } from '../skill-provenance'
import { assertAllowedRead, privateSkillInstalls, privateSkillPolicies } from './manifest'
import { repoRootFromManifest, resolveRepoPath } from './paths'

interface ResolvedPrivateSkill extends PrivateSkill {
  source: PrivateSkill['source'] & {
    path?: string
  }
}

function skillsRoot(): string {
  return process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME, 'skills')
    : path.join(getHomeDir(), '.codex', 'skills')
}

function sharedSkillsRoot(): string {
  return path.join(getHomeDir(), '.agents', 'skills')
}

function skillName(skill: PrivateSkill): string {
  const name = skill.targetName || skill.id
  if (!isSafeSkillName(name))
    throw new Error(`Invalid private skill name for ${skill.id}: ${name}`)

  return name
}

function resolveSkills(manifestPath: string, manifest: PrivateManifest): ResolvedPrivateSkill[] {
  const contract = manifest.workstationOverlay
  const repoRoot = repoRootFromManifest(manifestPath)

  return privateSkillInstalls(manifest).map((skill) => {
    if (skill.source.type !== 'local')
      return skill

    if (!skill.source.path)
      throw new Error(`Local private skill ${skill.id} has no source.path`)

    assertAllowedRead(skill.source.path, contract || {})
    const sourcePath = resolveRepoPath(repoRoot, skill.source.path)
    if (!fs.existsSync(sourcePath))
      throw new Error(`Local private skill source does not exist for ${skill.id}: ${skill.source.path}`)
    const sourceState = fs.lstatSync(sourcePath)
    if (sourceState.isSymbolicLink() || !sourceState.isDirectory())
      throw new Error(`Local private skill source must be a real directory for ${skill.id}: ${skill.source.path}`)
    const realRepoRoot = fs.realpathSync(repoRoot)
    const realSourcePath = fs.realpathSync(sourcePath)
    const relative = path.relative(realRepoRoot, realSourcePath)
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error(`Local private skill source escapes private overlay repository for ${skill.id}: ${skill.source.path}`)
    return {
      ...skill,
      source: {
        ...skill.source,
        path: sourcePath,
      },
    }
  })
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.error)
    throw result.error

  if (result.status !== 0) {
    const details = result.stderr.trim() || result.stdout.trim()
    throw new Error(details || `${command} ${args.join(' ')} failed`)
  }
}

function repoUrl(skill: PrivateSkill): string {
  const repo = skill.source.repo
  if (!repo)
    throw new Error(`GitHub private skill ${skill.id} has no source.repo`)

  if (repo.includes('://') || repo.startsWith('git@'))
    return repo

  return `https://github.com/${repo}.git`
}

function replaceSkillDirectory(source: string, destination: string, id: string): void {
  if (!fs.existsSync(path.join(source, 'SKILL.md')))
    throw new Error(`SKILL.md not found for private skill ${id}: ${source}`)

  const sourceDigest = skillDirectoryDigest(source, { rejectSymlinks: true })
  const destinationState = lstatIfPresent(destination)
  if (destinationState) {
    if (destinationState.isSymbolicLink() || !destinationState.isDirectory())
      throw new Error(`Private skill destination must be a real directory for ${id}: ${destination}`)
  }

  if (destinationState && sourceDigest === skillDirectoryDigest(destination)) {
    console.log(`[skip] private skill ${id} is already up to date`)
    return
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true })
  const backup = destinationState
    ? `${destination}.backup.${Date.now()}`
    : undefined

  if (backup)
    fs.renameSync(destination, backup)

  try {
    fs.cpSync(source, destination, { recursive: true })
    if (backup)
      fs.rmSync(backup, { force: true, recursive: true })
  }
  catch (error) {
    fs.rmSync(destination, { force: true, recursive: true })
    if (backup)
      fs.renameSync(backup, destination)
    throw error
  }

  console.log(`[ok] installed private skill ${id}`)
}

function preflightSkillInstall(skill: ResolvedPrivateSkill, destinationRoot: string): void {
  const destination = path.join(destinationRoot, skillName(skill))
  const destinationState = lstatIfPresent(destination)
  if (destinationState) {
    if (destinationState.isSymbolicLink() || !destinationState.isDirectory())
      throw new Error(`Private skill destination must be a real directory for ${skill.id}: ${destination}`)
  }

  if (skill.source.type !== 'local')
    return
  if (!skill.source.path)
    throw new Error(`Local private skill ${skill.id} has no source.path`)
  if (!fs.existsSync(path.join(skill.source.path, 'SKILL.md')))
    throw new Error(`SKILL.md not found for private skill ${skill.id}: ${skill.source.path}`)
  skillDirectoryDigest(skill.source.path, { rejectSymlinks: true })
}

function prepareSkillSource(
  source: string,
  skill: ResolvedPrivateSkill,
  policies: PrivateSkillPolicy[],
): { cleanup: () => void, source: string } {
  const matchingPolicies = policies.filter((policy) => {
    const [topLevelName] = policy.path.split('/')
    return policy.root === (skill.root === 'shared' ? 'shared' : 'codex')
      && topLevelName === skillName(skill)
  })
  if (matchingPolicies.length === 0)
    return { cleanup: () => {}, source }

  skillDirectoryDigest(source, { rejectSymlinks: true })
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'workstation-private-skill-policy-'))
  const prepared = path.join(temporary, 'skill')
  try {
    fs.cpSync(source, prepared, { recursive: true })
    for (const policy of matchingPolicies) {
      const skillDirectory = path.resolve(prepared, ...policy.path.split('/').slice(1))
      if (!isPathWithin(prepared, skillDirectory))
        throw new Error(`Unsafe private Skill policy target for ${policy.id}: ${policy.path}`)
      assertRealPathWithin(prepared, skillDirectory, policy)
      const plan = planSkillPolicy(policy, skillDirectory)
      if (plan.next === plan.existing)
        continue
      fs.mkdirSync(path.dirname(plan.configPath), { recursive: true })
      fs.writeFileSync(plan.configPath, plan.next, { encoding: 'utf8', mode: plan.existingMode })
    }
    return {
      cleanup: () => fs.rmSync(temporary, { force: true, recursive: true }),
      source: prepared,
    }
  }
  catch (error) {
    fs.rmSync(temporary, { force: true, recursive: true })
    throw error
  }
}

function materializeSkillSources(
  skills: ResolvedPrivateSkill[],
  policies: PrivateSkillPolicy[],
): { cleanup: () => void, sources: Map<ResolvedPrivateSkill, string> } {
  const cleanups: Array<() => void> = []
  const sources = new Map<ResolvedPrivateSkill, string>()
  const cleanup = () => {
    for (const remove of cleanups.reverse())
      remove()
  }

  try {
    for (const skill of skills) {
      let source: string
      if (skill.source.type === 'local') {
        if (!skill.source.path)
          throw new Error(`Local private skill ${skill.id} has no source.path`)
        source = skill.source.path
      }
      else if (skill.source.type === 'github') {
        if (!skill.source.path)
          throw new Error(`GitHub private skill ${skill.id} has no source.path`)
        if (!isSafeRelativeRepositoryPath(skill.source.path))
          throw new Error(`Unsafe GitHub private skill path for ${skill.id}: ${skill.source.path}`)
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workstation-private-skill-'))
        cleanups.push(() => fs.rmSync(tempDir, { force: true, recursive: true }))
        const repoDir = path.join(tempDir, 'repo')
        run('git', [
          'clone',
          '--filter=blob:none',
          '--depth',
          '1',
          '--sparse',
          '--single-branch',
          '--branch',
          skill.source.ref || 'main',
          repoUrl(skill),
          repoDir,
        ])
        run('git', ['-C', repoDir, 'sparse-checkout', 'set', '--', skill.source.path])
        source = path.resolve(repoDir, ...skill.source.path.split('/'))
        const sourceState = lstatIfPresent(source)
        if (!sourceState || sourceState.isSymbolicLink() || !sourceState.isDirectory())
          throw new Error(`GitHub private skill source must be a real directory for ${skill.id}: ${skill.source.path}`)
        if (!isPathWithin(fs.realpathSync(repoDir), fs.realpathSync(source)))
          throw new Error(`GitHub private skill source escapes its repository for ${skill.id}: ${skill.source.path}`)
      }
      else {
        throw new Error(`Unsupported private skill source type for ${skill.id}: ${skill.source.type}`)
      }

      if (!fs.existsSync(path.join(source, 'SKILL.md')))
        throw new Error(`SKILL.md not found for private skill ${skill.id}: ${source}`)
      skillDirectoryDigest(source, { rejectSymlinks: true })
      const prepared = prepareSkillSource(source, skill, policies)
      cleanups.push(prepared.cleanup)
      sources.set(skill, prepared.source)
    }
    return { cleanup, sources }
  }
  catch (error) {
    cleanup()
    throw error
  }
}

function installSkill(skill: ResolvedPrivateSkill, destinationRoot: string, dryRun: boolean, source?: string): void {
  const destination = path.join(destinationRoot, skillName(skill))
  console.log(`${dryRun ? '[dry-run]' : '[apply]'} private skill ${skill.id} -> ${destination}`)
  if (dryRun)
    return
  if (!source)
    throw new Error(`Private skill source was not materialized for ${skill.id}`)
  replaceSkillDirectory(source, destination, skill.id)
}

function installRoot(skill: PrivateSkill): string {
  return skill.root === 'shared' ? sharedSkillsRoot() : skillsRoot()
}

function applySkillProvenanceLock(skills: ResolvedPrivateSkill[], dryRun: boolean): void {
  const lockPath = workstationSkillLockPath(getHomeDir())
  if (dryRun) {
    if (skills.length > 0 || fs.existsSync(lockPath))
      console.log(`[dry-run] private Skill provenance lock -> ${lockPath}`)
    return
  }

  const entries = Object.fromEntries(
    [...skills]
      .sort((left, right) => skillName(left).localeCompare(skillName(right)))
      .map((skill) => {
        const name = skillName(skill)
        const destination = path.join(installRoot(skill), name)
        return [name, {
          digest: skillDirectoryDigest(destination),
          root: skill.root === 'shared' ? 'shared' : 'codex',
        }]
      }),
  )
  const next = `${JSON.stringify({ skills: entries, version: 1 }, null, 2)}\n`
  const current = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : ''
  if (current === next) {
    console.log('[skip] private Skill provenance lock is already up to date')
    return
  }
  if (skills.length === 0 && !fs.existsSync(lockPath))
    return

  const existing = readWorkstationSkillLock(lockPath)
  if (existing.error)
    throw new Error(`Private Skill provenance lock is invalid: ${existing.error}`)
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  const temporary = `${lockPath}.tmp.${process.pid}`
  const backup = fs.existsSync(lockPath) ? `${lockPath}.backup.${process.pid}` : undefined
  try {
    fs.writeFileSync(temporary, next, { encoding: 'utf8', mode: 0o600 })
    if (backup)
      fs.renameSync(lockPath, backup)
    fs.renameSync(temporary, lockPath)
    fs.chmodSync(lockPath, 0o600)
    if (backup)
      fs.rmSync(backup, { force: true })
  }
  catch (error) {
    if (backup && fs.existsSync(backup) && !fs.existsSync(lockPath))
      fs.renameSync(backup, lockPath)
    throw error
  }
  finally {
    fs.rmSync(temporary, { force: true })
    if (backup)
      fs.rmSync(backup, { force: true })
  }
  console.log(`[ok] applied private Skill provenance lock (${skills.length} skill(s))`)
}

function planSkillPolicy(policy: PrivateSkillPolicy, skillDirectory: string): {
  configPath: string
  existing: string
  existingMode: number
  next: string
} {
  const skillFile = path.join(skillDirectory, 'SKILL.md')
  if (!fs.existsSync(skillFile) || !fs.lstatSync(skillFile).isFile())
    throw new Error(`SKILL.md not found for private Skill policy ${policy.id}: ${skillFile}`)

  const agentsDirectory = path.join(skillDirectory, 'agents')
  const agentsState = lstatIfPresent(agentsDirectory)
  if (agentsState) {
    if (agentsState.isSymbolicLink() || !agentsState.isDirectory())
      throw new Error(`agents must be a real directory for private Skill policy ${policy.id}`)
  }
  const configPath = path.join(agentsDirectory, 'openai.yaml')

  const configState = lstatIfPresent(configPath)
  if (configState?.isSymbolicLink())
    throw new Error(`agents/openai.yaml must not be a symbolic link for private Skill policy ${policy.id}`)
  if (configState && !configState.isFile())
    throw new Error(`agents/openai.yaml must be a regular file for private Skill policy ${policy.id}`)
  const existing = configState ? fs.readFileSync(configPath, 'utf8') : ''
  const existingMode = configState ? configState.mode & 0o777 : 0o644
  const document = parseDocument(existing || '{}\n')
  if (document.errors.length > 0)
    throw new Error(`agents/openai.yaml is invalid for private Skill policy ${policy.id}: ${document.errors[0].message.split('\n')[0]}`)
  const config: unknown = document.toJS()
  if (!isRecord(config))
    throw new Error(`agents/openai.yaml must contain a mapping for private Skill policy ${policy.id}`)
  const existingPolicy = config.policy
  if (existingPolicy !== undefined && !isRecord(existingPolicy))
    throw new Error(`agents/openai.yaml policy must be a mapping for private Skill policy ${policy.id}`)
  document.setIn(['policy', 'allow_implicit_invocation'], policy.allowImplicitInvocation)
  return { configPath, existing, existingMode, next: document.toString() }
}

function resolvePolicySkillDirectory(policy: PrivateSkillPolicy): string {
  const root = policy.root === 'shared' ? sharedSkillsRoot() : skillsRoot()
  const skillDirectory = path.resolve(root, ...policy.path.split('/'))
  if (!isPathWithin(root, skillDirectory) || skillDirectory === root)
    throw new Error(`Unsafe private Skill policy target for ${policy.id}: ${policy.path}`)
  assertRealPathWithin(root, skillDirectory, policy)
  return skillDirectory
}

function assertRealPathWithin(root: string, skillDirectory: string, policy: PrivateSkillPolicy): void {
  const skillFile = path.join(skillDirectory, 'SKILL.md')
  let realRoot: string
  let realSkillDirectory: string
  try {
    realRoot = fs.realpathSync(root)
    realSkillDirectory = fs.realpathSync(skillDirectory)
  }
  catch {
    throw new Error(`SKILL.md not found for private Skill policy ${policy.id}: ${skillFile}`)
  }
  if (!isPathWithin(realRoot, realSkillDirectory))
    throw new Error(`Private Skill policy target escapes its discovery root for ${policy.id}: ${policy.path}`)
}

function preflightSkillPolicies(skills: ResolvedPrivateSkill[], policies: PrivateSkillPolicy[]): void {
  for (const policy of policies) {
    const segments = policy.path.split('/')
    const installedSkill = installedSkillForPolicy(skills, policy)
    if (installedSkill?.source.type === 'local' && installedSkill.source.path) {
      const sourceRoot = installedSkill.source.path
      const skillDirectory = path.resolve(sourceRoot, ...segments.slice(1))
      if (!isPathWithin(sourceRoot, skillDirectory))
        throw new Error(`Unsafe private Skill policy target for ${policy.id}: ${policy.path}`)
      assertRealPathWithin(sourceRoot, skillDirectory, policy)
      planSkillPolicy(policy, skillDirectory)
    }
    else if (!installedSkill) {
      planSkillPolicy(policy, resolvePolicySkillDirectory(policy))
    }
  }
}

function installedSkillForPolicy(skills: ResolvedPrivateSkill[], policy: PrivateSkillPolicy): ResolvedPrivateSkill | undefined {
  const [topLevelName] = policy.path.split('/')
  return skills.find(skill =>
    (skill.root === 'shared' ? 'shared' : 'codex') === policy.root
    && skillName(skill) === topLevelName,
  )
}

function applySkillPolicy(policy: PrivateSkillPolicy, dryRun: boolean): void {
  const plan = planSkillPolicy(policy, resolvePolicySkillDirectory(policy))
  if (plan.next === plan.existing) {
    console.log(`[skip] private Skill policy ${policy.id} is already up to date`)
    return
  }
  console.log(`${dryRun ? '[dry-run]' : '[apply]'} private Skill policy ${policy.id} -> ${plan.configPath}`)
  if (dryRun)
    return

  fs.mkdirSync(path.dirname(plan.configPath), { recursive: true })
  const temporary = `${plan.configPath}.tmp.${process.pid}`
  const backup = fs.existsSync(plan.configPath) ? `${plan.configPath}.backup.${process.pid}` : undefined
  try {
    fs.writeFileSync(temporary, plan.next, { encoding: 'utf8', mode: plan.existingMode })
    if (backup)
      fs.renameSync(plan.configPath, backup)
    fs.renameSync(temporary, plan.configPath)
    if (backup)
      fs.rmSync(backup, { force: true })
  }
  catch (error) {
    if (backup && fs.existsSync(backup) && !fs.existsSync(plan.configPath))
      fs.renameSync(backup, plan.configPath)
    throw error
  }
  finally {
    fs.rmSync(temporary, { force: true })
    if (backup)
      fs.rmSync(backup, { force: true })
  }
  console.log(`[ok] applied private Skill policy ${policy.id}`)
}

export function applyPrivateCodexSkills(manifestPath: string, manifest: PrivateManifest, dryRun: boolean): void {
  const existingLock = readWorkstationSkillLock(workstationSkillLockPath(getHomeDir()))
  if (existingLock.error)
    throw new Error(`Private Skill provenance lock is invalid: ${existingLock.error}`)

  const skills = resolveSkills(manifestPath, manifest)
  const policies = privateSkillPolicies(manifest)
  if (skills.length === 0) {
    console.log('[skip] no private Skill installs')
  }
  else {
    const names = new Set<string>()
    for (const skill of skills) {
      const name = skillName(skill)
      if (names.has(name))
        throw new Error(`Duplicate private skill name: ${name}`)
      names.add(name)
    }
    for (const skill of skills)
      preflightSkillInstall(skill, installRoot(skill))
    preflightSkillPolicies(skills, policies)
    const materialized = dryRun ? undefined : materializeSkillSources(skills, policies)
    try {
      for (const skill of skills)
        installSkill(skill, installRoot(skill), dryRun, materialized?.sources.get(skill))
    }
    finally {
      materialized?.cleanup()
    }
  }

  if (skills.length === 0)
    preflightSkillPolicies(skills, policies)
  if (policies.length === 0) {
    console.log('[skip] no private Skill policies')
  }
  else {
    for (const policy of policies) {
      const root = policy.root === 'shared' ? sharedSkillsRoot() : skillsRoot()
      const skillDirectory = path.resolve(root, ...policy.path.split('/'))
      if (dryRun && installedSkillForPolicy(skills, policy) && !lstatIfPresent(skillDirectory)) {
        console.log(`[dry-run] private Skill policy ${policy.id} -> ${path.join(skillDirectory, 'agents', 'openai.yaml')}`)
        continue
      }
      applySkillPolicy(policy, dryRun)
    }
  }

  applySkillProvenanceLock(skills, dryRun)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function lstatIfPresent(target: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(target)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return undefined
    throw error
  }
}

function isSafeRelativeRepositoryPath(value: string): boolean {
  return Boolean(
    value
    && value !== '.'
    && !value.includes('\\')
    && !path.isAbsolute(value)
    && !/^[A-Z]:[\\/]/i.test(value)
    && !value.split('/').some(segment => !segment || segment === '.' || segment === '..'),
  )
}
