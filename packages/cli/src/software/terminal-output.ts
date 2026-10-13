import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, constants, openSync, writeSync } from 'node:fs'
import process from 'node:process'
import { PassThrough } from 'node:stream'

// Only the output uses a terminal. The actual installer remains a direct, detached child
// of our worker, so cancellation still owns and kills its entire process group.
const holder = `
const { execFileSync } = require('node:child_process')
execFileSync('/bin/stty', ['cols', '180', 'rows', '24'], { stdio: 'inherit' })
const tty = execFileSync('/usr/bin/tty', [], { stdio: ['inherit', 'pipe', 'inherit'] }).toString().trim()
process.stdin.setRawMode(true)
process.stdout.write('workstation-terminal:' + JSON.stringify({ tty, pid: process.pid }) + '\\n')
process.stdin.resume()
setInterval(() => {
  try { process.kill(Number(process.argv[1]), 0) }
  catch { process.exit() }
}, 1000)
`

/** macOS terminal capture, with no shell or interactive input forwarded to the installer. */
export async function terminalOutput(environment: NodeJS.ProcessEnv): Promise<{
  fd: number
  pids: number[]
  output: PassThrough
  close: () => Promise<void>
} | undefined> {
  if (process.platform !== 'darwin')
    return undefined
  const child = spawn('/usr/bin/script', ['-q', '-F', '/dev/null', process.execPath, '-e', holder, String(process.pid)], {
    shell: false,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...environment, TERM: 'xterm-256color', COLUMNS: '180', LINES: '24' },
  })
  const pids = child.pid ? [child.pid] : []
  const stop = () => {
    for (const pid of pids) {
      try {
        process.kill(-pid, 'SIGKILL')
      }
      catch { /* Already exited. */ }
    }
    child.stdout.destroy()
    child.stderr.destroy()
  }
  let pending = ''
  const output = new PassThrough()
  const marker = `workstation-drain-${randomUUID()}`
  let drained: (() => void) | undefined
  const ready = await new Promise<{ tty: string, pid: number } | undefined>((resolve) => {
    const timeout = setTimeout(resolve, 3000, undefined)
    const finish = (value?: { tty: string, pid: number }) => {
      clearTimeout(timeout)
      resolve(value)
    }
    child.once('error', () => finish())
    child.once('exit', () => finish())
    const receive = (chunk: string) => {
      pending += chunk
      const newline = pending.indexOf('\n')
      if (newline === -1) {
        if (pending.length > 1024)
          finish()
        return
      }
      child.stdout.off('data', receive)
      try {
        const value = JSON.parse(pending.slice(pending.indexOf('workstation-terminal:') + 'workstation-terminal:'.length, newline)) as { tty: string, pid: number }
        if (!/^\/dev\/ttys[a-zA-Z0-9]+$/.test(value.tty) || !Number.isSafeInteger(value.pid) || value.pid <= 1)
          return finish()
        pids.push(value.pid)
        pending = pending.slice(newline + 1)
        child.stdout.on('data', (text: string) => {
          pending += text
          const end = pending.indexOf(marker)
          if (end !== -1) {
            output.write(pending.slice(0, end))
            pending = ''
            drained?.()
          }
          else {
            // Retain a possible partial drain marker across stream chunks.
            let keep = 0
            for (let length = 1; length < marker.length; length++) {
              if (pending.endsWith(marker.slice(0, length)))
                keep = length
            }
            output.write(keep ? pending.slice(0, -keep) : pending)
            pending = keep ? pending.slice(-keep) : ''
          }
        })
        finish(value)
      }
      catch { finish() }
    }
    child.stdout.setEncoding('utf8').on('data', receive)
    child.stderr.resume()
  })
  if (!ready) {
    stop()
    return undefined
  }
  let fd: number
  try {
    fd = openSync(ready.tty, constants.O_WRONLY | constants.O_NOCTTY)
  }
  catch {
    stop()
    return undefined
  }
  return {
    fd,
    pids,
    output,
    close: async () => {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 500)
        drained = () => {
          clearTimeout(timeout)
          resolve()
        }
        try {
          writeSync(fd, `\n${marker}\n`)
        }
        catch { drained() }
      })
      closeSync(fd)
      stop()
      output.end()
    },
  }
}
