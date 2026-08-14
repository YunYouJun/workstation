import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parse } from 'yaml'
import { getHomeDir } from './config'
import { isSafeSkillName, readWorkstationSkillLock, skillDirectoryDigest, workstationSkillLockPath } from './skill-provenance'

export type SkillsFindingSeverity = 'error' | 'warning'
export type SkillsRootKind = 'shared' | 'codex' | 'project'

export interface SkillsAuditOptions {
  check?: boolean
  codexHome?: string
  home?: string
  json?: boolean
  projectRoot?: string
}

export interface SkillsAuditFinding {
  code: string
  message: string
  paths: string[]
  severity: SkillsFindingSeverity
}

export interface SkillsAuditRoot {
  exists: boolean
  kind: SkillsRootKind
  path: string
  skillFileCount: number
  topLevelSkillCount: number
}

export interface SkillsAuditReport {
  apm: {
    lockExists: boolean
    managedSkillCount: number
    manifestExists: boolean
  }
  findings: SkillsAuditFinding[]
  roots: SkillsAuditRoot[]
  skillsRegistry: {
    lockExists: boolean
    managedSkillCount: number
  }
  workstation: {
    lockExists: boolean
    managedSkillCount: number
  }
  summary: {
    descriptionCharacterCount: number
    errorCount: number
    explicitOnlySkillCount: number
    implicitDescriptionCharacterCount: number
    implicitSkillCount: number
    longestDescriptionCharacterCount: number
    managedSharedSkillCount: number
    oversizedSkillBodyCount: number
    rootCount: number
    skillFileCount: number
    topLevelSkillCount: number
    unmanagedSharedSkillCount: number
    verboseDescriptionCount: number
    warningCount: number
  }
}

interface DiscoveredSkill {
  allowImplicitInvocation: boolean
  bodyLineCount: number
  descriptionCharacterCount: number
  frontmatterError?: string
  name: string
  path: string
  realPath: string
  rootKind: SkillsRootKind
  openaiConfigError?: string
  openaiConfigPath: string
  topLevel: boolean
}

interface SkillsDiscoveryResult {
  failures: Array<{ code: 'invalid-skill-symlink' | 'skill-discovery-limit-exceeded' | 'unreadable-skill-directory', error: string, path: string }>
  skills: DiscoveredSkill[]
}

const MAX_SKILL_DISCOVERY_DEPTH = 32
const MAX_SKILL_DISCOVERY_ENTRIES = 10_000
const MAX_SKILL_DESCRIPTION_CHARACTERS = 1_024
const RECOMMENDED_MAX_SKILL_BODY_LINES = 500
const RECOMMENDED_MAX_SKILL_DESCRIPTION_CHARACTERS = 500

export function auditSkills(options: SkillsAuditOptions = {}): SkillsAuditReport {
  const home = path.resolve(options.home || getHomeDir())
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(home, '.codex'))
  const projectRoot = path.resolve(options.projectRoot || process.cwd())
  const rootSpecs: Array<{ kind: SkillsRootKind, path: string }> = [
    { kind: 'shared', path: path.join(home, '.agents', 'skills') },
    { kind: 'codex', path: path.join(codexHome, 'skills') },
    { kind: 'project', path: path.join(projectRoot, '.agents', 'skills') },
  ]
  const discoveryResults = rootSpecs.map(root => discoverSkills(root.kind, root.path))
  const discovered = discoveryResults.flatMap(result => result.skills)
  const uniqueDiscovered = [...new Map(discovered.map(skill => [skill.realPath, skill])).values()]
  const roots = rootSpecs.map((root) => {
    const skills = discovered.filter(skill => skill.rootKind === root.kind)
    return {
      exists: isDirectory(root.path),
      kind: root.kind,
      path: root.path,
      skillFileCount: skills.length,
      topLevelSkillCount: skills.filter(skill => skill.topLevel).length,
    }
  })
  const findings: SkillsAuditFinding[] = []
  for (const failure of discoveryResults.flatMap(result => result.failures)) {
    findings.push({
      code: failure.code,
      message: failure.code === 'invalid-skill-symlink'
        ? `Skill symlink could not be followed safely: ${failure.error}`
        : failure.code === 'skill-discovery-limit-exceeded'
          ? `Skill discovery stopped at its safety limit: ${failure.error}`
          : `Skill directory could not be read: ${failure.error}`,
      paths: [failure.path],
      severity: 'error',
    })
  }
  for (const skill of uniqueDiscovered.filter(skill => skill.frontmatterError)) {
    findings.push({
      code: 'invalid-skill-frontmatter',
      message: `Invalid SKILL.md frontmatter for ${skill.name}: ${skill.frontmatterError}`,
      paths: [skill.path],
      severity: 'error',
    })
  }
  const nonstandardSkillNames = uniqueDiscovered.filter(skill =>
    !skill.frontmatterError
    && (Array.from(skill.name).length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name)),
  )
  if (nonstandardSkillNames.length > 0) {
    findings.push({
      code: 'nonstandard-skill-name',
      message: `${nonstandardSkillNames.length} Skill name(s) should use at most 64 lowercase letters, digits, and single hyphens`,
      paths: nonstandardSkillNames.map(skill => skill.path).sort(),
      severity: 'warning',
    })
  }
  for (const skill of uniqueDiscovered.filter(skill => skill.openaiConfigError)) {
    findings.push({
      code: 'invalid-skill-openai-config',
      message: `Invalid agents/openai.yaml for ${skill.name}: ${skill.openaiConfigError}`,
      paths: [skill.openaiConfigPath],
      severity: 'error',
    })
  }
  const verboseDescriptions = uniqueDiscovered.filter(skill =>
    skill.allowImplicitInvocation
    && !skill.frontmatterError
    && skill.descriptionCharacterCount > RECOMMENDED_MAX_SKILL_DESCRIPTION_CHARACTERS,
  )
  if (verboseDescriptions.length > 0) {
    findings.push({
      code: 'verbose-skill-description',
      message: `${verboseDescriptions.length} Skill description(s) exceed the recommended ${RECOMMENDED_MAX_SKILL_DESCRIPTION_CHARACTERS} characters and consume extra always-on context`,
      paths: verboseDescriptions.map(skill => skill.path).sort(),
      severity: 'warning',
    })
  }
  const oversizedSkillBodies = uniqueDiscovered.filter(skill =>
    skill.bodyLineCount > RECOMMENDED_MAX_SKILL_BODY_LINES,
  )
  if (oversizedSkillBodies.length > 0) {
    findings.push({
      code: 'oversized-skill-body',
      message: `${oversizedSkillBodies.length} Skill body/bodies exceed ${RECOMMENDED_MAX_SKILL_BODY_LINES} lines; move detailed material to references/`,
      paths: oversizedSkillBodies.map(skill => skill.path).sort(),
      severity: 'warning',
    })
  }
  const apmManifest = path.join(home, '.apm', 'apm.yml')
  const apmLock = path.join(home, '.apm', 'apm.lock.yaml')
  const skillsRegistryLock = process.env.XDG_STATE_HOME
    ? path.join(path.resolve(process.env.XDG_STATE_HOME), 'skills', '.skill-lock.json')
    : path.join(home, '.agents', '.skill-lock.json')
  const workstationLockPath = workstationSkillLockPath(home)
  const apmManifestExists = pathEntryExists(apmManifest)
  const apmLockExists = pathEntryExists(apmLock)
  const skillsRegistryLockExists = pathEntryExists(skillsRegistryLock)
  if (apmManifestExists && !apmLockExists) {
    findings.push({
      code: 'missing-apm-lock',
      message: 'Global APM manifest exists but apm.lock.yaml is missing',
      paths: [apmManifest, apmLock],
      severity: 'error',
    })
  }
  if (apmLockExists && !apmManifestExists) {
    findings.push({
      code: 'missing-apm-manifest',
      message: 'Global APM lock exists but apm.yml is missing',
      paths: [apmManifest, apmLock],
      severity: 'error',
    })
  }
  const manifest = apmManifestData(apmManifest)
  if (manifest.error) {
    findings.push({
      code: 'invalid-apm-manifest',
      message: `Global APM manifest is invalid: ${manifest.error}`,
      paths: [apmManifest],
      severity: 'error',
    })
  }
  const apmManaged = apmManagedSkills(apmLock)
  if (apmManaged.error) {
    findings.push({
      code: 'invalid-apm-lock',
      message: `Global APM lock is invalid: ${apmManaged.error}`,
      paths: [apmLock],
      severity: 'error',
    })
  }
  const missingLockDependencies = manifest.error || apmManaged.error
    ? []
    : [...manifest.dependencies]
        .filter(name => !apmManaged.dependencyNames.has(name) && !apmManaged.names.has(name))
        .sort()
  if (missingLockDependencies.length > 0) {
    findings.push({
      code: 'missing-apm-lock-dependency',
      message: `Global APM lock is missing manifest dependencies: ${missingLockDependencies.join(', ')}`,
      paths: [apmManifest, apmLock],
      severity: 'error',
    })
  }
  const deployedPaths = apmManaged.error
    ? { invalid: [], valid: new Map<string, string>() }
    : validatedDeployedPaths(home, [
        ...apmManaged.deployedFiles,
        ...apmManaged.deployedFileHashes.map(({ file }) => file),
      ])
  if (deployedPaths.invalid.length > 0) {
    findings.push({
      code: 'invalid-apm-deployed-path',
      message: `${deployedPaths.invalid.length} APM-deployed path(s) escape ~/.agents/skills`,
      paths: deployedPaths.invalid,
      severity: 'error',
    })
  }
  const missingDeployedFiles = apmManaged.deployedFiles
    .map(file => deployedPaths.valid.get(file))
    .filter((file): file is string => Boolean(file))
    .filter(file => !fs.existsSync(file))
    .sort()
  if (missingDeployedFiles.length > 0) {
    findings.push({
      code: 'missing-apm-deployed-file',
      message: `${missingDeployedFiles.length} file(s) declared by the global APM lock are missing`,
      paths: missingDeployedFiles,
      severity: 'error',
    })
  }
  const modifiedDeployedFiles = apmManaged.deployedFileHashes
    .filter(({ file, hash }) => {
      const deployedFile = deployedPaths.valid.get(file)
      if (!deployedFile)
        return false
      if (!fs.existsSync(deployedFile) || !fs.statSync(deployedFile).isFile())
        return false
      const actual = `sha256:${crypto.createHash('sha256').update(fs.readFileSync(deployedFile)).digest('hex')}`
      return actual !== hash
    })
    .map(({ file }) => deployedPaths.valid.get(file))
    .filter((file): file is string => Boolean(file))
    .sort()
  if (modifiedDeployedFiles.length > 0) {
    findings.push({
      code: 'modified-apm-deployed-file',
      message: `${modifiedDeployedFiles.length} APM-managed file(s) do not match the global lock`,
      paths: modifiedDeployedFiles,
      severity: 'error',
    })
  }
  const registryManaged = skillsRegistryManagedSkills(skillsRegistryLock)
  if (registryManaged.error) {
    findings.push({
      code: 'invalid-skills-registry-lock',
      message: `Global skills.sh lock is invalid: ${registryManaged.error}`,
      paths: [skillsRegistryLock],
      severity: 'error',
    })
  }
  const workstationManaged = readWorkstationSkillLock(workstationLockPath)
  if (workstationManaged.error) {
    findings.push({
      code: 'invalid-workstation-skill-lock',
      message: `Workstation Skill provenance lock is invalid: ${workstationManaged.error}`,
      paths: [workstationLockPath],
      severity: 'error',
    })
  }
  for (const [name, entry] of Object.entries(workstationManaged.lock.skills)) {
    const root = entry.root === 'shared' ? rootSpecs[0].path : rootSpecs[1].path
    const target = path.join(root, name)
    let actualDigest: string
    try {
      const state = fs.lstatSync(target)
      if (state.isSymbolicLink() || !state.isDirectory())
        throw new Error('deployment must be a real directory')
      actualDigest = skillDirectoryDigest(target)
    }
    catch (error) {
      findings.push({
        code: 'missing-workstation-skill',
        message: `Workstation-managed Skill deployment is missing or unreadable: ${name}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
        paths: [target],
        severity: 'error',
      })
      continue
    }
    if (actualDigest !== entry.digest) {
      findings.push({
        code: 'modified-workstation-skill',
        message: `Workstation-managed Skill does not match its provenance lock: ${name}`,
        paths: [target],
        severity: 'error',
      })
    }
  }
  const apmManagedNames = apmManaged.names
  const workstationSharedNames = new Set(
    Object.entries(workstationManaged.lock.skills)
      .filter(([, entry]) => entry.root === 'shared')
      .map(([name]) => name),
  )
  const managed = new Set([...apmManagedNames, ...registryManaged.names, ...workstationSharedNames])
  const sharedTopLevel = discovered.filter(skill => skill.rootKind === 'shared' && skill.topLevel)

  const unmanagedShared = sharedTopLevel.filter(skill => !managed.has(topLevelDirectoryName(skill)))
  if (unmanagedShared.length > 0) {
    findings.push({
      code: 'unmanaged-shared-skill',
      message: `${unmanagedShared.length} shared skill(s) are not declared by the global APM, skills.sh, or workstation provenance lock`,
      paths: unmanagedShared.map(skill => skill.path).sort(),
      severity: 'warning',
    })
  }

  for (const name of apmManagedNames) {
    if (!sharedTopLevel.some(skill => topLevelDirectoryName(skill) === name)) {
      findings.push({
        code: 'missing-apm-deployment',
        message: `APM-managed skill is missing from ~/.agents/skills: ${name}`,
        paths: [path.join(home, '.agents', 'skills', name)],
        severity: 'error',
      })
    }
  }
  const directoryNameMismatches = uniqueDiscovered.filter((skill) => {
    if (path.basename(path.dirname(skill.path)) === skill.name)
      return false
    return !(skill.rootKind === 'shared' && skill.topLevel && managed.has(topLevelDirectoryName(skill)))
  })
  if (directoryNameMismatches.length > 0) {
    findings.push({
      code: 'skill-directory-name-mismatch',
      message: `${directoryNameMismatches.length} Skill directory name(s) do not match their frontmatter name`,
      paths: directoryNameMismatches.map(skill => skill.path).sort(),
      severity: 'warning',
    })
  }

  const byName = new Map<string, DiscoveredSkill[]>()
  for (const skill of uniqueDiscovered.filter(skill => skill.topLevel)) {
    const matches = byName.get(skill.name) || []
    matches.push(skill)
    byName.set(skill.name, matches)
  }
  for (const [name, matches] of byName) {
    if (matches.length < 2)
      continue
    const duplicateAcrossRoots = new Set(matches.map(skill => skill.rootKind)).size > 1
    findings.push({
      code: duplicateAcrossRoots ? 'duplicate-skill-name' : 'duplicate-skill-name-in-root',
      message: duplicateAcrossRoots
        ? `Skill name is present in multiple discovery roots: ${name}`
        : `Skill name is present multiple times in the same discovery root: ${name}`,
      paths: matches.map(skill => skill.path).sort(),
      severity: 'warning',
    })
  }

  findings.sort((a, b) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message))
  return {
    apm: {
      lockExists: apmLockExists,
      managedSkillCount: apmManagedNames.size,
      manifestExists: apmManifestExists,
    },
    findings,
    roots,
    skillsRegistry: {
      lockExists: skillsRegistryLockExists,
      managedSkillCount: registryManaged.names.size,
    },
    summary: {
      descriptionCharacterCount: uniqueDiscovered.reduce((total, skill) => total + skill.descriptionCharacterCount, 0),
      errorCount: findings.filter(finding => finding.severity === 'error').length,
      explicitOnlySkillCount: uniqueDiscovered.filter(skill => !skill.allowImplicitInvocation).length,
      implicitDescriptionCharacterCount: uniqueDiscovered
        .filter(skill => skill.allowImplicitInvocation)
        .reduce((total, skill) => total + skill.descriptionCharacterCount, 0),
      implicitSkillCount: uniqueDiscovered.filter(skill => skill.allowImplicitInvocation).length,
      longestDescriptionCharacterCount: Math.max(0, ...uniqueDiscovered.map(skill => skill.descriptionCharacterCount)),
      managedSharedSkillCount: sharedTopLevel.length - unmanagedShared.length,
      oversizedSkillBodyCount: oversizedSkillBodies.length,
      rootCount: roots.length,
      skillFileCount: uniqueDiscovered.length,
      topLevelSkillCount: uniqueDiscovered.filter(skill => skill.topLevel).length,
      unmanagedSharedSkillCount: unmanagedShared.length,
      verboseDescriptionCount: verboseDescriptions.length,
      warningCount: findings.filter(finding => finding.severity === 'warning').length,
    },
    workstation: {
      lockExists: workstationManaged.exists,
      managedSkillCount: Object.keys(workstationManaged.lock.skills).length,
    },
  }
}

function topLevelDirectoryName(skill: DiscoveredSkill): string {
  return path.basename(path.dirname(skill.path))
}

export function formatSkillsAudit(report: SkillsAuditReport): string {
  const hasApmError = report.findings.some(finding =>
    finding.severity === 'error'
    && (finding.code.startsWith('invalid-apm')
      || finding.code.startsWith('missing-apm')
      || finding.code === 'modified-apm-deployed-file'),
  )
  const apmState = hasApmError
    ? 'invalid'
    : report.apm.manifestExists && report.apm.lockExists
      ? 'ok'
      : !report.apm.manifestExists && !report.apm.lockExists
          ? 'not configured'
          : 'incomplete'
  const hasSkillsRegistryError = report.findings.some(finding =>
    finding.severity === 'error'
    && finding.code === 'invalid-skills-registry-lock',
  )
  const skillsRegistryState = hasSkillsRegistryError
    ? 'invalid'
    : report.skillsRegistry.lockExists
      ? 'ok'
      : 'not configured'
  const hasWorkstationError = report.findings.some(finding =>
    finding.severity === 'error'
    && (finding.code === 'invalid-workstation-skill-lock'
      || finding.code === 'missing-workstation-skill'
      || finding.code === 'modified-workstation-skill'),
  )
  const workstationState = hasWorkstationError
    ? 'invalid'
    : report.workstation.lockExists
      ? 'ok'
      : 'not configured'
  const lines = [
    'Skills audit',
    '',
    `APM: [${apmState}] ${report.apm.managedSkillCount} managed skill(s)`,
    `skills.sh: [${skillsRegistryState}] ${report.skillsRegistry.managedSkillCount} managed skill(s)`,
    `workstation: [${workstationState}] ${report.workstation.managedSkillCount} managed skill(s)`,
    '',
    'Roots:',
  ]
  for (const root of report.roots) {
    const state = root.exists ? 'ok' : 'missing'
    lines.push(`- [${state}] ${root.kind}: ${root.path} (${root.topLevelSkillCount} top-level, ${root.skillFileCount} total)`)
  }

  lines.push(
    '',
    `Metadata: ${report.summary.implicitSkillCount} implicit / ${report.summary.explicitOnlySkillCount} explicit-only, ${report.summary.implicitDescriptionCharacterCount} implicit description character(s), ${report.summary.descriptionCharacterCount} total, longest ${report.summary.longestDescriptionCharacterCount}`,
  )

  lines.push('', 'Findings:')
  if (report.findings.length === 0) {
    lines.push('- [ok] no findings')
  }
  else {
    for (const finding of report.findings)
      lines.push(`- [${finding.severity}] ${finding.code}: ${finding.message}`)
  }

  lines.push(
    '',
    `Summary: ${report.summary.topLevelSkillCount} top-level skills, ${report.summary.managedSharedSkillCount} managed shared, ${report.summary.unmanagedSharedSkillCount} unmanaged shared, ${report.summary.warningCount} warning(s), ${report.summary.errorCount} error(s)`,
  )
  return `${lines.join('\n')}\n`
}

export function runSkillsAudit(options: SkillsAuditOptions = {}): void {
  const report = auditSkills(options)
  if (options.json)
    console.log(JSON.stringify(report, null, 2))
  else
    process.stdout.write(formatSkillsAudit(report))

  if (options.check && report.summary.errorCount > 0)
    process.exitCode = 1
}

function discoverSkills(rootKind: SkillsRootKind, root: string): SkillsDiscoveryResult {
  if (!isDirectory(root))
    return { failures: [], skills: [] }

  const failures: SkillsDiscoveryResult['failures'] = []
  const skills: DiscoveredSkill[] = []
  const stack: Array<{ ancestors: Set<string>, depth: number, directory: string }> = [{ ancestors: new Set(), depth: 0, directory: root }]
  let discoveredEntryCount = 0
  while (stack.length > 0) {
    const next = stack.pop()
    if (!next)
      continue
    const current = next.directory
    let realCurrent: string
    try {
      realCurrent = fs.realpathSync(current)
    }
    catch (error) {
      failures.push({
        code: 'invalid-skill-symlink',
        error: error instanceof Error ? error.message.split('\n')[0] : String(error),
        path: current,
      })
      continue
    }
    if (next.ancestors.has(realCurrent)) {
      failures.push({
        code: 'invalid-skill-symlink',
        error: 'symbolic link cycle detected',
        path: current,
      })
      continue
    }
    const ancestors = new Set(next.ancestors).add(realCurrent)
    let directoryEntries: { entries: fs.Dirent[], exceeded: boolean }
    try {
      directoryEntries = readDirectoryEntries(current, MAX_SKILL_DISCOVERY_ENTRIES - discoveredEntryCount)
    }
    catch (error) {
      failures.push({
        code: 'unreadable-skill-directory',
        error: error instanceof Error ? error.message.split('\n')[0] : String(error),
        path: current,
      })
      continue
    }
    discoveredEntryCount += directoryEntries.entries.length
    if (directoryEntries.exceeded) {
      failures.push({
        code: 'skill-discovery-limit-exceeded',
        error: `more than ${MAX_SKILL_DISCOVERY_ENTRIES} directory entries under one discovery root`,
        path: current,
      })
      break
    }
    for (const entry of directoryEntries.entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (next.depth >= MAX_SKILL_DISCOVERY_DEPTH) {
          failures.push({
            code: 'skill-discovery-limit-exceeded',
            error: `directory depth exceeds ${MAX_SKILL_DISCOVERY_DEPTH}`,
            path: fullPath,
          })
        }
        else {
          stack.push({ ancestors, depth: next.depth + 1, directory: fullPath })
        }
      }
      else if (entry.isFile() && entry.name === 'SKILL.md') {
        addDiscoveredSkill(skills, rootKind, root, fullPath)
      }
      else if (entry.isSymbolicLink()) {
        try {
          const target = fs.statSync(fullPath)
          if (current === root) {
            if (!target.isDirectory() || !fs.statSync(path.join(fullPath, 'SKILL.md')).isFile())
              throw new Error('top-level symlink target must be a Skill directory containing SKILL.md')
            stack.push({ ancestors, depth: next.depth + 1, directory: fullPath })
          }
          else if (target.isFile() && entry.name === 'SKILL.md') {
            addDiscoveredSkill(skills, rootKind, root, fullPath)
          }
        }
        catch (error) {
          if (current === root || entry.name === 'SKILL.md') {
            failures.push({
              code: 'invalid-skill-symlink',
              error: error instanceof Error ? error.message.split('\n')[0] : String(error),
              path: fullPath,
            })
          }
        }
      }
    }
  }
  return {
    failures,
    skills: skills.sort((a, b) => a.path.localeCompare(b.path)),
  }
}

function readDirectoryEntries(directoryPath: string, limit: number): { entries: fs.Dirent[], exceeded: boolean } {
  const directory = fs.opendirSync(directoryPath)
  const entries: fs.Dirent[] = []
  let exceeded = false
  try {
    while (true) {
      const entry = directory.readSync()
      if (!entry)
        break
      if (entries.length >= limit) {
        exceeded = true
        break
      }
      entries.push(entry)
    }
  }
  finally {
    directory.closeSync()
  }
  return { entries, exceeded }
}

function addDiscoveredSkill(skills: DiscoveredSkill[], rootKind: SkillsRootKind, root: string, file: string): void {
  const metadata = skillMetadata(file)
  const openaiConfig = skillOpenAIConfig(file)
  skills.push({
    allowImplicitInvocation: openaiConfig.allowImplicitInvocation,
    bodyLineCount: metadata.bodyLineCount,
    descriptionCharacterCount: metadata.descriptionCharacterCount,
    frontmatterError: metadata.error,
    name: metadata.name,
    path: file,
    realPath: fs.realpathSync(file),
    rootKind,
    openaiConfigError: openaiConfig.error,
    openaiConfigPath: openaiConfig.path,
    topLevel: path.dirname(file) === path.join(root, path.basename(path.dirname(file))),
  })
}

function skillOpenAIConfig(skillFile: string): { allowImplicitInvocation: boolean, error?: string, path: string } {
  const configPath = path.join(path.dirname(skillFile), 'agents', 'openai.yaml')
  if (!fs.existsSync(configPath))
    return { allowImplicitInvocation: true, path: configPath }

  try {
    const config: unknown = parse(fs.readFileSync(configPath, 'utf8'))
    if (!isRecord(config))
      throw new Error('root must be a mapping')
    if (config.policy === undefined)
      return { allowImplicitInvocation: true, path: configPath }
    if (!isRecord(config.policy))
      throw new TypeError('policy must be a mapping')
    const value = config.policy.allow_implicit_invocation
    if (value === undefined)
      return { allowImplicitInvocation: true, path: configPath }
    if (typeof value !== 'boolean')
      throw new TypeError('policy.allow_implicit_invocation must be a boolean')
    return { allowImplicitInvocation: value, path: configPath }
  }
  catch (error) {
    return {
      allowImplicitInvocation: true,
      error: error instanceof Error ? error.message.split('\n')[0] : String(error),
      path: configPath,
    }
  }
}

function skillMetadata(file: string): { bodyLineCount: number, descriptionCharacterCount: number, error?: string, name: string } {
  const fallback = path.basename(path.dirname(file))
  try {
    const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')
    if (lines[0]?.trim() !== '---')
      return { bodyLineCount: 0, descriptionCharacterCount: 0, error: 'missing YAML frontmatter', name: fallback }
    const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    if (closing === -1)
      return { bodyLineCount: 0, descriptionCharacterCount: 0, error: 'unterminated YAML frontmatter', name: fallback }
    const frontmatter = parse(lines.slice(1, closing).join('\n'))
    if (!frontmatter || typeof frontmatter !== 'object')
      return { bodyLineCount: 0, descriptionCharacterCount: 0, error: 'frontmatter must be a mapping', name: fallback }
    const name = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : ''
    const description = typeof frontmatter.description === 'string' ? frontmatter.description.trim() : ''
    const bodyLineCount = lines.slice(closing + 1).length
    const descriptionCharacterCount = Array.from(description).length
    if (!name)
      return { bodyLineCount, descriptionCharacterCount, error: 'name is required', name: fallback }
    if (!description)
      return { bodyLineCount, descriptionCharacterCount, error: 'description is required', name }
    if (descriptionCharacterCount > MAX_SKILL_DESCRIPTION_CHARACTERS) {
      return {
        bodyLineCount,
        descriptionCharacterCount,
        error: `description exceeds the ${MAX_SKILL_DESCRIPTION_CHARACTERS}-character Codex limit`,
        name,
      }
    }
    return { bodyLineCount, descriptionCharacterCount, name }
  }
  catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
    return { bodyLineCount: 0, descriptionCharacterCount: 0, error: message, name: fallback }
  }
}

function apmManagedSkills(lockPath: string): {
  dependencyNames: Set<string>
  deployedFileHashes: Array<{ file: string, hash: string }>
  deployedFiles: string[]
  error?: string
  names: Set<string>
} {
  const dependencyNames = new Set<string>()
  const deployedFileHashes = new Map<string, string>()
  const deployedFiles = new Set<string>()
  const names = new Set<string>()
  try {
    if (!assertRegularControlFile(lockPath))
      return { dependencyNames, deployedFileHashes: [], deployedFiles: [], names }
    const lock: unknown = parse(fs.readFileSync(lockPath, 'utf8'))
    if (!isRecord(lock))
      throw new Error('root must be a mapping')
    if (typeof lock.lockfile_version !== 'string' && typeof lock.lockfile_version !== 'number')
      throw new TypeError('lockfile_version must be a string or number')
    if (!Array.isArray(lock.dependencies))
      throw new TypeError('dependencies must be an array')
    for (const [index, dependency] of lock.dependencies.entries()) {
      if (!isRecord(dependency))
        throw new TypeError(`dependencies[${index}] must be a mapping`)
      if (dependency.name !== undefined && (typeof dependency.name !== 'string' || !dependency.name.trim()))
        throw new TypeError(`dependencies[${index}].name must be a non-empty string when present`)
      if (typeof dependency.name === 'string')
        dependencyNames.add(dependency.name.trim())
      const files = dependency.deployed_files ?? []
      if (!Array.isArray(files) || files.some(file => typeof file !== 'string'))
        throw new TypeError(`dependencies[${index}].deployed_files must be an array of strings`)
      for (const file of files) {
        if (isSkillDeploymentPath(file))
          deployedFiles.add(file)
        const match = file.match(/^\.agents\/skills\/([^/]+)(?:\/SKILL\.md)?$/)
        if (match)
          names.add(match[1])
      }
      const hashes = dependency.deployed_file_hashes ?? {}
      if (!isRecord(hashes) || Object.values(hashes).some(hash => typeof hash !== 'string'))
        throw new TypeError(`dependencies[${index}].deployed_file_hashes must be a string mapping`)
      for (const [file, hash] of Object.entries(hashes)) {
        if (isSkillDeploymentPath(file))
          deployedFileHashes.set(file, hash as string)
      }
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
    return {
      dependencyNames,
      deployedFileHashes: [...deployedFileHashes].map(([file, hash]) => ({ file, hash })),
      deployedFiles: [...deployedFiles],
      error: message,
      names,
    }
  }
  return {
    dependencyNames,
    deployedFileHashes: [...deployedFileHashes].map(([file, hash]) => ({ file, hash })),
    deployedFiles: [...deployedFiles],
    names,
  }
}

function skillsRegistryManagedSkills(lockPath: string): { error?: string, names: Set<string> } {
  const names = new Set<string>()
  try {
    if (!assertRegularControlFile(lockPath))
      return { names }
    const lock: unknown = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    if (!isRecord(lock))
      throw new Error('root must be a mapping')
    if (!Number.isInteger(lock.version) || (lock.version as number) < 1)
      throw new TypeError('version must be a positive integer')
    if (!isRecord(lock.skills))
      throw new TypeError('skills must be a mapping')
    for (const [name, entry] of Object.entries(lock.skills)) {
      if (!isSafeSkillName(name))
        throw new TypeError(`skills key must be a safe directory name: ${name}`)
      if (!isRecord(entry))
        throw new TypeError(`skills.${name} must be a mapping`)
      for (const field of ['source', 'sourceType', 'sourceUrl'] as const) {
        if (typeof entry[field] !== 'string' || !entry[field].trim())
          throw new TypeError(`skills.${name}.${field} must be a non-empty string`)
      }
      if (typeof entry.skillFolderHash !== 'string')
        throw new TypeError(`skills.${name}.skillFolderHash must be a string`)
      if (entry.skillPath !== undefined && (typeof entry.skillPath !== 'string' || !entry.skillPath.trim()))
        throw new TypeError(`skills.${name}.skillPath must be a non-empty string when present`)
      names.add(name)
    }
  }
  catch (error) {
    return {
      error: error instanceof Error ? error.message.split('\n')[0] : String(error),
      names: new Set(),
    }
  }
  return { names }
}

function apmManifestData(manifestPath: string): { dependencies: Set<string>, error?: string } {
  const dependencies = new Set<string>()
  try {
    if (!assertRegularControlFile(manifestPath))
      return { dependencies }
    const manifest: unknown = parse(fs.readFileSync(manifestPath, 'utf8'))
    if (!isRecord(manifest))
      throw new Error('root must be a mapping')
    if (typeof manifest.name !== 'string' || !manifest.name.trim())
      throw new TypeError('name must be a non-empty string')
    if (typeof manifest.version !== 'string' || !manifest.version.trim())
      throw new TypeError('version must be a non-empty string')
    collectManifestDependencyAliases(manifest, 'dependencies', dependencies)
    collectManifestDependencyAliases(manifest, 'devDependencies', dependencies)
    return { dependencies }
  }
  catch (error) {
    return {
      dependencies,
      error: error instanceof Error ? error.message.split('\n')[0] : String(error),
    }
  }
}

function collectManifestDependencyAliases(manifest: Record<string, unknown>, field: 'dependencies' | 'devDependencies', aliases: Set<string>): void {
  const dependencyGroups = manifest[field] ?? {}
  if (!isRecord(dependencyGroups))
    throw new TypeError(`${field} must be a mapping`)
  const apmDependencies = dependencyGroups.apm ?? []
  if (!Array.isArray(apmDependencies))
    throw new TypeError(`${field}.apm must be an array`)
  for (const [index, dependency] of apmDependencies.entries()) {
    const location = `${field}.apm[${index}]`
    if (typeof dependency === 'string') {
      if (!dependency.trim())
        throw new TypeError(`${location} must be a non-empty string`)
      continue
    }
    if (!isRecord(dependency))
      throw new TypeError(`${location} must be a string or mapping`)
    if (dependency.alias !== undefined && typeof dependency.alias !== 'string')
      throw new TypeError(`${location}.alias must be a string`)
    if (typeof dependency.alias === 'string' && dependency.alias.trim())
      aliases.add(dependency.alias.trim())
  }
}

function isSkillDeploymentPath(file: string): boolean {
  return file === '.agents/skills' || file.startsWith('.agents/skills/')
}

function validatedDeployedPaths(home: string, files: string[]): {
  invalid: string[]
  valid: Map<string, string>
} {
  const sharedRoot = path.resolve(home, '.agents', 'skills')
  let realSharedRoot = sharedRoot
  try {
    realSharedRoot = fs.realpathSync(sharedRoot)
  }
  catch {
    // Missing roots are reported through deployed-file checks below.
  }
  const invalid = new Set<string>()
  const valid = new Map<string, string>()
  for (const file of new Set(files)) {
    const resolved = path.resolve(home, file)
    if (!isPathWithin(sharedRoot, resolved)) {
      invalid.add(file)
      continue
    }
    if (fs.existsSync(resolved)) {
      try {
        if (!isPathWithin(realSharedRoot, fs.realpathSync(resolved))) {
          invalid.add(file)
          continue
        }
      }
      catch {
        invalid.add(file)
        continue
      }
    }
    valid.set(file, resolved)
  }
  return { invalid: [...invalid].sort(), valid }
}

function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDirectory(directory: string): boolean {
  try {
    return fs.statSync(directory).isDirectory()
  }
  catch {
    return false
  }
}

function pathEntryExists(target: string): boolean {
  try {
    fs.lstatSync(target)
    return true
  }
  catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}

function assertRegularControlFile(target: string): boolean {
  let state: fs.Stats
  try {
    state = fs.lstatSync(target)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return false
    throw error
  }
  if (state.isSymbolicLink() || !state.isFile())
    throw new Error('control file must be a real file')
  return true
}
