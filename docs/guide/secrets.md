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
- 如果误提交了密钥，应立即轮换。
- 项目需要描述必需变量时，使用 `.env.example` 或文档。

## 恢复清单

```bash
workstation dotfiles doctor
workstation dotfiles diff
```

如果 `doctor` 报告缺少某个 key，请在运行 `workstation dotfiles pull --force` 前，把它重新添加到 `.env.local`，或从密钥管理器恢复。
