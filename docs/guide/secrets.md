# 密钥

密钥绝不能提交到此仓库。仓库可以包含占位符、示例和说明，但不能包含真实凭据。

## 当前流程

从 `$HOME` push 回仓库时，CLI 会检测类似 `TOKEN`、`API_KEY`、`SECRET`、`PASSWORD`、`PRIVATE_KEY` 和 `CREDENTIAL` 的敏感 shell 赋值。

真实值会被替换为占位符：

```bash
export API_TOKEN="{{DOTFILES_SECRET:API_TOKEN}}"
```

真实值存储在 `.env.local` 中，而该文件被 Git 忽略。

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
