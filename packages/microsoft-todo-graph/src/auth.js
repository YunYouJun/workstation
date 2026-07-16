import { LogLevel, PublicClientApplication } from '@azure/msal-node'
import { createCachePlugin } from './cache.js'

export function createAuthClient(config) {
  return new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: config.authority,
    },
    cache: {
      cachePlugin: createCachePlugin(config.cachePath),
    },
    system: {
      loggerOptions: {
        logLevel: LogLevel.Error,
        piiLoggingEnabled: false,
        loggerCallback: () => {},
      },
    },
  })
}

export async function login(config, onDeviceCode) {
  const client = createAuthClient(config)
  const result = await client.acquireTokenByDeviceCode({
    scopes: config.scopes,
    deviceCodeCallback: onDeviceCode,
  })
  if (!result?.accessToken)
    throw new Error('Microsoft sign-in completed without returning an access token.')
}

export async function getAccessToken(config) {
  const client = createAuthClient(config)
  const accounts = await client.getTokenCache().getAllAccounts()
  const account = accounts[0]
  if (!account)
    throw new Error('Not authenticated. Run: pnpm todo:auth')

  let result
  try {
    result = await client.acquireTokenSilent({
      account,
      scopes: config.scopes,
    })
  }
  catch (error) {
    if (config.writeEnabled) {
      throw new Error(
        `Write permission is not authorized. Run: pnpm todo:auth (${error.errorCode || error.message})`,
      )
    }
    throw error
  }
  if (!result?.accessToken)
    throw new Error('No access token is available. Run: pnpm todo:auth')

  return result.accessToken
}

export async function getAuthStatus(config) {
  const client = createAuthClient(config)
  const accounts = await client.getTokenCache().getAllAccounts()

  return {
    authenticated: accounts.length > 0,
    requestedPermission: config.scopes[0],
    writeEnabled: config.writeEnabled,
    deleteEnabled: config.deleteEnabled,
    authority: config.authority,
    cacheLocation: config.cachePath,
  }
}
