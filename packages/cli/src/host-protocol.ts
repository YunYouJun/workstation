import type { DoctorOptions, DoctorReport } from './doctor'
import type { ProjectManifestValidationReport } from './projects-manifest'
import process from 'node:process'
import { version as cliVersion } from '../package.json'
import { inspectDoctor } from './doctor'
import { validateProjectManifest } from './projects'

export interface HostOperationCapability {
  supported: boolean
  reason?: 'unsupported-platform'
}

/** Protocol support describes implemented platform behavior, not local dependency readiness. */
export interface HostCapabilities {
  version: 1
  cliVersion: string
  platform: NodeJS.Platform
  protocols: { host: 1, configuration: 1, software: 1, repositoryValidation: 1 }
  operations: {
    configuration: Record<'inspect' | 'preview' | 'apply' | 'restore' | 'history' | 'git-status' | 'git-fetch' | 'git-commit' | 'git-publish', HostOperationCapability>
    software: Record<'catalog' | 'preview' | 'install' | 'runs' | 'cancel' | 'open', HostOperationCapability>
    doctor: HostOperationCapability
    repositoryValidation: HostOperationCapability
  }
}

/** Local injection only. Requests cannot contain configuration or executable overrides. */
export interface HostProtocolOptions {
  platform?: NodeJS.Platform
  doctor?: DoctorOptions
}

/** Negotiate protocol versions and operation support before exposing executable GUI actions. */
export function hostCapabilities(platform: NodeJS.Platform = process.platform): HostCapabilities {
  const support = (supported: boolean): HostOperationCapability => supported ? { supported } : { supported, reason: 'unsupported-platform' }
  const configurationWrite = platform === 'darwin' || platform === 'linux'
  return {
    version: 1,
    cliVersion,
    platform,
    protocols: { host: 1, configuration: 1, software: 1, repositoryValidation: 1 },
    operations: {
      configuration: {
        'inspect': support(true),
        'preview': support(configurationWrite),
        'apply': support(configurationWrite),
        'restore': support(configurationWrite),
        'history': support(true),
        'git-status': support(true),
        'git-fetch': support(configurationWrite),
        'git-commit': support(configurationWrite),
        'git-publish': support(configurationWrite),
      },
      software: {
        catalog: support(true),
        preview: support(true),
        install: support(platform === 'darwin'),
        runs: support(true),
        cancel: support(configurationWrite),
        open: support(platform === 'darwin'),
      },
      doctor: support(true),
      repositoryValidation: support(true),
    },
  }
}

/** Strict read-only request handler, without filesystem overrides or executable commands. */
export function hostRequest(input: unknown, options: HostProtocolOptions = {}): HostCapabilities | DoctorReport | ProjectManifestValidationReport {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid host request')
  const request = input as Record<string, unknown>
  const fields = request.operation === 'validate-projects' ? ['version', 'operation', 'content'] : ['version', 'operation']
  if (Object.keys(request).some(key => !fields.includes(key)))
    throw new Error('Invalid host request')
  if (request.version !== 1)
    throw new Error('Unsupported host protocol version')
  if (request.operation === 'capabilities')
    return hostCapabilities(options.platform)
  if (request.operation === 'doctor')
    return inspectDoctor({ ...options.doctor, platform: options.platform ?? options.doctor?.platform })
  if (request.operation === 'validate-projects') {
    if (typeof request.content !== 'string')
      throw new Error('Invalid host request')
    return validateProjectManifest(request.content)
  }
  throw new Error('Unsupported host operation')
}

/** Permit fixed protocol guidance only, withholding parser, filesystem and subprocess details. */
export function hostError(error: unknown): { ok: false, code: string, error: string } {
  const message = error instanceof Error ? error.message : ''
  const known: Record<string, string> = {
    'Invalid host request': 'INVALID_REQUEST',
    'Unsupported host protocol version': 'UNSUPPORTED_VERSION',
    'Unsupported host operation': 'UNSUPPORTED_OPERATION',
  }
  return Object.hasOwn(known, message)
    ? { ok: false, code: known[message], error: message }
    : { ok: false, code: 'UNAVAILABLE', error: 'Host inspection failed. Check the local CLI version and filesystem permissions.' }
}
