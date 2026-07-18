import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import * as p from '@clack/prompts'
import consola from 'consola'
import { isChezmoiMissing, spawnChezmoi } from './chezmoi'
import { dotfiles, getRepoRoot, resolveSource } from './config'
import { findPlaceholders, loadSecretsFile } from './secrets'

interface DoctorCounts {
  errors: number
  warnings: number
}

function pass(message: string) {
  consola.success(message)
}

function warn(counts: DoctorCounts, message: string) {
  counts.warnings += 1
  consola.warn(message)
}

function fail(counts: DoctorCounts, message: string) {
  counts.errors += 1
  consola.error(message)
}

function readSourcePlaceholders(sourcePath: string) {
  if (!fs.existsSync(sourcePath))
    return []

  return findPlaceholders(fs.readFileSync(sourcePath, 'utf-8'))
}

export function doctor() {
  p.intro('Dotfiles Doctor')

  const counts: DoctorCounts = {
    errors: 0,
    warnings: 0,
  }

  const repoRoot = getRepoRoot()
  const chezmoiRootPath = path.join(repoRoot, '.chezmoiroot')

  if (!fs.existsSync(chezmoiRootPath)) {
    fail(counts, '.chezmoiroot is missing')
  }
  else {
    const chezmoiRoot = fs.readFileSync(chezmoiRootPath, 'utf-8').trim()
    if (chezmoiRoot === 'home')
      pass('.chezmoiroot points to home')
    else
      fail(counts, `.chezmoiroot should be "home" but is "${chezmoiRoot}"`)
  }

  const homeSourcePath = path.join(repoRoot, 'home')
  if (fs.existsSync(homeSourcePath) && fs.statSync(homeSourcePath).isDirectory())
    pass('home source tree exists')
  else
    fail(counts, 'home source tree is missing')

  const apmSources = [
    {
      label: 'APM manifest',
      sourcePath: path.join(homeSourcePath, 'dot_apm', 'apm.yml'),
    },
    {
      label: 'APM lockfile',
      sourcePath: path.join(homeSourcePath, 'dot_apm', 'private_apm.lock.yaml'),
    },
  ]

  for (const source of apmSources) {
    if (fs.existsSync(source.sourcePath))
      pass(`${source.label}: source exists`)
    else
      fail(counts, `${source.label}: source missing at ${source.sourcePath}`)
  }

  const secretsMap = loadSecretsFile()
  for (const entry of dotfiles) {
    const sourcePath = resolveSource(entry)
    if (fs.existsSync(sourcePath))
      pass(`${entry.description || entry.source}: source exists`)
    else
      fail(counts, `${entry.description || entry.source}: source missing at ${sourcePath}`)

    const placeholders = readSourcePlaceholders(sourcePath)
    const missingSecrets = placeholders.filter(key => !secretsMap.has(key))
    if (missingSecrets.length > 0)
      fail(counts, `${entry.description || entry.source}: missing local secrets for ${missingSecrets.join(', ')}`)
  }

  const chezmoiVersion = spawnChezmoi(['--version'], 'pipe')
  if (chezmoiVersion.error) {
    if (isChezmoiMissing(chezmoiVersion.error))
      warn(counts, 'chezmoi is not installed')
    else
      warn(counts, `chezmoi check failed: ${chezmoiVersion.error.message}`)
  }
  else if (typeof chezmoiVersion.status === 'number' && chezmoiVersion.status !== 0) {
    warn(counts, `chezmoi --version exited with code ${chezmoiVersion.status}`)
  }
  else {
    pass('chezmoi executable is available')
  }

  const apmVersion = spawnSync('apm', ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (apmVersion.error) {
    const code = (apmVersion.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT')
      warn(counts, 'APM is not installed; run `brew install microsoft/apm/apm`')
    else
      warn(counts, `APM check failed: ${apmVersion.error.message}`)
  }
  else if (typeof apmVersion.status === 'number' && apmVersion.status !== 0) {
    warn(counts, `apm --version exited with code ${apmVersion.status}`)
  }
  else {
    pass('APM executable is available')
  }

  if (counts.errors > 0)
    p.outro(`Doctor found ${counts.errors} errors and ${counts.warnings} warnings`)
  else if (counts.warnings > 0)
    p.outro(`Doctor found ${counts.warnings} warnings`)
  else
    p.outro('Doctor checks passed')

  return counts
}
