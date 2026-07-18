import type { PrivateManifest, PrivateSkill } from './types'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { getHomeDir } from '../config'
import { assertAllowedRead, privateSkillInstalls } from './manifest'
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

function skillName(skill: PrivateSkill): string {
  const name = skill.targetName || skill.id
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\'))
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
    return {
      ...skill,
      source: {
        ...skill.source,
        path: resolveRepoPath(repoRoot, skill.source.path),
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

function updateDirectoryDigest(hash: ReturnType<typeof createHash>, root: string, relative = ''): void {
  const current = path.join(root, relative)
  const entries = fs.readdirSync(current, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))

  for (const entry of entries) {
    const entryRelative = path.join(relative, entry.name)
    const entryPath = path.join(root, entryRelative)
    hash.update(entryRelative)

    if (entry.isDirectory()) {
      hash.update('directory')
      updateDirectoryDigest(hash, root, entryRelative)
    }
    else if (entry.isSymbolicLink()) {
      hash.update('symlink')
      hash.update(fs.readlinkSync(entryPath))
    }
    else {
      hash.update('file')
      hash.update(fs.readFileSync(entryPath))
    }
  }
}

function directoryDigest(root: string): string {
  const hash = createHash('sha256')
  updateDirectoryDigest(hash, root)
  return hash.digest('hex')
}

function replaceSkillDirectory(source: string, destination: string, id: string): void {
  if (!fs.existsSync(path.join(source, 'SKILL.md')))
    throw new Error(`SKILL.md not found for private skill ${id}: ${source}`)

  if (fs.existsSync(destination) && directoryDigest(source) === directoryDigest(destination)) {
    console.log(`[skip] private skill ${id} is already up to date`)
    return
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true })
  const backup = fs.existsSync(destination)
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

function installSkill(skill: ResolvedPrivateSkill, destinationRoot: string, dryRun: boolean): void {
  const destination = path.join(destinationRoot, skillName(skill))
  console.log(`${dryRun ? '[dry-run]' : '[apply]'} private skill ${skill.id} -> ${destination}`)
  if (dryRun)
    return

  if (skill.source.type === 'local') {
    if (!skill.source.path)
      throw new Error(`Local private skill ${skill.id} has no source.path`)
    replaceSkillDirectory(skill.source.path, destination, skill.id)
    return
  }

  if (skill.source.type !== 'github')
    throw new Error(`Unsupported private skill source type for ${skill.id}: ${skill.source.type}`)

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workstation-private-skill-'))
  const repoDir = path.join(tempDir, 'repo')
  const ref = skill.source.ref || 'main'
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
    if (!skill.source.path)
      throw new Error(`GitHub private skill ${skill.id} has no source.path`)
    run('git', ['-C', repoDir, 'sparse-checkout', 'set', skill.source.path])
    replaceSkillDirectory(path.join(repoDir, skill.source.path), destination, skill.id)
  }
  finally {
    fs.rmSync(tempDir, { force: true, recursive: true })
  }
}

export function applyPrivateCodexSkills(manifestPath: string, manifest: PrivateManifest, dryRun: boolean): void {
  const skills = resolveSkills(manifestPath, manifest)
  if (skills.length === 0) {
    console.log('[skip] no private Codex skill installs')
    return
  }

  const names = new Set<string>()
  for (const skill of skills) {
    const name = skillName(skill)
    if (names.has(name))
      throw new Error(`Duplicate private skill target: ${name}`)
    names.add(name)
    installSkill(skill, skillsRoot(), dryRun)
  }
}
