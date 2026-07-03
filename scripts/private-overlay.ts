#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'

type Command = 'apply' | 'check' | 'list' | 'status'

interface Manifest {
  mcp?: {
    localOutputs?: LocalOutput[]
    templates?: McpTemplate[]
  }
  policy?: {
    plaintextSecretsAllowed?: boolean
    secretSource?: string
  }
  workstationOverlay?: OverlayContract
}

interface OverlayContract {
  allowedOperations?: string[]
  allowedReadPaths?: string[]
  contractVersion?: number
  defaultMode?: string
  localIgnoredOutputs?: string[]
  neverApply?: string[]
  secretSource?: string
}

interface McpTemplate {
  id: string
  operation?: string
  outputPath?: string
  path: string
  usage?: string
}

interface LocalOutput {
  gitIgnored?: boolean
  path: string
  reason?: string
}

interface Options {
  dryRun: boolean
  manifest: string
  yes: boolean
}

const helpFlags = new Set(['--help', '-h'])
const knownOperations = new Set(['inventory', 'managed-block-fragment', 'op-inject-template'])

function usage(exitCode = 0): never {
  console.log(`Usage:
  pnpm private:list -- --manifest <path>
  pnpm private:status -- --manifest <path>
  pnpm private:check -- --manifest <path>
  pnpm private:apply -- --manifest <path> [--dry-run]
  pnpm private:apply -- --manifest <path> --yes

Environment:
  WORKSTATION_PRIVATE_MANIFEST  Default manifest path`)
  process.exit(exitCode)
}

function parseCommand(value: string | undefined): Command {
  if (!value || value.startsWith('-'))
    return 'status'

  if (['apply', 'check', 'list', 'status'].includes(value))
    return value as Command

  console.error(`Unknown private overlay command: ${value}`)
  usage(1)
}

function defaultManifestPath(): string {
  if (process.env.WORKSTATION_PRIVATE_MANIFEST)
    return resolve(expandHome(process.env.WORKSTATION_PRIVATE_MANIFEST))

  return resolve(homedir(), 'repos', 'dotfiles', 'config', 'sync-manifest.json')
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    dryRun: true,
    manifest: defaultManifestPath(),
    yes: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (helpFlags.has(arg))
      usage()

    if (arg === '--') {
      continue
    }
    else if (arg === '--dry-run') {
      options.dryRun = true
    }
    else if (arg === '--yes') {
      options.yes = true
      options.dryRun = false
    }
    else if (arg === '--manifest') {
      const value = args[index + 1]
      if (!value) {
        console.error('--manifest requires a path')
        usage(1)
      }
      options.manifest = resolve(expandHome(value))
      index += 1
    }
    else {
      console.error(`Unknown option: ${arg}`)
      usage(1)
    }
  }

  return options
}

function expandHome(value: string): string {
  if (value === '~')
    return homedir()

  if (value.startsWith('~/'))
    return join(homedir(), value.slice(2))

  if (value.startsWith('$HOME/'))
    return join(homedir(), value.slice(6))

  return value
}

function repoRootFromManifest(manifestPath: string): string {
  const parent = dirname(manifestPath)
  return parent.endsWith('/config') ? dirname(parent) : parent
}

function readManifest(path: string): Manifest {
  if (!existsSync(path))
    throw new Error(`Private overlay manifest not found: ${path}`)

  return JSON.parse(readFileSync(path, 'utf-8')) as Manifest
}

function validateManifest(manifest: Manifest): string[] {
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

  return errors
}

function commandExists(command: string): boolean {
  return spawnSync('which', [command], { stdio: 'ignore' }).status === 0
}

function opState(): 'available' | 'missing' | 'unavailable' {
  if (!commandExists('op'))
    return 'missing'

  const result = spawnSync('op', ['whoami'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return result.status === 0 ? 'available' : 'unavailable'
}

function printValidation(errors: string[], check: boolean): void {
  if (errors.length === 0) {
    console.log('[ok] manifest contract is valid')
    return
  }

  for (const error of errors)
    console.log(`[error] ${error}`)

  if (check)
    process.exitCode = 1
}

function isSafeRelativePath(path: string): boolean {
  return Boolean(path)
    && !isAbsolute(path)
    && !path.split('/').includes('..')
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')

  return new RegExp(`^${escaped}$`)
}

function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some(pattern => globToRegExp(pattern).test(path))
}

function resolveRepoPath(repoRoot: string, relativePath: string): string {
  if (!isSafeRelativePath(relativePath))
    throw new Error(`Unsafe relative path in private overlay manifest: ${relativePath}`)

  const absolutePath = resolve(repoRoot, relativePath)
  const rel = relative(repoRoot, absolutePath)
  if (rel.startsWith('..') || isAbsolute(rel))
    throw new Error(`Path escapes private overlay repository: ${relativePath}`)

  return absolutePath
}

function assertAllowedRead(path: string, contract: OverlayContract): void {
  if (!matchesAny(path, contract.allowedReadPaths || []))
    throw new Error(`Path is not allowlisted for private overlay reads: ${path}`)
}

function assertAllowedOutput(path: string, manifest: Manifest): void {
  const contract = manifest.workstationOverlay
  const localOutputs = new Set([
    ...(contract?.localIgnoredOutputs || []),
    ...(manifest.mcp?.localOutputs || []).map(output => output.path),
  ])

  if (!localOutputs.has(path))
    throw new Error(`Output path is not listed as a local ignored output: ${path}`)

  if ((contract?.neverApply || []).includes(path))
    throw new Error(`Output path is listed in neverApply: ${path}`)
}

function privateTemplates(manifest: Manifest): McpTemplate[] {
  return (manifest.mcp?.templates || [])
    .filter(template => template.operation === 'op-inject-template')
}

function list(manifestPath: string, manifest: Manifest): void {
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Secret source: ${manifest.workstationOverlay?.secretSource || manifest.policy?.secretSource || 'unknown'}`)
  console.log(`Default mode: ${manifest.workstationOverlay?.defaultMode || 'unknown'}`)

  console.log('\nOperations:')
  for (const operation of manifest.workstationOverlay?.allowedOperations || [])
    console.log(`  - ${operation}`)

  console.log('\nMCP templates:')
  for (const template of manifest.mcp?.templates || []) {
    const output = template.outputPath ? ` -> ${template.outputPath}` : ''
    console.log(`  - ${template.id}: ${template.path}${output}`)
  }
}

function status(manifestPath: string, manifest: Manifest, check: boolean): void {
  const errors = validateManifest(manifest)
  console.log(`Manifest: ${manifestPath}`)
  printValidation(errors, check)

  const state = opState()
  if (state === 'available') {
    console.log('[ok] 1Password CLI is available and signed in')
  }
  else if (state === 'missing') {
    console.log('[missing] 1Password CLI is not installed')
    if (check)
      process.exitCode = 1
  }
  else {
    console.log('[auth] 1Password CLI is installed but not signed in or locked')
    if (check)
      process.exitCode = 1
  }

  const repoRoot = repoRootFromManifest(manifestPath)
  const contract = manifest.workstationOverlay
  if (!contract)
    return

  for (const template of privateTemplates(manifest)) {
    try {
      assertAllowedRead(template.path, contract)
      const source = resolveRepoPath(repoRoot, template.path)
      const sourceState = existsSync(source) ? 'ok' : 'missing'
      const output = template.outputPath || '<missing outputPath>'
      console.log(`[${sourceState}] template ${template.id}: ${template.path} -> ${output}`)
      if (sourceState === 'missing' && check)
        process.exitCode = 1
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log(`[error] ${message}`)
      if (check)
        process.exitCode = 1
    }
  }
}

function backupPath(path: string): string {
  return `${path}.backup.${Date.now()}`
}

function runOpInject(source: string, output: string, dryRun: boolean): void {
  console.log(`${dryRun ? '[dry-run]' : '[apply]'} op inject ${source} -> ${output}`)

  if (dryRun)
    return

  mkdirSync(dirname(output), { recursive: true })

  if (existsSync(output)) {
    const backup = backupPath(output)
    copyFileSync(output, backup)
    console.log(`[backup] ${backup}`)
  }

  const result = spawnSync('op', ['inject', '--in-file', source, '--out-file', output], {
    stdio: 'inherit',
  })

  if (result.status !== 0)
    throw new Error(`op inject failed for ${source}`)

  chmodSync(output, 0o600)
  console.log(`[ok] wrote local ignored output ${output}`)
}

function apply(manifestPath: string, manifest: Manifest, dryRun: boolean): void {
  const errors = validateManifest(manifest)
  if (errors.length > 0)
    throw new Error(`Invalid private overlay manifest:\n${errors.map(error => `- ${error}`).join('\n')}`)

  if (!dryRun) {
    const state = opState()
    if (state !== 'available')
      throw new Error('1Password CLI must be installed and signed in before applying private overlay templates')
  }

  const repoRoot = repoRootFromManifest(manifestPath)
  const contract = manifest.workstationOverlay
  if (!contract)
    throw new Error('workstationOverlay is missing')

  const templates = privateTemplates(manifest)
  if (templates.length === 0) {
    console.log('[skip] no op-inject-template entries')
    return
  }

  for (const template of templates) {
    assertAllowedRead(template.path, contract)
    if (!template.outputPath)
      throw new Error(`template ${template.id} has no outputPath`)
    assertAllowedOutput(template.outputPath, manifest)

    const source = resolveRepoPath(repoRoot, template.path)
    const output = resolveRepoPath(repoRoot, template.outputPath)
    if (!existsSync(source))
      throw new Error(`Template does not exist: ${source}`)

    runOpInject(source, output, dryRun)
  }
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2])
  const optionArgs = process.argv[2]?.startsWith('-')
    ? process.argv.slice(2)
    : process.argv.slice(3)
  const options = parseOptions(optionArgs)
  const manifest = readManifest(options.manifest)

  if (command === 'list') {
    list(options.manifest, manifest)
  }
  else if (command === 'apply') {
    apply(options.manifest, manifest, options.dryRun || !options.yes)
  }
  else {
    status(options.manifest, manifest, command === 'check')
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
