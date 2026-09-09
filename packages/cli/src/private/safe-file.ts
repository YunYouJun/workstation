import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getHomeDir } from '../config'

export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function localStatePath(destination: string): string {
  return path.join(getHomeDir(), '.local', 'state', 'workstation', 'private', contentHash(path.resolve(destination)))
}

export function withFileLock<T>(destination: string, dryRun: boolean, operation: () => T): T {
  if (dryRun)
    return operation()
  const directory = localStatePath(destination)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const lock = path.join(directory, 'lock')
  let fd: number
  try {
    fd = fs.openSync(lock, 'wx', 0o600)
  }
  catch {
    throw new Error(`Operation locked: ${lock}. If a previous process crashed, verify it has stopped before removing the lock.`)
  }
  try {
    return operation()
  }
  finally {
    fs.closeSync(fd)
    fs.unlinkSync(lock)
  }
}

export function atomicWrite(destination: string, content: string, expected?: string): void {
  if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink())
    throw new Error(`Refusing to replace a symbolic link: ${destination}`)
  const current = fs.existsSync(destination) ? fs.readFileSync(destination, 'utf8') : ''
  if (expected !== undefined && current !== expected)
    throw new Error(`File changed during planning: ${destination}`)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  if (fs.existsSync(destination)) {
    const directory = localStatePath(destination)
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    const backup = path.join(directory, `backup.${randomUUID()}`)
    fs.writeFileSync(backup, current, { mode: 0o600, flag: 'wx' })
    console.log(`[backup] ${backup}`)
  }
  const temporary = `${destination}.tmp.${randomUUID()}`
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' })
    fs.renameSync(temporary, destination)
  }
  finally {
    fs.rmSync(temporary, { force: true })
  }
}
