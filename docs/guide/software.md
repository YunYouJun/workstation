<script setup>
import SoftwareCatalog from '../.vitepress/theme/components/SoftwareCatalog.vue'
</script>

# 软件

此页列出常见的新机器应用。官网链接用于了解产品；下载页用于快速安装。可重复安装应优先使用 Homebrew 清单，或仓库中的轻量辅助脚本。

## 安装策略

- 用 `Brewfile` 管理终端基础工具和日常 CLI。
- 用 `Brewfile.apps` 管理可选桌面应用。
- 对需要手动确认、账号设置或许可证检查的应用保留下载链接。
- 一次性实验不要加入清单，除非它们已经成为日常工作的一部分。

## 交互目录

<SoftwareCatalog />

在目录中搜索或切换分类后，可直接打开当前结果的下载页，也可以进入单个软件的官方站点。搜索支持空格或逗号分隔的多个关键词；下面的命令适合终端批量操作。

## 软件中心接口

### 仓库来源

Craft Hub 的软件中心可以添加本地或线上 Git 仓库来源；同一仓库可同时关联线上地址与本机目录，并选择读取位置。本地目录的 `origin` 会用于确认仓库身份，绑定不会拉取、切换分支或授予项目执行信任。

Craft Hub 直接静态解析仓库根目录的 `software.config.ts`，无需构建或导出 JSON。清单须保留为 `export const softwareGroups` 的字面量数组，支持类型标注、`as const` 和 `satisfies`；不会导入或执行仓库代码，也不解析由函数调用、变量引用或展开运算计算出来的值。

预览后保存目录快照；本地模式读取当前 TS（含未提交修改），线上模式读取选定分支的提交。刷新失败继续使用缓存，移除来源后仍保留默认内置目录与个人收藏。

`software.config.ts` 是唯一需要编辑的软件清单。Craft Hub 维护者通过 `pnpm software-catalog:sync /path/to/workstation/software.config.ts` 复制经过验证的 TS 作为离线默认目录，没有安装 Workstation 也能浏览和收藏。已连接插件时使用下面的 API 获取本机状态和管理能力。

Craft Hub 等工作台可复用 `software.config.ts`，通过独立的版本化接口读取软件卡片，不需要维护第二份目录：

```bash
printf '%s\n' '{"version":1,"operation":"catalog"}' | workstation software-json
```

成功响应为 `{ "ok": true, "result": { "version": 1, ... } }`。目录条目提供本地化名称、分类、官网、可选下载和源码仓库链接、安装方式，以及 `canInstall` 和 `canOpen`。没有公开源码的软件不填充仓库链接。

`catalog` 只读检查 macOS 标准应用目录，以及绝对 PATH 和常见安装目录中的声明可执行文件，不运行探测到的程序。Codex CLI 也可复用官方 Codex / ChatGPT 应用内的原生二进制。无法验证的条目返回 `unknown`；`not-detected` 不代表软件一定未安装，检测到 VS Code 也不代表扩展已安装。

软件目录包含 magpie、Orca、VS Code、CodeBuddy 中国版和 VS Code 插件。工作台可通过以下 v1 操作完成所选软件的安装流程：

| 操作 | 请求中的额外字段 | 结果 |
| --- | --- | --- |
| `preview` | `softwareIds: string[]`，最多 50 个且不重复 | 30 分钟有效的不可变计划，条目为安装、跳过或手动处理，以及 Homebrew 前置条件 |
| `install` | `planId: string, confirmed: true` | 启动后台任务并返回持久化运行记录；重复提交同一计划返回同一记录 |
| `runs` | 无 | 最近 20 条运行记录和日志 |
| `run` | `runId: string` | 单条运行记录 |
| `cancel` | `runId: string` | 请求取消；运行保持 `cancelling`，直到安装器及其进程组停止 |
| `open` | `softwareId: string` | 重新检测后打开已安装的目录应用 |

安装只支持 macOS 上目录声明的 Homebrew cask / formula，不执行 `installCommand`。每项安装前重新检测并跳过已有软件，不调用 `brew upgrade`；禁用 Homebrew 自动更新、既有包自动升级、对已安装依赖此包软件的升级或重装检查，以及自动清理。所选软件需要的依赖仍由 Homebrew 处理。退出码为 0 后仍须检测到声明的应用或二进制才记为成功。Homebrew 缺失、手动下载、App Store 登录或管理员交互仍需用户处理；自动项目完成后仍有手动项目的任务使用 `waiting` 状态。

运行中的条目可带 `progress`：`phase` 为 `preparing`、`downloading` 或 `installing`。下载阶段的可选 `percent`（0–100）来自 Homebrew 的文件下载量或 curl 进度，`resource` 标识当前文件；多个依赖按各自文件显示，不代表整个安装计划的百分比。总量未知时省略 `percent`。macOS 通过输出终端读取 Homebrew 的实时进度，安装器仍由 worker 直接启动并管理进程组，不转发交互输入。进入安装阶段后清除文件百分比，只有退出成功且重新检测通过才标记为已安装；终态不保留过期进度。历史中的进度可在刷新后恢复，旧记录没有此字段也仍有效。

任务与计划保存在本机 Workstation 状态目录（macOS 为 `~/Library/Application Support/Workstation/software-v1`），不写入配置仓库。每项日志仅保留最近 16 KiB，先按完整行脱敏再持久化。中断不会自动重跑；重试需要对失败或中断的软件重新预览、确认并创建新计划。取消可能留下部分下载或安装文件，应刷新检测结果后再重试。

失败响应为 `{ "ok": false, "code": "...", "error": "..." }`，使用固定错误代码，例如 `PLAN_STALE`、`PLAN_EXPIRED`、`INSTALL_BUSY`、`NOT_FOUND`、`CONFIRMATION_REQUIRED` 或 `UNAVAILABLE`，不回显原始请求或异常诊断。

## 快速命令

列出已知软件 id：

```bash
pnpm software list
```

打开所选应用的官方下载页：

```bash
pnpm software:open raycast feishu wetype microsoft-todo ima
```

快速安装 Raycast、飞书和微软待办；微信输入法与 ima 走官方下载页：

```bash
brew install --cask raycast feishu
brew install mas
mas install 1274495053
pnpm software:open wetype ima
```

微信输入法优先使用官网下载安装器，避免 Homebrew cask 版本滞后或安装入口不完整。

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
