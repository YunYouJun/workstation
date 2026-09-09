import type { ConfigurationDecision } from './model'
import { ConfigurationEngine } from './engine'

/** One-request JSON interface shared by CLI and trusted local Host Plugins. */
export function configurationRequest(input: unknown, engine = new ConfigurationEngine()): unknown {
  const request = input as { version?: number, projectPath?: string, operation?: string, decisions?: ConfigurationDecision[], planId?: string, repository?: string, revision?: string, action?: string, paths?: string[], message?: string }
  if (!request || request.version !== 1)
    throw new Error('Unsupported configuration protocol version')
  switch (request.operation) {
    case 'inspect': return engine.inspect(typeof request.projectPath === 'string' ? request.projectPath : undefined)
    case 'preview': return engine.preview(request.decisions ?? [])
    case 'apply': return engine.apply(request.planId ?? '')
    case 'restore': return engine.restore(request.planId ?? '')
    case 'git-status': return engine.gitStatus()
    case 'git-action': return engine.gitAction(request)
    case 'history': return engine.history()
    default: throw new Error('Unsupported configuration operation')
  }
}
