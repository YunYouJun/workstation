import { describe, expect, it } from 'vitest'
import { downloadProgress } from '../src/software/download-progress'

describe('homebrew download observations', () => {
  it('reads terminal byte counts, mixed units, unknown sizes and completed files', () => {
    expect(downloadProgress('⠋ Cask editor (1.0) ####     Downloading  12.5MB/ 50.0MB')).toEqual({ phase: 'downloading', resource: 'Cask editor (1.0)', percent: 25 })
    expect(downloadProgress('⠋ Bottle editor (1.0) ## Downloading 500.0KB/ 1.0MB')).toMatchObject({ percent: 50 })
    expect(downloadProgress('⠋ Cask editor Downloading 2.0MB/-------')).toEqual({ phase: 'downloading', resource: 'Cask editor' })
    expect(downloadProgress('⠋ Cask editor Downloading 1.0MB/1.0MB')).toMatchObject({ percent: 99 })
    expect(downloadProgress('✔︎ Cask editor Downloaded 1.0MB/1.0MB')).toMatchObject({ percent: 100 })
    expect(downloadProgress('⠋ Cask editor Downloading 0.0B/0.0B')).not.toHaveProperty('percent')
  })

  it('accepts curl bars but never unrelated percentages or malformed measurements', () => {
    expect(downloadProgress('\x1B[32m######## 42.7%\x1B[0m')).toEqual({ phase: 'downloading', percent: 42 })
    expect(downloadProgress('Cask editor Downloading NaNMB/2MB')).toBeUndefined()
    expect(downloadProgress('  0.0%')).toEqual({ phase: 'downloading', percent: 0 })
    for (const line of ['##### 101.0%', '##### -1.0%', 'Building 50%', '50% tests passed'])
      expect(downloadProgress(line)).toBeUndefined()
  })

  it('resets a previous percentage on a new file or installation phase', () => {
    const previous = { phase: 'downloading' as const, percent: 100, resource: 'old file' }
    expect(downloadProgress('==> Downloading https://example.com/next', previous)).toEqual({ phase: 'downloading' })
    expect(downloadProgress('Already downloaded: /cache/file', previous)).toEqual({ phase: 'downloading' })
    expect(downloadProgress('==> Installing Cask editor', previous)).toEqual({ phase: 'installing' })
    expect(downloadProgress('==> Pouring editor.bottle.tar.gz', previous)).toEqual({ phase: 'installing' })
    expect(downloadProgress('######## 100.0%', { phase: 'installing' })).toBeUndefined()
  })
})
