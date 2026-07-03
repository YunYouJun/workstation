import type { CommandResult, OpContext, PrivateManifest, PrivateOptions, SecretReference } from './types'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { commandExists, formatCommand } from './exec'
import { assertAllowedOutput, assertAllowedRead, privateEnvTemplate, privateTemplates } from './manifest'
import { expandHome, repoRootFromManifest, resolveManifestRelativePath, resolveRepoPath } from './paths'
import { isAsciiDigit, isAsciiLetter, parseEnvAssignment, readSecretReferences, secretReferencePath, unquote } from './secret-refs'

interface TokenCandidate {
  source: string
  value: string
}

interface OpItem {
  fields?: OpItemField[]
  tags?: string[]
  [key: string]: unknown
}

interface OpItemField {
  id?: string
  label?: string
  type?: string
  value?: unknown
  [key: string]: unknown
}

export function opReadinessState(manifestPath: string, manifest: PrivateManifest, context?: OpContext): 'available' | 'missing' | 'unavailable' {
  if (!commandExists('op'))
    return 'missing'

  if (context) {
    try {
      const refs = readSecretReferences(secretEnvFilePath(manifestPath, manifest))
      const probeRef = refs.find(ref => !ref.optional) || refs[0]

      if (probeRef && checkSecretReference(context, probeRef).ok)
        return 'available'
    }
    catch {
      // Fall back to op whoami when the manifest has no readable secret probe.
    }
  }

  return opState(context)
}

export function tryLoadOpContext(manifestPath: string, manifest: PrivateManifest): OpContext | undefined {
  try {
    return loadOpContext(manifestPath, manifest)
  }
  catch {
    return undefined
  }
}

export function checkMcpSecrets(manifestPath: string, manifest: PrivateManifest, envFileOverride?: string): void {
  const context = loadOpContext(manifestPath, manifest)
  const envFile = secretEnvFilePath(manifestPath, manifest, envFileOverride)
  const refs = readSecretReferences(envFile)
  let failed = false

  if (!commandExists('op'))
    throw new Error('1Password CLI was not found. Install op before checking MCP secrets.')

  console.log(`account: ${context.account}`)
  console.log(`env file: ${envFile}`)

  for (const ref of refs) {
    const result = checkSecretReference(context, ref)

    if (result.ok) {
      console.log(`ok: ${ref.ref}`)
      continue
    }

    if (ref.optional) {
      console.log(`optional missing, empty, or unreadable: ${ref.ref}`)
      continue
    }

    console.log(`missing, empty, or unreadable: ${ref.ref}`)
    failed = true
  }

  if (failed) {
    console.log('Create missing item/field values in 1Password; do not write real tokens to Git.')
    process.exitCode = 1
    return
  }

  console.log('1Password MCP secret references are ready.')
}

export function importMcpSecrets(manifestPath: string, manifest: PrivateManifest, envFileOverride: string | undefined, dryRun: boolean): void {
  const envFile = secretEnvFilePath(manifestPath, manifest, envFileOverride)
  const refs = readSecretReferences(envFile)
  const context = dryRun ? undefined : loadOpContext(manifestPath, manifest)
  const tempDir = dryRun ? undefined : createTempWorkspace()
  let imported = 0
  let requiredSkipped = 0

  if (!dryRun && !commandExists('op'))
    throw new Error('1Password CLI was not found. Install op before importing MCP secrets.')

  try {
    for (const ref of refs) {
      const candidate = findImportCandidate(ref)

      if (!candidate || !isUsableSecretValue(ref, candidate.value)) {
        console.log(`${ref.optional ? 'optional skip' : 'skip'}: ${ref.envName} was not found or does not look like a usable token`)
        if (!ref.optional)
          requiredSkipped += 1
        continue
      }

      if (dryRun) {
        console.log(`[dry-run] would import: ${secretReferencePath(ref)} (${candidate.source})`)
      }
      else {
        if (!context || !tempDir)
          throw new Error('1Password import context was not initialized')

        const action = upsertSecret(context, ref, candidate.value, tempDir)
        console.log(`${action}: ${secretReferencePath(ref)} (${candidate.source})`)
      }

      imported += 1
    }
  }
  finally {
    if (tempDir)
      removeTempWorkspace(tempDir)
  }

  if (imported === 0 && requiredSkipped > 0) {
    console.log('No tokens were imported. Set environment variables in the current shell and retry.')
    process.exitCode = 1
    return
  }

  if (requiredSkipped > 0) {
    console.log('Some tokens were imported or found, but required tokens are still missing.')
    process.exitCode = 2
    return
  }

  console.log(dryRun ? 'MCP secret import dry-run is complete.' : 'All MCP tokens were imported into 1Password.')
}

export function injectMcpTemplates(manifestPath: string, manifest: PrivateManifest, options: PrivateOptions): void {
  const dryRun = options.dryRun || !options.yes
  const templates = templateInjectionTargets(manifestPath, manifest, options)

  if (templates.length === 0) {
    console.log('[skip] no op-inject-template entries')
    return
  }

  const context = dryRun ? undefined : loadOpContext(manifestPath, manifest)
  if (!dryRun && !commandExists('op'))
    throw new Error('1Password CLI must be installed before injecting MCP templates')

  for (const template of templates)
    runOpInject(template.source, template.output, dryRun, context)
}

export function runMcpCommand(manifestPath: string, manifest: PrivateManifest, options: PrivateOptions): void {
  const command = options.passthrough.length > 0 ? options.passthrough : options.positionals
  if (command.length === 0) {
    console.log('Usage: wst private mcp-run --manifest <path> -- <command> [args...]')
    process.exitCode = 2
    return
  }

  if (!commandExists('op'))
    throw new Error('1Password CLI was not found. Install op before running MCP commands.')

  const context = loadOpContext(manifestPath, manifest)
  const envFile = secretEnvFilePath(manifestPath, manifest, options.envFile)
  const result = spawnSync('op', ['run', '--env-file', envFile, '--', ...command], {
    env: opEnv(context),
    stdio: 'inherit',
  })

  process.exitCode = result.status ?? 1
}

function opState(context?: OpContext): 'available' | 'missing' | 'unavailable' {
  if (!commandExists('op'))
    return 'missing'

  const result = spawnSync('op', ['whoami'], {
    encoding: 'utf8',
    env: context ? opEnv(context) : process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return result.status === 0 ? 'available' : 'unavailable'
}

function secretEnvFilePath(manifestPath: string, manifest: PrivateManifest, envFileOverride?: string): string {
  if (envFileOverride)
    return envFileOverride

  if (process.env.MCP_ENV_FILE)
    return path.resolve(expandHome(process.env.MCP_ENV_FILE))

  const template = privateEnvTemplate(manifest)
  if (template) {
    if (manifest.workstationOverlay)
      assertAllowedRead(template.path, manifest.workstationOverlay)

    return resolveRepoPath(repoRootFromManifest(manifestPath), template.path)
  }

  return resolveRepoPath(repoRootFromManifest(manifestPath), 'mcp/mcp.env.example')
}

function checkSecretReference(context: OpContext, ref: SecretReference): { ok: boolean, ref: SecretReference } {
  const result = runOp(context, ['read', secretReferencePath(ref)], { allowFailure: true })

  return {
    ok: result.status === 0 && result.stdout.length > 0,
    ref,
  }
}

export function loadOpContext(manifestPath: string, manifest: PrivateManifest): OpContext {
  const repoRoot = repoRootFromManifest(manifestPath)
  const accountEnvPath = manifest.policy?.opAccount?.accountEnvPath || 'mcp/op-account.env.example'
  const accountExample = resolveRepoPath(repoRoot, accountEnvPath)
  const accountLocal = accountExample.replace(/\.example$/, '.local')
  const accountFiles = [accountLocal, accountExample]

  let account = process.env.OP_ACCOUNT
  let itemTagsRaw = process.env.OP_ITEM_TAGS
  let accountFile: string | undefined

  for (const file of accountFiles) {
    const parsed = readEnvFile(file)

    if (!account && parsed.OP_ACCOUNT) {
      account = parsed.OP_ACCOUNT
      accountFile = file
    }

    itemTagsRaw ||= parsed.OP_ITEM_TAGS

    if (account && itemTagsRaw)
      break
  }

  account ||= manifest.policy?.opAccount?.defaultUserId || manifest.policy?.opAccount?.defaultName

  if (!account)
    throw new Error('OP_ACCOUNT is not set. Set OP_ACCOUNT or configure policy.opAccount.defaultUserId.')

  return {
    account,
    accountFile,
    itemTags: parseTags(itemTagsRaw || 'Tencent'),
    repoRoot,
    vault: process.env.OP_VAULT || manifest.policy?.opAccount?.vault,
  }
}

function parseTags(value: string): string[] {
  return value
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean)
}

function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file))
    return {}

  const output: Record<string, string> = {}
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)

  for (const line of lines) {
    const assignment = parseEnvAssignment(line)
    if (!assignment)
      continue

    output[assignment.key] = unquote(assignment.value)
  }

  return output
}

function findImportCandidate(ref: SecretReference): TokenCandidate | undefined {
  const envValue = process.env[ref.envName]
  if (envValue)
    return { source: `env:${ref.envName}`, value: envValue }

  const codexValue = readCodexTomlValue(process.env.CODEX_CONFIG_FILE || path.join(os.homedir(), '.codex/config.toml'), ref)
  if (codexValue)
    return codexValue

  const mcpFiles = [
    process.env.CURSOR_MCP_FILE || path.join(os.homedir(), '.cursor/mcp.json'),
    process.env.CLAUDE_MCP_FILE || path.join(os.homedir(), '.claude/.mcp.json'),
  ]

  for (const file of mcpFiles) {
    const value = readMcpJsonEnvValue(file, ref.envName)
    if (value)
      return { source: file, value }
  }

  return undefined
}

function isUsableSecretValue(ref: SecretReference, value: string): boolean {
  const minLength = minimumSecretLength(ref.envName)

  if (!value || value.length < minLength)
    return false

  if (value === ref.envName)
    return false

  if (value.startsWith('op://') || value.startsWith('$'))
    return false

  if (/^<.*>$/.test(value))
    return false

  if (/^(?:change_me|todo|token)$/i.test(value))
    return false

  return true
}

function minimumSecretLength(envName: string): number {
  if (envName === 'GITHUB_PERSONAL_ACCESS_TOKEN')
    return 20

  return 8
}

function readMcpJsonEnvValue(file: string, envName: string): string | undefined {
  if (!fs.existsSync(file))
    return undefined

  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  const servers = data?.mcpServers

  if (!servers || typeof servers !== 'object')
    return undefined

  for (const config of Object.values(servers)) {
    const value = (config as { env?: Record<string, unknown> })?.env?.[envName]
    if (typeof value === 'string' && value)
      return value
  }

  return undefined
}

function readCodexTomlValue(file: string, ref: SecretReference): TokenCandidate | undefined {
  if (!fs.existsSync(file))
    return undefined

  const sections = readTomlSections(file)

  for (const [section, values] of sections) {
    if (!/^mcp_servers\.[^.]+\.env$/.test(section))
      continue

    const value = values.get(ref.envName)
    if (value)
      return { source: `${file}:${section}.${ref.envName}`, value }
  }

  if (ref.envName === 'GONGFENG_TOKEN') {
    const value = sections.get('mcp_servers.gongfeng.http_headers')?.get('Authorization')
    if (!value)
      return undefined

    const credential = bearerCredential(value) ?? value

    return {
      source: `${file}:mcp_servers.gongfeng.http_headers.Authorization`,
      value: credential,
    }
  }

  return undefined
}

function readTomlSections(file: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>()
  let section = ''

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/)
    if (sectionMatch) {
      section = sectionMatch[1]
      sections.set(section, sections.get(section) ?? new Map())
      continue
    }

    const valueEntry = parseTomlQuotedValue(line)
    if (!valueEntry)
      continue

    sections.set(section, sections.get(section) ?? new Map())
    sections.get(section)?.set(valueEntry.key, valueEntry.value)
  }

  return sections
}

function bearerCredential(value: string): string | undefined {
  if (!value.toLowerCase().startsWith('bearer '))
    return undefined

  return value.slice('bearer '.length)
}

function parseTomlQuotedValue(line: string): { key: string, value: string } | undefined {
  const equalsIndex = line.indexOf('=')
  if (equalsIndex === -1)
    return undefined

  const key = line.slice(0, equalsIndex).trim()
  if (!isTomlKey(key))
    return undefined

  const rawValue = line.slice(equalsIndex + 1).trim()
  const quote = rawValue[0]
  if (quote !== '"' && quote !== '\'')
    return undefined

  let value = ''
  for (let index = 1; index < rawValue.length; index += 1) {
    const char = rawValue[index]
    if (char === quote)
      return { key, value }

    value += char
  }

  return undefined
}

function isTomlKey(value: string): boolean {
  if (!value)
    return false

  for (const char of value) {
    if (!isAsciiLetter(char) && !isAsciiDigit(char) && char !== '_' && char !== '.' && char !== '-')
      return false
  }

  return true
}

export function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workstation-op-'))
  chmodPrivateDirectory(dir)
  return dir
}

function chmodPrivateDirectory(dir: string): void {
  fs.chmodSync(dir, 0o700)
}

export function removeTempWorkspace(dir: string): void {
  fs.rmSync(dir, { force: true, recursive: true })
}

function upsertSecret(context: OpContext, ref: SecretReference, value: string, tempDir: string): 'created' | 'updated' {
  const currentPath = path.join(tempDir, `${ref.item}.current.json`)
  const nextPath = path.join(tempDir, `${ref.item}.next.json`)
  const vault = context.vault || ref.vault
  const getResult = runOp(context, ['item', 'get', ref.item, '--vault', vault, '--format', 'json', '--reveal'], {
    allowFailure: true,
  })

  if (getResult.status === 0) {
    writePrivateFile(currentPath, getResult.stdout)
    const currentItem = JSON.parse(getResult.stdout) as OpItem
    const nextItem = mergeSecretField(currentItem, ref, value, context.itemTags)
    writePrivateJson(nextPath, nextItem)
    runOp(context, ['item', 'edit', ref.item, '--vault', vault, '--template', nextPath])
    return 'updated'
  }

  writePrivateJson(nextPath, createApiCredentialItem(ref, value, context.itemTags))
  runOp(context, ['item', 'create', '--vault', vault, '--template', nextPath])
  return 'created'
}

function createApiCredentialItem(ref: SecretReference, value: string, tags: string[]): Record<string, unknown> {
  return {
    title: ref.item,
    category: 'API_CREDENTIAL',
    tags,
    fields: [
      {
        id: 'notesPlain',
        type: 'STRING',
        purpose: 'NOTES',
        label: 'notesPlain',
        value: 'Managed by workstation private tooling. Do not store this value in Git.',
      },
      {
        id: ref.field,
        type: 'CONCEALED',
        label: ref.field,
        value,
      },
    ],
  }
}

function mergeSecretField(item: OpItem, ref: SecretReference, value: string, tags: string[]): OpItem {
  item.fields ||= []
  item.tags = mergeTags(item.tags, tags)

  let target = item.fields.find(entry => entry.label === ref.field)
  if (!target) {
    target = {
      id: ref.field,
      type: 'CONCEALED',
      label: ref.field,
      value: '',
    }
    item.fields.push(target)
  }

  target.type = 'CONCEALED'
  target.value = value

  return item
}

function mergeTags(existing: string[] | undefined, added: string[]): string[] {
  return [...new Set([...(existing || []), ...added].filter(Boolean))]
}

export function writePrivateJson(file: string, value: unknown): void {
  writePrivateFile(file, `${JSON.stringify(value, null, 2)}\n`)
}

export function writePrivateFile(file: string, contents: string): void {
  fs.writeFileSync(file, contents, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}

export function opEnv(context: OpContext): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OP_ACCOUNT: context.account,
  }
}

export function runOp(context: OpContext, args: string[], options: { allowFailure?: boolean } = {}): CommandResult {
  const result = spawnSync('op', args, {
    encoding: 'utf8',
    env: opEnv(context),
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const status = result.status ?? 1
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''

  if (!options.allowFailure && status !== 0) {
    const rendered = formatCommand('op', args)
    throw new Error(`${rendered} failed with exit code ${status}\n${stderr}`.trim())
  }

  return { status, stdout, stderr }
}

function runOpInject(source: string, output: string, dryRun: boolean, context?: OpContext): void {
  console.log(`${dryRun ? '[dry-run]' : '[apply]'} op inject ${source} -> ${output}`)

  if (dryRun)
    return

  if (!context)
    throw new Error('1Password account context is required for op inject')

  fs.mkdirSync(path.dirname(output), { recursive: true })

  if (fs.existsSync(output)) {
    const backup = backupPath(output)
    fs.copyFileSync(output, backup)
    console.log(`[backup] ${backup}`)
  }

  const result = spawnSync('op', ['inject', '--in-file', source, '--out-file', output], {
    env: opEnv(context),
    stdio: 'inherit',
  })

  if (result.status !== 0)
    throw new Error(`op inject failed for ${source}`)

  fs.chmodSync(output, 0o600)
  console.log(`[ok] wrote local ignored output ${output}`)
}

function backupPath(value: string): string {
  return `${value}.backup.${Date.now()}`
}

function templateInjectionTargets(manifestPath: string, manifest: PrivateManifest, options: PrivateOptions): Array<{ output: string, source: string }> {
  const repoRoot = repoRootFromManifest(manifestPath)
  const contract = manifest.workstationOverlay

  if (options.template || options.positionals.length > 0) {
    const templatePath = options.template || options.positionals[0]
    if (!templatePath)
      throw new Error('Missing MCP template path')

    const outputPath = options.output || options.positionals[1] || privateTemplates(manifest)[0]?.outputPath
    if (!outputPath)
      throw new Error('Missing MCP template output path')

    const relativeTemplate = path.isAbsolute(templatePath) ? path.relative(repoRoot, templatePath) : templatePath
    const relativeOutput = path.isAbsolute(outputPath) ? path.relative(repoRoot, outputPath) : outputPath
    if (contract)
      assertAllowedRead(relativeTemplate, contract)
    assertAllowedOutput(relativeOutput, manifest)

    return [{
      source: resolveManifestRelativePath(manifestPath, templatePath),
      output: resolveManifestRelativePath(manifestPath, outputPath),
    }]
  }

  return privateTemplates(manifest).map((template) => {
    if (!template.outputPath)
      throw new Error(`template ${template.id} has no outputPath`)

    if (contract)
      assertAllowedRead(template.path, contract)
    assertAllowedOutput(template.outputPath, manifest)

    const source = resolveRepoPath(repoRoot, template.path)
    if (!fs.existsSync(source))
      throw new Error(`Template does not exist: ${source}`)

    return {
      source,
      output: resolveRepoPath(repoRoot, template.outputPath),
    }
  })
}
