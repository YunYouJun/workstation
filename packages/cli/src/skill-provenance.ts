import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export type WorkstationSkillRoot = 'codex' | 'shared'

export interface WorkstationSkillLockEntry {
  digest: string
  root: WorkstationSkillRoot
}

export interface WorkstationSkillLock {
  skills: Record<string, WorkstationSkillLockEntry>
  version: 1
}

const MAX_DIGEST_DEPTH = 32
const MAX_DIGEST_ENTRIES = 10_000

export function workstationSkillLockPath(home: string): string {
  return path.join(home, '.agents', '.wst-skill-lock.json')
}

export function skillDirectoryDigest(root: string, options: { rejectSymlinks?: boolean } = {}): string {
  const hash = createHash('sha256')
  hash.update('workstation-skill-directory-v1\0')
  const stack: Array<{ directory: string, depth: number, relative: string }> = [
    { directory: root, depth: 0, relative: '' },
  ]
  let entryCount = 0

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current)
      continue
    if (current.depth > MAX_DIGEST_DEPTH)
      throw new Error(`Skill directory exceeds ${MAX_DIGEST_DEPTH} levels: ${root}`)

    const entries = fs.readdirSync(current.directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
    entryCount += entries.length
    if (entryCount > MAX_DIGEST_ENTRIES)
      throw new Error(`Skill directory exceeds ${MAX_DIGEST_ENTRIES} entries: ${root}`)

    const childDirectories: Array<{ directory: string, depth: number, relative: string }> = []
    for (const entry of entries) {
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name
      const entryPath = path.join(current.directory, entry.name)
      updateDigestField(hash, 'path', relative)

      if (entry.isDirectory()) {
        updateDigestField(hash, 'type', 'directory')
        childDirectories.push({ directory: entryPath, depth: current.depth + 1, relative })
      }
      else if (entry.isFile()) {
        updateDigestField(hash, 'type', 'file')
        updateDigestField(hash, 'content', fs.readFileSync(entryPath))
      }
      else if (entry.isSymbolicLink()) {
        if (options.rejectSymlinks)
          throw new Error(`Skill source must not contain symbolic links: ${entryPath}`)
        updateDigestField(hash, 'type', 'symlink')
        updateDigestField(hash, 'target', fs.readlinkSync(entryPath))
      }
      else {
        throw new Error(`Unsupported Skill directory entry: ${entryPath}`)
      }
    }
    stack.push(...childDirectories.reverse())
  }

  return `sha256:${hash.digest('hex')}`
}

export function readWorkstationSkillLock(lockPath: string): {
  error?: string
  exists: boolean
  lock: WorkstationSkillLock
} {
  const empty: WorkstationSkillLock = { skills: {}, version: 1 }
  try {
    const state = fs.lstatSync(lockPath)
    if (state.isSymbolicLink() || !state.isFile())
      throw new Error('lock must be a real file')
    const value: unknown = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    if (!isRecord(value))
      throw new Error('root must be a mapping')
    if (value.version !== 1)
      throw new Error('version must be 1')
    if (!isRecord(value.skills))
      throw new Error('skills must be a mapping')

    const skills: Record<string, WorkstationSkillLockEntry> = {}
    for (const [name, entry] of Object.entries(value.skills)) {
      if (!isSafeSkillName(name))
        throw new Error(`skills key must be a safe directory name: ${name}`)
      if (!isRecord(entry))
        throw new Error(`skills.${name} must be a mapping`)
      if (entry.root !== 'shared' && entry.root !== 'codex')
        throw new Error(`skills.${name}.root must be shared or codex`)
      if (typeof entry.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(entry.digest))
        throw new Error(`skills.${name}.digest must be a SHA-256 digest`)
      skills[name] = { digest: entry.digest, root: entry.root }
    }
    return { exists: true, lock: { skills, version: 1 } }
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { exists: false, lock: empty }
    return {
      error: error instanceof Error ? error.message.split('\n')[0] : String(error),
      exists: true,
      lock: empty,
    }
  }
}

export function isSafeSkillName(name: string): boolean {
  return Boolean(
    name
    && name === name.trim()
    && name !== '.'
    && name !== '..'
    && !name.includes('/')
    && !name.includes('\\')
    && !Array.from(name).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 31 || codePoint === 127
    }),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function updateDigestField(
  hash: ReturnType<typeof createHash>,
  tag: string,
  value: Buffer | string,
): void {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value
  const length = Buffer.allocUnsafe(8)
  length.writeBigUInt64BE(BigInt(bytes.byteLength))
  hash.update(tag)
  hash.update('\0')
  hash.update(length)
  hash.update(bytes)
}
