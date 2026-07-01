import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, it } from 'vitest'
import { codexAgentsPath, createSyncFixture, removePath, repoCodexAgentsPath, repoVscodeSettingsPath, repoZshrcPath, runCli, vscodeSettingsPath, writeFile, zshrcPath } from './utils'

const originalRepoRoot = process.env.DOTFILES_REPO_ROOT
const originalHome = process.env.DOTFILES_HOME
let tempDir: string | undefined

function useFixture() {
  const fixture = createSyncFixture()
  tempDir = fixture.tempDir
  return fixture
}

function runCliOk(args: string[], repoRoot: string, homeRoot: string) {
  const result = runCli(args, repoRoot, homeRoot)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return result
}

function writeFakeChezmoi(binDir: string) {
  const scriptPath = path.join(binDir, 'chezmoi')
  writeFile(scriptPath, [
    '#!/usr/bin/env node',
    'const fs = require("node:fs")',
    'if (process.env.CHEZMOI_ARGS_OUT)',
    '  fs.writeFileSync(process.env.CHEZMOI_ARGS_OUT, JSON.stringify(process.argv.slice(2)))',
    '',
  ].join('\n'))
  fs.chmodSync(scriptPath, 0o755)

  writeFile(path.join(binDir, 'chezmoi.cmd'), [
    '@echo off',
    `node "${scriptPath}" %*`,
    '',
  ].join('\r\n'))
}

function writeManagedRepoSources(repoRoot: string) {
  writeFile(path.join(repoRoot, '.chezmoiroot'), 'home\n')
  writeFile(repoCodexAgentsPath(repoRoot), '# Codex\n')
  writeFile(repoZshrcPath(repoRoot), 'export API_TOKEN="{{DOTFILES_SECRET:API_TOKEN}}"\nalias ll="ls -la"\n')
  writeFile(repoVscodeSettingsPath(repoRoot), '{"editor.fontSize":14}\n')
}

afterEach(() => {
  removePath(tempDir)
  tempDir = undefined

  if (originalRepoRoot === undefined)
    delete process.env.DOTFILES_REPO_ROOT
  else
    process.env.DOTFILES_REPO_ROOT = originalRepoRoot

  if (originalHome === undefined)
    delete process.env.DOTFILES_HOME
  else
    process.env.DOTFILES_HOME = originalHome
})

describe('sync CLI', () => {
  it('passes this repo as the chezmoi source directory', () => {
    const { repoRoot, homeRoot, tempDir } = useFixture()
    const binDir = path.join(tempDir, 'bin')
    const argsPath = path.join(tempDir, 'chezmoi-args.json')
    writeFakeChezmoi(binDir)

    const result = runCli(['chezmoi', 'diff', '--dry-run'], repoRoot, homeRoot, {
      CHEZMOI_ARGS_OUT: argsPath,
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.deepEqual(JSON.parse(fs.readFileSync(argsPath, 'utf-8')), [
      '--source',
      repoRoot,
      'diff',
      '--dry-run',
    ])
  })

  it('reports a missing chezmoi executable clearly', () => {
    const { repoRoot, homeRoot, tempDir } = useFixture()
    const binDir = path.join(tempDir, 'empty-bin')
    fs.mkdirSync(binDir)

    const result = runCli(['chezmoi', 'diff'], repoRoot, homeRoot, {
      PATH: binDir,
    })

    assert.equal(result.status, 127)
    assert.match(`${result.stdout}\n${result.stderr}`, /chezmoi is not installed/)
  })

  it('doctor checks the chezmoi source tree and local secrets', () => {
    const { repoRoot, homeRoot, tempDir } = useFixture()
    writeManagedRepoSources(repoRoot)
    writeFile(path.join(repoRoot, '.env.local'), 'API_TOKEN="secret-token-123"\n')

    const binDir = path.join(tempDir, 'bin')
    const argsPath = path.join(tempDir, 'chezmoi-args.json')
    writeFakeChezmoi(binDir)

    const result = runCli(['doctor'], repoRoot, homeRoot, {
      CHEZMOI_ARGS_OUT: argsPath,
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /Doctor checks passed/)
    assert.deepEqual(JSON.parse(fs.readFileSync(argsPath, 'utf-8')), [
      '--source',
      repoRoot,
      '--version',
    ])
  })

  it('doctor fails when a managed placeholder has no local secret value', () => {
    const { repoRoot, homeRoot, tempDir } = useFixture()
    writeManagedRepoSources(repoRoot)

    const binDir = path.join(tempDir, 'bin')
    writeFakeChezmoi(binDir)

    const result = runCli(['doctor'], repoRoot, homeRoot, {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
    })

    assert.equal(result.status, 1)
    assert.match(`${result.stdout}\n${result.stderr}`, /missing local secrets for API_TOKEN/)
    assert.equal(`${result.stdout}\n${result.stderr}`.includes('secret-token-123'), false)
  })

  it('push masks secrets and stores real values in .env.local', () => {
    const { repoRoot, homeRoot } = useFixture()
    writeFile(codexAgentsPath(homeRoot), '# Codex\n')
    writeFile(zshrcPath(homeRoot), 'export API_TOKEN="secret-token-123"\nalias ll="ls -la"\n')
    writeFile(vscodeSettingsPath(homeRoot), '{"editor.fontSize":14}\n')

    runCliOk(['push', '--force'], repoRoot, homeRoot)

    const repoAgents = fs.readFileSync(repoCodexAgentsPath(repoRoot), 'utf-8')
    assert.equal(repoAgents, '# Codex\n')

    const repoZshrc = fs.readFileSync(repoZshrcPath(repoRoot), 'utf-8')
    assert.equal(repoZshrc.includes('secret-token-123'), false)
    assert.equal(repoZshrc.includes('{{DOTFILES_SECRET:API_TOKEN}}'), true)

    const repoSettings = fs.readFileSync(repoVscodeSettingsPath(repoRoot), 'utf-8')
    assert.equal(repoSettings, '{"editor.fontSize":14}\n')

    const envLocal = fs.readFileSync(path.join(repoRoot, '.env.local'), 'utf-8')
    assert.equal(envLocal.includes('API_TOKEN="secret-token-123"'), true)
  })

  it('pull restores secrets, and a later push removes sync metadata', () => {
    const { repoRoot, homeRoot } = useFixture()
    writeFile(repoCodexAgentsPath(repoRoot), '# Codex\n')
    writeFile(repoZshrcPath(repoRoot), 'export API_TOKEN="{{DOTFILES_SECRET:API_TOKEN}}"\nalias ll="ls -la"\n')
    writeFile(path.join(repoRoot, '.env.local'), 'API_TOKEN="secret-token-123"\n')
    writeFile(repoVscodeSettingsPath(repoRoot), '{"editor.fontSize":14}\n')

    runCliOk(['pull', '--force'], repoRoot, homeRoot)

    const homeAgents = fs.readFileSync(codexAgentsPath(homeRoot), 'utf-8')
    assert.equal(homeAgents, '# Codex\n')

    const homeZshrcPath = zshrcPath(homeRoot)
    const homeZshrc = fs.readFileSync(homeZshrcPath, 'utf-8')
    assert.equal(homeZshrc.includes('secret-token-123'), true)
    assert.equal(homeZshrc.includes('# synced by'), false)

    runCliOk(['push', '--force'], repoRoot, homeRoot)

    const repoZshrc = fs.readFileSync(repoZshrcPath(repoRoot), 'utf-8')
    assert.equal(repoZshrc.includes('secret-token-123'), false)
    assert.equal(repoZshrc.includes('# synced by'), false)
    assert.equal(repoZshrc, 'export API_TOKEN="{{DOTFILES_SECRET:API_TOKEN}}"\nalias ll="ls -la"\n')

    const homeSettings = fs.readFileSync(vscodeSettingsPath(homeRoot), 'utf-8')
    assert.equal(homeSettings, '{"editor.fontSize":14}\n')

    const repoAgents = fs.readFileSync(repoCodexAgentsPath(repoRoot), 'utf-8')
    assert.equal(repoAgents, '# Codex\n')
  })

  it('dry-run does not write repo or home files', () => {
    const { repoRoot, homeRoot } = useFixture()
    writeFile(repoCodexAgentsPath(repoRoot), '# Codex\n')
    writeFile(repoZshrcPath(repoRoot), 'alias ll="ls -la"\n')
    writeFile(repoVscodeSettingsPath(repoRoot), '{"editor.fontSize":14}\n')

    runCliOk(['sync', '--direction', 'pull', '--dry-run'], repoRoot, homeRoot)

    assert.equal(fs.existsSync(zshrcPath(homeRoot)), false)
    assert.equal(fs.existsSync(codexAgentsPath(homeRoot)), false)
    assert.equal(fs.existsSync(vscodeSettingsPath(homeRoot)), false)
  })

  it('diff masks local secrets before printing output', () => {
    const { repoRoot, homeRoot } = useFixture()
    writeFile(repoCodexAgentsPath(repoRoot), '# Codex\n')
    writeFile(repoZshrcPath(repoRoot), 'export API_TOKEN="{{DOTFILES_SECRET:API_TOKEN}}"\nalias ll="ls -la"\n')
    writeFile(repoVscodeSettingsPath(repoRoot), '{"editor.fontSize":14}\n')
    writeFile(codexAgentsPath(homeRoot), '# Codex\n')
    writeFile(zshrcPath(homeRoot), 'export API_TOKEN="secret-token-123"\nalias gs="git status"\n')
    writeFile(vscodeSettingsPath(homeRoot), '{"editor.fontSize":14}\n')

    const result = runCliOk(['diff'], repoRoot, homeRoot)

    assert.equal(result.stdout.includes('secret-token-123'), false)
    assert.equal(result.stdout.includes('{{DOTFILES_SECRET:API_TOKEN}}'), true)
    assert.equal(result.stdout.includes('alias gs="git status"'), true)
  })
})
