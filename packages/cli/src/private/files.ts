import type { OpContext, PrivateManifest, PrivateOptions, SecretFileBundle, SecretFileBundleFile } from './types'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { commandExists } from './exec'
import { privateSecretFileBundles } from './manifest'
import { createTempWorkspace, loadOpContext, removeTempWorkspace, runOp } from './op'
import { expandHome } from './paths'

export function restoreSecretFileBundles(manifestPath: string, manifest: PrivateManifest, options: PrivateOptions): void {
  const dryRun = options.dryRun || !options.yes
  const bundles = secretFileRestoreTargets(manifest, options)

  if (bundles.length === 0) {
    console.log('[skip] no op-file-restore bundles')
    return
  }

  if (!dryRun && !commandExists('op'))
    throw new Error('1Password CLI was not found. Install op before restoring secret files.')

  const context = dryRun ? undefined : loadOpContext(manifestPath, manifest)
  const tempDir = dryRun ? undefined : createTempWorkspace()

  try {
    for (const bundle of bundles)
      restoreSecretFileBundle(bundle, dryRun, context, tempDir)
  }
  finally {
    if (tempDir)
      removeTempWorkspace(tempDir)
  }
}

function secretFileRestoreTargets(manifest: PrivateManifest, options: PrivateOptions): SecretFileBundle[] {
  const bundles = privateSecretFileBundles(manifest)
  const requested = options.bundle || options.positionals[0]
  if (!requested)
    return bundles

  const bundle = bundles.find(item => item.id === requested)
  if (!bundle)
    throw new Error(`Unknown secret file bundle: ${requested}`)

  return [bundle]
}

function restoreSecretFileBundle(bundle: SecretFileBundle, dryRun: boolean, context?: OpContext, tempDir?: string): void {
  console.log(`${dryRun ? '[dry-run]' : '[apply]'} secret file bundle ${bundle.id}`)

  for (const file of bundle.files) {
    const target = resolveHomeFilePath(file.path)
    const fileMode = parseMode(file.mode, 0o600)
    const directoryMode = parseMode(file.directoryMode || bundle.directoryMode, 0o700)

    if (dryRun) {
      console.log(`[dry-run] would restore ${file.ref} -> ${target} (mode ${formatMode(fileMode)})`)
      continue
    }

    if (!context || !tempDir)
      throw new Error('1Password account context was not initialized')

    restoreSecretFile(context, file, target, fileMode, directoryMode, tempDir)
  }
}

function restoreSecretFile(context: OpContext, file: SecretFileBundleFile, target: string, fileMode: number, directoryMode: number, tempDir: string): void {
  const targetDir = path.dirname(target)
  const tempFile = path.join(tempDir, `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.${path.basename(target)}`)

  fs.mkdirSync(targetDir, { mode: directoryMode, recursive: true })
  fs.chmodSync(targetDir, directoryMode)
  runOp(context, ['read', '--force', '--out-file', tempFile, file.ref])

  if (fs.existsSync(target)) {
    const backup = `${target}.backup.${Date.now()}`
    fs.copyFileSync(target, backup)
    fs.chmodSync(backup, fileMode)
    console.log(`[backup] ${backup}`)
  }

  fs.copyFileSync(tempFile, target)
  fs.rmSync(tempFile, { force: true })
  fs.chmodSync(target, fileMode)
  console.log(`[ok] restored ${target}`)
}

function resolveHomeFilePath(value: string): string {
  const home = path.resolve(expandHome('~'))
  const resolved = path.resolve(expandHome(value))
  const relative = path.relative(home, resolved)

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error(`Secret file output must stay under $HOME: ${value}`)

  return resolved
}

function parseMode(value: string | undefined, fallback: number): number {
  if (!value)
    return fallback

  if (!/^[0-7]{3,4}$/.test(value))
    throw new Error(`Invalid file mode: ${value}`)

  return Number.parseInt(value, 8)
}

function formatMode(value: number): string {
  return value.toString(8).padStart(4, '0')
}
