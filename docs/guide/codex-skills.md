# Agent Skills 与 APM

这个仓库使用 [APM（Agent Package Manager）](https://microsoft.github.io/apm/)
管理公开、可移植的 Agent Skills 与项目级标准 MCP server。APM 是这部分能力的唯一事实源：
workstation 不再维护第二套 Skills manifest、Git 下载器、状态命令或 MCP 映射脚本。需要
跨项目生效的用户级 MCP 则使用客户端原生命令或显式的 workstation init 任务。

## 文件与职责

| 文件或工具 | 职责 |
| --- | --- |
| `home/dot_apm/apm.yml` | 声明公开 Skills、标准 MCP 和目标 Agent |
| `home/dot_apm/private_apm.lock.yaml` | APM 生成的锁文件；`private_` 是 chezmoi 的 `0600` 权限标记 |
| `~/.apm/apm.yml` | chezmoi 应用后的全局 APM manifest |
| `~/.apm/apm.lock.yaml` | 全局 APM lock；不要手改 |
| `~/.agents/.skill-lock.json` | skills.sh 全局安装来源锁；不要手改 |
| `~/.agents/.wst-skill-lock.json` | workstation 私有 Skill 部署来源与 SHA-256 锁；不要手改 |
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

## 项目级、用户级与私有 Codex MCP

公开且随项目复用的 MCP 使用 APM：

```bash
apm install --mcp io.github.example/server
```

APM 0.26 的自定义 MCP 安装目前只支持项目作用域；`--global --mcp` 会被拒绝。确实需要
在所有 Codex 项目中生效的公开 MCP，应使用可预览、幂等的 workstation init 任务或
`codex mcp add`。例如 Microsoft To Do：

```bash
workstation init codex.microsoft-todo-mcp
workstation init codex.microsoft-todo-mcp --yes
```

包含内部 server 名称、私有本地命令、Codex plugin 配置或 OAuth callback 顶层字段的
TOML 不进入公开 APM manifest。这些内容继续由 allowlisted private overlay 管理：

```bash
wst private mcp-apply --dry-run
wst private mcp-apply --yes
```

`mcp-apply` 只写 `~/.codex/config.toml` 中标记为
`workstation managed private mcp` 的 block，不覆盖完整配置。

## Skill 结构与触发

一个 Skill 是包含 `SKILL.md` 的目录，可以带脚本、参考资料和资源。Agent 根据
`SKILL.md` frontmatter 中的名称和描述决定是否触发；需要时也可以显式输入
`$skill-name`。

全局 Skills 应保持少而清晰。描述重叠会增加误触发；不具备跨项目价值的工作流应留在
仓库 `.agents/skills` 或私有 overlay 中。

已经安装但低频、可通过 Hub 路由或只需手动调用的 Skill，不必卸载。可在其
`agents/openai.yaml` 中关闭隐式触发；它不会进入每轮模型上下文，但仍可通过 `$skill-name` 调用：

```yaml
policy:
  allow_implicit_invocation: false
```

私有 overlay 可用 `skills.policies` 记录这些选择，并通过 `wst private skills-apply --yes` 幂等重放，避免直接复制或接管第三方 Skill 内容。

## 本机审计

使用 workstation 的只读审计检查 APM manifest/lock、skills.sh 与 workstation 来源锁、锁定文件与哈希、全局与项目
discovery root、未纳管的 shared Skills、同名 Skill、元数据规模以及无效 frontmatter：

```bash
wst skills audit
wst skills audit --json
wst skills audit --check
```

只有既未登记在 APM、skills.sh 全局锁，也未登记在 workstation provenance lock 中的 shared Skills 才会聚合为未纳管 warning。APM manifest 与 lock 都不存在表示
“未配置”，不会失败；只存在一侧、YAML 或最小结构无效、显式 alias 未锁定、部署路径逃逸
`~/.agents/skills`、shared Skill 部署文件缺失或哈希不符、Skill 目录或符号链接不可读，或递归发现的
`SKILL.md` frontmatter 无效（包括 description 超过 Codex 的 1024 字符上限）时，`--check` 返回非零退出码。
skills.sh 锁存在但 JSON 或最小结构无效时同样失败；它可能包含面向其他 Agent 的全局 Skill，
所以审计只用该锁确认 shared Skill 的来源，不要求每个锁条目都部署到 Codex 的 shared root。
workstation provenance lock 则严格校验对应 shared/Codex 私有部署的存在性与目录摘要；锁无效、部署缺失或内容被修改都会令 `--check` 失败。
超过 500 字符的 description、超过 500 行的正文、非标准 name（最多 64 个小写字母、数字和单连字符）和目录名不匹配会聚合为可维护性 warning；命令不会安装、删除或移动 Skill。
报告会分别统计 implicit 与 explicit-only Skill，以及实际常驻的 implicit description 字符数。
顶层 Skill 符号链接会递归审计，但每个 discovery root 最多读取 10,000 个目录项和 32 层；
超过上限会失败，避免误配置链接扩大为无界文件系统扫描。
其中依赖匹配只核对 manifest 中显式声明的 alias；字符串 shorthand、完整 URL、registry
与非 Skill 部署的权威一致性仍由 `apm install --global --frozen` 校验，避免在 `wst` 中复制
APM 的解析器。
机器状态审计属于 workstation；只有多个产品需要共享同一套解析规则时，才把纯规则模块
抽到独立仓库，`wst` 接口仍保留在这里。

## 边界

| 需求 | 使用 |
| --- | --- |
| 公开 Skills、项目级标准 MCP、版本锁定、更新与重放 | APM；已有 skills.sh 安装保留其来源锁 |
| 个人可复用的公开 Skills 内容 | 独立 Skills 仓库（如 `YunYouJun/ai`），再通过 APM/安装器部署 |
| 公开的用户级 Codex MCP | workstation init / `codex mcp` |
| 仓库共享工作流 | `.agents/skills` |
| 私有本地 Skill、Codex 专属 MCP、1Password | `wst private` |
| 软件安装 | `Brewfile` / `pnpm software:*` |
| 仓库约定 | `AGENTS.md` |

APM 0.28 的 `audit` 仍没有全局模式。用
`apm install --global --frozen` 校验全局 manifest/lock 一致性并重放锁定状态；
不要在 `~/.apm` 下运行项目作用域的 `apm audit --ci`，因为它会按错误的
项目根目录解释部署路径。

## 参考

- [APM 文档](https://microsoft.github.io/apm/)
- [APM install](https://microsoft.github.io/apm/reference/cli/install/)
- [skills.sh CLI](https://github.com/vercel-labs/skills)
- [Agent Skills](https://agentskills.io/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
