#!/usr/bin/env node
import type { CodexSkill } from '../codex-skills.config'
import type { PrivateManifest } from '../packages/cli/src/private/types'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { assertAllowedRead, privateSkillInstalls, readPrivateManifest } from '../packages/cli/src/private/manifest'
import { expandHome, repoRootFromManifest, resolveRepoPath } from '../packages/cli/src/private/paths'

interface Options {
  dest: string
  dryRun: boolean
  force: boolean
  manifest: string
  privateManifest?: string
  selectedIds: Set<string> | null
}

type Command = 'check' | 'install' | 'list' | 'status'

const helpFlags = new Set(['--help', '-h'])
const defaultRef = 'main'

function usage(exitCode = 0): never {
  console.log(`Usage:
  pnpm skills:list
  pnpm skills:status
  pnpm skills:check
  pnpm skills:install [--skill <id>] [--force] [--dry-run] [--manifest <path>] [--dest <path>] [--private-manifest <path>]

Examples:
  pnpm skills:status
  pnpm skills:install
  pnpm skills:install --skill ui-ux-pro-max --force
  pnpm skills:install --private-manifest ~/repos/private/dotfiles/config/sync-manifest.json`)
  process.exit(exitCode)
}

function codexSkillsRoot(): string {
  return process.env.CODEX_HOME
    ? resolve(process.env.CODEX_HOME, 'skills')
    : resolve(homedir(), '.codex', 'skills')
}

function defaultManifestPath(): string {
  return resolve(import.meta.dirname, '..', 'config', 'codex-tools.manifest.json')
}

function defaultPrivateManifestPath(): string | undefined {
  return process.env.WORKSTATION_PRIVATE_MANIFEST
    ? resolve(expandHome(process.env.WORKSTATION_PRIVATE_MANIFEST))
    : undefined
}

function parseCommand(value: string | undefined): Command {
  if (!value || value.startsWith('-'))
    return 'status'

  if (['check', 'install', 'list', 'status'].includes(value))
    return value as Command

  console.error(`Unknown skills command: ${value}`)
  usage(1)
}

function parseSelectedIds(value: string): string[] {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    dest: codexSkillsRoot(),
    dryRun: false,
    force: false,
    manifest: defaultManifestPath(),
    privateManifest: defaultPrivateManifestPath(),
    selectedIds: null,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (helpFlags.has(arg))
      usage()

    if (arg === '--') {
      continue
    }
    else if (arg === '--dry-run') {
      options.dryRun = true
    }
    else if (arg === '--force') {
      options.force = true
    }
    else if (arg === '--dest') {
      const value = args[index + 1]
      if (!value) {
        console.error('--dest requires a path')
        usage(1)
      }
      options.dest = resolve(value)
      index += 1
    }
    else if (arg === '--manifest') {
      const value = args[index + 1]
      if (!value) {
        console.error('--manifest requires a path')
        usage(1)
      }
      options.manifest = resolve(expandHome(value))
      index += 1
    }
    else if (arg === '--private-manifest') {
      const value = args[index + 1]
      if (!value) {
        console.error('--private-manifest requires a path')
        usage(1)
      }
      options.privateManifest = resolve(expandHome(value))
      index += 1
    }
    else if (arg === '--skill') {
      const value = args[index + 1]
      if (!value) {
        console.error('--skill requires an id')
        usage(1)
      }

      options.selectedIds ||= new Set<string>()
      for (const id of parseSelectedIds(value))
        options.selectedIds.add(id)

      index += 1
    }
    else {
      console.error(`Unknown option: ${arg}`)
      usage(1)
    }
  }

  return options
}

function selectedSkills(skills: CodexSkill[], options: Options): CodexSkill[] {
  if (!options.selectedIds)
    return skills

  const selected = skills.filter(skill => options.selectedIds?.has(skill.id))
  const missing = [...options.selectedIds].filter(id => !skills.some(skill => skill.id === id))

  if (missing.length > 0) {
    console.error(`Unknown skill id: ${missing.join(', ')}`)
    process.exit(1)
  }

  return selected
}

function readManifest(path: string): PrivateManifest {
  if (!existsSync(path))
    throw new Error(`Codex tools manifest not found: ${path}`)

  return JSON.parse(readFileSync(path, 'utf-8')) as PrivateManifest
}

function publicSkills(manifestPath: string): CodexSkill[] {
  return (readManifest(manifestPath).skills?.install || []) as CodexSkill[]
}

function privateSkills(manifestPath: string | undefined): CodexSkill[] {
  if (!manifestPath)
    return []

  const manifest = readPrivateManifest(manifestPath)
  const repoRoot = repoRootFromManifest(manifestPath)

  return (privateSkillInstalls(manifest) as CodexSkill[]).map((skill) => {
    if (skill.source.type !== 'local')
      return skill

    assertAllowedRead(skill.source.path, manifest.workstationOverlay || {})

    return {
      ...skill,
      source: {
        ...skill.source,
        path: resolveRepoPath(repoRoot, skill.source.path),
      },
    }
  })
}

function allSkills(options: Options): CodexSkill[] {
  const skills = [...publicSkills(options.manifest), ...privateSkills(options.privateManifest)]
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const skill of skills) {
    if (seen.has(skill.id))
      duplicates.add(skill.id)
    seen.add(skill.id)
  }

  if (duplicates.size > 0)
    throw new Error(`Duplicate skill id: ${[...duplicates].join(', ')}`)

  return skills
}

function skillName(skill: CodexSkill): string {
  const name = skill.targetName || skill.id

  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\'))
    throw new Error(`Invalid skill name for ${skill.id}: ${name}`)

  return name
}

function skillDestination(skill: CodexSkill, destRoot: string): string {
  return join(destRoot, skillName(skill))
}

function isInstalled(skill: CodexSkill, destRoot: string): boolean {
  return existsSync(join(skillDestination(skill, destRoot), 'SKILL.md'))
}

function repoUrl(skill: CodexSkill): string {
  if (skill.source.type !== 'github')
    throw new Error(`Unsupported source type for ${skill.id}: ${skill.source.type}`)

  if (skill.source.repo.includes('://') || skill.source.repo.startsWith('git@'))
    return skill.source.repo

  return `https://github.com/${skill.source.repo}.git`
}

function copySkillDirectory(source: string, destination: string, name: string): void {
  if (!existsSync(join(source, 'SKILL.md')))
    throw new Error(`SKILL.md not found in ${source}`)

  let backup: string | null = null
  if (existsSync(destination)) {
    backup = `${destination}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
    renameSync(destination, backup)
  }

  try {
    cpSync(source, destination, { recursive: true })
  }
  catch (error) {
    if (backup && !existsSync(destination))
      renameSync(backup, destination)
    throw error
  }

  const backupSuffix = backup ? ` (previous copy moved to ${backup})` : ''
  console.log(`[ok] installed ${name}${backupSuffix}`)
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

function installSkill(skill: CodexSkill, options: Options): void {
  const name = skillName(skill)
  const destination = skillDestination(skill, options.dest)

  if (existsSync(destination) && !options.force) {
    console.log(`[skip] ${skill.id} already exists at ${destination}`)
    return
  }

  console.log(`${options.dryRun ? '[dry-run]' : '[install]'} ${skill.id} -> ${destination}`)

  if (options.dryRun)
    return

  mkdirSync(options.dest, { recursive: true })

  if (skill.source.type === 'local') {
    copySkillDirectory(skill.source.path, destination, name)
    return
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'workstation-codex-skill-'))
  const repoDir = join(tempDir, 'repo')
  const ref = skill.source.ref || defaultRef

  try {
    run('git', [
      'clone',
      '--filter=blob:none',
      '--depth',
      '1',
      '--sparse',
      '--single-branch',
      '--branch',
      ref,
      repoUrl(skill),
      repoDir,
    ])
    run('git', ['-C', repoDir, 'sparse-checkout', 'set', skill.source.path])
    run('git', ['-C', repoDir, 'checkout', ref])

    const source = join(repoDir, skill.source.path)
    copySkillDirectory(source, destination, name)
  }
  finally {
    rmSync(tempDir, { force: true, recursive: true })
  }
}

function listSkills(skills: CodexSkill[]): void {
  for (const skill of skills) {
    console.log(`${skill.id}`)
    console.log(`  description: ${skill.description}`)
    console.log(`  target:      ${skillName(skill)}`)
    if (skill.source.type === 'github') {
      const ref = skill.source.ref || defaultRef
      console.log(`  source:      ${skill.source.repo}@${ref}:${skill.source.path}`)
    }
    else {
      console.log(`  source:      local:${skill.source.path}`)
    }
  }
}

function statusSkills(skills: CodexSkill[], destRoot: string, check: boolean): void {
  let missing = 0

  for (const skill of skills) {
    const state = isInstalled(skill, destRoot) ? 'installed' : 'missing'
    if (state === 'missing')
      missing += 1

    console.log(`[${state}] ${skill.id} -> ${skillDestination(skill, destRoot)}`)
  }

  console.log(`\nDestination: ${destRoot}`)

  if (check && missing > 0)
    process.exitCode = 1
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2])
  const optionArgs = process.argv[2]?.startsWith('-')
    ? process.argv.slice(2)
    : process.argv.slice(3)
  const options = parseOptions(optionArgs)
  const skills = selectedSkills(allSkills(options), options)

  if (command === 'list') {
    listSkills(skills)
  }
  else if (command === 'install') {
    for (const skill of skills)
      installSkill(skill, options)
  }
  else {
    statusSkills(skills, options.dest, command === 'check')
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
