import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

// Microsoft's public client used by Microsoft Graph command-line tooling.
// Override MS_TODO_CLIENT_ID to use an app registration you own.
export const DEFAULT_CLIENT_ID = '14d82eec-204b-4c2f-b7e8-296a70dab67e'

export function loadConfig(env = process.env) {
  const tenant = env.MS_TODO_TENANT?.trim() || 'common'
  const writeEnabled = env.MS_TODO_WRITE === '1'

  return {
    clientId: env.MS_TODO_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${tenant}`,
    cachePath:
      env.MS_TODO_CACHE?.trim()
      || join(
        homedir(),
        'Library',
        'Application Support',
        'Codex',
        'microsoft-todo-graph',
        'token-cache.json',
      ),
    scopes: [writeEnabled ? 'Tasks.ReadWrite' : 'Tasks.Read'],
    writeEnabled,
    deleteEnabled: writeEnabled && env.MS_TODO_ALLOW_DELETE === '1',
    graphBase: 'https://graph.microsoft.com/v1.0',
    maxItems: 500,
  }
}
