# 引导流程

Bootstrap 应该枯燥、可见、可恢复。新机器脚本只有在部分失败后能安全重跑时才真正有用。

## 首次运行

如果机器还没有 Homebrew，先安装它：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
eval "$(/opt/homebrew/bin/brew shellenv)"
```

安装 `ghq`，配置项目根目录，并把此仓库 clone 到标准路径：

```bash
brew install ghq
git config --global ghq.root ~/repos
ghq get git@github.com:YunYouJun/workstation.git
cd "$(ghq list -p github.com/YunYouJun/workstation)"
```

安装软件包和运行时工具：

```bash
brew bundle --file Brewfile
fnm install --lts
fnm default lts-latest
```

也可以从独立的应用清单安装桌面应用：

```bash
pnpm software:install --apps
```

安装工作区依赖并构建 CLI：

```bash
pnpm install
pnpm build
```

预览本机初始化任务，例如 Git `includeIf` 身份路由：

```bash
wst init --list
wst init git.include-if --git-profile 'id=github;host=github.com;name=Your Name;email=you@example.com'
```

写入 `$HOME` 前先运行检查：

```bash
workstation dotfiles doctor
workstation dotfiles pull --dry-run
```

检查 dry-run 输出后，再应用 dotfiles：

```bash
workstation dotfiles pull --force
```

更多可直接复制的命令块见[可复制命令](./commands.md)。

## 最佳实践

- 在改变机器状态前先运行 `doctor` 检查。
- 对任何会写入 `$HOME` 的命令使用 `--dry-run`。
- 替换文件前先备份被覆盖文件。
- 保持引导脚本幂等。
- 把设置拆成小阶段：软件包、dotfiles、密钥、项目、应用偏好。
- 当脚本无法自动完成时，打印清楚的下一步。

## 建议阶段

1. 安装命令行前置工具。
2. 恢复 dotfiles。
3. 配置本地密钥。
4. Clone 常用项目。
5. 安装编辑器扩展和语言工具链。
6. 再次运行 `doctor`。

目标不是魔法般的一条命令装好一切，而是一个可以审计、可以恢复、可以持续改进的设置流程。
