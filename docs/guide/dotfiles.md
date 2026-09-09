# Dotfiles 同步

Dotfiles 放在 `home/` 下，并通过 `workstation dotfiles` 命令管理。旧的 `dotfiles` 命令仍作为兼容入口保留。

## 管理文件

- `home/dot_codex/AGENTS.md` -> `~/.codex/AGENTS.md`
- `home/dot_config/ghostty/config` -> `~/.config/ghostty/config`
- `home/dot_config/starship.toml` -> `~/.config/starship.toml`
- `home/dot_zshrc` -> `~/.zshrc`
- `home/Library/Application Support/Code/User/settings.json` -> `~/Library/Application Support/Code/User/settings.json`
- `home/Library/Application Support/CodeBuddy CN/User/settings.json` -> `~/Library/Application Support/CodeBuddy CN/User/settings.json`
- `home/dot_local/libexec/executable_git-confirm-large-push` -> `~/.local/libexec/git-confirm-large-push`

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
- 标记为 executable 的脚本在 copy/push 后会被规范为 `0755`。
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
        "root": "shared",
        "description": "Private internal workflow.",
        "source": {
          "type": "local",
          "path": "skills/install/internal-example"
        }
      }
    ],
    "policies": [
      {
        "id": "internal-example-explicit-only",
        "root": "shared",
        "path": "internal-example",
        "allowImplicitInvocation": false
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
wst private mcp-apply --dry-run
wst private mcp-apply --yes
wst private skills-apply --dry-run
wst private skills-apply --yes
wst private apply --dry-run
wst private apply --yes
wst private inventory --section skills
wst private file-restore --bundle <id> --yes
wst private ios-secrets-import --yes
wst private ios-run -- <command>
wst private secrets-check
wst private secret-scan
```

`wst private` 和 `wst private status` 不访问 1Password 账户，只报告 CLI
是否安装。`wst private check` 会读取一个代表性的密钥引用来验证账户与读取权限，
因此可能触发一次 1Password 授权；自动化只在确实需要认证验证时使用它。
`wst private mcp-run` 会在临时 env 文件中省略缺失的 optional secret，避免一个未配置的
可选服务阻塞其他 MCP；required secret 仍会让 `op run` 失败。

`apply` 只能处理 manifest 声明的模板、MCP fragment、显式 installable skill、本地 ignored 输出和 `op-file-restore` 文件包，不能把私有仓库里的任意文件复制到 `$HOME`。没有 `--yes` 时即使使用 `apply` 也只会 dry-run。
`mcp-apply` 的范围更窄：它只更新 Codex 的私有 MCP managed block，不执行模板注入、密钥文件恢复或 Skill 安装。fragment 中的 `{{WORKSTATION_PRIVATE_REPO_ROOT}}` 会按已连接 manifest 的仓库根目录展开，供受管本地 wrapper 使用，避免绑定某台机器的绝对 checkout 路径。
`skills-apply` 只安装 manifest 声明的私有 Skill，并安全合并每个 Skill 的 `agents/openai.yaml` 隐式调用策略；`install[].root` 可选择 `shared` 或 `codex`（默认 `codex`），相对路径不能逃逸 discovery root。成功应用后会原子更新 `~/.agents/.wst-skill-lock.json`，以 SHA-256 校验私有部署是否缺失或被修改。

`mcp-export` 从 manifest 中的 Codex TOML source（通常是
`~/.codex/config.toml`）读取指定 server，并写入声明的
`mcp/codex-mcp.overlay.toml`。它不会导出完整 Codex 配置；`env` 里的明文值
会被转换成 `${ENV_NAME}` 引用，遇到 header/token 这类不能安全推断的明文
secret 会拒绝写入。旧机器导出并提交私有 dotfiles 后，新机器运行
`wst private mcp-apply --yes` 即可只把 MCP overlay 合并进 Codex managed block。

`wst private connect --yes` 会把私有 manifest 路径记到
`~/.config/workstation/private.json`，后续命令可省略 `--manifest`。如果没有
这个配置，CLI 会从常见 `~/repos/**/dotfiles/config/sync-manifest.json` 路径自动发现。
仍然可以传 `--manifest <path>` 覆盖默认路径。

`wst private connect` 会在 TTY 中询问是否连接私有 Git dotfiles 仓库，并允许粘贴 Git URL。非交互环境必须传 `--repo`；没有 `--yes` 时只预览 `git clone`。

## 远端同步与冲突保护

公开、私有配置复用同一套 Git 同步实现。以下命令默认预览，不访问远端；
`--yes` 才执行远端操作。旧 `df push/pull` 仍表示 HOME 与本地配置源之间的导出/应用。

```sh
wst df fetch                     # 预览公开配置仓库拉取
wst df fetch --yes               # fetch 后仅快进，不应用到 HOME
wst private fetch --yes          # 对已连接的私有配置仓库执行同样流程
wst private mcp-export --server docs --yes  # 按 server 合并，保留其他 server
wst private mcp-export --server docs --replace --dry-run # 预览全量替换
wst private mcp-apply --dry-run
wst private mcp-apply --yes
# 在对应仓库审阅 diff、显式 git add / git commit 后：
wst private publish --dry-run
wst private publish --yes
wst df publish --yes             # 对公开配置仓库执行同样流程
```

`fetch` 要求工作区干净且配置了远端 upstream，仅允许快进；分支分叉时保留双方提交并停止。
`publish` 只发布当前分支中已经提交的内容，要求工作区干净且不落后远端，并使用
`gitleaks git` 扫描待发布的整个提交范围。扫描器缺失或扫描失败时不推送。
命令不会自动 add、commit、stash、rebase、强推或应用 HOME 配置。首次发布新分支需要先显式设置远端 upstream。
不支持 fetch/push URL 不同或多个 URL 的远端。离线或鉴权失败后可重新执行；不会丢弃本机文件。

`mcp-export` 默认按选中的 server 更新，保留其他 server 和顶层设置；只有显式
`--replace` 才替换整个 overlay。写入使用备份和原子替换。

MCP 应用会解析 TOML，在本机记录上次应用配置值的 SHA-256 基线，忽略注释、键顺序和格式差异。托管区与基线不同且与新配置
也不一致时，预览和应用都会报冲突，原配置和源片段保持不变。没有基线的旧托管区
只有与源片段一致时才能自动建立基线，避免第一次升级就覆盖未知修改。
解决冲突时，先审阅本机修改，再通过导出或编辑源片段使双方一致，重新应用后继续同步。
删除托管区也视为本机修改；无本机修改时，移除 manifest fragment 可以正常删除受管内容。

基线、备份与文件操作锁保存在 `~/.local/state/workstation/private/`，不会进入配置仓库。
备份文件权限为 `0600`；输出会显示备份路径，可用它恢复后重新核对源配置。
远端同步锁保存在 Git 目录。进程异常退出留下锁时，先确认进程已停止再移除锁。
完整 `private apply` 会先检查 MCP 冲突，但跨密钥恢复、skills 和 MCP 的所有步骤不构成统一事务；
发生其他步骤错误时按输出检查已完成操作，再修复重试。
