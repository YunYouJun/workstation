# Microsoft To Do：MCP 与 Graph 客户端

## 当前结论

日常让 Codex 操作 Microsoft To Do 时，优先使用 MCP，而不是再封装一个只包含调用说明的 Skill。workstation 将 `@softeria/ms-365-mcp-server@0.140.0` 固定为可选初始化任务，并把 Graph 资源能力限制为 To Do 的 list/get/create/update 工具和委托权限 `Tasks.ReadWrite`；delete 工具以及邮件、日历、文件等其他 Microsoft 365 资源都不会暴露。服务端仍提供登录、验登、账户选择/移除等本地认证辅助工具。本机使用个人 Microsoft 账户，因此 tenant 固定为 `consumers`，避免 `common` authority 的 refresh token 后续失效。

先预览，再写入当前用户的 Codex 配置：

```bash
workstation init codex.microsoft-todo-mcp
workstation init codex.microsoft-todo-mcp --yes
codex mcp get microsoft-todo
```

配置后新开一个 Codex 任务，使客户端重新加载 MCP。第一次调用 To Do 工具时按服务端提示完成 Microsoft 登录；OAuth token 只保存在本机。`npx` 和固定 npm 版本使同一配置可在 macOS、Linux 与 Windows 复用。

To Do 认证不经过 1Password，也不需要把会轮换的 access token 或 refresh token 保存为长期密钥。当前固定版本默认把 MSAL 缓存加密写入用户配置目录；在 macOS 上只把缓存加密密钥交给系统钥匙串。这样既能让 MSAL 自动刷新 token，也不会让仓库、Codex 配置或 1Password 承担 OAuth token 生命周期。

APM 仍是公开 Skills 和项目级 MCP 的事实源，但 APM 0.26 的自定义 MCP 安装目前只支持项目作用域，不能直接生成用户级 Codex 配置。因此这个全局 MCP 由显式的 workstation init 任务管理，任务只替换 `mcp_servers.microsoft-todo`，不会覆盖完整的 `~/.codex/config.toml`。

仓库原有的本地 Graph 客户端继续保留为高可审计回退方案，尤其适合脚本、dry-run 更新和带二次确认的删除。实现位于 [`packages/microsoft-todo-graph`](https://github.com/YunYouJun/workstation/tree/main/packages/microsoft-todo-graph)。

## 为什么这样分层

- MCP 是 Agent 的执行接口，装一次即可被支持 MCP 的客户端直接发现；Skill 只在需要固定工作流、参数校验或审批策略时再加。
- Microsoft Graph 提供正式的 To Do list/task API；读取最低可用 `Tasks.Read`，当前 MCP 为了支持创建和更新使用 `Tasks.ReadWrite`。
- MCP 启动参数从服务端同时收窄工具和 scope；包版本固定，避免 `latest` 静默扩大能力。
- 本地 Graph CLI 只允许访问 `/v1.0/me/todo/`，并继续提供独立的写入、`--apply` 和删除门禁。

## 安装与授权

在仓库根目录执行：

```bash
pnpm install
pnpm todo:auth
```

终端会显示设备登录网址和一次性代码。保持命令运行，在浏览器中完成登录；设备代码登录需要 CLI 持续轮询，提前结束进程会导致授权看似完成但本地没有 token。

个人 Microsoft 账户可以显式使用 `consumers` tenant：

```bash
MS_TODO_TENANT=consumers pnpm todo:auth
```

默认使用 Microsoft Graph 命令行工具的 public-client ID。长期使用或组织账号应注册自己控制的 Entra public-client app，并设置：

```bash
export MS_TODO_CLIENT_ID="YOUR_ENTRA_APP_CLIENT_ID"
export MS_TODO_TENANT="consumers"
```

后续命令必须继续使用相同的 tenant 和 client ID。

## 读取任务

```bash
pnpm todo:status
pnpm todo:lists
pnpm todo:tasks -- --open
pnpm todo:tasks -- LIST_ID
```

默认不会返回任务正文。只有确实需要备注时才添加 `--include-body`：

```bash
pnpm todo:tasks -- LIST_ID --include-body
```

这些读取脚本复用已授权的 `Tasks.ReadWrite` scope，但命令本身只执行固定 GET 请求。底层配置仍默认 `Tasks.Read`；只有设置 `MS_TODO_WRITE=1` 才会放行非 GET 请求。

## 修改和完成任务

省略 `--apply` 时只输出预览，不发送 Graph 写请求：

```bash
MS_TODO_WRITE=1 pnpm todo -- update LIST_ID TASK_ID --title "新标题"
MS_TODO_WRITE=1 pnpm todo -- complete LIST_ID TASK_ID
```

确认预览无误后再执行：

```bash
MS_TODO_WRITE=1 pnpm todo -- update LIST_ID TASK_ID --title "新标题" --apply
MS_TODO_WRITE=1 pnpm todo -- complete LIST_ID TASK_ID --apply
```

更新还支持 `--importance`、`--status`、`--due YYYY-MM-DD` 和 `--clear-due`。

## 删除任务

删除需要同时满足三个条件：显式开启删除能力、添加 `--apply`、并用完整任务 ID 二次确认。

```bash
MS_TODO_WRITE=1 MS_TODO_ALLOW_DELETE=1 pnpm todo -- delete LIST_ID TASK_ID \
  --confirm-id TASK_ID --apply
```

客户端没有实现任务清单删除。

## 安全边界

- URL allowlist 只允许 `https://graph.microsoft.com/v1.0/me/todo/` 下的请求，包括 Graph 返回的分页 URL。
- 非 GET 请求必须设置 `MS_TODO_WRITE=1`。
- PATCH 必须通过 `--apply` 确认。
- DELETE 还必须设置 `MS_TODO_ALLOW_DELETE=1` 并精确匹配 `--confirm-id`。
- token cache 默认保存到 `~/Library/Application Support/Codex/microsoft-todo-graph/token-cache.json`，目录权限为 `0700`，文件权限为 `0600`。
- 单个请求 20 秒超时，单次枚举最多返回 500 项。
- 代码不会打印 access token 或 refresh token，也不会读取 To Do 之外的 Graph 资源。

退出登录并清理本地缓存：

```bash
pnpm todo -- logout
```

## 已解决的故障

### 浏览器登录完成但客户端仍未认证

设备代码流是轮询协议。运行 `pnpm todo:auth` 的进程必须保持存活，直到命令输出 `authenticated: true`。

### Graph 请求丢失 `/v1.0`

不能用 `/me/todo/...` 直接覆盖 `https://graph.microsoft.com/v1.0` 的 pathname。客户端会显式拼接相对路径，并对最终 origin 和 `/v1.0/me/todo/` 前缀重新校验。

### 已授权写权限，但读取命令要求再次登录

MSAL 按 scope 查找缓存。仓库提供的 `todo:status`、`todo:lists` 和 `todo:tasks` 脚本请求已经授权的 `Tasks.ReadWrite` scope，从而复用同一份缓存；这些命令仍然只暴露读取操作。

## 官方参考

- [Microsoft Graph To Do API 概览](https://learn.microsoft.com/graph/api/resources/todo-overview?view=graph-rest-1.0)
- [列出 To Do tasks](https://learn.microsoft.com/graph/api/todotasklist-list-tasks?view=graph-rest-1.0)
- [更新 todoTask](https://learn.microsoft.com/graph/api/todotask-update?view=graph-rest-1.0)
- [Microsoft identity platform 设备代码流](https://learn.microsoft.com/entra/identity-platform/v2-oauth2-device-code)
