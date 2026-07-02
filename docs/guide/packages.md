# 软件包

软件包安装应该足够可复现，能帮助恢复机器；但也不应僵硬到把每一次临时实验都永久加入设置。

## 推荐分层

- Homebrew formulae 和 casks 用于系统级工具与应用。
- `ghq` 用于 `~/repos` 下可复现的本地仓库布局。
- pnpm workspace 依赖用于仓库本地开发。
- 编辑器扩展列表用于编辑器相关工具。
- 只有在生态确实受益时才使用语言版本管理器。

## 最佳实践

- 当一个包成为日常工作的一部分后，再加入自动化。
- 把一次性实验排除在 bootstrap 清单之外。
- 优先使用包管理器清单，而不是自定义安装命令。
- 区分核心工具和可选应用。
- 先安装软件包，再应用依赖这些工具的 dotfiles。

## Brewfiles

根目录 `Brewfile` 用于终端基础工具和日常 CLI：

```bash
brew bundle dump --file Brewfile --force
brew bundle --file Brewfile
```

`Brewfile.apps` 用于可选桌面应用：

```bash
brew bundle --file Brewfile.apps
```

`Brewfile.apps` 中的 Mac App Store 条目通过 `mas` 安装，因此需要先在本机登录 App Store。

提交前先检查生成的变更。Brewfile 应描述工作站，而不是记录所有曾经试过的应用。
