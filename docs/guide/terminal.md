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
| `tmux` | 终端复用器，用于保持远程 shell、构建、部署或日志会话。 |
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

## Tmux 会话

Tmux 适合远程机器、长时间构建、部署排查和需要断开后继续观察的日志会话。

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
- `zsh-autosuggestions` 和 `zsh-syntax-highlighting` 优先来自 Homebrew；如果已有 Oh My Zsh custom plugin，`.zshrc` 仍会兼容加载。

参考：

- [Homebrew](https://brew.sh/)
- [Starship](https://starship.rs/guide/)
- [fzf](https://github.com/junegunn/fzf)
- [zoxide](https://github.com/ajeetdsouza/zoxide)
- [Powerlevel10k](https://github.com/romkatv/powerlevel10k)
