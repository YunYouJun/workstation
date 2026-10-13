import type { SoftwareHostOptions } from './software/detection'
import type { SoftwareMetadata } from './software/metadata'
import process from 'node:process'
import { softwareItems } from '../../../software.config'
import { findApplication, softwareStatus } from './software/detection'
import { softwareCatalogSource, softwareInstallation, softwareMetadata } from './software/metadata'

export { runSoftwareWorker, softwareOperationRequest } from './software/engine'
export type { SoftwareEngineOptions, SoftwareInstallationPlan, SoftwareInstallationRun } from './software/engine'
export { softwareInstallation } from './software/metadata'

export interface SoftwareCatalogEntry extends SoftwareMetadata {
  status: 'detected' | 'not-detected' | 'unknown'
  canInstall?: boolean
  canOpen?: boolean
}

export interface SoftwareCatalogResult {
  version: 1
  source: { id: 'workstation', title: 'Workstation', url: string }
  items: SoftwareCatalogEntry[]
}

/** Host options are injected for tests; JSON requests cannot choose directories or catalog items. */
export interface SoftwareCatalogOptions extends SoftwareHostOptions {}

/** Read the declarative software catalog without running commands, installing software or writing state. */
export function softwareRequest(input: unknown, options: SoftwareCatalogOptions = {}): SoftwareCatalogResult {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['version', 'operation'].includes(key)))
    throw new Error('Invalid software request')
  const request = input as { version?: unknown, operation?: unknown }
  if (request.version !== 1)
    throw new Error('Unsupported software protocol version')
  if (request.operation !== 'catalog')
    throw new Error('Unsupported software operation')

  return {
    version: 1,
    source: { ...softwareCatalogSource },
    items: (options.items ?? softwareItems).map(item => ({
      ...softwareMetadata(item),
      status: softwareStatus(item, options),
      canInstall: (options.platform ?? process.platform) === 'darwin' && ['brew-cask', 'brew-formula'].includes(softwareInstallation(item).kind) && softwareStatus(item, options) === 'not-detected',
      canOpen: !!findApplication(item, options).path,
    })),
  }
}
