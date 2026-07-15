import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'

const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url))

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

it('update without --apply only returns a preview', () => {
  const result = runCli(
    ['update', 'list-1', 'task-1', '--title', 'New title'],
    { MS_TODO_WRITE: '1' },
  )
  assert.equal(result.status, 0)
  const output = JSON.parse(result.stdout)
  assert.equal(output.preview, true)
  assert.equal(output.payload.patch.title, 'New title')
})

it('accepts a pnpm argument separator before the command', () => {
  const result = runCli(
    ['--', 'update', 'list-1', 'task-1', '--title', 'New title'],
    { MS_TODO_WRITE: '1' },
  )
  assert.equal(result.status, 0)
  const output = JSON.parse(result.stdout)
  assert.equal(output.command, 'update')
  assert.equal(output.preview, true)
})

it('delete requires an exact task ID confirmation', () => {
  const result = runCli(
    ['delete', 'list-1', 'task-1', '--confirm-id', 'task-2', '--apply'],
    { MS_TODO_WRITE: '1', MS_TODO_ALLOW_DELETE: '1' },
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /--confirm-id must exactly match TASK_ID/)
})
