import type { McpFragment, McpTemplate, OverlayContract, PrivateManifest, PrivateSkill, SecretEnvTemplate, SecretFileBundle } from './types'
import fs from 'node:fs'
import { matchesAny } from './paths'

export const privateAllowedOperations = [
  'inventory',
  'mcp-export',
  'managed-block-fragment',
  'op-account-select',
  'op-run-env',
  'op-inject-template',
  'op-file-restore',
  'op-run-wrapper',
  'op-typescript-cli',
  'private-skill-install',
  'secret-scan',
] as const

const knownOperations = new Set<string>(privateAllowedOperations)

export function readPrivateManifest(manifestPath: string): PrivateManifest {
  if (!fs.existsSync(manifestPath))
    throw new Error(`Private overlay manifest not found: ${manifestPath}`)

  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PrivateManifest
}

export function validatePrivateManifest(manifest: PrivateManifest): string[] {
  const errors: string[] = []
  const contract = manifest.workstationOverlay

  if (!contract) {
    errors.push('workstationOverlay is missing')
    return errors
  }

  if (contract.contractVersion !== 1)
    errors.push('workstationOverlay.contractVersion must be 1')

  if (contract.defaultMode !== 'dry-run')
    errors.push('workstationOverlay.defaultMode must be dry-run')

  const secretSource = contract.secretSource || manifest.policy?.secretSource
  if (secretSource !== '1Password')
    errors.push('secretSource must be 1Password')

  if (manifest.policy?.plaintextSecretsAllowed !== false)
    errors.push('policy.plaintextSecretsAllowed must be false')

  for (const operation of contract.allowedOperations || []) {
    if (!knownOperations.has(operation))
      errors.push(`unsupported allowed operation: ${operation}`)
  }

  if (!contract.allowedReadPaths?.length)
    errors.push('workstationOverlay.allowedReadPaths must not be empty')

  for (const template of manifest.mcp?.templates || []) {
    if (template.operation === 'op-inject-template' && !template.outputPath)
      errors.push(`template ${template.id} uses op-inject-template but has no outputPath`)
  }

  for (const template of manifest.secrets?.envTemplates || []) {
    if (template.operation && template.operation !== 'op-run-env')
      errors.push(`unsupported secret env template operation for ${template.id}: ${template.operation}`)

    if (!matchesAny(template.path, contract.allowedReadPaths || []))
      errors.push(`secret env template path is not allowlisted for ${template.id}: ${template.path}`)

    if (template.materializer && template.materializer !== 'app-store-connect-key')
      errors.push(`unsupported secret env template materializer for ${template.id}: ${template.materializer}`)
  }

  for (const bundle of manifest.secrets?.fileBundles || []) {
    if (bundle.operation && bundle.operation !== 'op-file-restore')
      errors.push(`unsupported secret file bundle operation for ${bundle.id}: ${bundle.operation}`)

    if (!bundle.files?.length)
      errors.push(`secret file bundle has no files: ${bundle.id}`)

    for (const file of bundle.files || []) {
      if (!file.ref?.startsWith('op://'))
        errors.push(`secret file bundle ${bundle.id} uses a non-1Password ref: ${file.ref || '<missing ref>'}`)

      if (!isHomeOutputPath(file.path))
        errors.push(`secret file bundle ${bundle.id} output must be under $HOME: ${file.path || '<missing path>'}`)

      if (file.mode && !isOctalMode(file.mode))
        errors.push(`secret file bundle ${bundle.id} has invalid file mode for ${file.path}: ${file.mode}`)

      if (file.directoryMode && !isOctalMode(file.directoryMode))
        errors.push(`secret file bundle ${bundle.id} has invalid directory mode for ${file.path}: ${file.directoryMode}`)
    }

    if (bundle.directoryMode && !isOctalMode(bundle.directoryMode))
      errors.push(`secret file bundle ${bundle.id} has invalid directory mode: ${bundle.directoryMode}`)
  }

  for (const fragment of manifest.mcp?.fragments || []) {
    if (fragment.operation && fragment.operation !== 'managed-block-fragment')
      errors.push(`unsupported MCP fragment operation for ${fragment.id}: ${fragment.operation}`)

    if (fragment.format && fragment.format !== 'toml-codex')
      errors.push(`unsupported MCP fragment format for ${fragment.id}: ${fragment.format}`)

    if (!matchesAny(fragment.path, contract.allowedReadPaths || []))
      errors.push(`MCP fragment path is not allowlisted: ${fragment.path}`)
  }

  for (const skill of manifest.skills?.install || []) {
    if (skill.source.type === 'local') {
      if (!skill.source.path) {
        errors.push(`local skill ${skill.id} has no source.path`)
      }
      else if (!matchesAny(skill.source.path, contract.allowedReadPaths || [])) {
        errors.push(`skill source path is not allowlisted for ${skill.id}: ${skill.source.path}`)
      }
    }
    else if (skill.source.type !== 'github') {
      errors.push(`unsupported skill source type for ${skill.id}: ${skill.source.type}`)
    }
  }

  return errors
}

export function assertAllowedRead(value: string, contract: OverlayContract): void {
  if (!matchesAny(value, contract.allowedReadPaths || []))
    throw new Error(`Path is not allowlisted for private overlay reads: ${value}`)
}

export function assertAllowedOutput(value: string, manifest: PrivateManifest): void {
  const contract = manifest.workstationOverlay
  const localOutputs = new Set([
    ...(contract?.localIgnoredOutputs || []),
    ...(manifest.mcp?.localOutputs || []).map(output => output.path),
  ])

  if (!localOutputs.has(value))
    throw new Error(`Output path is not listed as a local ignored output: ${value}`)

  if ((contract?.neverApply || []).includes(value))
    throw new Error(`Output path is listed in neverApply: ${value}`)
}

export function privateTemplates(manifest: PrivateManifest): McpTemplate[] {
  return (manifest.mcp?.templates || [])
    .filter(template => template.operation === 'op-inject-template')
}

export function privateEnvTemplate(manifest: PrivateManifest): McpTemplate | undefined {
  return (manifest.mcp?.templates || [])
    .find(template => template.operation === 'op-run-env')
}

export function privateSecretEnvTemplate(manifest: PrivateManifest, id: string): SecretEnvTemplate | undefined {
  return (manifest.secrets?.envTemplates || [])
    .find(template => template.id === id)
}

export function privateSecretEnvTemplates(manifest: PrivateManifest): SecretEnvTemplate[] {
  return manifest.secrets?.envTemplates || []
}

export function privateSecretFileBundles(manifest: PrivateManifest): SecretFileBundle[] {
  return (manifest.secrets?.fileBundles || [])
    .filter(bundle => !bundle.operation || bundle.operation === 'op-file-restore')
}

export function privateMcpFragments(manifest: PrivateManifest): McpFragment[] {
  return (manifest.mcp?.fragments || [])
    .filter(fragment => !fragment.operation || fragment.operation === 'managed-block-fragment')
}

export function privateSkillInstalls(manifest: PrivateManifest): PrivateSkill[] {
  return manifest.skills?.install || []
}

function isHomeOutputPath(value: string | undefined): boolean {
  return Boolean(value && (value.startsWith('~/') || value.startsWith('$HOME/')))
}

function isOctalMode(value: string): boolean {
  return /^[0-7]{3,4}$/.test(value)
}
