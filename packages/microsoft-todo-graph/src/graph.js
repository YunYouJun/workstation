import { getAccessToken } from './auth.js'

export function normalizeAllowedUrl(config, url) {
  const base = new URL(config.graphBase)
  const parsed = url.startsWith('http')
    ? new URL(url)
    : new URL(`${config.graphBase}${url.startsWith('/') ? '' : '/'}${url}`)
  const allowedPrefix = `${base.pathname.replace(/\/$/, '')}/me/todo/`

  if (parsed.origin !== base.origin || !parsed.pathname.startsWith(allowedPrefix))
    throw new Error(`Blocked Graph URL outside /me/todo: ${parsed.pathname}`)

  return parsed.toString()
}

export async function graphRequest(config, pathOrUrl, { method = 'GET', body } = {}) {
  const url = normalizeAllowedUrl(config, pathOrUrl)
  if (method !== 'GET' && !config.writeEnabled) {
    throw new Error(
      'Write operation blocked. Set MS_TODO_WRITE=1 for an explicitly authorized write command.',
    )
  }
  if (method === 'DELETE' && !config.deleteEnabled) {
    throw new Error(
      'Delete operation blocked. Set MS_TODO_ALLOW_DELETE=1 only for an explicitly confirmed deletion.',
    )
  }

  const token = await getAccessToken(config)
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })

  const text = await response.text()
  let responseBody
  try {
    responseBody = text ? JSON.parse(text) : undefined
  }
  catch {
    responseBody = undefined
  }

  if (!response.ok) {
    const message
      = responseBody?.error?.message || `Microsoft Graph returned HTTP ${response.status}`
    throw new Error(message)
  }
  return responseBody
}

export async function graphGet(config, pathOrUrl) {
  return graphRequest(config, pathOrUrl)
}

export async function collectPages(config, firstPath) {
  const items = []
  let next = firstPath

  while (next && items.length < config.maxItems) {
    const page = await graphGet(config, next)
    items.push(...(page?.value || []))
    next = page?.['@odata.nextLink']
  }

  return items.slice(0, config.maxItems)
}

export async function listTaskLists(config) {
  const lists = await collectPages(config, '/me/todo/lists?$top=100')
  return lists.map(({ id, displayName, isOwner, isShared, wellknownListName }) => ({
    id,
    displayName,
    isOwner,
    isShared,
    wellknownListName,
  }))
}

export async function listTasks(config, listId, { includeBody = false, openOnly = false } = {}) {
  const query = new URLSearchParams({ $top: '100' })
  if (openOnly)
    query.set('$filter', 'status ne \'completed\'')

  const path = `/me/todo/lists/${encodeURIComponent(listId)}/tasks?${query}`
  const tasks = await collectPages(config, path)

  return tasks.map(task => ({
    id: task.id,
    title: task.title,
    status: task.status,
    importance: task.importance,
    dueDateTime: task.dueDateTime,
    reminderDateTime: task.reminderDateTime,
    createdDateTime: task.createdDateTime,
    lastModifiedDateTime: task.lastModifiedDateTime,
    ...(includeBody ? { body: task.body } : {}),
  }))
}

export async function updateTask(config, listId, taskId, patch) {
  return graphRequest(
    config,
    `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: 'PATCH', body: patch },
  )
}

export async function deleteTask(config, listId, taskId) {
  await graphRequest(
    config,
    `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: 'DELETE' },
  )
  return { deleted: true, taskId }
}
