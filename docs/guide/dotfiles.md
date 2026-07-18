# Dotfiles 同步

Dotfiles 放在 `home/` 下，并通过 `workstation dotfiles` 命令管理。旧的 `dotfiles` 命令仍作为兼容入口保留。

## 管理文件

- `home/dot_codex/AGENTS.md` -> `~/.codex/AGENTS.md`
- `home/dot_config/ghostty/config` -> `~/.config/ghostty/config`
- `home/dot_config/starship.toml` -> `~/.config/starship.toml`
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
  "$schema": "https://raw.githubusercontent.com/YunYouJun/workstation/main/schemas/private-overlay.schema.json",
  "version": 1,
  "visibility": "private",
  "workstationOverlay": {
    "contractVersion": 1,
    "defaultMode": "dry-run",
    "secretSource": "1Password",
    "allowedOperations": [
      "inventory",
      "mcp-export",
      "op-inject-template",
      "private-skill-install",
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
        "managedBy": "APM for standard MCP plus workstation private managed block"
      }
    ]
  }
}
```

发布版 CLI 提供 `wst private` 读取 overlay manifest；仓库内 `pnpm private:*` scripts 只是兼容入口：

```bash
wst private connect
wst private connect --repo git@example.com:user/dotfiles.git --target-dir ~/repos/private/dotfiles --dry-run
wst private connect --repo git@example.com:user/dotfiles.git --target-dir ~/repos/private/dotfiles --yes
wst private list
wst private status
wst private check
wst private mcp-export --server gongfeng,iwiki,knot --dry-run
wst private mcp-export --server gongfeng,iwiki,knot --yes
wst private apply --dry-run
wst private apply --yes
wst private inventory --section skills
wst private file-restore --bundle <id> --yes
wst private ios-secrets-import --yes
wst private ios-run -- <command>
wst private secrets-check
wst private secret-scan
```

`apply` 只能处理 manifest 声明的模板、MCP fragment、显式 installable skill、本地 ignored 输出和 `op-file-restore` 文件包，不能把私有仓库里的任意文件复制到 `$HOME`。没有 `--yes` 时即使使用 `apply` 也只会 dry-run。

`mcp-export` 从 manifest 中的 Codex TOML source（通常是
`~/.codex/config.toml`）读取指定 server，并写入声明的
`mcp/codex-mcp.overlay.toml`。它不会导出完整 Codex 配置；`env` 里的明文值
会被转换成 `${ENV_NAME}` 引用，遇到 header/token 这类不能安全推断的明文
secret 会拒绝写入。旧机器导出并提交私有 dotfiles 后，新机器运行
`wst private apply --yes` 即可把 overlay 合并进 Codex managed block。

`wst private connect --yes` 会把私有 manifest 路径记到
`~/.config/workstation/private.json`，后续命令可省略 `--manifest`。如果没有
这个配置，CLI 会从常见 `~/repos/**/dotfiles/config/sync-manifest.json` 路径自动发现。
仍然可以传 `--manifest <path>` 覆盖默认路径。

`wst private connect` 会在 TTY 中询问是否连接私有 Git dotfiles 仓库，并允许粘贴 Git URL。非交互环境必须传 `--repo`；没有 `--yes` 时只预览 `git clone`。
