import assert from 'node:assert/strict'
import { it } from 'vitest'
import { normalizeAllowedUrl } from '../src/graph.js'

const config = {
  graphBase: 'https://graph.microsoft.com/v1.0',
}

it('normalizes an allowed relative To Do path without dropping v1.0', () => {
  assert.equal(
    normalizeAllowedUrl(config, '/me/todo/lists?$top=100'),
    'https://graph.microsoft.com/v1.0/me/todo/lists?$top=100',
  )
})

it('accepts Graph pagination URLs under the To Do boundary', () => {
  assert.equal(
    normalizeAllowedUrl(
      config,
      'https://graph.microsoft.com/v1.0/me/todo/lists/list-1/tasks?$skiptoken=abc',
    ),
    'https://graph.microsoft.com/v1.0/me/todo/lists/list-1/tasks?$skiptoken=abc',
  )
})

it('rejects other Graph resources and non-Microsoft origins', () => {
  assert.throws(() => normalizeAllowedUrl(config, '/me/messages'))
  assert.throws(() =>
    normalizeAllowedUrl(config, 'https://example.com/v1.0/me/todo/lists'),
  )
})
