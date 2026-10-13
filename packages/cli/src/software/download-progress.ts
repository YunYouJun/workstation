/** Observed installer phase. Percent describes the current file, never the whole plan. */
export interface SoftwareInstallationProgress {
  phase: 'preparing' | 'downloading' | 'installing'
  percent?: number
  resource?: string
}

/** Parse Homebrew's terminal output without inferring progress from elapsed time. */
export function downloadProgress(line: string, previous?: SoftwareInstallationProgress): SoftwareInstallationProgress | undefined {
  // eslint-disable-next-line no-control-regex
  const clean = line.replace(/\x1B\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/g, '').trim()
  if (/^==> (?:Installing|Pouring|Moving|Linking|Running installer|Building)\b/.test(clean))
    return { phase: 'installing' }
  if (/^(?:==> )?(?:Fetching downloads for:|Downloading |Already downloaded:)/.test(clean))
    return { phase: 'downloading' }

  // Current Homebrew emits per-file byte counts; curl progress bars cover older releases.
  const size = clean.match(/\b(Downloading|Downloaded|Verifying|Extracting|Extracted)\s+(\d+(?:\.\d+)?)\s*([kKMGT]?B)\s*\/\s*(?:(\d+(?:\.\d+)?)\s*([kKMGT]?B)|-+)$/)
  if (size) {
    if (previous?.phase === 'installing' && size[1] !== 'Downloading')
      return undefined
    const units: Record<string, number> = { B: 1, kB: 1000, KB: 1000, MB: 1e6, GB: 1e9, TB: 1e12 }
    const received = Number(size[2]) * units[size[3]!]!
    const total = size[4] ? Number(size[4]) * units[size[5]!]! : undefined
    const resource = clean.slice(0, size.index).replace(/^\W+/, '').replace(/[ #]+$/, '').trim().slice(0, 256)
    const percent = total && Number.isFinite(received / total)
      ? Math.min(size[1] === 'Downloading' ? 99 : 100, Math.max(0, Math.floor(received / total * 100)))
      : undefined
    return { phase: 'downloading', ...(percent !== undefined && { percent }), resource }
  }
  const bar = clean.match(/^#+\s+(\d{1,3}(?:\.\d+)?)%$/) ?? clean.match(/^(\d{1,3}\.\d+)%$/)
  if (bar && Number(bar[1]) <= 100 && previous?.phase !== 'installing')
    return { phase: 'downloading', percent: Math.floor(Number(bar[1])), ...(previous?.resource && { resource: previous.resource }) }
  return undefined
}
