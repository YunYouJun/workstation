import assert from 'node:assert/strict'
import { it } from 'vitest'
import { DEFAULT_CLIENT_ID, loadConfig } from '../src/config.js'

it('defaults to read-only Tasks.Read and the common authority', () => {
  const config = loadConfig({})
  assert.deepEqual(config.scopes, ['Tasks.Read'])
  assert.equal(config.writeEnabled, false)
  assert.equal(config.deleteEnabled, false)
  assert.equal(config.clientId, DEFAULT_CLIENT_ID)
  assert.equal(config.authority, 'https://login.microsoftonline.com/common')
})

it('write and delete capabilities require separate explicit switches', () => {
  const writeOnly = loadConfig({ MS_TODO_WRITE: '1' })
  assert.deepEqual(writeOnly.scopes, ['Tasks.ReadWrite'])
  assert.equal(writeOnly.writeEnabled, true)
  assert.equal(writeOnly.deleteEnabled, false)

  const destructive = loadConfig({
    MS_TODO_WRITE: '1',
    MS_TODO_ALLOW_DELETE: '1',
  })
  assert.equal(destructive.deleteEnabled, true)
})

it('allows an owned client and tenant to be selected', () => {
  const config = loadConfig({
    MS_TODO_CLIENT_ID: 'owned-client-id',
    MS_TODO_TENANT: 'consumers',
    MS_TODO_CACHE: '/tmp/test-cache.json',
  })
  assert.equal(config.clientId, 'owned-client-id')
  assert.equal(config.authority, 'https://login.microsoftonline.com/consumers')
  assert.equal(config.cachePath, '/tmp/test-cache.json')
})
