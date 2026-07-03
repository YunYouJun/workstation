# Old Environment Notes Migration Index

This page replaces the old scattered Yuque pages under the "Environment" group.
Current, reusable content has moved into the Workstation docs. Outdated scripts,
old mirrors, historical hosts entries, one-off server installers, and personal
temporary FAQ notes are no longer maintained as the workstation baseline.

When cleaning up Yuque, mark page status first and delete content later. Reusable
content belongs here; content that cannot be maintained long-term but may still
be useful as history should be archived instead of moved into Workstation.

## Pasteable Replacement Text

When replacing an old Yuque page before deleting it or leaving a redirect, paste:

```md
[已迁移]

This page has moved to Workstation:

https://workstation.yunyoujun.cn/guide/migration

The still-current commands, tools, and decisions have been merged into the new
workstation docs. Outdated scripts and historical workarounds are no longer
maintained.
```

For pages that should not move into Workstation but should remain as history for
now, paste:

```md
[归档]

This page is kept only as historical context. It is no longer maintained and
should not be used as the source of truth for new workstation setup.

Current reusable environment setup lives here:

https://workstation.yunyoujun.cn/guide/migration
```

## New Entrypoints

- [Terminal](./terminal.md): Zsh, Oh My Zsh, Starship, Tmux, proxy helpers, and the terminal toolchain.
- [Copyable Commands](./commands.md): fresh-machine setup, SSH, macOS/Unix maintenance, dotfiles, and project commands.
- [Packages](./packages.md): Brewfiles, package layering, and decisions for old environment scripts.
- [Software](./software.md): optional desktop apps, download entrypoints, and old macOS app recommendations.
- [Projects](./projects.md): repository layout, SSH baseline, Git identities, and project manifests.
- [Repository Scope](./repository.md): what this repository owns and what it leaves machine-local.

## Yuque Cleanup Status

- `Keep entry`: keep only one redirect page pointing to this migration index.
- `Migrated`: current content is already in Workstation; replace the old page body
  with the redirect text, then delete it after confirming no links depend on it.
- `Partially migrated`: move only current, repeatable commands or decisions; archive
  old workarounds, bookmarks, and machine-specific content.
- `Archived`: keep historical context temporarily, but do not move it into
  Workstation. Use this for old scripts, mirrors, hosts entries, one-off server
  stacks, and unverified FAQ snippets.

During cleanup, use `[已迁移]`, `[部分迁移]`, or `[归档]` in the Yuque title or page
top as temporary status labels. The final Yuque group should keep only
`Migrate to workstation.yunyoujun.cn` as the entry page.

## Migration Map

| Old Yuque page | New location | Handling |
| --- | --- | --- |
| `Migrate to workstation.yunyoujun.cn` | This page and the site home | Keep entry |
| `通用` group | This page | Deleted: empty group no longer kept |
| `开发环境配置` | [Terminal](./terminal.md), [Copyable Commands](./commands.md), [Packages](./packages.md) | Migrated; safe to delete old page |
| `SSH` | [Projects / SSH Baseline](./projects.md#ssh-baseline), [Copyable Commands / SSH And Remote Access](./commands.md#ssh-and-remote-access) | Migrated; safe to delete old page |
| `Terminal Proxy` | [Terminal / Terminal Proxy](./terminal.md#terminal-proxy) | Migrated; safe to delete old page |
| `oh-my-zsh 常用插件配置指南` | [Terminal](./terminal.md) and `home/dot_zshrc` | Migrated; safe to delete old page |
| `GitHub 小技巧` | [Projects / SSH Baseline](./projects.md#ssh-baseline) | Partially migrated: GitHub SSH over 443 kept, old hosts entries archived |
| `macOS 开发环境配置` | [Bootstrap Flow](./bootstrap.md), [Terminal](./terminal.md), [Copyable Commands](./commands.md) | Migrated; replaced by repeatable flows |
| `macOS app` | [Software](./software.md) | Partially migrated: reusable app entrypoints added to the software catalog, old recommendations archived |
| `macOS 常用快捷键` | [Copyable Commands / macOS And Unix Maintenance](./commands.md#macos-and-unix-maintenance) | Partially migrated: common shortcuts merged, personal habits archived |
| `macOS 与 Java` | [Copyable Commands / macOS And Unix Maintenance](./commands.md#macos-and-unix-maintenance) | Partially migrated: OpenJDK and jenv commands refreshed, old paths archived |
| `Linux` group | This page | Deleted: empty group no longer kept |
| `Linux 初始环境配置脚本` | [Terminal](./terminal.md), [Packages](./packages.md) | Archived: old scripts are not migrated |
| `Tmux 简要笔记` | [Terminal / Tmux Sessions](./terminal.md#tmux-sessions) | Migrated; safe to delete old page |
| `macOS FAQ` | [Copyable Commands / macOS And Unix Maintenance](./commands.md#macos-and-unix-maintenance) | Partially migrated: current commands merged, the rest archived |
| `macOS SSH` | [Projects / SSH Baseline](./projects.md#ssh-baseline) | Migrated; Remote Login and port forwarding merged |
| `Linux 使用笔记` | [Copyable Commands / macOS And Unix Maintenance](./commands.md#macos-and-unix-maintenance), [Terminal](./terminal.md) | Partially migrated: read-only checks merged, risky or outdated snippets archived |
| `一键安装包` | [Packages / Migrating Old Environment Notes](./packages.md#migrating-old-environment-notes) | Archived: OneinStack/LNMP are not part of the workstation baseline |
| `参考教程` | [Terminal / Tmux Sessions](./terminal.md#tmux-sessions) | Partially migrated: Tmux reference merged, bookmarks archived |
| `Windows 常用脚本` | [Copyable Commands / Windows PowerShell](./commands.md#windows-powershell) | Migrated; port-inspection commands merged |
| `scoop 包管理器 for windows` | This page | Archived: keep the historical link only; not part of the workstation baseline |
| `Windows zsh + autojump` | This page | Archived: old patch is not maintainable long-term |
| `安装 Windows` | This page | Archived: old installation tutorial is not part of the workstation baseline |
| `在 Windows 中使用 Makefile` | [Copyable Commands / Windows PowerShell](./commands.md#windows-powershell) | Partially migrated: Windows/WSL commands kept, old MinGW flow archived |
| `Windows 常用快捷键` | [Copyable Commands / Windows PowerShell](./commands.md#windows-powershell) | Partially migrated: `ii .` merged, the rest archived |
| `WINDOWS 10 环境配置` | [Copyable Commands / Windows PowerShell](./commands.md#windows-powershell) | Partially migrated: current WSL commands merged, old feature toggles archived |
| `Win 10 激活` | This page | Archived: activation scripts do not belong in public workstation docs |

## Cleanup Order

1. Add a status label to each old Yuque page according to the table above.
2. For `Migrated` pages, replace the body with the redirect text.
3. For `Partially migrated` pages, keep only historical notes not covered by the
   new docs and mark them archived.
4. For `Archived` pages, stop maintaining them; delete or move them out of the
   main group once no links depend on them.

## Drop Rules

- Do not migrate hosts-file IP lists that are expensive to maintain and cannot be trusted long-term.
- Do not migrate old mirrors, old `nvm`/Taobao mirror scripts, or historical registry workarounds.
- Do not put OneinStack, LNMP one-click installers, or similar server stacks into the personal workstation baseline.
- Do not add deprecated or occasional compatibility tools to default manifests; for example, `rar` remains a temporary command only.
- Do not commit machine-local hostnames, private key paths, remote machine details, or personal account values to the public repository.
