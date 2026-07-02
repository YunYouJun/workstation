<script setup>
import SoftwareCatalog from '../.vitepress/theme/components/SoftwareCatalog.vue'
</script>

# 软件

此页列出常见的新机器应用。下载链接指向官方项目页面；可重复安装应优先使用 Homebrew 清单，或仓库中的轻量辅助脚本。

## 安装策略

- 用 `Brewfile` 管理终端基础工具和日常 CLI。
- 用 `Brewfile.apps` 管理可选桌面应用。
- 对需要手动确认、账号设置或许可证检查的应用保留下载链接。
- 一次性实验不要加入清单，除非它们已经成为日常工作的一部分。

## 交互目录

<SoftwareCatalog />

## 快速命令

列出已知软件 id：

```bash
pnpm software list
```

打开所选应用的官方下载页：

```bash
pnpm software:open microsoft-todo vscode neteasemusic qq wechat codex chrome raycast feishu
```

显示共享软件目录中的安装状态：

```bash
pnpm software:status
pnpm software:missing
```

改变机器前先检查安装状态：

```bash
pnpm software:check --core
pnpm software:check --apps
```

安装终端基础工具：

```bash
pnpm software:install --core
```

安装可选桌面应用：

```bash
pnpm software:install --apps
```

`Brewfile.apps` 也通过 `mas` 包含 Mac App Store 应用，因此安装这些条目前需要先登录 App Store。

安装两个清单：

```bash
pnpm software:install --all
```

## Skill 与脚本

Codex skill 可以帮助操作或记录设置流程，但它不应成为机器状态的事实来源。脚本和包管理器清单更适合这件事，因为它们在仓库中版本化、可在 PR 中审查，也可以安全重跑。

使用 skill 处理编排和维护笔记。实际安装应使用 `Brewfile`、`Brewfile.apps` 和 `pnpm software:*` 命令。什么时候使用 skill、本地脚本或插件，见 [Codex Skills](./codex-skills.md)。
