import type { ConfigurationDecision } from './model'
import { ConfigurationEngine } from './engine'

/** Preserve known operation guidance while withholding unexpected parser/filesystem diagnostics. */
export function configurationErrorMessage(error: unknown): string {
  const recoveryErrors = [
    'Skill ownership changed after application. Review the original installer before recovery.',
    'Skill ownership is unavailable. Check installer locks before recovery.',
  ]
  const safe = error instanceof Error && (recoveryErrors.includes(error.message)
    || /^(?:Repository |Backup |Git operation failed|Git fetch failed|Secret scan|Only declared|Unknown repository|Provide a bounded|Existing staged|Branches diverged|Remote is ahead|Configure a single|Sync requires|Unsupported configuration|Select configuration|Configuration changed|Configuration is not|Invalid decision|Duplicate decision|Choose a side|Replace literal credentials|Plan |File changed|Baseline changed|Later configuration)/.test(error.message))
  return safe ? (error as Error).message : 'Configuration operation failed. Check local permissions, source syntax and recovery history.'
}

/** One-request JSON interface shared by CLI and trusted local Host Plugins. */
export function configurationRequest(input: unknown, engine = new ConfigurationEngine()): unknown {
  const request = input as { version?: number, projectPath?: string, operation?: string, decisions?: ConfigurationDecision[], planId?: string, repository?: string, revision?: string, action?: string, paths?: string[], message?: string, registry?: Parameters<ConfigurationEngine['configureRepositories']>[0], targetId?: string, resolution?: string }
  if (!request || request.version !== 1)
    throw new Error('Unsupported configuration protocol version')
  switch (request.operation) {
    case 'inspect': return engine.inspect(typeof request.projectPath === 'string' ? request.projectPath : undefined)
    case 'preview': return engine.preview(request.decisions ?? [])
    case 'apply': return engine.apply(request.planId ?? '')
    case 'restore': return engine.restore(request.planId ?? '')
    case 'git-status': return engine.gitStatus()
    case 'git-action': return engine.gitAction(request)
    case 'repositories': return engine.repositoryRegistry()
    case 'repositories-update': return engine.configureRepositories(request.registry ?? {})
    case 'backup-preview': return engine.backupPreview(request)
    case 'history': return engine.history()
    default: throw new Error('Unsupported configuration operation')
  }
}
