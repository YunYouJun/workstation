# 密钥

密钥绝不能提交到此仓库。仓库可以包含占位符、示例和说明，但不能包含真实凭据。

## 当前流程

从 `$HOME` push 回仓库时，CLI 会检测类似 `TOKEN`、`API_KEY`、`SECRET`、`PASSWORD`、`PRIVATE_KEY` 和 `CREDENTIAL` 的敏感 shell 赋值。

真实值会被替换为占位符：

```bash
export API_TOKEN="{{DOTFILES_SECRET:API_TOKEN}}"
```

真实值存储在 `.env.local` 中，而该文件被 Git 忽略。

## 门禁

CI 会用 Gitleaks 扫描完整 Git 历史。普通 CI 和 GitHub Pages 部署都会先跑密钥扫描；扫描失败时不要部署，先移除敏感值并轮换已经暴露的凭据。

本地提交或推送前也可以手动扫描：

```bash
pnpm secrets:scan
```

`&#123;&#123;DOTFILES_SECRET:KEY&#125;&#125;` 是允许提交的占位符，不是真实密钥。

## 规则

- 提交占位符，不提交密钥值。
- `.env.local` 只保留在本机。
- 长期凭据优先使用专门的密钥管理器。
- 私有配置仓库可以记录 1Password `op://...` 引用、内部 MCP server 名称和本机 inventory；不要把这些内部细节提升到此公开/共享仓库。
- 本机交互使用 1Password 桌面 App 的 CLI 集成；不要在 workstation 流程中反复执行手动 `op signin`。
- workstation 优先使用单次 `op run` 或 `op inject` 批量解析同一操作需要的字段；只有批量失败时才逐项诊断。文件附件仍按文件恢复，避免把二进制内容拼入环境变量。
- 如果误提交了密钥，应立即轮换。
- 项目需要描述必需变量时，使用 `.env.example` 或文档。

如果以前用手动方式把账户加入过 CLI，并且已经确认桌面 App 集成可用，可以清理 CLI 自己保存的旧账户信息：

```bash
op account forget --all
```

这个命令不会从 1Password 桌面 App 删除账户。清理后保持桌面 App 解锁，让后续 `op` 命令通过 Touch ID 或 macOS 系统认证授权。

## 恢复清单

```bash
workstation dotfiles doctor
workstation dotfiles diff
```

如果 `doctor` 报告缺少某个 key，请在运行 `workstation dotfiles pull --force` 前，把它重新添加到 `.env.local`，或从密钥管理器恢复。
