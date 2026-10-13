# Host API v1

`workstation host-json` 从 stdin 读取一次 JSON 请求，向 stdout 返回一个 JSON 信封，为 Craft Hub 等本地 GUI 提供版本/能力协商及只读诊断。配置写入、Git 操作、软件安装和应用打开仍由现有 CLI 协议执行。

```sh
printf '%s\n' '{"version":1,"operation":"capabilities"}' | workstation host-json
printf '%s\n' '{"version":1,"operation":"doctor"}' | workstation host-json
```

`capabilities` 和 `doctor` 请求只允许 `version` 和 `operation`；`validate-projects` 额外允许一个 `content` 字符串。宿主以 `shell: false` 调用已安装且受信任的 CLI；请求不能传入路径、命令或依赖探测参数。UTF-8 stdin 上限为 1 MiB。响应为 `{ "ok": true, "result": ... }` 或 `{ "ok": false, "code": "...", "error": "固定的安全提示" }`。无效 JSON/额外字段返回 `INVALID_REQUEST`，不支持的版本返回 `UNSUPPORTED_VERSION`，未知操作返回 `UNSUPPORTED_OPERATION`。意外失败返回 `UNAVAILABLE`，不回显解析器内容或子进程输出。请求拒绝时退出码非零。

## 版本与能力协商

`capabilities` 返回 `{ version: 1, cliVersion, platform, protocols, operations }`。当前 `protocols` 为 `{ host: 1, configuration: 1, software: 1, repositoryValidation: 1 }`；`platform` 使用 Node.js 平台名，例如 `darwin`、`linux`、`win32`。

`operations.configuration` 包含 `inspect`、`preview`、`apply`、`restore`、`history`、`git-status`、`git-fetch`、`git-commit`、`git-publish`；后三项对应 configuration 协议的 `git-action` 操作。`operations.software` 包含 `catalog`、`preview`、`install`、`runs`、`cancel`、`open`，另有 `operations.doctor` 和 `operations.repositoryValidation`。纯内容仓库清单校验在所有平台均可用。

每项返回 `{ supported: true }` 或 `{ supported: false, reason: 'unsupported-platform' }`。这表示 CLI 已实现的平台能力，不表示本机依赖已就绪；依赖状态由 doctor 提供，各操作仍保留自己的预览校验和确认要求。

| 操作 | macOS | Linux | Windows |
| --- | --- | --- | --- |
| doctor、配置清单/历史/Git 状态、软件目录/任务历史 | 支持 | 支持 | 支持 |
| 配置预览/应用/恢复及 Git 操作 | 支持 | 支持 | 暂不支持 |
| 软件预览 | 支持 | 手动安装预览 | 手动安装预览 |
| 软件安装/打开 | 支持 | 暂不支持 | 暂不支持 |
| 软件取消任务 | 支持 | 支持 | 暂不支持 |

GUI 应按 CLI 返回的能力隐藏或禁用操作。旧版 CLI 没有 `host-json` 时能力为未知，应展示兼容性提示，不应根据 GUI 所在平台推定支持。Windows 写操作在入口、路径和平台实现完成适配及测试前保持禁用。

## doctor 结构化诊断

`doctor` 返回 `{ version: 1, checkedAt, checks, summary }`。每项检查为 `{ code, severity: 'info' | 'warning' | 'error', message, path? }`，汇总为 `{ errors, warnings, passed }`；`checkedAt` 是 ISO UTC 时间。缺配置或缺依赖属于诊断结果，即使 `errors` 非零也返回 `ok: true`，与请求处理失败分开表达。

终端 `workstation doctor` 和 `workstation df doctor` 渲染同一份报告，存在 error 时退出码非零。

检查覆盖 `.chezmoiroot`、home 源树、APM 源文件 YAML 语法、现有 dotfiles 声明、未解决的本地密钥占位符、可选私有 manifest，以及 Git、chezmoi、APM、gitleaks 的依赖就绪。Unix 另检查 Zsh，macOS 另检查 Homebrew；其他平台跳过 macOS 专用客户端源。YAML 检查只确认可解析，不代表 APM 安装完成或 Agent 已加载。私有 manifest 只做声明校验，不恢复密钥或执行操作。

报告不回显 `.chezmoiroot` 内容、YAML/JSON 报错片段、密钥名称和值、stdout 或 stderr。每个文件最多读取 1 MiB，私有 manifest 的后备发现最多扫描 512 个目录、4096 个条目、耗时 1 秒；每个依赖探测超时 1 秒、输出上限 64 KiB，报告最多 200 项。探测失败返回固定警告。源文件或检查数量超限会添加 `doctor-report-truncated`；私有源发现超过扫描限额返回 `private-manifest-unavailable`，均不宣称已覆盖全部。检查不创建状态目录、锁文件，也不修改配置。

## 项目清单内容校验

请求 `{ "version": 1, "operation": "validate-projects", "content": "repositories: []\n" }` 只校验提供的 YAML 内容，返回 `{ version: 1, valid, issues: [{ code, path, message }], summary? }`。格式问题保留 `ok: true`，由 `valid: false` 和 issues 表达；有效文件的 summary 只含 repositories/groups 数量。

此接口复用 `projects manifest --validate` 的语义解析器，保留无 version 的旧格式、对象形式的 groups、顶层 repositories、host/root 继承以及 URL/路径别名。它不读取本机配置，不展开 HOME，不探测依赖，不访问网络或执行 Git，不创建缓存或状态。target 重复判断采用词法路径；执行时仍需正常预览和平台路径校验。

内容按 UTF-8 最多 256 KiB，结构最多 10000 个节点和 32 层，别名展开有上限；自定义标签、循环或无效 YAML 被拒绝。issues 最多 100 项，路径只含固定字段和索引，例如 `groups[0].repositories[1]`，不回显私有组名、URL、凭据或解析器片段。超出报告限额有明确 `issue-limit` 项。

编辑器 Schema 位于 `schemas/projects.schema.json`，由 `packages/cli/src/projects-manifest.ts` 导出生成。`pnpm projects:schema` 更新产物，`pnpm projects:schema:check` 检查是否过期，CI 执行同一检查。Schema 提供结构提示，host 继承、目标推导、重复检查仍由共享 CLI 解析器负责。
