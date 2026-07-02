# 终端

新 macOS 机器的默认终端栈是：

- Homebrew 用于包安装。
- Zsh 作为交互式 shell。
- Oh My Zsh 用于轻量 shell 插件和补全。
- Starship 用于 prompt。
- fzf 用于模糊选择。
- zoxide 用于更聪明的目录跳转。
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

## p10k 备用方案

Powerlevel10k 仍可作为已有机器的备用方案。如果没有安装 `starship`，但 Powerlevel10k 可用，`.zshrc` 仍可加载它。新机器应优先安装 Starship。

参考：

- [Homebrew](https://brew.sh/)
- [Starship](https://starship.rs/guide/)
- [fzf](https://github.com/junegunn/fzf)
- [zoxide](https://github.com/ajeetdsouza/zoxide)
- [Powerlevel10k](https://github.com/romkatv/powerlevel10k)
