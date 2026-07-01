import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
export const packageRoot = fileURLToPath(new URL('..', import.meta.url))

export function createTempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export function removePath(targetPath: string | undefined) {
  if (targetPath)
    fs.rmSync(targetPath, { recursive: true, force: true })
}

export function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf-8')
}

export function codexAgentsPath(root: string) {
  return path.join(root, '.codex', 'AGENTS.md')
}

export function repoCodexAgentsPath(root: string) {
  return path.join(root, 'home', 'dot_codex', 'AGENTS.md')
}

export function zshrcPath(root: string) {
  return path.join(root, '.zshrc')
}

export function repoZshrcPath(root: string) {
  return path.join(root, 'home', 'dot_zshrc')
}

export function vscodeSettingsPath(root: string) {
  return path.join(root, 'Library', 'Application Support', 'Code', 'User', 'settings.json')
}

export function repoVscodeSettingsPath(root: string) {
  return path.join(root, 'home', 'Library', 'Application Support', 'Code', 'User', 'settings.json')
}

export function createSyncFixture() {
  const tempDir = createTempDir('dotfiles-sync-')
  const repoRoot = path.join(tempDir, 'repo')
  const homeRoot = path.join(tempDir, 'home')
  fs.mkdirSync(repoRoot)
  fs.mkdirSync(homeRoot)
  return { tempDir, repoRoot, homeRoot }
}

export function runCli(args: string[], repoRoot: string, homeRoot: string, extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', cliPath, ...args], {
    cwd: packageRoot,
    encoding: 'utf-8',
    env: {
      ...process.env,
      CI: '1',
      DOTFILES_HOME: homeRoot,
      DOTFILES_REPO_ROOT: repoRoot,
      NO_COLOR: '1',
      ...extraEnv,
    },
  })
}
