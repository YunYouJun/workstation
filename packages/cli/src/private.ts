import type { InventorySection, ParsedCommand, PrivateAction, PrivateManifest, PrivateOptions } from './private/types'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { getHomeDir } from './config'
import { applyPrivateCodexMcp } from './private/codex-mcp'
import { applyPrivateCodexSkills } from './private/codex-skills'
import { commandExists, commandOutput } from './private/exec'
import { restoreSecretFileBundles } from './private/files'
import { generatePrivateInventory } from './private/inventory'
import { importIosSecrets, materializeIosCommand, runIosCommand } from './private/ios'
import { assertAllowedRead, privateMcpFragments, privateSecretEnvTemplates, privateSecretFileBundles, privateSkillInstalls, privateTemplates, readPrivateManifest, validatePrivateManifest } from './private/manifest'
import { exportMcpServers } from './private/mcp-export'
import { checkMcpSecrets, importMcpSecrets, injectMcpTemplates, opReadinessState, runMcpCommand, tryLoadOpContext } from './private/op'
import { defaultManifestPath, expandHome, rememberPrivateManifestPath, repoRootFromManifest, resolvePathOption, resolveRepoPath } from './private/paths'
import { scanSecrets } from './private/scan'

export { readSecretReferences } from './private/secret-refs'

const helpFlags = new Set(['--help', '-h'])

export function privateUsage(): string {
  return `Usage:
  wst private status [--manifest <path>]
  wst private list [--manifest <path>]
  wst private check [--manifest <path>]
  wst private apply [--manifest <path>] [--dry-run|--yes]
  wst private connect [--repo <git-url> --target-dir <path>] [--dry-run|--yes]
  wst private inventory [--manifest <path>] [--section all|skills|mcp]
  wst private file-restore [--manifest <path>] [--bundle <id>] [--dry-run|--yes]
  wst private ios-secrets-import [--manifest <path>] [--dry-run|--yes]
  wst private ios-run [--manifest <path>] -- <command...>
  wst private ios-materialize -- <command...>
  wst private secret-scan [--manifest <path>] [--all|--staged]
  wst private secrets-check [--manifest <path>]
  wst private secrets-import [--manifest <path>] [--dry-run|--yes]
  wst private mcp-export [--manifest <path>] --server <name[,name...]> [--source <path>] [--output <path>] [--dry-run|--yes]
  wst private mcp-inject [--manifest <path>] [--dry-run|--yes]
  wst private mcp-run [--manifest <path>] -- <command...>

Environment:
  WORKSTATION_PRIVATE_MANIFEST  Default manifest path
  WORKSTATION_PRIVATE_CONFIG    Default private CLI config file`
}

export async function runPrivateCommand(actionArg?: string, rawArgs: string[] = []): Promise<void> {
  try {
    const parsed = parsePrivateCommand(actionArg, rawArgs)

    if (parsed.options.positionals.some(arg => helpFlags.has(arg))) {
      console.log(privateUsage())
      return
    }

    await runParsedPrivateCommand(parsed)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exitCode = 1
  }
}

async function runParsedPrivateCommand({ action, options }: ParsedCommand): Promise<void> {
  if (action === 'connect') {
    await connect(options)
    return
  }

  if (action === 'secret-scan') {
    scanSecrets(options)
    return
  }

  if (action === 'ios-materialize') {
    materializeIosCommand(options)
    return
  }

  const manifest = readPrivateManifest(options.manifest)

  if (action === 'list') {
    list(options.manifest, manifest)
  }
  else if (action === 'apply') {
    apply(options.manifest, manifest, options.dryRun || !options.yes)
  }
  else if (action === 'inventory') {
    process.stdout.write(generatePrivateInventory(options.manifest, manifest, options.section))
  }
  else if (action === 'file-restore') {
    restoreSecretFileBundles(options.manifest, manifest, options)
  }
  else if (action === 'ios-secrets-import') {
    importIosSecrets(options.manifest, manifest, options)
  }
  else if (action === 'ios-run') {
    runIosCommand(options.manifest, manifest, options)
  }
  else if (action === 'secrets-check') {
    checkMcpSecrets(options.manifest, manifest, options.envFile)
  }
  else if (action === 'secrets-import') {
    importMcpSecrets(options.manifest, manifest, options.envFile, options.dryRun || !options.yes)
  }
  else if (action === 'mcp-export') {
    exportMcpServers(options.manifest, manifest, options)
  }
  else if (action === 'mcp-inject') {
    injectMcpTemplates(options.manifest, manifest, options)
  }
  else if (action === 'mcp-run') {
    runMcpCommand(options.manifest, manifest, options)
  }
  else {
    status(options.manifest, manifest, action === 'check')
  }
}

function parsePrivateCommand(actionArg: string | undefined, rawArgs: string[]): ParsedCommand {
  const actionCandidate = actionArg && !actionArg.startsWith('-') ? actionArg : undefined
  const args = actionArg && actionArg.startsWith('-') ? [actionArg, ...rawArgs] : rawArgs
  const action = parsePrivateAction(actionCandidate)
  const options = parsePrivateOptions(args)

  if (action === 'inventory' && options.positionals.length > 0) {
    options.manifest = resolvePathOption(options.positionals[0])
    options.positionals = options.positionals.slice(1)
  }

  return {
    action,
    options,
  }
}

function parsePrivateAction(value: string | undefined): PrivateAction {
  if (!value)
    return 'status'

  if (['apply', 'check', 'connect', 'file-restore', 'inventory', 'ios-materialize', 'ios-run', 'ios-secrets-import', 'list', 'mcp-export', 'mcp-inject', 'mcp-run', 'status'].includes(value))
    return value as PrivateAction

  if (['files-restore', 'restore-files'].includes(value))
    return 'file-restore'

  if (['op-import-ios', 'ios-import', 'ios-secrets'].includes(value))
    return 'ios-secrets-import'

  if (['op-run-ios', 'ios-op-run'].includes(value))
    return 'ios-run'

  if (['with-ios-appstoreconnect', 'ios-with-appstoreconnect'].includes(value))
    return 'ios-materialize'

  if (['op-check', 'secrets-check'].includes(value))
    return 'secrets-check'

  if (['op-import', 'secrets-import'].includes(value))
    return 'secrets-import'

  if (['op-inject'].includes(value))
    return 'mcp-inject'

  if (['export-mcp', 'mcp-sync'].includes(value))
    return 'mcp-export'

  if (['op-run'].includes(value))
    return 'mcp-run'

  if (['scan-secrets', 'secret-scan', 'secrets-scan'].includes(value))
    return 'secret-scan'

  throw new Error(`Unknown private command: ${value}\n\n${privateUsage()}`)
}

function parsePrivateOptions(args: string[]): PrivateOptions {
  const options: PrivateOptions = {
    dryRun: true,
    manifest: defaultManifestPath(),
    passthrough: [],
    positionals: [],
    scanMode: 'all',
    section: 'all',
    yes: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '--') {
      options.passthrough = args.slice(index + 1)
      break
    }
    else if (helpFlags.has(arg)) {
      options.positionals.push(arg)
    }
    else if (arg === '--dry-run') {
      options.dryRun = true
      options.yes = false
    }
    else if (arg === '--yes') {
      options.yes = true
      options.dryRun = false
    }
    else if (arg === '--manifest') {
      options.manifest = resolveRequiredOption(args, index, '--manifest')
      index += 1
    }
    else if (arg.startsWith('--manifest=')) {
      options.manifest = resolvePathOption(arg.slice('--manifest='.length))
    }
    else if (arg === '--repo') {
      options.repo = requireOptionValue(args, index, '--repo')
      index += 1
    }
    else if (arg === '--target-dir') {
      options.targetDir = resolveRequiredOption(args, index, '--target-dir')
      index += 1
    }
    else if (arg === '--section') {
      options.section = parseInventorySection(requireOptionValue(args, index, '--section'))
      index += 1
    }
    else if (arg.startsWith('--section=')) {
      options.section = parseInventorySection(arg.slice('--section='.length))
    }
    else if (arg === '--skills') {
      options.section = 'skills'
    }
    else if (arg === '--mcp') {
      options.section = 'mcp'
    }
    else if (arg === '--all') {
      options.section = 'all'
      options.scanMode = 'all'
    }
    else if (arg === '--staged') {
      options.scanMode = 'staged'
    }
    else if (arg === '--template') {
      options.template = resolveRequiredOption(args, index, '--template')
      index += 1
    }
    else if (arg === '--source') {
      options.source = resolveRequiredOption(args, index, '--source')
      index += 1
    }
    else if (arg.startsWith('--source=')) {
      options.source = resolvePathOption(arg.slice('--source='.length))
    }
    else if (arg === '--server' || arg === '--servers') {
      options.servers ||= []
      options.servers.push(requireOptionValue(args, index, arg))
      index += 1
    }
    else if (arg.startsWith('--server=')) {
      options.servers ||= []
      options.servers.push(arg.slice('--server='.length))
    }
    else if (arg.startsWith('--servers=')) {
      options.servers ||= []
      options.servers.push(arg.slice('--servers='.length))
    }
    else if (arg === '--output') {
      options.output = resolveRequiredOption(args, index, '--output')
      index += 1
    }
    else if (arg === '--env-file') {
      options.envFile = resolveRequiredOption(args, index, '--env-file')
      index += 1
    }
    else if (arg === '--bundle') {
      options.bundle = requireOptionValue(args, index, '--bundle')
      index += 1
    }
    else if (arg.startsWith('--bundle=')) {
      options.bundle = arg.slice('--bundle='.length)
    }
    else if (arg.startsWith('-')) {
      throw new Error(`Unknown private option: ${arg}\n\n${privateUsage()}`)
    }
    else {
      options.positionals.push(arg)
    }
  }

  return options
}

function requireOptionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1]
  if (!value)
    throw new Error(`${option} requires a value`)

  return value
}

function resolveRequiredOption(args: string[], index: number, option: string): string {
  return resolvePathOption(requireOptionValue(args, index, option))
}

function parseInventorySection(value: string): InventorySection {
  if (value === 'all' || value === 'skills' || value === 'mcp')
    return value

  throw new Error(`Unsupported inventory section: ${value}`)
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

function list(manifestPath: string, manifest: PrivateManifest): void {
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

  console.log('\nSecret env templates:')
  for (const template of privateSecretEnvTemplates(manifest)) {
    const materializer = template.materializer ? ` (${template.materializer})` : ''
    console.log(`  - ${template.id}: ${template.path}${materializer}`)
  }

  console.log('\nSecret file bundles:')
  for (const bundle of privateSecretFileBundles(manifest))
    console.log(`  - ${bundle.id}: ${bundle.files.length} file${bundle.files.length === 1 ? '' : 's'}`)

  console.log('\nMCP fragments:')
  for (const fragment of privateMcpFragments(manifest))
    console.log(`  - ${fragment.id}: ${fragment.path}`)

  console.log('\nCodex skill installs:')
  for (const skill of privateSkillInstalls(manifest)) {
    const target = skill.targetName ? ` -> ${skill.targetName}` : ''
    const source = skill.source.path || skill.source.repo || '<missing source>'
    console.log(`  - ${skill.id}${target}: ${skill.source.type}:${source}`)
  }
}

function status(manifestPath: string, manifest: PrivateManifest, check: boolean): void {
  const errors = validatePrivateManifest(manifest)
  console.log(`Manifest: ${manifestPath}`)
  printValidation(errors, check)

  const opContext = tryLoadOpContext(manifestPath, manifest)
  const state = opReadinessState(manifestPath, manifest, opContext)
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
      const sourceState = fs.existsSync(source) ? 'ok' : 'missing'
      const output = template.outputPath || '<missing outputPath>'
      console.log(`[${sourceState}] template ${template.id}: ${template.path} -> ${output}`)
      if (sourceState === 'missing' && check)
        process.exitCode = 1
    }
    catch (error) {
      printStatusError(error, check)
    }
  }

  for (const template of privateSecretEnvTemplates(manifest)) {
    try {
      assertAllowedRead(template.path, contract)
      const source = resolveRepoPath(repoRoot, template.path)
      const sourceState = fs.existsSync(source) ? 'ok' : 'missing'
      const materializer = template.materializer ? ` (${template.materializer})` : ''
      console.log(`[${sourceState}] secret env template ${template.id}: ${template.path}${materializer}`)
      if (sourceState === 'missing' && check)
        process.exitCode = 1
    }
    catch (error) {
      printStatusError(error, check)
    }
  }

  for (const bundle of privateSecretFileBundles(manifest)) {
    for (const file of bundle.files) {
      const target = path.resolve(expandHome(file.path))
      const targetState = fs.existsSync(target) ? 'ok' : 'missing'
      console.log(`[${targetState}] secret file ${bundle.id}: ${file.path}`)
      if (targetState === 'missing' && check)
        process.exitCode = 1
    }
  }

  for (const fragment of privateMcpFragments(manifest)) {
    try {
      assertAllowedRead(fragment.path, contract)
      const source = resolveRepoPath(repoRoot, fragment.path)
      const sourceState = fs.existsSync(source) ? 'ok' : 'missing'
      console.log(`[${sourceState}] MCP fragment ${fragment.id}: ${fragment.path}`)
      if (sourceState === 'missing' && check)
        process.exitCode = 1
    }
    catch (error) {
      printStatusError(error, check)
    }
  }

  for (const skill of privateSkillInstalls(manifest)) {
    try {
      if (skill.source.type === 'local') {
        if (!skill.source.path)
          throw new Error(`local skill ${skill.id} has no source.path`)

        assertAllowedRead(skill.source.path, contract)
        const source = resolveRepoPath(repoRoot, skill.source.path)
        const sourceState = fs.existsSync(path.join(source, 'SKILL.md')) ? 'ok' : 'missing'
        console.log(`[${sourceState}] skill ${skill.id}: ${skill.source.path}`)
        if (sourceState === 'missing' && check)
          process.exitCode = 1
      }
      else {
        const source = skill.source.repo || '<missing repo>'
        console.log(`[configured] skill ${skill.id}: ${skill.source.type}:${source}`)
      }
    }
    catch (error) {
      printStatusError(error, check)
    }
  }
}

function printStatusError(error: unknown, check: boolean): void {
  const message = error instanceof Error ? error.message : String(error)
  console.log(`[error] ${message}`)
  if (check)
    process.exitCode = 1
}

function applyCodexOverlay(manifestPath: string, manifest: PrivateManifest, dryRun: boolean): void {
  applyPrivateCodexSkills(manifestPath, manifest, dryRun)
  applyPrivateCodexMcp(manifestPath, manifest, dryRun)
}

function apply(manifestPath: string, manifest: PrivateManifest, dryRun: boolean): void {
  const errors = validatePrivateManifest(manifest)
  if (errors.length > 0)
    throw new Error(`Invalid private overlay manifest:\n${errors.map(error => `- ${error}`).join('\n')}`)

  injectMcpTemplates(manifestPath, manifest, {
    dryRun,
    manifest: manifestPath,
    passthrough: [],
    positionals: [],
    scanMode: 'all',
    section: 'all',
    yes: !dryRun,
  })
  restoreSecretFileBundles(manifestPath, manifest, {
    dryRun,
    manifest: manifestPath,
    passthrough: [],
    positionals: [],
    scanMode: 'all',
    section: 'all',
    yes: !dryRun,
  })
  applyCodexOverlay(manifestPath, manifest, dryRun)
}

function shouldPrompt(): boolean {
  return !process.env.CI && process.stdin.isTTY && process.stdout.isTTY
}

function repoNameFromUrl(repo: string): string {
  const cleaned = repo.trim().replace(/\/$/, '').replace(/\.git$/, '')
  const match = cleaned.match(/[:/]([^/:]+)$/)
  return match?.[1] || 'dotfiles'
}

function defaultTargetDir(repo?: string): string {
  const name = repo ? repoNameFromUrl(repo) : 'dotfiles'
  return path.join(getHomeDir(), 'repos', 'private', name)
}

function normalizeYesNo(value: string): boolean | null {
  const normalized = value.trim().toLowerCase()
  if (['y', 'yes'].includes(normalized))
    return true

  if (['', 'n', 'no'].includes(normalized))
    return false

  return null
}

async function promptForConnectOptions(options: PrivateOptions): Promise<PrivateOptions | null> {
  if (!shouldPrompt()) {
    if (!options.repo)
      throw new Error('Missing --repo in non-interactive private overlay connect')

    return {
      ...options,
      targetDir: options.targetDir || defaultTargetDir(options.repo),
    }
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    const shouldConnectAnswer = await rl.question('Connect a private Git dotfiles repository? [y/N] ')
    const shouldConnect = normalizeYesNo(shouldConnectAnswer)

    if (shouldConnect !== true) {
      console.log('[skip] private dotfiles repository was not connected')
      return null
    }

    let repo = options.repo?.trim()
    while (!repo) {
      repo = (await rl.question('Paste private dotfiles Git URL: ')).trim()
      if (!repo)
        console.log('Git URL is required.')
    }

    const defaultDir = options.targetDir || defaultTargetDir(repo)
    const targetDirAnswer = await rl.question(`Local checkout path [${defaultDir}]: `)
    const targetDir = path.resolve(expandHome(targetDirAnswer.trim() || defaultDir))

    return {
      ...options,
      repo,
      targetDir,
    }
  }
  finally {
    rl.close()
  }
}

function isGitRepository(value: string): boolean {
  return fs.existsSync(path.join(value, '.git'))
}

function printRemote(value: string): void {
  const remote = commandOutput('git', ['remote', 'get-url', 'origin'], value)
  if (remote.status === 0 && remote.stdout)
    console.log(`[ok] existing repository origin: ${remote.stdout}`)
}

function clonePrivateRepo(repo: string, targetDir: string, dryRun: boolean): void {
  if (!commandExists('git'))
    throw new Error('git is required to connect a private dotfiles repository')

  if (fs.existsSync(targetDir)) {
    if (!isGitRepository(targetDir))
      throw new Error(`Target path exists but is not a Git repository: ${targetDir}`)

    console.log(`[ok] private dotfiles repository already exists: ${targetDir}`)
    printRemote(targetDir)
    return
  }

  console.log(`${dryRun ? '[dry-run]' : '[clone]'} git clone ${repo} ${targetDir}`)

  if (dryRun)
    return

  fs.mkdirSync(path.dirname(targetDir), { recursive: true })
  const result = spawnSync('git', ['clone', repo, targetDir], {
    stdio: 'inherit',
  })

  if (result.status !== 0)
    throw new Error(`git clone failed: ${repo}`)
}

async function connect(options: PrivateOptions): Promise<void> {
  const connectOptions = await promptForConnectOptions(options)
  if (!connectOptions)
    return

  if (!connectOptions.repo)
    throw new Error('Missing private dotfiles Git URL')

  const targetDir = connectOptions.targetDir || defaultTargetDir(connectOptions.repo)
  const dryRun = connectOptions.dryRun || !connectOptions.yes
  clonePrivateRepo(connectOptions.repo, targetDir, dryRun)

  const manifestPath = path.join(targetDir, 'config', 'sync-manifest.json')
  console.log(`Manifest path: ${manifestPath}`)

  if (dryRun) {
    console.log('Dry-run mode: pass --yes to clone the repository.')
    return
  }

  if (!fs.existsSync(manifestPath)) {
    console.log('[warn] config/sync-manifest.json was not found after clone')
    return
  }

  rememberPrivateManifestPath(manifestPath)
  console.log(`[ok] default private manifest saved: ${manifestPath}`)

  const manifest = readPrivateManifest(manifestPath)
  status(manifestPath, manifest, false)
}
