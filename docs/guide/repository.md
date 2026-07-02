# 仓库范围

`workstation` 是个人开发环境设置的顶层仓库。它可以包含 dotfiles、引导脚本、包清单、项目 checkout 约定和文档。

## 命名约定

- 仓库：`workstation`
- Checkout 路径：`~/repos/github.com/YunYouJun/workstation`
- Dotfiles 源目录：`home/`
- 主命令：`workstation`
- 短入口：`wst`
- 领域短别名：`df`、`p`
- 兼容命令：`dotfiles`
- 文档：`docs/`
- CLI 包：`packages/cli`

这样可以让仓库名和主命令保持宽泛，同时保留已有的 `dotfiles` CLI 名称作为兼容入口。

## CLI 命名

推荐使用 `workstation` 作为主命令，并按领域拆分子命令：

```bash
workstation doctor
workstation bootstrap --dry-run
workstation packages install --dry-run
workstation dotfiles pull --dry-run
workstation projects clone-active
```

日常重复输入时可以使用短别名：

```bash
workstation df pull --dry-run
workstation p active --limit 20
wst df pull --dry-run
wst p active --limit 20
```

短入口使用 `wst`，避免占用更容易被理解成 WebSocket 或 workspace 的 `ws`。旧的 `dotfiles` 命令保留为兼容别名，用于现有同步工作流。

## 常用 `.gitignore` 基线

旧笔记里的通用模板可以合并到当前仓库的忽略策略，但本仓库使用 pnpm，并且应该提交 `pnpm-lock.yaml`，所以不要把它加入忽略列表。当前适合保留的通用项是：

```text
.DS_Store
node_modules/
dist/
tmp/
```

如果本仓库里误生成了 npm 或 Yarn lockfile，可以忽略 `package-lock.json` 和 `yarn.lock`；依赖版本仍由 `pnpm-lock.yaml` 固定。

## 应该放在这里的内容

- Shell、Git、编辑器、终端和 Codex 配置。
- macOS 设置笔记和脚本。
- 新增包自动化后，用于包管理器的清单，例如 `Brewfile`。
- 安全的项目 checkout 清单，例如 `projects.example.yaml`。
- 让机器设置更容易检查和复现的本地开发脚本。
- 解释设置决策、取舍和恢复步骤的笔记。

## 不应该放在这里的内容

- Token、私钥、密码和生成的 `.env` 文件。
- 公开仓库中的公司内部仓库名。
- 机器特定的绝对路径，除非它们只是示例或明确可配置。
- `dist/`、`docs/.vitepress/dist` 等生成产物。
- 更适合通过包管理器安装的大型二进制文件和应用导出。

## 目录结构

```text
workstation/
  docs/                 # VitePress 文档
  home/                 # chezmoi 兼容的 home 文件
  packages/cli/         # workstation CLI
  projects.example.yaml # 公开的项目清单示例
  package.json          # 工作区脚本
```

仓库继续增长时，优先添加带文档的模块，而不是把无关设置逻辑混在一个大型脚本里。
