import type { SyncDirection, SyncMode } from './sync'
import process from 'node:process'
import cac from 'cac'
import { version } from '../package.json'
import { runChezmoi } from './chezmoi'
import { doctor } from './doctor'
import { cloneActiveProjects, cloneManifestProjects, projectStatus } from './projects'
import { diff, status, sync, syncInteractive } from './sync'

function getCliName() {
  const binName = process.argv[1]?.split(/[\\/]/).pop()
  return binName && ['dotfiles', 'workstation', 'wst'].includes(binName) ? binName : 'workstation'
}

const cli = cac(getCliName())

function parseProjectAction(action: string | undefined) {
  const projectAction = action || 'clone-active'
  if (['clone-active', 'active', 'clone', 'ca'].includes(projectAction))
    return 'clone-active'

  if (['manifest', 'clone-manifest', 'local', 'config'].includes(projectAction))
    return 'manifest'

  if (['status', 'dirty', 'check'].includes(projectAction))
    return 'status'

  return undefined
}

function parseListOption(value: unknown): string[] {
  if (Array.isArray(value))
    return value.flatMap(item => parseListOption(item))

  if (typeof value !== 'string')
    return []

  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

async function runProjectsCommand(action: string | undefined, target: string | undefined, options: any) {
  const projectAction = parseProjectAction(action)
  if (!projectAction) {
    console.error(`Unknown projects action: ${action}`)
    process.exitCode = 1
    return
  }

  if (projectAction === 'manifest') {
    await cloneManifestProjects({
      source: target,
      file: options.file,
      repo: options.repo,
      manifest: options.manifest,
      groups: parseListOption(options.group),
      root: options.root,
      protocol: options.https ? 'https' : 'ssh',
      update: options.update,
      yes: options.yes,
      dryRun: options.dryRun,
      interactive: options.interactive,
    })
    return
  }

  if (projectAction === 'status') {
    await projectStatus({
      root: options.root,
      all: options.all,
      check: options.check,
      maxDepth: options.maxDepth === undefined ? undefined : Number(options.maxDepth),
    })
    return
  }

  await cloneActiveProjects({
    owner: target || 'YunYouJun',
    limit: options.limit === undefined ? undefined : Number(options.limit),
    root: options.root,
    protocol: options.https ? 'https' : 'ssh',
    includeForks: options.includeForks,
    includeArchived: options.includeArchived,
    update: options.update,
    yes: options.yes,
    dryRun: options.dryRun,
    interactive: options.interactive,
  })
}

function registerProjectsCommand(name: string, description: string) {
  cli
    .command(`${name} [action] [target]`, description)
    .option('--limit <number>', 'Number of repositories to fetch (default: 50, max: 100)')
    .option('--root <path>', 'Project root directory (default: ~/repos)')
    .option('--https', 'Use HTTPS clone URLs instead of SSH', { default: false })
    .option('--include-forks', 'Include forked repositories', { default: false })
    .option('--include-archived', 'Include archived repositories', { default: false })
    .option('--file <path>', 'Project manifest YAML file')
    .option('--repo <url>', 'Git repository containing a project manifest')
    .option('--manifest <path>', 'Manifest path inside --repo (default: projects.yaml)')
    .option('--group <names>', 'Comma-separated manifest group names')
    .option('--all', 'Show clean repositories in projects status output', { default: false })
    .option('--check', 'Exit non-zero when projects status finds repositories needing attention', { default: false })
    .option('--max-depth <number>', 'Maximum directory depth for projects status scan (default: 6)')
    .option('--update', 'Update repositories that already exist', { default: false })
    .option('--yes', 'Apply clone/update operations (defaults to dry-run)', { default: false })
    .option('--dry-run', 'Preview operations without writing', { default: false })
    .option('-i, --interactive', 'Select repositories interactively', { default: false })
    .action(async (action: string | undefined, target: string | undefined, options) => {
      await runProjectsCommand(action, target, options)
    })
}

function getArgsAfter(commandName: string, action?: string) {
  const commandIndex = process.argv.indexOf(commandName)
  if (commandIndex === -1)
    return []

  const actionIndex = action ? commandIndex + 1 : commandIndex
  return process.argv.slice(actionIndex + 1)
}

async function runDotfilesAction(action: string | undefined, options: any, commandName?: string) {
  const dotfilesAction = action || 'sync'

  if (dotfilesAction === 'push') {
    await sync({
      direction: 'push',
      mode: 'copy',
      force: options.force,
      dryRun: options.dryRun,
    })
    return
  }

  if (dotfilesAction === 'pull') {
    await sync({
      direction: 'pull',
      mode: options.mode as SyncMode,
      force: options.force,
      dryRun: options.dryRun,
    })
    return
  }

  if (dotfilesAction === 'sync') {
    if (options.interactive) {
      await syncInteractive()
    }
    else {
      await sync({
        direction: options.direction as SyncDirection,
        mode: options.mode as SyncMode,
        force: options.force,
        dryRun: options.dryRun,
      })
    }
    return
  }

  if (dotfilesAction === 'diff') {
    diff()
    return
  }

  if (dotfilesAction === 'status') {
    status()
    return
  }

  if (dotfilesAction === 'doctor') {
    const result = doctor()
    if (result.errors > 0)
      process.exitCode = 1
    return
  }

  if (dotfilesAction === 'chezmoi') {
    runChezmoi(commandName ? getArgsAfter(commandName, dotfilesAction) : getArgsAfter('chezmoi'))
    return
  }

  console.error(`Unknown dotfiles action: ${dotfilesAction}`)
  process.exitCode = 1
}

function registerDotfilesNamespace(name: string, description: string) {
  cli
    .command(`${name} [action]`, description)
    .option('--direction <dir>', 'Sync direction: push or pull', { default: 'pull' })
    .option('--mode <mode>', 'Sync mode: link or copy', { default: 'copy' })
    .option('--force', 'Overwrite existing files (with backup)', { default: false })
    .option('--dry-run', 'Preview changes without applying', { default: false })
    .option('-i, --interactive', 'Interactive mode', { default: false })
    .allowUnknownOptions()
    .action(async (action: string | undefined, options) => {
      await runDotfilesAction(action, options, name)
    })
}

registerProjectsCommand('projects', 'Manage project checkouts')
registerProjectsCommand('p', 'Alias for projects')
registerDotfilesNamespace('dotfiles', 'Manage dotfiles')
registerDotfilesNamespace('df', 'Alias for dotfiles')

cli
  .command('push', 'Push dotfiles from home to repo (auto-mask secrets)')
  .option('--force', 'Overwrite existing files (with backup)', { default: false })
  .option('--dry-run', 'Preview changes without applying', { default: false })
  .action(async (options) => {
    await runDotfilesAction('push', options)
  })

cli
  .command('pull', 'Pull dotfiles from repo to home (auto-restore secrets)')
  .option('--mode <mode>', 'Sync mode: link or copy', { default: 'copy' })
  .option('--force', 'Overwrite existing files (with backup)', { default: false })
  .option('--dry-run', 'Preview changes without applying', { default: false })
  .action(async (options) => {
    await runDotfilesAction('pull', options)
  })

cli
  .command('sync', 'Sync dotfiles (specify direction)')
  .option('--direction <dir>', 'Sync direction: push or pull', { default: 'pull' })
  .option('--mode <mode>', 'Sync mode: link or copy', { default: 'copy' })
  .option('--force', 'Overwrite existing files (with backup)', { default: false })
  .option('--dry-run', 'Preview changes without applying', { default: false })
  .option('-i, --interactive', 'Interactive mode', { default: false })
  .action(async (options) => {
    await runDotfilesAction('sync', options)
  })

cli
  .command('diff', 'Show differences between repo and home dotfiles')
  .action(async () => {
    await runDotfilesAction('diff', {})
  })

cli
  .command('status', 'Show sync status of dotfiles')
  .action(async () => {
    await runDotfilesAction('status', {})
  })

cli
  .command('doctor', 'Check dotfiles repo, chezmoi, and local secret readiness')
  .action(async () => {
    await runDotfilesAction('doctor', {})
  })

cli
  .command('chezmoi [...args]', 'Run chezmoi with this repo as source')
  .allowUnknownOptions()
  .action(async () => {
    await runDotfilesAction('chezmoi', {})
  })

cli
  .command('', 'Interactive sync (default)')
  .action(async () => {
    await syncInteractive()
  })

cli.help()
cli.version(version)
cli.parse()
