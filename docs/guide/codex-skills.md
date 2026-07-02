# Codex Skills

Codex skills 是可复用工作流。一个 skill 会把任务特定说明、参考资料和可选脚本打包在一起，让 Codex 在不同线程中可靠地遵循同一流程。

当工作流可复用时使用 skill。当输出应该是确定的机器状态时，使用脚本或包管理器清单。

## 调用

知道需要哪个工作流时，可以显式调用 skill：

```text
$skill-name
```

在 Codex CLI 和 IDE 界面中，可以使用 `/skills` 或输入 `$` 来选择 skill。已安装的插件也可能暴露可在提示中显式调用的 skills。

当你的请求匹配 skill 描述时，Codex 也可以隐式调用 skill。好的 skill 描述应该清楚说明什么时候应该触发，以及什么时候不应该触发。

## Skill 结构

一个 skill 是包含 `SKILL.md` 的目录：

```md
---
name: workstation-software
description: Maintain the workstation software catalog, Brewfiles, and docs.
---

Follow the repository's software setup workflow.
```

可选文件夹可以存放脚本、参考资料、模板或资源。Codex 起初只看到 skill 名称、描述和路径；只有在判断该 skill 适用后，才会读取完整的 `SKILL.md`。

## 本地位置

Codex 会从多个范围发现 skills：

| 范围 | 位置 | 用途 |
| --- | --- | --- |
| 仓库 | `.agents/skills` | 此仓库共享的工作流 |
| 用户 | `~/.agents/skills` | 跨仓库的个人工作流 |
| 管理员 | `/etc/codex/skills` | 机器或组织默认项 |
| 系统 | Codex 内置 | 例如 skill 创建等内置工作流 |

当 Codex 在嵌套项目中启动时，仓库 skills 也可以位于父目录。新增或修改 skill 后如果未出现，请重启 Codex。

## 创建或安装

用内置 creator 创建新 skill：

```text
$skill-creator
```

安装 curated 或外部 skill 到本地：

```text
$skill-installer
```

如果一个工作流需要分发给其他开发者，应把它打包成插件，而不是只提交一个本地 skill。

## Skills、插件与脚本

| 需求 | 使用 |
| --- | --- |
| Codex 可复用说明 | Skill |
| 包含 skills、应用集成、MCP servers 或资源的共享包 | 插件 |
| 确定性的本地安装或机器状态变更 | 脚本或清单 |
| 定时检查或提醒 | 自动化 |
| 仓库约定和命令 | `AGENTS.md` |

对于此工作站仓库，软件安装应保留在 `Brewfile`、`Brewfile.apps` 和 `pnpm software:*` 中。Skill 可以帮助维护目录、解释选择或运行文档化流程，但不应是唯一知道要安装什么的地方。

此仓库还提供 repo-scoped skill：

| Skill | 用途 |
| --- | --- |
| `$workstation-projects` | 让 Codex 按 dry-run、`gh`、`ghq` 和 `wst p active` 的规范处理项目 checkout。 |

## 示例工作流

让 Codex 使用 skill 做维护：

```text
$workstation-software update the software catalog for a new Mac setup
```

让 Codex 使用项目 checkout workflow：

```text
$workstation-projects preview cloning YunYouJun's 50 most active repositories
```

让 Codex 运行确定性的机器状态脚本：

```text
Check missing software and install the app manifest.
```

Codex 应把第二个请求解析为：

```bash
pnpm software:missing
pnpm software:install --apps
```

## 参考

- [Agent Skills](https://developers.openai.com/codex/skills)
- [Plugins](https://developers.openai.com/codex/plugins)
- [Build plugins](https://developers.openai.com/codex/plugins/build)
