import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { syncGitRepository } from '../git-sync'
import { contentHash, withFileLock } from '../private/safe-file'

function git(root: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 })
  if (result.status !== 0)
    throw new Error('Git operation failed. Check local repository state and authentication.')
  return result.stdout
}

/** Diff metadata and known non-secret controls only; never return raw Git patches. */
function displayDiff(diff: string): string {
  return diff.split('\n').map((line) => {
    if (/^(?:diff --git |index |--- |\+\+\+ |@@)/.test(line))
      return line
    const prefix = /^[+ -]/.test(line) ? line[0] : ' '
    const assignment = line.slice(1).trim().match(/^([\w.-]+)\s*=(.*)$/)
    if (assignment) {
      const [, key, rawValue] = assignment
      const value = rawValue.trim()
      const safe = ['enabled', 'startup_timeout_sec', 'tool_timeout_sec', 'font-size', 'add_newline'].includes(key) && /^(?:true|false|[0-9.]+)$/.test(value)
      return `${prefix}${key} = ${safe ? value : '[value withheld]'}`
    }
    return line ? `${prefix}[content withheld]` : ''
  }).slice(0, 1000).join('\n')
}

/** Read local Git state without contacting a remote. Remote counts reflect the last fetch. */
export function configurationGitStatus(root: string, id: string) {
  const head = git(root, ['rev-parse', 'HEAD']).trim()
  const branch = git(root, ['symbolic-ref', '--short', 'HEAD']).trim()
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  let ahead: number | null = null
  let behind: number | null = null
  try {
    [ahead, behind] = git(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']).trim().split(/\s+/).map(Number)
  }
  catch {
    /* No upstream is distinct from synchronized. */
  }
  const outgoing = ahead && ahead > 0 ? git(root, ['log', '--format=%h', '@{upstream}..HEAD']).trim().split('\n') : []
  const outgoingDiff = ahead && ahead > 0 ? displayDiff(git(root, ['diff', '--no-ext-diff', '--no-textconv', '@{upstream}...HEAD', '--'])) : ''
  const outgoingChanges = ahead && ahead > 0 ? git(root, ['diff', '--no-ext-diff', '--no-textconv', '--numstat', '@{upstream}...HEAD', '--']).trim().split('\n').filter(Boolean) : []
  const diff = git(root, ['diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--'])
  const paths: { path: string, status: string }[] = []
  const entries = status.split('\0')
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (!entry)
      continue
    paths.push({ path: entry.slice(3), status: entry.slice(0, 2) })
    if (/[RC]/.test(entry.slice(0, 2)))
      index++
  }
  // Include untracked contents in the review token, never in display output.
  const untracked = paths.filter(entry => entry.status === '??').map((entry) => {
    const target = path.join(root, entry.path)
    const stat = fs.lstatSync(target)
    return [entry.path, stat.isFile() && stat.size < 2 * 1024 * 1024 ? contentHash(fs.readFileSync(target, 'utf8')) : 'unsupported']
  })
  return { id, root, branch, ahead, behind, outgoing, outgoingChanges, outgoingDiff, workingDiff: displayDiff(diff), dirty: paths.length > 0, diverged: (ahead ?? 0) > 0 && (behind ?? 0) > 0, revision: contentHash(JSON.stringify([head, branch, status, diff, untracked])), paths }
}

/**
 Commit only explicitly reviewed managed files
preserve unrelated working tree and index entries.
 */
export function commitConfiguration(root: string, id: string, revision: string, paths: string[], allowed: string[], message: string) {
  if (!paths.length || paths.some(file => !allowed.includes(path.resolve(root, file))))
    throw new Error('Only declared managed source files can be committed')
  if (!message.trim() || message.length > 500)
    throw new Error('Provide a bounded commit message')
  return withFileLock(path.join(root, '.workstation-configuration-commit'), false, () => {
    if (configurationGitStatus(root, id).revision !== revision)
      throw new Error('Repository changed. Review again before committing.')
    if (git(root, ['diff', '--cached', '--name-only']).trim())
      throw new Error('Existing staged content must be handled before committing configuration')
    // Scan complete working tree, fail closed; no raw diagnostic output crosses the protocol.
    const scan = spawnSync('gitleaks', ['dir', '--redact', '--no-banner', '--no-color', '.'], { cwd: root, encoding: 'utf8', timeout: 30000 })
    if (scan.status !== 0)
      throw new Error('Secret scan failed or unavailable. Nothing was committed.')
    if (configurationGitStatus(root, id).revision !== revision)
      throw new Error('Repository changed during scan. Review again.')
    git(root, ['--literal-pathspecs', 'add', '--', ...paths])
    // On a commit failure, deliberately leave the reviewed index for recovery; never reset another operation.
    git(root, ['--literal-pathspecs', 'commit', '-m', message, '--', ...paths])
    return configurationGitStatus(root, id)
  })
}

/** Reuse existing fast-forward and scanned, non-forced publication transport. */
export function transportConfiguration(root: string, id: string, action: 'fetch' | 'publish', revision: string) {
  if (configurationGitStatus(root, id).revision !== revision)
    throw new Error('Repository changed. Review again before syncing.')
  syncGitRepository(root, action, false, true)
  return configurationGitStatus(root, id)
}
