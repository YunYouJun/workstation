import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'

export function createCachePlugin(cachePath) {
  return {
    async beforeCacheAccess(context) {
      try {
        const serialized = await readFile(cachePath, 'utf8')
        context.tokenCache.deserialize(serialized)
      }
      catch (error) {
        if (error?.code !== 'ENOENT')
          throw error
      }
    },

    async afterCacheAccess(context) {
      if (!context.cacheHasChanged)
        return

      const directory = dirname(cachePath)
      const temporaryPath = `${cachePath}.${process.pid}.tmp`
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFile(temporaryPath, context.tokenCache.serialize(), {
        encoding: 'utf8',
        mode: 0o600,
      })
      await rename(temporaryPath, cachePath)
    },
  }
}

export async function clearCache(cachePath) {
  try {
    await unlink(cachePath)
  }
  catch (error) {
    if (error?.code !== 'ENOENT')
      throw error
  }
}
