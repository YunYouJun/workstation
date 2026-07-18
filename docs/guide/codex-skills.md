# Agent Skills 与 APM

这个仓库使用 [APM（Agent Package Manager）](https://microsoft.github.io/apm/)
管理公开、可移植的 Agent Skills 与标准 MCP server。APM 是这部分能力的唯一事实源：
workstation 不再维护第二套 Skills manifest、Git 下载器、状态命令或 MCP 映射脚本。

## 文件与职责

| 文件或工具 | 职责 |
| --- | --- |
| `home/dot_apm/apm.yml` | 声明公开 Skills、标准 MCP 和目标 Agent |
| `home/dot_apm/private_apm.lock.yaml` | APM 生成的锁文件；`private_` 是 chezmoi 的 `0600` 权限标记 |
| `~/.apm/apm.yml` | chezmoi 应用后的全局 APM manifest |
| `~/.apm/apm.lock.yaml` | 全局 APM lock；不要手改 |
| `wst private` | 私有本地 Skills、Codex 专属 MCP、1Password 与 inventory-only 配置 |

APM 默认把共享 Skills 部署到 `~/.agents/skills`。仓库自己的工作流仍放在
`.agents/skills`，私有 overlay 显式安装的本地 Skill 则保留在
`~/.codex/skills`，避免把私有路径写入公开 manifest。

## 新机器恢复

`Brewfile` 会安装 APM CLI。应用 dotfiles 后，用锁文件做 frozen replay：

```bash
brew bundle --file Brewfile
wst df chezmoi apply
apm install --global --frozen
```

查看全局依赖：

```bash
apm deps list --global
apm deps tree --global
```

## 增加或更新依赖

让 APM 修改全局 manifest、安装并生成 lock，然后把两个文件收回 chezmoi source：

```bash
apm install --global owner/repo --skill skill-name
wst df chezmoi re-add ~/.apm/apm.yml ~/.apm/apm.lock.yaml
git diff -- home/dot_apm
```

更新现有依赖时先预览，再确认：

```bash
apm update --global --dry-run
apm update --global
wst df chezmoi re-add ~/.apm/apm.yml ~/.apm/apm.lock.yaml
apm install --global --frozen
```

不要手工编辑 `apm.lock.yaml`。`main` 或版本范围可以留在 manifest 中，lock 仍会固定
解析后的 commit；更新只通过显式 `apm update --global` 发生。

## 标准 MCP 与私有 Codex MCP

公开且可移植的 MCP 使用 APM：

```bash
apm install --global --mcp io.github.example/server
```

包含内部 server 名称、私有本地命令、Codex plugin 配置或 OAuth callback 顶层字段的
TOML 不进入公开 APM manifest。这些内容继续由 allowlisted private overlay 管理：

```bash
wst private apply --dry-run
wst private apply --yes
```

private apply 只写 `~/.codex/config.toml` 中标记为
`workstation managed private mcp` 的 block，不覆盖完整配置。

## Skill 结构与触发

一个 Skill 是包含 `SKILL.md` 的目录，可以带脚本、参考资料和资源。Agent 根据
`SKILL.md` frontmatter 中的名称和描述决定是否触发；需要时也可以显式输入
`$skill-name`。

全局 Skills 应保持少而清晰。描述重叠会增加误触发；不具备跨项目价值的工作流应留在
仓库 `.agents/skills` 或私有 overlay 中。

## 边界

| 需求 | 使用 |
| --- | --- |
| 公开 Skills、标准 MCP、版本锁定、更新与重放 | APM |
| 仓库共享工作流 | `.agents/skills` |
| 私有本地 Skill、Codex 专属 MCP、1Password | `wst private` |
| 软件安装 | `Brewfile` / `pnpm software:*` |
| 仓库约定 | `AGENTS.md` |

APM v0.25.0 的 `audit` 没有全局模式。用
`apm install --global --frozen` 校验全局 manifest/lock 一致性并重放锁定状态；
不要在 `~/.apm` 下运行项目作用域的 `apm audit --ci`，因为它会按错误的
项目根目录解释部署路径。

## 参考

- [APM 文档](https://microsoft.github.io/apm/)
- [APM install](https://microsoft.github.io/apm/reference/cli/install/)
- [Agent Skills](https://agentskills.io/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
