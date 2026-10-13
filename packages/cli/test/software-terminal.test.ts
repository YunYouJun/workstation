import { spawn } from 'node:child_process'
import process from 'node:process'
import { expect, it, vi } from 'vitest'

it.skipIf(process.platform !== 'darwin')('releases the output terminal even if the owning worker crashes before recording its PIDs', async () => {
  const module = new URL('../src/software/terminal-output.ts', import.meta.url).href
  const owner = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', `
    const { terminalOutput } = await import(${JSON.stringify(module)})
    const terminal = await terminalOutput(process.env)
    process.stdout.write(JSON.stringify(terminal?.pids) + '\\n')
    setInterval(() => {}, 1000)
  `], { shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  owner.stdout.setEncoding('utf8').on('data', chunk => output += chunk)
  owner.stderr.resume()
  let pids: number[] = []
  try {
    await vi.waitFor(() => expect(output).toContain('\n'), { timeout: 5000 })
    pids = JSON.parse(output)
    expect(pids).toHaveLength(2)
    owner.kill('SIGKILL')
    await vi.waitFor(() => {
      for (const pid of pids)
        expect(() => process.kill(pid, 0)).toThrow()
    }, { timeout: 5000 })
  }
  finally {
    for (const pid of [owner.pid, ...pids]) {
      if (pid) {
        try {
          process.kill(-pid, 'SIGKILL')
        }
        catch { /* Already exited. */ }
      }
    }
  }
}, 12000)
