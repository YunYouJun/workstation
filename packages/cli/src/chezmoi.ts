import type { StdioOptions } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import consola from 'consola'
import { getRepoRoot } from './config'

export function spawnChezmoi(args: string[], stdio: StdioOptions = 'inherit') {
  return spawnSync('chezmoi', ['--source', getRepoRoot(), ...args], { stdio })
}

export function isChezmoiMissing(error: Error | undefined) {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

export function runChezmoi(args: string[]) {
  const result = spawnChezmoi(args)
  if (result.error) {
    if (isChezmoiMissing(result.error)) {
      consola.error('chezmoi is not installed. Install it first, then run this command again.')
      process.exit(127)
    }

    consola.error(result.error.message)
    process.exit(1)
  }

  if (typeof result.status === 'number')
    process.exit(result.status)

  if (result.signal) {
    consola.error(`chezmoi exited with signal ${result.signal}`)
    process.exit(1)
  }
}
