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

应用全局 APM manifest，并按锁文件恢复公开 Skills 与标准 MCP：

```bash
wst df chezmoi apply
apm install --global --frozen
apm deps list --global
```

读取私有 dotfiles overlay，并只预览会生成的本地 ignored 配置：

```bash
wst private connect
wst private status
wst private file-restore --bundle wecom-cli --dry-run
wst private mcp-export --server gongfeng,iwiki,knot --dry-run
wst private apply --dry-run
```

非交互连接私有仓库：

```bash
wst private connect --repo git@example.com:user/dotfiles.git --target-dir ~/repos/private/dotfiles --yes
```

确认 1Password 已登录后，再显式应用：

```bash
wst private apply --yes
wst private file-restore --bundle wecom-cli --yes
```

从旧机器把已安装的 Codex MCP server 导出到私有 overlay，提交私有
dotfiles 后，新机器只需要 `wst private apply --yes` 读取该 overlay：

```bash
wst private mcp-export --server gongfeng,iwiki,knot --yes
```

## SSH 与远端连接

生成新的 GitHub SSH key，并复制公钥：

```bash
ssh-keygen -t ed25519 -C "you@example.com"
cat ~/.ssh/id_ed25519.pub
```

把公钥安装到远程机器：

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@example-host
```

检查 GitHub SSH 认证：

```bash
ssh -T git@github.com
```

## macOS 与 Unix 维护

清除 macOS DNS 缓存：

```bash
sudo killall -HUP mDNSResponder
```

如果本机 `localhost` 被系统自带 Apache 占用，先停止它：

```bash
sudo apachectl stop
```

临时检查内置磁盘 SMART 信息：

```bash
brew install smartmontools
smartctl -a /dev/disk0
```

查看本机已安装的 JDK，并把 Homebrew OpenJDK 注册给 macOS Java wrapper：

```bash
/usr/libexec/java_home -V
brew install openjdk
sudo ln -sfn "$(brew --prefix openjdk)/libexec/openjdk.jdk" /Library/Java/JavaVirtualMachines/openjdk.jdk
```

如果一台机器需要长期切换多个 JDK，再安装 `jenv`：

```bash
brew install jenv
echo 'export PATH="$HOME/.jenv/bin:$PATH"' >> ~/.zshrc
echo 'eval "$(jenv init -)"' >> ~/.zshrc
jenv add "$(/usr/libexec/java_home)"
jenv versions
```

如果机器上已经有 `rar`，可以用 `-ep1` 避免把完整路径写进压缩包。`rar` 不进入工作站默认清单；只有接收方明确要求 RAR 时再临时使用。

```bash
rar a -ep1 archive.rar /path/to/source
```

常用 macOS 快捷键：

| 快捷键 | 作用 |
| --- | --- |
| `Control-Command-Space` | 显示表情与符号 |
| `Control-Command-F` | 进入或退出全屏 |
| `Shift-Command-5` | 打开截图与录屏工具 |
| `Shift-Command-.` | 在 Finder 中显示或隐藏隐藏文件 |
| `Command-Option-C` | 在 Finder 中复制所选项目的路径 |
| `Command-Shift-G` | 在 Finder 中前往指定路径 |

常用 Linux/Unix 查询命令：

```bash
hostname
uname -m
df -h
du -sh <path>
```

## Windows PowerShell

查看所有 TCP 端口占用：

```powershell
Get-NetTCPConnection
```

查看指定端口，例如 `8080`：

```powershell
Get-NetTCPConnection | Where-Object { $_.LocalPort -eq 8080 }
```

在资源管理器打开当前目录：

```powershell
ii .
```

安装 WSL 时优先使用当前 Windows 命令，旧的功能开关命令只作为历史归档：

```powershell
wsl --install
wsl --list --verbose
```

## 安全检查

检查当前 dotfiles 状态：

```bash
workstation dotfiles doctor
workstation dotfiles status
workstation dotfiles diff
```

查看可用初始化任务：

```bash
wst init --list
```

预览 Git `includeIf` 身份路由初始化：

```bash
wst init git.include-if --git-profile 'id=github;host=github.com;name=Your Name;email=you@example.com'
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
wst p manifest -i
```

预览从本地项目清单 clone：

```bash
wst p manifest --file projects.local.yaml
wst p manifest --file projects.local.yaml --validate
```

预览从私有配置仓库读取项目清单：

```bash
wst p manifest https://git.example.com/<user>/<config-repo> --group common
wst p manifest https://git.example.com/<user>/<config-repo>/raw/main/projects.yaml -g common
wst p m https://git.example.com/<user>/<config-repo> -g common
wst p m --file projects.local.yaml -g common --repository git.example.com/example/service
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

进入一个已知的 `ghq` 项目：

```bash
cd "$(ghq list -p github.com/YunYouJun/workstation)"
```

用 `zoxide` 跳转到访问过的项目：

```bash
z workstation
zi workstation
```

从所有 `ghq` checkout 中模糊选择并进入：

```bash
project="$(ghq list -p | fzf)" && cd "$project"
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
pnpm software:open raycast feishu microsoft-todo ima
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

检查 dry-run 输出后，应用 Git `includeIf` 身份路由：

```bash
wst init git.include-if --git-profile 'id=github;host=github.com;name=Your Name;email=you@example.com' --yes
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

当需要选择初始化任务并输入本机身份信息时，使用交互式初始化：

```bash
wst init -i
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
