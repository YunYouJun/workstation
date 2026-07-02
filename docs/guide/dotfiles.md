# Dotfiles 同步

Dotfiles 放在 `home/` 下，并通过 `workstation dotfiles` 命令管理。旧的 `dotfiles` 命令仍作为兼容入口保留。

## 管理文件

- `home/dot_codex/AGENTS.md` -> `~/.codex/AGENTS.md`
- `home/dot_zshrc` -> `~/.zshrc`
- `home/Library/Application Support/Code/User/settings.json` -> `~/Library/Application Support/Code/User/settings.json`

## 命令

安全检查：

```bash
workstation dotfiles doctor
workstation dotfiles status
workstation dotfiles diff
workstation dotfiles pull --dry-run
workstation dotfiles push --dry-run
```

会写入文件的命令：

```bash
workstation dotfiles pull --force
workstation dotfiles push --force
```

## Chezmoi 兼容

仓库使用 `.chezmoiroot`，让 chezmoi 只读取 `home/` 子树。

```bash
workstation dotfiles chezmoi diff
workstation dotfiles chezmoi apply
```

日常检查优先使用 CLI diff，因为它会在打印文件差异前遮蔽本地密钥。

## 同步规则

- Pull 时会尽可能从 `.env.local` 恢复占位符。
- Push 时会在写入仓库前遮蔽匹配密钥形式的 shell 赋值。
- Force 写入前会先备份已有文件。
- macOS-only 文件可以通过 `home/.chezmoiignore.tmpl` 在其他平台排除。

这一层应专注于能直接映射到 `$HOME` 的文件。更高层的设置任务应放在脚本或文档中。
