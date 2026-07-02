# 环境旧笔记迁移索引

这个页面用于替代语雀「环境」目录里的旧散页。旧笔记里的当前有效内容已经合并到 Workstation 文档；过期脚本、旧镜像、历史 hosts、一次性服务端安装包和个人临时 FAQ 不再作为工作站基线维护。

清理旧语雀时优先标记状态，再删除内容。可复用内容迁到这里；无法长期维护但仍有历史参考价值的内容标记归档，不迁入 Workstation。

## 可粘贴替换文案

如果需要先替换旧语雀文档内容，再删除或保留入口，可以粘贴这段：

```md
[已迁移]

本文已迁移至 Workstation：

https://workstation.yunyoujun.cn/guide/migration

其中仍然有效的命令、工具和决策已经合并到新的工作站文档；过时脚本和历史 workaround 不再维护。
```

如果旧页不适合迁入，但想先保留历史记录，可以粘贴这段：

```md
[归档]

本文仅作为历史记录保留，不再维护，也不作为新机器工作站配置的依据。

当前可复用的环境配置请见：

https://workstation.yunyoujun.cn/guide/migration
```

## 新文档入口

- [终端](./terminal.md)：Zsh、Oh My Zsh、Starship、Tmux、代理和终端工具链。
- [可复制命令](./commands.md)：新机器、SSH、macOS/Unix 维护、dotfiles 和项目命令。
- [软件包](./packages.md)：Brewfile、包管理分层和旧环境脚本的取舍原则。
- [软件](./software.md)：可选桌面应用、下载入口和旧 macOS app 推荐。
- [项目](./projects.md)：仓库布局、SSH 基线、Git 多账号和项目清单。
- [仓库范围](./repository.md)：此仓库维护什么、不维护什么。

## 语雀清理状态

- `保留入口`：只保留一个跳转页，指向本迁移索引。
- `已迁移`：有效内容已经进入 Workstation，可把旧页正文替换为跳转文案，确认无引用后删除。
- `部分迁移`：只迁移仍然有效、可重复的命令或决策；旧 workaround、资源收藏和机器相关内容标记归档。
- `归档`：不进入 Workstation，也不删除第一时间的历史记录；适合旧脚本、旧镜像、hosts、一次性服务端套件和不可验证 FAQ。

建议语雀标题或页面顶部使用 `[已迁移]`、`[部分迁移]`、`[归档]` 作为临时标记。最终只保留 `Migrate to workstation.yunyoujun.cn` 入口页。

## 迁移映射

| 旧语雀文档 | 新位置 | 处理 |
| --- | --- | --- |
| `Migrate to workstation.yunyoujun.cn` | 本页和站点首页 | 保留入口 |
| `通用` 分组 | 本页 | 已删除：空分组不再保留 |
| `开发环境配置` | [终端](./terminal.md)、[可复制命令](./commands.md)、[软件包](./packages.md) | 已迁移，可删除旧页 |
| `SSH` | [项目 / SSH 基线](./projects.md#ssh-基线)、[可复制命令 / SSH 与远端连接](./commands.md#ssh-与远端连接) | 已迁移，可删除旧页 |
| `Terminal Proxy` | [终端 / 终端代理](./terminal.md#终端代理) | 已迁移，可删除旧页 |
| `oh-my-zsh 常用插件配置指南` | [终端](./terminal.md) 和 `home/dot_zshrc` | 已迁移，可删除旧页 |
| `GitHub 小技巧` | [项目 / SSH 基线](./projects.md#ssh-基线) | 部分迁移：SSH 443 已合并，旧 hosts 归档 |
| `macOS 开发环境配置` | [引导流程](./bootstrap.md)、[终端](./terminal.md)、[可复制命令](./commands.md) | 已迁移，由可重复流程取代 |
| `macOS app` | [软件](./software.md) | 部分迁移：可复用应用入口已加入软件目录，其余历史推荐归档 |
| `macOS 常用快捷键` | [可复制命令 / macOS 与 Unix 维护](./commands.md#macos-与-unix-维护) | 部分迁移：常用快捷键已合并，其余个人习惯归档 |
| `macOS 与 Java` | [可复制命令 / macOS 与 Unix 维护](./commands.md#macos-与-unix-维护) | 部分迁移：OpenJDK 与 jenv 命令已更新合并，旧路径归档 |
| `Linux` 分组 | 本页 | 已删除：空分组不再保留 |
| `Linux 初始环境配置脚本` | [终端](./terminal.md)、[软件包](./packages.md) | 归档：旧脚本不迁移 |
| `Tmux 简要笔记` | [终端 / Tmux 会话](./terminal.md#tmux-会话) | 已迁移，可删除旧页 |
| `macOS FAQ` | [可复制命令 / macOS 与 Unix 维护](./commands.md#macos-与-unix-维护) | 部分迁移：有效命令已合并，其余归档 |
| `macOS SSH` | [项目 / SSH 基线](./projects.md#ssh-基线) | 已迁移，远程登录与端口转发已合并 |
| `Linux 使用笔记` | [可复制命令 / macOS 与 Unix 维护](./commands.md#macos-与-unix-维护)、[终端](./terminal.md) | 部分迁移：查询类命令已合并，危险或过时片段归档 |
| `一键安装包` | [软件包 / 旧环境笔记迁移](./packages.md#旧环境笔记迁移) | 归档：OneinStack/LNMP 不进工作站基线 |
| `参考教程` | [终端 / Tmux 会话](./terminal.md#tmux-会话) | 部分迁移：Tmux 参考已合并，资源收藏归档 |
| `Windows 常用脚本` | [可复制命令 / Windows PowerShell](./commands.md#windows-powershell) | 已迁移，端口查询命令已合并 |
| `scoop 包管理器 for windows` | 本页 | 归档：只保留历史链接，不进入工作站基线 |
| `Windows zsh + autojump` | 本页 | 归档：旧补丁不可长期维护 |
| `安装 Windows` | 本页 | 归档：旧装机教程不进入工作站基线 |
| `在 Windows 中使用 Makefile` | [可复制命令 / Windows PowerShell](./commands.md#windows-powershell) | 部分迁移：Windows/WSL 命令保留，MinGW 旧流程归档 |
| `Windows 常用快捷键` | [可复制命令 / Windows PowerShell](./commands.md#windows-powershell) | 部分迁移：`ii .` 已合并，其余归档 |
| `WINDOWS 10 环境配置` | [可复制命令 / Windows PowerShell](./commands.md#windows-powershell) | 部分迁移：WSL 当前命令已合并，旧功能开关归档 |
| `Win 10 激活` | 本页 | 归档：激活脚本不进入公开工作站文档 |

## 清理顺序

1. 先按上表给旧语雀页加状态标记。
2. 对 `已迁移` 页面，把正文替换为跳转文案。
3. 对 `部分迁移` 页面，只保留新文档没有承接的历史说明，并标记归档。
4. 对 `归档` 页面，不再补充维护内容；确认无引用后再删除或移出主目录。

## 丢弃原则

- 不迁移长期维护成本高、当前不可验证的 hosts IP 列表。
- 不迁移旧镜像源、旧 `nvm`/淘宝镜像脚本和历史 registry workaround。
- 不把 OneinStack、LNMP 一键包这类服务器场景内容放入个人工作站基线。
- 不把已废弃或偶发兼容工具加入默认安装清单；例如 `rar` 只保留临时命令。
- 不把机器本地信息、远程主机名、私钥路径和个人账号写入公开仓库。
