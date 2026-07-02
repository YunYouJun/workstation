# 可复制命令

此页把常用工作站操作整理成小块可复制命令。命令按安全等级分组，让新机器设置过程保持可见和可恢复。

## 命令规则

- 一个命令块只做一个阶段。
- 对会写入机器的命令，先运行检查和 dry-run。
- 保留交互式命令，同时记录非交互等价命令。
- 当命令无法安全继续时，打印或记录下一步。
- 把包管理器清单作为事实来源，不把安装逻辑藏在临时脚本里。

## 新机器

如果机器还没有 Homebrew，先安装它：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

把 Homebrew 加载到当前 shell：

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

安装 `ghq` 并配置标准项目根目录：

```bash
brew install ghq
git config --global ghq.root ~/repos
```

确认 `ghq` 项目根目录：

```bash
git config --global --get ghq.root
```

按 `ghq` 布局 clone 此仓库：

```bash
ghq get git@github.com:YunYouJun/workstation.git
cd "$(ghq list -p github.com/YunYouJun/workstation)"
```

如果暂时没有 `ghq`，也可以直接 clone 到同一路径：

```bash
mkdir -p ~/repos/github.com/YunYouJun
git clone git@github.com:YunYouJun/workstation.git ~/repos/github.com/YunYouJun/workstation
cd ~/repos/github.com/YunYouJun/workstation
```

安装仓库声明的软件包：

```bash
brew bundle --file Brewfile
```

安装默认 Node.js 运行时：

```bash
fnm install --lts
fnm default lts-latest
```

安装可选桌面应用：

```bash
pnpm software:install --apps
```

安装工作区依赖并构建 CLI：

```bash
pnpm install
pnpm build
```

## 安全检查

检查当前 dotfiles 状态：

```bash
workstation dotfiles doctor
workstation dotfiles status
workstation dotfiles diff
```

预览从仓库恢复到 `$HOME`：

```bash
workstation dotfiles pull --dry-run
```

预览从 `$HOME` 保存回仓库：

```bash
workstation dotfiles push --dry-run
```

预览 clone 最近活跃的 `YunYouJun` 仓库：

```bash
workstation projects clone-active
```

预览 clone 最近活跃的 20 个 `YunYouJun` 仓库：

```bash
workstation projects clone-active --limit 20
```

用短别名预览同一件事：

```bash
wst p active --limit 20
```

交互式选择要处理的仓库：

```bash
wst p active --limit 50 -i
```

预览从本地项目清单 clone：

```bash
wst p manifest --file projects.local.yaml
```

预览从私有配置仓库读取项目清单：

```bash
wst p manifest https://git.example.com/<user>/<config-repo> --group common
```

用脚本入口和环境变量配置默认数量：

```bash
WORKSTATION_ACTIVE_PROJECT_LIMIT=20 pnpm projects:clone-active
```

检查本地项目是否有未提交、未 push 或 stash：

```bash
workstation projects status
wst p status --check
wst p status --max-depth 8
pnpm projects:status
```

检查 Homebrew 包是否已安装：

```bash
brew bundle check --file Brewfile
```

检查可选桌面应用是否已安装：

```bash
pnpm software:check --apps
```

显示软件目录中缺失的应用：

```bash
pnpm software:missing
```

打开所选应用的官方下载页：

```bash
pnpm software:open microsoft-todo vscode neteasemusic qq wechat codex chrome raycast feishu
```

## 应用更改

检查 dry-run 输出后，把管理的 dotfiles 恢复到 `$HOME`：

```bash
workstation dotfiles pull --force
```

检查 dry-run 输出后，把本地 dotfile 变更保存回仓库：

```bash
workstation dotfiles push --force
```

直接应用 chezmoi 管理的文件：

```bash
workstation dotfiles chezmoi apply
```

检查 dry-run 输出后，clone 最近活跃的 `YunYouJun` 仓库：

```bash
workstation projects clone-active --yes
```

重启当前 shell：

```bash
exec zsh
```

## 交互流程

当需要手动选择方向和文件时，使用交互式同步：

```bash
workstation dotfiles sync -i
```

等价的非交互恢复流程：

```bash
workstation dotfiles sync --direction pull --dry-run
workstation dotfiles sync --direction pull --force
```

等价的非交互保存流程：

```bash
workstation dotfiles sync --direction push --dry-run
workstation dotfiles sync --direction push --force
```

## 发布 CLI

首次使用 GitHub Actions 发布前，先在 npm package settings 为 `@yunyoujun/workstation` 配置 Trusted Publisher：

```text
Publisher: GitHub Actions
Repository: YunYouJun/workstation
Workflow filename: release.yml
Allowed action: npm publish
```

发布新版本：

```bash
pnpm release
git push --follow-tags
```

推送 `v*` tag 后，GitHub Actions 会校验并发布 `packages/cli`。

## 未来命令

仓库超出 dotfiles 范围后，推荐使用更宽泛的 `workstation` 命令和领域子命令，同时保留 `dotfiles` 作为现有同步工作流的兼容别名。

```bash
workstation doctor
workstation bootstrap --dry-run
workstation packages install --dry-run
workstation dotfiles pull --dry-run
workstation projects clone-active
```
