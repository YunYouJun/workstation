#!/usr/bin/env node

import process from 'node:process'
import { getAuthStatus, login } from './auth.js'
import { clearCache } from './cache.js'
import { loadConfig } from './config.js'
import { deleteTask, listTaskLists, listTasks, updateTask } from './graph.js'

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function optionValue(args, name) {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

function requireApply(command, payload, args) {
  if (!args.includes('--apply')) {
    print({
      preview: true,
      command,
      payload,
      instruction: 'Add --apply after explicit user confirmation.',
    })
    return false
  }
  return true
}

async function main() {
  const config = loadConfig()
  const cliArgs = process.argv.slice(2)
  if (cliArgs[0] === '--')
    cliArgs.shift()
  const [command = 'help', ...args] = cliArgs

  if (command === 'auth') {
    await login(config, (response) => {
      process.stderr.write(`${response.message}\n`)
    })
    print({ authenticated: true, permission: config.scopes[0] })
    return
  }

  if (command === 'status') {
    print(await getAuthStatus(config))
    return
  }

  if (command === 'logout') {
    await clearCache(config.cachePath)
    print({ authenticated: false, cacheCleared: true })
    return
  }

  if (command === 'lists') {
    print(await listTaskLists(config))
    return
  }

  if (command === 'tasks') {
    const listId = args.find(arg => !arg.startsWith('--'))
    const includeBody = args.includes('--include-body')
    const openOnly = args.includes('--open')

    if (listId) {
      print(await listTasks(config, listId, { includeBody, openOnly }))
      return
    }

    const lists = await listTaskLists(config)
    const output = []
    for (const list of lists) {
      output.push({
        list,
        tasks: await listTasks(config, list.id, { includeBody, openOnly }),
      })
    }
    print(output)
    return
  }

  if (command === 'update' || command === 'complete') {
    const [listId, taskId] = args
    if (!listId || !taskId || listId.startsWith('--') || taskId.startsWith('--'))
      throw new Error(`${command} requires LIST_ID and TASK_ID as its first two arguments.`)

    const patch = command === 'complete' ? { status: 'completed' } : {}
    const title = optionValue(args, '--title')
    const importance = optionValue(args, '--importance')
    const status = optionValue(args, '--status')
    const due = optionValue(args, '--due')

    if (title !== undefined)
      patch.title = title
    if (importance !== undefined)
      patch.importance = importance
    if (status !== undefined)
      patch.status = status
    if (due !== undefined) {
      patch.dueDateTime = {
        dateTime: `${due}T00:00:00.0000000`,
        timeZone: 'Asia/Shanghai',
      }
    }
    if (args.includes('--clear-due'))
      patch.dueDateTime = null

    if (Object.keys(patch).length === 0)
      throw new Error('No update fields supplied.')
    if (!requireApply(command, { listId, taskId, patch }, args))
      return

    const updated = await updateTask(config, listId, taskId, patch)
    print({ updated: true, task: updated })
    return
  }

  if (command === 'delete') {
    const [listId, taskId] = args
    const confirmedId = optionValue(args, '--confirm-id')
    if (!listId || !taskId || listId.startsWith('--') || taskId.startsWith('--'))
      throw new Error('delete requires LIST_ID and TASK_ID as its first two arguments.')
    if (!requireApply('delete', { listId, taskId }, args))
      return
    if (confirmedId !== taskId)
      throw new Error('Deletion blocked: --confirm-id must exactly match TASK_ID.')

    print(await deleteTask(config, listId, taskId))
    return
  }

  process.stdout.write('Microsoft To Do Graph client\n\n')
  process.stdout.write('  pnpm todo:auth                   Sign in with Tasks.ReadWrite\n')
  process.stdout.write('  pnpm todo:status                 Show local auth status\n')
  process.stdout.write('  pnpm todo:lists                  List To Do lists\n')
  process.stdout.write('  pnpm todo:tasks -- [listId]      List tasks\n')
  process.stdout.write('  pnpm todo:tasks -- --open        List incomplete tasks from every list\n')
  process.stdout.write('  pnpm todo -- logout              Clear the local token cache\n')
  process.stdout.write(
    '  MS_TODO_WRITE=1 pnpm todo -- update LIST_ID TASK_ID [fields] [--apply]\n',
  )
  process.stdout.write(
    '  MS_TODO_WRITE=1 pnpm todo -- complete LIST_ID TASK_ID [--apply]\n',
  )
  process.stdout.write(
    '  MS_TODO_WRITE=1 MS_TODO_ALLOW_DELETE=1 pnpm todo -- delete LIST_ID TASK_ID --confirm-id TASK_ID --apply\n',
  )
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`)
  process.exitCode = 1
})
