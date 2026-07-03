import type { CommandResult } from './types'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export function commandExists(command: string): boolean {
  const pathEnv = process.env.PATH || ''
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : ['']

  return pathEnv.split(path.delimiter).some((directory) => {
    if (!directory)
      return false

    return extensions.some((extension) => {
      const candidate = path.join(directory, process.platform === 'win32' ? `${command}${extension}` : command)

      try {
        fs.accessSync(candidate, fs.constants.X_OK)
        return true
      }
      catch {
        return false
      }
    })
  })
}

export function commandOutput(command: string, args: string[], cwd?: string): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return {
    status: result.status ?? 1,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  }
}

export function formatCommand(command: string, args: string[]): string {
  return [command, ...args]
    .map(value => /\s/.test(value) ? JSON.stringify(value) : value)
    .join(' ')
}
