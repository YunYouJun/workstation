# 配置管理接口 v1

使用 `workstation configuration`，从标准输入接收一个 JSON 请求，标准输出返回一个 JSON 结果。CLI 与 Craft Hub 插件共用同一实现；检查、合并、版本校验、备份、恢复、密钥扫描和 Git 操作都由 workstation 完成。

```sh
printf '%s\n' '{"version":1,"operation":"inspect"}' | workstation configuration
```

操作：`inspect` 只读检查；`preview` 接收逐项决定并生成冻结方案；`apply` 应用方案；`history` 查看结果；`restore` 恢复；`git-status` 查看 Git 状态；`git-action` 明确执行拉取、提交或发布。字段定义见 [英文接口文档](./configuration-api.md)。`apply` 返回 `state: failed` 时必须展示失败及恢复入口，不能按成功处理。

`inspect` 新增客户端 `client`、作用域 `scope`、管理器 `manager`、来源证据 `provenance: { label, path? }` 和只读 `skillsAudit`。报告复用既有 Skills 审计，展示检查时间、数量及有界诊断。全局检查不扫描 CLI 当前项目；只有宿主提供已注册 `projectPath` 时才检查项目 Skills。磁盘观察不代表运行中的 Agent 已加载，审计失败单独返回错误，不覆盖原有配置和恢复记录。旧 v1 CLI 缺少这些字段时应显示不支持。

APM、Skills CLI 和 Workstation 归属依据既有记录，不能按同名推断；原生插件、外部链接和项目资产保持只读。私有用户 Skill 树继续使用原有预览流程，并冻结归属控制文件。应用和恢复都会拒绝后续安装器接管，即使安装器只新增锁、未改文件内容；旧恢复计划也重新检查当前归属。检查和配置同步不会改写安装器锁。

逐项决定为 `local`（保留本机并更新源文件）、`source`（使用源配置并更新本机）、`merge`（逐字段或逐行选择后更新双方）、`skip`（暂不处理）。每项带扫描时的 `revision`；任一源文件、目标文件、manifest 或基线改变都会使旧方案失效。没有成功同步基线的差异标记为“首次接管”，不推测历史状态。

公开仓库使用现有映射管理全局指令、Zsh、Starship、Ghostty；已连接的私有 manifest 管理 MCP fragment 和本地用户 skill 目录。未纳管 skill 先通过现有 manifest 声明本地来源。系统目录、插件缓存、符号链接和安装器锁记录的 skills 仅展示归属，使用原安装器管理。项目 MCP 单独展示，只读；不迁移登录态、缓存或执行授权字段。

真实内容只在设备本地处理。文本预览保留正文、注释、格式和换行，并对可识别的凭据字面值脱敏；未知密钥格式可能无法识别。结构化 MCP 片段继续保守隐藏未知值。行号和差异由客户端渲染，接口不再添加行标记或在 200 行后截断。此显示内容不会被用作配置写回输入。自动状态、计划及包含原始内容的恢复记录保存在设备的 `~/.local/state/workstation/configuration-v1`，目录权限 0700、文件权限 0600，不进入 Git。

本机应用、仓库提交、远端发布相互独立。提交只接受已审阅的纳管路径，有既存暂存区内容时拒绝。导出及提交要求 gitleaks；发布沿用原来的密钥扫描及禁止强推保护。断网、远端领先、分叉均保留本地内容并报告失败，不自动重写历史。

限制：文本合并按对齐行位置逐项选择，不是语义或自动三方合并；请仔细审阅插入、删除。MCP/TOML 与 Zsh 有语法检查，其他内容没有完整语义校验。整个 MCP fragment 缺失显示扫描错误；单个服务器删除可同步。多文件写入依靠本地记录恢复，不是系统原子事务；外部编辑器不遵守 workstation 锁，替换前会再次校验版本。进程崩溃后需先确认进程已结束，再手动处理遗留锁。尚不自动清理备份或迁移备份。更多限制见英文文档。

## 多仓库配置源与加密备份

Host 能力协商新增 `repositories`、`repositories-update`、`backup-preview`，保持 configuration v1 兼容。`inspect` 返回设备本地的 `registry`，每个纳管配置项返回 `sourceId`、`audience` 和 `resource`。旧版客户端继续使用原操作；旧私有源先标记为 `unclassified`，明确分类后才能加入备份目标。

配置源登记已有 Git checkout，支持 `dotfiles` 和 `overlay` 两种格式；私有源继续使用 `config/sync-manifest.json`。内容范围为 `public`、`personal`、`work`，与 Git 托管平台、仓库可见性分别判断。登记文件、绝对路径和执行授权留在本机。读操作不会创建登记文件；增删改必须携带当前 registry revision。移除登记不删除仓库；仍被备份或归属记录引用的源可停用。

修改只写回配置项的原来源。多个源声明同一文件或 MCP server 时显示归属冲突，同一内容范围内可显式选择归属；公开、个人、公司范围之间不能转移归属。已应用的归属在停用源和恢复文件后继续保留。不同范围需要同一目标时，应拆分源声明；系统没有隐式覆盖顺序，也不会把未纳管的本机 MCP 自动导出到某个私有仓库。

备份目标与配置源分开登记。目标的 `root` 留空即预留，不创建仓库。后续绑定已有本地 checkout；来源和备份使用独立仓库。`driver: workstation` 仅加密明确声明的源文件，`driver: external` 由原应用管理格式、上传和恢复，Workstation 不代替它写入。

Workstation 备份目标保存内容范围、来源 ID 列表、仓库内目录和 `keyEnvironment`（口令环境变量名称）。通过密钥管理器向本机后端提供口令，不在界面输入、不保存口令值、不写入 Git。备份使用 AES-256-GCM 与 scrypt，文件为 `<directory>/configuration.backup.json`，明文总量限制 1 MiB。公司与个人配置不能混入同一备份范围或 checkout，公开配置可加入其中任一范围。

`backup-preview` 携带 `targetId`、registry `revision` 和 `action: save | restore`，再通过原有 `apply` 应用方案。备份读取源文件，因此本机修改需先审阅并导出回所属源。仓库备份发生变化或首次发现已有备份时，默认阻止替换；显式选择 `resolution: replace` 才生成替换预览，原版本保留在本地恢复记录中。恢复设备需先具备对应的源仓库、清单和相同来源 ID；备份不负责重建它们。

恢复先解密并校验身份、路径、范围和文件清单，预览后只恢复到原配置源；应用到本机另走配置审阅。错误口令、被篡改的归档、越界路径及清单外文件均拒绝恢复。源文件写入仍需密钥扫描。预览后 registry、manifest 或文件变化会阻止应用；恢复不会覆盖后续独立修改，也不会回退其他源的基线。逐文件记录恢复进度，失败后可重试。含明文的本地恢复日志保存在受保护的状态目录中。

Git 提交和发布保持独立：选择纳管文件、审阅并提交，再发布。备份仓库标识为 `target:<id>`；空仓库支持首次提交，远端传输仍需配置 upstream。分支分叉保留双方历史，需先协调冲突。此能力不包含后台自动同步、跨仓库原子事务、任意应用数据库备份或凭据目录同步。
