import type { OpContext, PrivateManifest, PrivateOptions, SecretReference } from './types'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { commandExists } from './exec'
import { assertAllowedRead, privateSecretEnvTemplate, privateSecretEnvTemplates } from './manifest'
import { createTempWorkspace, loadOpContext, removeTempWorkspace, runOp, writePrivateJson } from './op'
import { repoRootFromManifest, resolvePathOption, resolveRepoPath } from './paths'
import { readSecretReferences, secretReferencePath } from './secret-refs'

interface AppStoreConnectSecrets {
  issuerId: string
  keyId: string
  privateKey: string
}

const appStoreConnectTemplateId = 'ios-app-store-connect'

export function importIosSecrets(manifestPath: string, manifest: PrivateManifest, options: PrivateOptions): void {
  const dryRun = options.dryRun || !options.yes
  const envFile = iosEnvFilePath(manifestPath, manifest, options.envFile)
  const refs = readSecretReferences(envFile)
  const secrets = appStoreConnectSecretsFromCurrentEnv(refs)

  if (dryRun) {
    for (const ref of appStoreConnectRefs(refs))
      console.log(`[dry-run] would import: ${secretReferencePath(ref)}`)

    console.log('App Store Connect secret import dry-run is complete.')
    return
  }

  if (!commandExists('op'))
    throw new Error('1Password CLI was not found. Install op before importing iOS secrets.')

  const context = loadOpContext(manifestPath, manifest)
  const tempDir = createTempWorkspace()

  try {
    const action = upsertAppStoreConnectItem(context, refs, secrets, tempDir)
    console.log(`${action}: ${appStoreConnectSummary(refs)}`)
  }
  finally {
    removeTempWorkspace(tempDir)
  }
}

export function runIosCommand(manifestPath: string, manifest: PrivateManifest, options: PrivateOptions): void {
  const command = commandFromOptions(options, 'wst private ios-run --manifest <path> -- <command> [args...]')
  if (!command)
    return

  if (!commandExists('op'))
    throw new Error('1Password CLI was not found. Install op before running iOS commands.')

  const context = loadOpContext(manifestPath, manifest)
  const envFile = iosEnvFilePath(manifestPath, manifest, options.envFile)
  const refs = readSecretReferences(envFile)
  const env = materializeAppStoreConnectEnv({
    ...process.env,
    ...readOpEnv(context, refs),
  })

  const result = spawnSync(command[0], command.slice(1), {
    env,
    stdio: 'inherit',
  })

  process.exitCode = result.status ?? 1
}

export function materializeIosCommand(options: PrivateOptions): void {
  const command = commandFromOptions(options, 'wst private ios-materialize -- <command> [args...]')
  if (!command)
    return

  const env = materializeAppStoreConnectEnv(process.env)
  const result = spawnSync(command[0], command.slice(1), {
    env,
    stdio: 'inherit',
  })

  process.exitCode = result.status ?? 1
}

function iosEnvFilePath(manifestPath: string, manifest: PrivateManifest, envFileOverride?: string): string {
  if (envFileOverride)
    return resolvePathOption(envFileOverride)

  const template = privateSecretEnvTemplate(manifest, appStoreConnectTemplateId)
    || privateSecretEnvTemplates(manifest).find(item => item.materializer === 'app-store-connect-key')

  if (!template)
    throw new Error('No App Store Connect env template configured. Add secrets.envTemplates with materializer "app-store-connect-key".')

  if (manifest.workstationOverlay)
    assertAllowedRead(template.path, manifest.workstationOverlay)

  return resolveRepoPath(repoRootFromManifest(manifestPath), template.path)
}

function commandFromOptions(options: PrivateOptions, usage: string): string[] | undefined {
  const command = options.passthrough.length > 0 ? options.passthrough : options.positionals
  if (command.length > 0)
    return command

  console.log(`Usage: ${usage}`)
  process.exitCode = 2
  return undefined
}

function readOpEnv(context: OpContext, refs: SecretReference[]): Record<string, string> {
  const output: Record<string, string> = {}

  for (const ref of appStoreConnectRefs(refs)) {
    const result = runOp(context, ['read', secretReferencePath(ref)])
    output[ref.envName] = trimOneTrailingNewline(result.stdout)
  }

  return output
}

function appStoreConnectSecretsFromCurrentEnv(refs: SecretReference[]): AppStoreConnectSecrets {
  const envNames = new Set(appStoreConnectRefs(refs).map(ref => ref.envName))
  const keyId = process.env.ASC_KEY_ID
  const issuerId = process.env.ASC_ISSUER_ID
  const privateKey = process.env.ASC_KEY_P8_CONTENT || readPrivateKeyFile(process.env.ASC_KEY_P8)
  const missing: string[] = []

  if (envNames.has('ASC_KEY_ID') && !keyId)
    missing.push('ASC_KEY_ID')

  if (envNames.has('ASC_ISSUER_ID') && !issuerId)
    missing.push('ASC_ISSUER_ID')

  if (envNames.has('ASC_KEY_P8_CONTENT') && !privateKey)
    missing.push('ASC_KEY_P8_CONTENT or readable ASC_KEY_P8')

  if (missing.length > 0)
    throw new Error(`Missing App Store Connect import values: ${missing.join(', ')}`)

  return validateAppStoreConnectSecrets({
    issuerId: issuerId || '',
    keyId: keyId || '',
    privateKey: privateKey || '',
  })
}

function readPrivateKeyFile(file: string | undefined): string | undefined {
  if (!file)
    return undefined

  const resolved = resolvePathOption(file)
  if (!fs.existsSync(resolved))
    return undefined

  return fs.readFileSync(resolved, 'utf8')
}

function materializeAppStoreConnectEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const secrets = validateAppStoreConnectSecrets({
    issuerId: source.ASC_ISSUER_ID || '',
    keyId: source.ASC_KEY_ID || '',
    privateKey: source.ASC_KEY_P8_CONTENT || '',
  })
  const keyPath = appStoreConnectKeyPath(source, secrets.keyId)

  fs.mkdirSync(path.dirname(keyPath), { mode: 0o700, recursive: true })
  writePrivateKeyFile(keyPath, secrets.privateKey)

  const env: NodeJS.ProcessEnv = {
    ...source,
    ASC_KEY_ID: secrets.keyId,
    ASC_ISSUER_ID: secrets.issuerId,
    ASC_KEY_P8: keyPath,
  }
  delete env.ASC_KEY_P8_CONTENT

  return env
}

function validateAppStoreConnectSecrets(secrets: AppStoreConnectSecrets): AppStoreConnectSecrets {
  const missing: string[] = []

  if (!secrets.keyId)
    missing.push('ASC_KEY_ID')

  if (!secrets.issuerId)
    missing.push('ASC_ISSUER_ID')

  if (!secrets.privateKey)
    missing.push('ASC_KEY_P8_CONTENT')

  if (missing.length > 0)
    throw new Error(`Missing App Store Connect values: ${missing.join(', ')}`)

  if (!secrets.privateKey.includes('BEGIN PRIVATE KEY'))
    throw new Error('ASC_KEY_P8_CONTENT does not look like a .p8 private key')

  return secrets
}

function appStoreConnectKeyPath(env: NodeJS.ProcessEnv, keyId: string): string {
  const keyDir = resolvePathOption(env.ASC_KEY_DIR || '~/.appstoreconnect/private_keys')
  return resolvePathOption(env.ASC_KEY_P8 || path.join(keyDir, `AuthKey_${keyId}.p8`))
}

function writePrivateKeyFile(file: string, privateKey: string): void {
  const tempFile = path.join(path.dirname(file), `.AuthKey.${process.pid}.${Date.now()}`)

  try {
    fs.writeFileSync(tempFile, `${trimOneTrailingNewline(privateKey)}\n`, { mode: 0o600 })
    fs.chmodSync(tempFile, 0o600)
    fs.renameSync(tempFile, file)
    fs.chmodSync(file, 0o600)
  }
  catch (error) {
    fs.rmSync(tempFile, { force: true })
    throw error
  }
}

function upsertAppStoreConnectItem(context: OpContext, refs: SecretReference[], secrets: AppStoreConnectSecrets, tempDir: string): 'created' | 'updated' {
  const targetRefs = appStoreConnectRefs(refs)
  const firstRef = targetRefs[0]
  const vault = context.vault || firstRef.vault
  const itemPath = path.join(tempDir, 'app-store-connect.item.json')
  const item = createAppStoreConnectItem(firstRef.item, secrets, context.itemTags)
  const existing = runOp(context, ['item', 'get', firstRef.item, '--vault', vault, '--format', 'json'], {
    allowFailure: true,
  })

  writePrivateJson(itemPath, item)

  if (existing.status === 0) {
    runOp(context, ['item', 'edit', firstRef.item, '--vault', vault, '--template', itemPath])
    return 'updated'
  }

  runOp(context, ['item', 'create', '--vault', vault, '--template', itemPath])
  return 'created'
}

function createAppStoreConnectItem(title: string, secrets: AppStoreConnectSecrets, tags: string[]): Record<string, unknown> {
  return {
    title,
    category: 'API_CREDENTIAL',
    tags,
    fields: [
      {
        id: 'notesPlain',
        type: 'STRING',
        purpose: 'NOTES',
        label: 'notesPlain',
        value: 'App Store Connect API key for local iOS TestFlight uploads. Store op:// references in Git.',
      },
      {
        id: 'key_id',
        type: 'STRING',
        label: 'key_id',
        value: secrets.keyId,
      },
      {
        id: 'issuer_id',
        type: 'CONCEALED',
        label: 'issuer_id',
        value: secrets.issuerId,
      },
      {
        id: 'private_key',
        type: 'CONCEALED',
        label: 'private_key',
        value: secrets.privateKey,
      },
      {
        id: 'filename',
        type: 'STRING',
        label: 'filename',
        value: `AuthKey_${secrets.keyId}.p8`,
      },
    ],
  }
}

function appStoreConnectRefs(refs: SecretReference[]): SecretReference[] {
  const required = ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_P8_CONTENT']
  const selected = required.map((envName) => {
    const ref = refs.find(item => item.envName === envName)
    if (!ref)
      throw new Error(`App Store Connect env template is missing ${envName}`)

    return ref
  })
  const itemNames = new Set(selected.map(ref => `${ref.vault}/${ref.item}`))

  if (itemNames.size !== 1)
    throw new Error('App Store Connect env refs must point to one 1Password item')

  return selected
}

function appStoreConnectSummary(refs: SecretReference[]): string {
  const ref = appStoreConnectRefs(refs)[0]
  return `op://${ref.vault}/${ref.item}/{key_id,issuer_id,private_key}`
}

function trimOneTrailingNewline(value: string): string {
  return value.replace(/\r?\n$/, '')
}
