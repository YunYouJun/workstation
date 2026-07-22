import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

export interface DotfileEntry {
  /** 仓库中的相对路径 */
  source: string
  /** 目标路径（相对于 $HOME） */
  target: string
  /** 描述 */
  description?: string
  /** pull 到本地时是否追加同步元信息 */
  appendSyncMeta?: boolean
  /** 同步后是否确保目标文件可执行 */
  executable?: boolean
}

export const vscodeSettingsRelativePath = path.join('Library', 'Application Support', 'Code', 'User', 'settings.json')
export const codeBuddyCnSettingsRelativePath = path.join('Library', 'Application Support', 'CodeBuddy CN', 'User', 'settings.json')

/**
 * dotfiles 映射表
 * source: 仓库根目录下的相对路径
 * target: 相对于 $HOME 的目标路径
 */
export const dotfiles: DotfileEntry[] = [
  {
    source: 'home/dot_codex/AGENTS.md',
    target: path.join('.codex', 'AGENTS.md'),
    description: 'Codex Global Instructions',
    appendSyncMeta: false,
  },
  {
    source: 'home/dot_zshrc',
    target: '.zshrc',
    description: 'Oh-My-Zsh Config',
    appendSyncMeta: false,
  },
  {
    source: path.join('home', 'dot_config', 'starship.toml'),
    target: path.join('.config', 'starship.toml'),
    description: 'Starship Prompt Config',
    appendSyncMeta: false,
  },
  {
    source: path.join('home', 'dot_config', 'ghostty', 'config'),
    target: path.join('.config', 'ghostty', 'config'),
    description: 'Ghostty Terminal Config',
    appendSyncMeta: false,
  },
  {
    source: path.join('home', vscodeSettingsRelativePath),
    target: vscodeSettingsRelativePath,
    description: 'VSCode Global Settings (macOS)',
    appendSyncMeta: false,
  },
  {
    source: path.join('home', codeBuddyCnSettingsRelativePath),
    target: codeBuddyCnSettingsRelativePath,
    description: 'CodeBuddy CN Global Settings (macOS)',
    appendSyncMeta: false,
  },
  {
    source: path.join('home', 'dot_local', 'libexec', 'executable_git-confirm-large-push'),
    target: path.join('.local', 'libexec', 'git-confirm-large-push'),
    description: 'GitHub large-push confirmation guard',
    appendSyncMeta: false,
    executable: true,
  },
]

export function getRepoRoot(): string {
  if (process.env.DOTFILES_REPO_ROOT)
    return path.resolve(process.env.DOTFILES_REPO_ROOT)

  // packages/cli → 仓库根目录
  return path.resolve(import.meta.dirname, '..', '..', '..')
}

export function getHomeDir(): string {
  if (process.env.DOTFILES_HOME)
    return path.resolve(process.env.DOTFILES_HOME)

  return os.homedir()
}

export function resolveSource(entry: DotfileEntry): string {
  return path.resolve(getRepoRoot(), entry.source)
}

export function resolveTarget(entry: DotfileEntry): string {
  return path.resolve(getHomeDir(), entry.target)
}
