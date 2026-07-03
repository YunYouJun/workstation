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

## 私有 dotfiles Overlay

`workstation` 可以支持读取私有 dotfiles 仓库，但推荐把它设计成 overlay manifest，而不是把私有仓库当成第二个 `home/` 树直接 apply。

推荐边界：

- `workstation` 仍是公开、可复现、可安装的主配置源。
- 私有 dotfiles 只提供机器可读 manifest、内部 server 名称、私有 MCP fragment、显式 installable skill、1Password `op://...` 引用和本机 inventory。
- 默认只做 `dry-run` 和状态检查；写入 `$HOME` 前必须显式确认。
- 只读取 allowlist 中的相对路径，不递归扫描整个私有仓库。
- 写入前必须备份目标文件，并且只写 managed block、本地 ignored 输出文件，或显式声明的 `$CODEX_HOME/skills/<name>` skill 目录。
- 永远不要从私有仓库直接覆盖完整 `~/.codex/config.toml`、`~/.codex/skills`、`.env`、`auth.json` 或包含 resolved token 的文件。

私有仓库可以暴露一个 `config/sync-manifest.json`：

```json
{
  "$schema": "https://raw.githubusercontent.com/YunYouJun/workstation/main/schemas/codex-tools-manifest.schema.json",
  "version": 1,
  "visibility": "private",
  "workstationOverlay": {
    "contractVersion": 1,
    "defaultMode": "dry-run",
    "secretSource": "1Password",
    "allowedOperations": [
      "inventory",
      "op-inject-template",
      "codex-skill-install",
      "codex-mcp-fragment",
      "managed-block-fragment"
    ],
    "allowedReadPaths": [
      "config/sync-manifest.json",
      "mcp/*.op.example.json",
      "mcp/codex-mcp.overlay.toml",
      "skills/install/*"
    ],
    "neverApply": [
      "$HOME/.codex/config.toml",
      "$HOME/.codex/skills",
      "$HOME/.env",
      "$HOME/.codex/auth.json"
    ]
  },
  "skills": {
    "install": [
      {
        "id": "internal-example",
        "targetName": "internal-example",
        "description": "Private internal workflow.",
        "source": {
          "type": "local",
          "path": "skills/install/internal-example"
        }
      }
    ]
  },
  "mcp": {
    "fragments": [
      {
        "id": "private-codex",
        "path": "mcp/codex-mcp.overlay.toml",
        "format": "toml-codex",
        "operation": "managed-block-fragment"
      }
    ],
    "templates": [
      {
        "id": "json-op-template",
        "path": "mcp/mcp.op.example.json",
        "usage": "op inject --in-file mcp/mcp.op.example.json --out-file mcp/mcp.local.json"
      }
    ],
    "sources": [
      {
        "id": "codex-user",
        "path": "$HOME/.codex/config.toml",
        "format": "toml-codex",
        "syncMode": "inventory-only",
        "managedBy": "workstation codex-mcp.toml managed block plus local unmanaged entries"
      }
    ]
  }
}
```

当前仓库提供 repo-level 脚本读取 overlay manifest：

```bash
pnpm private:connect
pnpm private:connect -- --repo git@example.com:user/dotfiles.git --target-dir ~/repos/private/dotfiles --dry-run
pnpm private:connect -- --repo git@example.com:user/dotfiles.git --target-dir ~/repos/private/dotfiles --yes
pnpm private:list -- --manifest ~/repos/<host>/<user>/dotfiles/config/sync-manifest.json
pnpm private:status -- --manifest ~/repos/<host>/<user>/dotfiles/config/sync-manifest.json
pnpm private:check -- --manifest ~/repos/<host>/<user>/dotfiles/config/sync-manifest.json
pnpm private:apply -- --manifest ~/repos/<host>/<user>/dotfiles/config/sync-manifest.json --dry-run
pnpm private:apply -- --manifest ~/repos/<host>/<user>/dotfiles/config/sync-manifest.json --yes
```

`apply` 只能处理 manifest 声明的模板、MCP fragment、显式 installable skill 和本地 ignored 输出，不能把私有仓库里的任意文件复制到 `$HOME`。没有 `--yes` 时即使使用 `apply` 也只会 dry-run。

`private:connect` 会在 TTY 中询问是否连接私有 Git dotfiles 仓库，并允许粘贴 Git URL。非交互环境必须传 `--repo`；没有 `--yes` 时只预览 `git clone`。

如果以后把 overlay 支持并入发布版 CLI，命令形态应保持同样显式：

```bash
workstation dotfiles overlay status --manifest ~/repos/<host>/<user>/dotfiles/config/sync-manifest.json
workstation dotfiles overlay apply --manifest ~/repos/<host>/<user>/dotfiles/config/sync-manifest.json --dry-run
workstation dotfiles overlay apply --manifest ~/repos/<host>/<user>/dotfiles/config/sync-manifest.json --yes
```
