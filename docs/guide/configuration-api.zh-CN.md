# 配置管理接口 v1

使用 `workstation configuration`，从标准输入接收一个 JSON 请求，标准输出返回一个 JSON 结果。CLI 与 Craft Hub 插件共用同一实现；检查、合并、版本校验、备份、恢复、密钥扫描和 Git 操作都由 workstation 完成。

```sh
printf '%s\n' '{"version":1,"operation":"inspect"}' | workstation configuration
```

操作：`inspect` 只读检查；`preview` 接收逐项决定并生成冻结方案；`apply` 应用方案；`history` 查看结果；`restore` 恢复；`git-status` 查看 Git 状态；`git-action` 明确执行拉取、提交或发布。字段定义见 [英文接口文档](./configuration-api.md)。`apply` 返回 `state: failed` 时必须展示失败及恢复入口，不能按成功处理。

逐项决定为 `local`（保留本机并更新源文件）、`source`（使用源配置并更新本机）、`merge`（逐字段或逐行选择后更新双方）、`skip`（暂不处理）。每项带扫描时的 `revision`；任一源文件、目标文件、manifest 或基线改变都会使旧方案失效。没有成功同步基线的差异标记为“首次接管”，不推测历史状态。

公开仓库使用现有映射管理全局指令、Zsh、Starship、Ghostty；已连接的私有 manifest 管理 MCP fragment 和本地用户 skill 目录。未纳管 skill 先通过现有 manifest 声明本地来源。系统目录、插件缓存、符号链接和安装器锁记录的 skills 仅展示归属，使用原安装器管理。项目 MCP 单独展示，只读；不迁移登录态、缓存或执行授权字段。

真实内容只在设备本地处理。界面隐藏正文和未知字面值，仅展示受限的安全结构；文本行前的 `!` 表示该位置存在差异，`=` 表示一致。此显示内容不会被写回配置。自动状态、计划及包含原始内容的恢复记录保存在设备的 `~/.local/state/workstation/configuration-v1`，目录权限 0700、文件权限 0600，不进入 Git。

本机应用、仓库提交、远端发布相互独立。提交只接受已审阅的纳管路径，有既存暂存区内容时拒绝。导出及提交要求 gitleaks；发布沿用原来的密钥扫描及禁止强推保护。断网、远端领先、分叉均保留本地内容并报告失败，不自动重写历史。

限制：文本合并按对齐行位置逐项选择，不是语义或自动三方合并；请仔细审阅插入、删除。MCP/TOML 与 Zsh 有语法检查，其他内容没有完整语义校验。整个 MCP fragment 缺失显示扫描错误；单个服务器删除可同步。多文件写入依靠本地记录恢复，不是系统原子事务；外部编辑器不遵守 workstation 锁，替换前会再次校验版本。进程崩溃后需先确认进程已结束，再手动处理遗留锁。尚不自动清理备份或迁移备份。更多限制见英文文档。
