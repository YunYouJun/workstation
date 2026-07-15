# Microsoft To Do Graph 客户端

这个仓库使用一个本地、最小权限的 Microsoft Graph 客户端读写 Microsoft To Do。它直接调用微软官方 API，不依赖社区 MCP 中转服务；CLI 通过微软的 `@azure/msal-node` 完成设备代码登录。

实现位于 [`packages/microsoft-todo-graph`](https://github.com/YunYouJun/workstation/tree/main/packages/microsoft-todo-graph)。OAuth token 缓存只保存在本机，不会写入仓库或打印到终端。

## 为什么采用这个方案

- Microsoft Graph 提供正式的 To Do list/task API，读取任务最低可使用委托权限 `Tasks.Read`，修改任务需要 `Tasks.ReadWrite`。
- 设备代码流适合本地 CLI，不需要在仓库中保存 client secret。
- 与通用 MCP server 相比，客户端只允许访问 `/v1.0/me/todo/`，攻击面和可授权操作更容易审查。
- 写入与删除通过独立门禁控制，Codex 或脚本不能因为一次普通读取而意外修改任务。

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
