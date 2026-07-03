import type { PrivateOptions } from './types'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { commandExists } from './exec'
import { repoRootFromManifest } from './paths'

export function scanSecrets(options: PrivateOptions): void {
  const repoRoot = repoRootFromManifest(options.manifest)

  if (commandExists('gitleaks')) {
    const args = options.scanMode === 'staged'
      ? ['protect', '--staged', '--verbose']
      : ['detect', '--source', repoRoot, '--no-git', '--verbose']
    const result = spawnSync('gitleaks', args, {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    process.exitCode = result.status ?? 1
    return
  }

  if (commandExists('detect-secrets')) {
    const result = spawnSync('detect-secrets', ['scan', '--all-files'], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    process.exitCode = result.status ?? 1
    return
  }

  console.log('No secret scanning tool was found.')
  console.log('Install one of:')
  console.log('  brew install gitleaks')
  console.log('  pipx install detect-secrets')
  process.exitCode = 1
}
