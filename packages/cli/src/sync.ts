import type { DotfileEntry } from './config'
import { execFileSync, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import * as p from '@clack/prompts'
import consola from 'consola'
import { isChezmoiMissing, spawnChezmoi } from './chezmoi'
import { dotfiles, resolveSource, resolveTarget } from './config'
import { detectSecrets, findPlaceholders, loadSecretsFile, maskSecrets, saveSecrets, unmaskSecrets } from './secrets'

export type SyncDirection = 'push' | 'pull'
export type SyncMode = 'link' | 'copy'

export interface SyncOptions {
  direction: SyncDirection
  mode: SyncMode
  force: boolean
  dryRun: boolean
}

interface SyncResult {
  entry: DotfileEntry
  status: 'created' | 'skipped' | 'updated' | 'error'
  message: string
  secretsFound?: number
}

const SYNC_META_RE = /^# synced by @yunyoujun\/dotfiles at .+\n?/m
const ISO_MS_RE = /\.\d+Z$/

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir))
    fs.mkdirSync(dir, { recursive: true })
}

/**
 * 获取同步元信息注释（时间 + commit hash）
 * 仅用于 pull 到本地时追加
 */
function getSyncMeta(): string {
  const time = new Date().toISOString().replace(ISO_MS_RE, '')
  let hash = ''
  try {
    hash = execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  }
  catch {}
  const hashPart = hash ? ` (${hash})` : ''
  return `# synced by @yunyoujun/workstation at ${time}${hashPart}\n`
}

function isSymlink(targetPath: string): boolean {
  try {
    return fs.lstatSync(targetPath).isSymbolicLink()
  }
  catch {
    return false
  }
}

function backupFile(filePath: string) {
  const backupPath = `${filePath}.backup.${Date.now()}`
  fs.copyFileSync(filePath, backupPath)
  return backupPath
}

function normalizeSyncedContent(content: string): string {
  return `${content.replace(SYNC_META_RE, '').trimEnd()}\n`
}

function maskContentSecrets(content: string) {
  const secrets = detectSecrets(content)
  return {
    content: secrets.length > 0 ? maskSecrets(content, secrets) : content,
    secretsFound: secrets.length,
  }
}

function printMaskedDiff(sourceLabel: string, targetLabel: string, sourceContent: string, targetContent: string) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotfiles-diff-'))
  const sourcePath = path.join(tempDir, 'repo')
  const targetPath = path.join(tempDir, 'home')

  try {
    fs.writeFileSync(sourcePath, sourceContent, 'utf-8')
    fs.writeFileSync(targetPath, targetContent, 'utf-8')

    const output = execFileSync('diff', [
      '--color=always',
      '-u',
      '--label',
      sourceLabel,
      '--label',
      targetLabel,
      sourcePath,
      targetPath,
    ], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    console.log(output)
  }
  catch (e: any) {
    if (e.stdout)
      console.log(e.stdout)
  }
  finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

/**
 * push: 从用户目录 → 仓库（自动 mask tokens）
 */
function pushEntry(entry: DotfileEntry, options: SyncOptions): SyncResult {
  const repoPath = resolveSource(entry)
  const homePath = resolveTarget(entry)

  if (!fs.existsSync(homePath)) {
    return {
      entry,
      status: 'error',
      message: `Home file not found: ${homePath}`,
    }
  }

  let content = fs.readFileSync(homePath, 'utf-8')

  // 移除 pull 时注入的同步元信息
  content = `${content.replace(SYNC_META_RE, '').trimEnd()}\n`

  // 检测 & mask secrets
  const secrets = detectSecrets(content)
  if (secrets.length > 0) {
    if (!options.dryRun) {
      // 先保存真实值到 .env.local
      saveSecrets(secrets)
    }
    content = maskSecrets(content, secrets)
  }

  if (options.dryRun) {
    const secretsInfo = secrets.length > 0 ? ` (${secrets.length} secrets masked)` : ''
    return {
      entry,
      status: 'created',
      message: `[dry-run] Would push: ${homePath} → ${repoPath}${secretsInfo}`,
      secretsFound: secrets.length,
    }
  }

  // 检查是否有变更
  if (fs.existsSync(repoPath)) {
    const existing = fs.readFileSync(repoPath, 'utf-8')
    if (existing === content) {
      return {
        entry,
        status: 'skipped',
        message: 'Already up to date',
      }
    }

    if (!options.force) {
      return {
        entry,
        status: 'skipped',
        message: `Repo file exists and differs (use --force to overwrite): ${repoPath}`,
      }
    }

    backupFile(repoPath)
  }

  ensureDir(repoPath)
  fs.writeFileSync(repoPath, content, 'utf-8')

  const secretsInfo = secrets.length > 0 ? ` (${secrets.length} secrets masked)` : ''
  return {
    entry,
    status: 'created',
    message: `Pushed: ${homePath} → ${repoPath}${secretsInfo}`,
    secretsFound: secrets.length,
  }
}

/**
 * pull: 从仓库 → 用户目录（自动 unmask tokens, 或 symlink）
 */
function pullEntry(entry: DotfileEntry, options: SyncOptions): SyncResult {
  const repoPath = resolveSource(entry)
  const homePath = resolveTarget(entry)

  if (!fs.existsSync(repoPath)) {
    return {
      entry,
      status: 'error',
      message: `Repo file not found: ${repoPath}`,
    }
  }

  const repoContent = fs.readFileSync(repoPath, 'utf-8')
  const placeholders = findPlaceholders(repoContent)
  const hasPlaceholders = placeholders.length > 0

  // 如果有占位符，必须用 copy 模式（需要替换内容）
  const effectiveMode = hasPlaceholders ? 'copy' : options.mode

  if (options.dryRun) {
    const action = effectiveMode === 'link' ? 'link' : 'copy'
    const secretsInfo = hasPlaceholders ? ` (${placeholders.length} secrets to restore)` : ''
    return {
      entry,
      status: 'created',
      message: `[dry-run] Would ${action}: ${repoPath} → ${homePath}${secretsInfo}`,
    }
  }

  // 目标已存在
  if (fs.existsSync(homePath) || isSymlink(homePath)) {
    if (effectiveMode === 'link' && isSymlink(homePath)) {
      const linkTarget = fs.readlinkSync(homePath)
      if (linkTarget === repoPath) {
        return {
          entry,
          status: 'skipped',
          message: 'Already linked',
        }
      }
    }

    if (!options.force) {
      return {
        entry,
        status: 'skipped',
        message: `Target exists (use --force to overwrite): ${homePath}`,
      }
    }

    const backupPath = backupFile(homePath)
    consola.info(`Backed up: ${homePath} → ${backupPath}`)
    fs.unlinkSync(homePath)
  }

  ensureDir(homePath)

  if (effectiveMode === 'link') {
    fs.symlinkSync(repoPath, homePath)
    return {
      entry,
      status: 'created',
      message: `Linked: ${repoPath} → ${homePath}`,
    }
  }

  // copy 模式：替换占位符后写入
  let finalContent = repoContent
  let missing: string[] = []

  if (hasPlaceholders) {
    const secretsMap = loadSecretsFile()
    const result = unmaskSecrets(repoContent, secretsMap)
    finalContent = result.content
    missing = result.missing
  }

  if (entry.appendSyncMeta === false)
    finalContent = `${finalContent.trimEnd()}\n`
  else
    finalContent = `${finalContent.trimEnd()}\n${getSyncMeta()}`

  fs.writeFileSync(homePath, finalContent, 'utf-8')

  if (missing.length > 0) {
    return {
      entry,
      status: 'created',
      message: `Copied with ${placeholders.length - missing.length}/${placeholders.length} secrets restored (missing: ${missing.join(', ')})`,
    }
  }

  const secretsInfo = hasPlaceholders ? ` (${placeholders.length} secrets restored)` : ''
  return {
    entry,
    status: 'created',
    message: `Copied: ${repoPath} → ${homePath}${secretsInfo}`,
  }
}

function syncEntry(entry: DotfileEntry, options: SyncOptions): SyncResult {
  return options.direction === 'push'
    ? pushEntry(entry, options)
    : pullEntry(entry, options)
}

function printResults(results: SyncResult[]) {
  for (const result of results) {
    const icon = result.status === 'created'
      ? '✔'
      : result.status === 'skipped'
        ? '○'
        : '✖'
    const label = result.entry.description || result.entry.source
    consola.log(`  ${icon} ${label}: ${result.message}`)
  }

  const created = results.filter(r => r.status === 'created').length
  const skipped = results.filter(r => r.status === 'skipped').length
  const errors = results.filter(r => r.status === 'error').length

  return { created, skipped, errors }
}

export async function sync(options: SyncOptions) {
  const label = options.direction === 'push' ? 'Push: ~/ → repo' : 'Pull: repo → ~/'
  p.intro(label)

  const s = p.spinner()
  s.start('Syncing files...')

  const results: SyncResult[] = []
  for (const entry of dotfiles) {
    results.push(syncEntry(entry, options))
  }

  s.stop('Sync complete')

  const { created, skipped, errors } = printResults(results)
  p.outro(`Done! ${created} synced, ${skipped} skipped, ${errors} errors`)
}

export async function syncInteractive() {
  p.intro('Dotfiles Sync')

  const direction = await p.select({
    message: 'Sync direction',
    options: [
      { value: 'push' as SyncDirection, label: 'Push', hint: 'User home → Git repo (auto-mask secrets)' },
      { value: 'pull' as SyncDirection, label: 'Pull', hint: 'Git repo → User home (auto-restore secrets)' },
    ],
  })

  if (p.isCancel(direction)) {
    p.cancel('Cancelled')
    process.exit(0)
  }

  const entries = dotfiles.map(e => ({
    value: e,
    label: e.source,
    hint: e.description,
  }))

  const selected = await p.multiselect({
    message: 'Select dotfiles to sync',
    options: entries,
    initialValues: dotfiles,
  })

  if (p.isCancel(selected)) {
    p.cancel('Cancelled')
    process.exit(0)
  }

  let mode: SyncMode = 'copy'
  if (direction === 'pull') {
    const modeChoice = await p.select({
      message: 'Sync mode',
      options: [
        { value: 'link' as SyncMode, label: 'Symlink', hint: 'Create symbolic links (no secret restore)' },
        { value: 'copy' as SyncMode, label: 'Copy', hint: 'Copy files (supports secret restore)' },
      ],
    })

    if (p.isCancel(modeChoice)) {
      p.cancel('Cancelled')
      process.exit(0)
    }
    mode = modeChoice as SyncMode
  }

  const force = await p.confirm({
    message: 'Overwrite existing files? (will backup first)',
    initialValue: false,
  })

  if (p.isCancel(force)) {
    p.cancel('Cancelled')
    process.exit(0)
  }

  const selectedEntries = selected as DotfileEntry[]
  const syncDirection = direction as SyncDirection
  const shouldForce = force as boolean

  const s = p.spinner()
  s.start('Syncing...')

  const results: SyncResult[] = []
  for (const entry of selectedEntries) {
    results.push(syncEntry(entry, { direction: syncDirection, mode, force: shouldForce, dryRun: false }))
  }

  s.stop('Sync complete')
  printResults(results)
  p.outro('All done!')
}

export function diff() {
  p.intro('Dotfiles Diff')

  let hasDiff = false

  for (const entry of dotfiles) {
    const source = resolveSource(entry)
    const target = resolveTarget(entry)

    if (!fs.existsSync(source)) {
      consola.warn(`Source not found: ${source}`)
      continue
    }

    if (!fs.existsSync(target)) {
      consola.info(`${entry.source}: target does not exist yet`)
      continue
    }

    // resolve symlink for comparison
    const realTarget = isSymlink(target) ? fs.readlinkSync(target) : target

    if (isSymlink(target) && realTarget === source) {
      consola.info(`${entry.source}: symlinked (identical)`)
      continue
    }

    // 为了准确比较，把本地文件 mask 后再 diff，避免输出真实 secret
    const targetMasked = maskContentSecrets(normalizeSyncedContent(fs.readFileSync(realTarget, 'utf-8')))
    const sourceContent = normalizeSyncedContent(fs.readFileSync(source, 'utf-8'))

    if (sourceContent === targetMasked.content) {
      consola.info(`${entry.source}: identical${targetMasked.secretsFound ? ' (after masking secrets)' : ''}`)
      continue
    }

    hasDiff = true
    consola.warn(`${entry.source}: differs`)
    printMaskedDiff(source, realTarget, sourceContent, targetMasked.content)
  }

  if (!hasDiff)
    p.outro('All dotfiles are in sync!')
  else
    p.outro('Some dotfiles have differences')
}

export function status() {
  p.intro('Dotfiles Status')

  const chezmoiStatus = spawnChezmoi(['status'])
  if (chezmoiStatus.error) {
    if (isChezmoiMissing(chezmoiStatus.error))
      consola.warn('chezmoi is not installed; showing legacy sync status only')
    else
      consola.warn(`chezmoi status failed: ${chezmoiStatus.error.message}`)
  }
  else if (typeof chezmoiStatus.status === 'number' && chezmoiStatus.status !== 0) {
    consola.warn(`chezmoi status exited with code ${chezmoiStatus.status}; showing legacy sync status below`)
  }

  const secretsMap = loadSecretsFile()

  for (const entry of dotfiles) {
    const source = resolveSource(entry)
    const target = resolveTarget(entry)
    const label = entry.description || entry.source

    if (!fs.existsSync(source)) {
      consola.error(`${label}: source missing in repo`)
      continue
    }

    // 检查仓库文件中的占位符
    const repoContent = fs.readFileSync(source, 'utf-8')
    const placeholders = findPlaceholders(repoContent)
    const secretsInfo = placeholders.length > 0
      ? ` [${placeholders.length} secrets${placeholders.every(k => secretsMap.has(k)) ? ', all in .env.local' : ', some missing in .env.local'}]`
      : ''

    if (!fs.existsSync(target) && !isSymlink(target)) {
      consola.warn(`${label}: not synced to home${secretsInfo}`)
      continue
    }

    if (isSymlink(target)) {
      const linkTarget = fs.readlinkSync(target)
      if (linkTarget === source)
        consola.success(`${label}: linked ✔${secretsInfo}`)
      else
        consola.warn(`${label}: linked to ${linkTarget} (expected ${source})`)
    }
    else {
      consola.info(`${label}: file exists (not linked)${secretsInfo}`)
    }
  }

  p.outro('')
}
