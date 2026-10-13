import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hostCapabilities, hostError, hostRequest } from '../src/host-protocol'
import { cliPath, packageRoot, writeFile } from './utils'

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'workstation-host-protocol-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function cli(input: string, args: string[] = []) {
  return spawnSync(process.execPath, ['--import', 'tsx', cliPath, 'host-json', ...args], {
    cwd: packageRoot,
    input,
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      DOTFILES_HOME: path.join(root, 'home'),
      DOTFILES_REPO_ROOT: root,
      WORKSTATION_PRIVATE_MANIFEST: path.join(root, 'private.json'),
      PATH: '',
      NO_COLOR: '1',
    },
  })
}

describe('host protocol v1', () => {
  it('reports explicit versions without probing or writing', () => {
    const report = hostRequest({ version: 1, operation: 'capabilities' }, { platform: 'darwin' })
    expect(report).toMatchObject({ version: 1, cliVersion: expect.any(String), platform: 'darwin', protocols: { host: 1, software: 1, configuration: 1 } })
    expect(fs.readdirSync(root)).toEqual([])
    expect(Object.values(hostCapabilities('darwin').operations.configuration).every(operation => operation.supported)).toBe(true)
    expect(Object.values(hostCapabilities('darwin').operations.software).every(operation => operation.supported)).toBe(true)
  })

  it('keeps Linux configuration supported and macOS software operations unavailable', () => {
    const { operations } = hostCapabilities('linux')
    expect(operations.configuration.apply).toEqual({ supported: true })
    expect(operations.configuration['git-publish']).toEqual({ supported: true })
    expect(operations.software.install).toEqual({ supported: false, reason: 'unsupported-platform' })
    expect(operations.software.open).toEqual({ supported: false, reason: 'unsupported-platform' })
    expect(operations.software.catalog).toEqual({ supported: true })
    expect(operations.software.preview).toEqual({ supported: true })
  })

  it('conservatively disables Windows writes and unsupported native operations', () => {
    const { operations } = hostCapabilities('win32')
    for (const operation of ['preview', 'apply', 'restore', 'git-fetch', 'git-commit', 'git-publish'] as const)
      expect(operations.configuration[operation]).toEqual({ supported: false, reason: 'unsupported-platform' })
    expect(operations.configuration.inspect).toEqual({ supported: true })
    expect(operations.configuration.history).toEqual({ supported: true })
    expect(operations.configuration['git-status']).toEqual({ supported: true })
    expect(operations.software.cancel.supported).toBe(false)
    expect(operations.doctor.supported).toBe(true)
  })

  it('rejects filesystem and command overrides and invalid request shapes', () => {
    for (const input of [null, [], 'secret-value', { version: 1, operation: 'doctor', repoRoot: '/private' }, { version: 1, operation: 'doctor', command: 'secret-value' }])
      expect(() => hostRequest(input)).toThrow('Invalid host request')
    expect(() => hostRequest({ version: 2, operation: 'doctor' })).toThrow('Unsupported host protocol version')
    expect(() => hostRequest({ version: 1, operation: 'install' })).toThrow('Unsupported host operation')
  })

  it('preserves fixed errors only', () => {
    expect(hostError(new Error('Unsupported host protocol version'))).toEqual({ ok: false, code: 'UNSUPPORTED_VERSION', error: 'Unsupported host protocol version' })
    for (const error of [new Error('parser: secret-value'), new Error('Invalid host request\nsecret-value'), { message: 'Invalid host request' }, null]) {
      expect(hostError(error)).toMatchObject({ ok: false, code: 'UNAVAILABLE' })
      expect(JSON.stringify(hostError(error))).not.toContain('secret-value')
    }
  })

  it('emits exactly one JSON envelope for capabilities', () => {
    const output = cli('{"version":1,"operation":"capabilities"}')
    expect(output.status).toBe(0)
    expect(output.stderr).toBe('')
    expect(output.stdout.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(output.stdout)).toMatchObject({ ok: true, result: { version: 1, cliVersion: expect.any(String), platform: process.platform } })
  })

  it('returns missing configuration as a successful doctor report, without output leaks or writes', () => {
    writeFile(path.join(root, '.chezmoiroot'), 'secret-config-excerpt')
    writeFile(path.join(root, 'private.json'), '{"private":"secret-config-excerpt",')
    const before = fs.readdirSync(root)
    const output = cli('{"version":1,"operation":"doctor"}')
    expect(output.status).toBe(0)
    expect(output.stderr).toBe('')
    expect(output.stdout.trim().split('\n')).toHaveLength(1)
    const envelope = JSON.parse(output.stdout)
    expect(envelope).toMatchObject({ ok: true, result: { version: 1, summary: { errors: expect.any(Number), warnings: expect.any(Number), passed: expect.any(Number) } } })
    expect(envelope.result.summary.errors).toBeGreaterThan(0)
    expect(output.stdout).not.toContain('secret-config-excerpt')
    expect(fs.readdirSync(root)).toEqual(before)
    expect(fs.existsSync(path.join(root, 'home'))).toBe(false)
  })

  it('rejects malformed JSON and oversized UTF-8 requests with a fixed envelope', () => {
    for (const input of ['{"secret-value":', 'é'.repeat(600000)]) {
      const output = cli(input)
      expect(output.status).toBe(1)
      expect(JSON.parse(output.stdout)).toEqual({ ok: false, code: 'INVALID_REQUEST', error: 'Invalid host request' })
      expect(output.stderr).toBe('')
    }
  })
})
