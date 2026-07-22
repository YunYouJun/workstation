# 终端

新 macOS 机器的默认终端栈是：

- Homebrew 用于包安装。
- Zsh 作为交互式 shell。
- Oh My Zsh 用于轻量 shell 插件和补全。
- Starship 用于 prompt。
- fzf 用于模糊选择。
- zoxide 用于更聪明的目录跳转。
- Tmux 用于远程机器和长期运行任务的持久会话。
- zsh-autosuggestions 和 zsh-syntax-highlighting 用于交互编辑。

## 决策

在新机器上默认使用 Starship 作为 prompt。

Starship 跨 shell，只需要一个 TOML 配置文件，并且可以轻松通过 Homebrew 重新安装。如果一台机器已经有调好的 Zsh-only Powerlevel10k prompt，它仍然很好；但因为上游项目支持有限且不再计划新功能，它不再是新机器的默认选择。

保留 Oh My Zsh，但不要让它负责 prompt。在这套设置中，Oh My Zsh 提供插件和补全，Starship 负责 prompt 渲染。

### Starship Prompt

`home/dot_config/starship.toml` 使用 Starship 内建模块渲染 prompt，不通过自定义 shell 命令重复解析 `git status`。这让配置保持跨 shell、可维护，并且受 `command_timeout` 保护。

默认 prompt 保持两行：第一行显示目录、Git、运行时、包版本、命令耗时和失败退出码，第二行只显示输入符号。Git 信息只在仓库中出现：

- `git:<branch>`：当前分支。
- `~N`：modified 文件数。
- `+N`：staged 文件数。
- `?N`：untracked 文件数。
- `-N`：deleted 文件数。
- `»N`：renamed 文件数。
- `=N`：冲突文件数。
- `⇡N` / `⇣N` / `⇕⇡A⇣B`：与 upstream 的提交差异，分别表示 ahead、behind 和 diverged。
- ` +A -D`（`nf-oct-diff`）：当前 diff 的增删行数。

`git_state` 会在 merge、rebase、cherry-pick、bisect 等操作进行中显示状态；`status` 只在上一条命令失败时显示 `exit <code>`。如果某个超大仓库或 WSL 的 Windows 挂载目录里 prompt 变慢，优先关闭 `git_metrics`，必要时再针对该环境调整 `git_status`。

视觉风格基于 Starship 的 Tokyo Night preset，并叠加 workstation 自己的 Git 计数、diff 行数、失败退出码和 package 版本配置。目录段使用高对比 Tokyo blue 变体，避免原 preset 浅字叠在中亮蓝背景上时不够清晰；留白参考原 preset 的色块胶囊节奏，在色块外侧保留呼吸感，连续子模块之间只保留一个空格，避免直接叠加模块留白造成双空格。`Brewfile` 安装 `font-hack-nerd-font`；终端应用需要把字体切到 `Hack Nerd Font Mono`，才能正确显示 powerline、Git 分支、Node、Bun、Deno 和 package 图标。VS Code 与 CodeBuddy CN 的集成终端字体由全局 settings 模板设置为 `Hack Nerd Font Mono, Source Code Pro, monospace`；iTerm2 或系统 Terminal 需要在各自 Profile 里手动选择 Nerd Font。文件状态仍使用 `~N`、`+N`、`?N` 这类短文本符号，diff 行数使用 `nf-oct-diff` 图标，优先保证扫读效率。

`home/dot_zshrc` 提供 `starship-theme` 函数和 `stheme` 短别名，用来快速切换 prompt 主题。`default` 会把当前 live 配置先保存到 `~/.local/state/workstation/starship/current.toml`，再恢复 workstation 管理的默认主题；`current` 会恢复刚才保存的 live 主题；`preset <name>` 可以临时试 Starship 官方 preset：

```bash
stheme status
stheme default
stheme current
stheme preset gruvbox-rainbow
stheme list
```

macOS 自带 Terminal 的字体跟 shell 配置无关，它保存在 Terminal Profile 中。当前默认 Profile 可以这样检查和修复：

```bash
osascript -e 'tell application "Terminal" to get name of default settings'
osascript -e 'tell application "Terminal" to get font name of default settings'
osascript -e 'tell application "Terminal" to set font name of default settings to "HackNFM-Regular"'
```

Codex Desktop 的内置终端有时会把交互式 shell 的 `TERM` 暴露为 `dumb`，这会让 Starship 主动禁用 prompt。`home/dot_zshrc` 只在 Codex 环境中把交互式 `TERM=dumb` 修正为 `xterm-256color`，避免影响普通终端。Codex 自身的终端字体来自 Codex 外观配置里的 `fonts.code`；本机可以在 `~/.codex/config.toml` 中把 code font 设置为 `Hack Nerd Font Mono`，但不要把整份 Codex 配置同步进 workstation，因为它可能包含登录态、MCP 或机器私有配置。

### GitHub 大 Push 确认

Git 2.55 及以上版本可以通过 named configured hook 注册全局 hook，同时保留仓库自己的 `.git/hooks`。workstation 提供的 `pre-push` 守卫只检查 `github.com` remote；它根据 hook 收到的新旧 object ID 在本地生成 thin pack，超过默认 `800 KiB` 时，在主体 pack 上传前通过 macOS 对话框确认。不超过 `10 MiB` 的 pack 会显示具体估算值；达到估算上限后会提前停止并显示“超过 10 MiB”。取消或无法显示对话框且没有交互终端时，push 会被阻止。

先同步 executable，再预览和启用可选初始化任务：

```bash
mkdir -p ~/.local/libexec
workstation dotfiles chezmoi apply ~/.local/libexec/git-confirm-large-push
wst init git.large-push-guard
wst init git.large-push-guard --yes
git hook list --show-scope pre-push
```

阈值故意低于外部工具常见的 `1 MiB` 告警线，为 Git 协议、SSH/HTTPS 和 pack 估算误差留出余量。可按字节或 Git 的 `k`/`m` 后缀调整：

```bash
git config --global workstation.largePushGuardBytes 800k
```

某个仓库确实不需要守卫时，可以只在该仓库禁用；恢复时删除本地覆盖：

```bash
git config --local hook.workstation-large-push-guard.enabled false
git config --local --unset hook.workstation-large-push-guard.enabled
```

`pre-push` 发生前仍会有少量连接握手和 remote refs 查询；守卫阻止的是主体 Git pack，而不是零字节网络策略。`git push --no-verify` 可以主动绕过。Git LFS 使用独立上传流程，目前不计入 pack 阈值。参考 [Git hooks](https://git-scm.com/docs/githooks#_pre_push)、[configured hooks](https://git-scm.com/docs/git-hook) 和 [pack-objects](https://git-scm.com/docs/git-pack-objects)。

### 目录跳转

新机器默认使用 `zoxide`，不再把 `autojump` 作为默认方案。`zoxide` 是受 `z` 和 `autojump` 启发的现代 `cd` 替代工具，支持主流 shell，会根据常用目录权重通过 `z` 快速跳转，也可以通过 `zi` 配合 `fzf` 交互选择。

项目路径仍由 `ghq` 负责，保持 `~/repos/<host>/<owner>/<repo>` 这种接近远程 URL 的布局。第一次进入或需要精确路径时使用 `ghq list -p`；日常高频项目用 `z <keyword>`；结果不确定时用 `zi <keyword>`；想从所有 checkout 中挑一个时，用 `ghq list -p | fzf`。

`autojump` 已作为历史方案归档。旧机器迁移时优先移除 `autojump` 插件加载和 Homebrew 包，统一使用 `zoxide`。

## 安装

从官方安装器安装 Homebrew：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

然后让当前 shell 可用 `brew`：

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

安装此仓库声明的终端工具链：

```bash
brew bundle --file Brewfile
```

通过 `fnm` 安装默认 Node.js 运行时：

```bash
fnm install --lts
fnm default lts-latest
```

应用管理的 dotfiles：

```bash
workstation dotfiles pull --dry-run
workstation dotfiles pull --force
```

重启 Zsh：

```bash
exec zsh
```

## 工具

| 工具 | 作用 |
| --- | --- |
| `starship` | 跨 shell prompt，显示 Git、运行时、包和命令耗时等上下文。 |
| `fzf` | 用于历史、文件、目录、Git 分支和临时选择的模糊查找器。 |
| `zoxide` | 更聪明的 `cd`，学习常用目录并通过 `z` 跳转。 |
| `zsh-autosuggestions` | 输入时从历史中显示命令建议。 |
| `zsh-syntax-highlighting` | 在 prompt 中高亮合法命令、字符串、路径和错误。 |
| `fnm` | 快速 Node.js 版本管理器。 |
| `ripgrep` | 快速代码和文本搜索。 |
| `fd` | 快速、友好的文件查找器。 |
| `eza` | 现代 `ls` 替代工具。 |

## Shell 初始化顺序

保持 shell 启动顺序可预测：

1. 初始化 Homebrew，让 Homebrew 安装的工具进入 `PATH`。
2. 如果安装了 Oh My Zsh，加载它。
3. 加载语言管理器和路径追加。
4. 在补全可用后初始化 fzf 和 zoxide。
5. 接近结尾时初始化 Starship。
6. 最后 source `zsh-syntax-highlighting`。

## fzf 快捷键

Homebrew 安装的 fzf 集成启用：

- `Ctrl-R`：模糊搜索命令历史。
- `Ctrl-T`：把文件或目录模糊插入到当前命令。
- `Alt-C`：模糊跳转目录。

## 项目跳转

精确进入某个 `ghq` 项目：

```bash
cd "$(ghq list -p github.com/YunYouJun/workstation)"
```

访问过一次后，交给 `zoxide`：

```bash
z workstation
z YunYouJun workstation
zi workstation
```

从所有 `ghq` checkout 中模糊选择并进入：

```bash
project="$(ghq list -p | fzf)" && cd "$project"
```

如果想把它变成短命令，可以放在机器私有 shell 配置中：

```zsh
cdp() {
  local project
  project="$(ghq list -p | fzf --preview 'git -C {} status --short --branch 2>/dev/null | head -50')" && cd "$project"
}
```

## Tmux 会话

Tmux 适合远程机器、长时间构建、部署排查和需要断开后继续观察的日志会话。它不是默认核心工具，需要时可单独安装：

```bash
brew install tmux
```

新建命名会话：

```bash
tmux new -s <session-name>
```

从当前会话分离：

```bash
tmux detach
```

也可以在 Tmux 内按 `Ctrl-B`，再按 `d` 分离会话。

重新接入会话：

```bash
tmux attach -t <session-name>
```

结束指定会话：

```bash
tmux kill-session -t <session-name>
```

参考：[Tmux 使用教程](https://www.ruanyifeng.com/blog/2019/10/tmux.html)。

## 终端代理

`home/dot_zshrc` 提供两个临时代理函数：

```bash
goproxy
disproxy
```

默认代理地址是 `127.0.0.1:8234`，SOCKS 地址是 `127.0.0.1:8235`。如果某台机器使用其他端口，在机器本地配置里覆盖环境变量，再调用 `goproxy`：

```bash
TERMINAL_PROXY_HTTP_PORT=7890 TERMINAL_PROXY_SOCKS_PORT=7890 goproxy
```

WSL 里代理服务通常在 Windows 侧，需要把 `TERMINAL_PROXY_HOST` 设置为 `/etc/resolv.conf` 里看到的 nameserver 地址。macOS 上如果工具本身已经由 Surge、Clash 或系统代理接管，可以不打开 shell 级代理。

## p10k 备用方案

Powerlevel10k 仍可作为已有机器的备用方案。如果没有安装 `starship`，但 Powerlevel10k 可用，`.zshrc` 仍可加载它。新机器应优先安装 Starship。

## 旧环境笔记迁移

语雀里的 oh-my-zsh、macOS/Linux 初始脚本、Tmux 和 Terminal Proxy 笔记已经收敛到这里和 `home/dot_zshrc`：

- 新 macOS 机器使用 [引导流程](./bootstrap.md) 与 [可复制命令](./commands.md)，不要再维护一份临时安装脚本。
- Node.js 默认通过 `fnm` 安装，不再使用 Homebrew 安装 `nvm`。
- prompt 默认使用 Starship，Powerlevel10k 只作为已有机器的 fallback。
- 目录跳转默认使用 `zoxide` + `fzf`，不再安装或加载 `autojump`。
- `zsh-autosuggestions` 和 `zsh-syntax-highlighting` 优先来自 Homebrew；如果已有 Oh My Zsh custom plugin，`.zshrc` 仍会兼容加载。

参考：

- [Homebrew](https://brew.sh/)
- [Starship](https://starship.rs/guide/)
- [Starship 配置](https://starship.rs/config/)
- [fzf](https://github.com/junegunn/fzf)
- [zoxide](https://github.com/ajeetdsouza/zoxide)
- [ghq](https://github.com/x-motemen/ghq)
- [Powerlevel10k](https://github.com/romkatv/powerlevel10k)
