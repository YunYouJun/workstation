import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** Repository transport only: never stages files, commits, applies HOME files or forces a push. */
export function syncGitRepository(repoRoot: string, action: 'fetch' | 'publish', dryRun: boolean): void {
  function git(args: string[], operation = args[0]): string {
    const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
    if (result.status !== 0)
      throw new Error(`Git ${operation} failed; repository content was not discarded. Check authentication and repository state.`)
    return result.stdout.trim()
  }
  function assertClean(): void {
    if (git(['status', '--porcelain', '--untracked-files=all']))
      throw new Error('Repository has uncommitted or untracked files. Review and commit them before syncing.')
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']) {
      if (fs.existsSync(path.resolve(repoRoot, git(['rev-parse', '--git-path', marker]))))
        throw new Error(`Repository has an unfinished Git operation: ${marker}`)
    }
  }
  if (fs.realpathSync(git(['rev-parse', '--show-toplevel'])) !== fs.realpathSync(repoRoot))
    throw new Error('Sync target must be the repository root.')
  const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const remote = git(['config', '--get', `branch.${branch}.remote`])
  const mergeRef = git(['config', '--get', `branch.${branch}.merge`])
  if (!remote || remote === '.' || remote.startsWith('-') || !mergeRef.startsWith('refs/heads/') || mergeRef.includes('\n'))
    throw new Error('Configure a single remote branch upstream before syncing.')
  git(['check-ref-format', mergeRef])
  // Resolve the configured fetch/push URL explicitly: pushurl may point somewhere else.
  const fetchUrl = git(['remote', 'get-url', '--all', remote])
  const pushUrl = git(['remote', 'get-url', '--push', '--all', remote])
  if (fetchUrl !== pushUrl || fetchUrl.includes('\n'))
    throw new Error('Sync requires one matching fetch/push URL; reconcile remote URLs first.')
  assertClean()
  if (dryRun) {
    console.log(`[dry-run] ${action} ${remote} ${mergeRef}; remote state will be checked with --yes`)
    console.log(action === 'fetch' ? '[dry-run] fast-forward checkout only; apply configuration separately' : '[dry-run] scan outgoing commits with gitleaks, then push this branch only')
    return
  }

  const lock = path.resolve(repoRoot, git(['rev-parse', '--git-path', 'workstation-sync.lock']))
  let fd: number
  try {
    fd = fs.openSync(lock, 'wx', 0o600)
  }
  catch {
    throw new Error(`Repository sync locked: ${lock}. Verify the previous process has stopped before removing a stale lock.`)
  }
  try {
    assertClean()
    const head = git(['rev-parse', 'HEAD'])
    git(['fetch', '--no-tags', remote, mergeRef])
    const upstream = git(['rev-parse', 'FETCH_HEAD'])
    const [ahead, behind] = git(['rev-list', '--left-right', '--count', `${head}...${upstream}`]).split(/\s+/).map(Number)
    console.log(`[status] ahead=${ahead} behind=${behind}`)
    if (ahead > 0 && behind > 0)
      throw new Error('Branches diverged. Both versions are preserved; reconcile commits manually before syncing.')
    const assertUnchanged = () => {
      assertClean()
      if (git(['rev-parse', 'HEAD']) !== head || git(['symbolic-ref', '--quiet', '--short', 'HEAD']) !== branch)
        throw new Error('Branch changed during sync. Retry after reviewing the checkout.')
    }
    assertUnchanged()
    if (action === 'fetch') {
      if (behind > 0)
        git(['merge', '--ff-only', upstream])
      console.log('[ok] repository fetched; HOME configuration was not applied')
      return
    }
    if (behind > 0)
      throw new Error('Remote is ahead. Run fetch and review before publishing.')
    if (ahead === 0) {
      console.log('[skip] no outgoing commits')
      return
    }
    const scan = spawnSync('gitleaks', ['git', '--redact', '--no-banner', `--log-opts=${upstream}..${head}`, '.'], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    if (scan.status !== 0)
      throw new Error('Outgoing secret scan failed or gitleaks is unavailable. Nothing was pushed.')
    assertUnchanged()
    git(['-c', 'push.followTags=false', 'push', '--no-force', '--no-follow-tags', '--recurse-submodules=no', remote, `${head}:${mergeRef}`], 'push')
    console.log('[ok] published reviewed commits')
  }
  finally {
    fs.closeSync(fd)
    fs.unlinkSync(lock)
  }
}
