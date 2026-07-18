# workstation

[![CI](https://github.com/YunYouJun/workstation/actions/workflows/ci.yml/badge.svg)](https://github.com/YunYouJun/workstation/actions/workflows/ci.yml)

[English](./README.md) | [简体中文](./README.zh-CN.md)

个人开发工作站配置、dotfiles 同步工具、装机笔记与日常操作约定。

这个仓库刻意比普通 dotfiles 仓库更宽一些：它把 shell / 编辑器配置放在 `home/`，把 TypeScript CLI 放在 `packages/cli`，并把长文档放在 `docs/`。

文档：<https://workstation.yunyoujun.cn>

## 使用

```bash
# 安装依赖
pnpm install

# 构建 CLI 包
pnpm build

# 启动文档站点
pnpm docs:dev
```

## 文档

VitePress 文档是工作站设置模型的事实来源：

- [概览](./docs/index.md)
- [仓库范围](./docs/guide/repository.md)
- [引导流程](./docs/guide/bootstrap.md)
- [可复制命令](./docs/guide/commands.md)
- [终端](./docs/guide/terminal.md)
- [Dotfiles 同步](./docs/guide/dotfiles.md)
- [密钥](./docs/guide/secrets.md)
- [项目](./docs/guide/projects.md)
- [软件包](./docs/guide/packages.md)
- [软件](./docs/guide/software.md)
- [Agent Skills 与 APM](./docs/guide/codex-skills.md)
- [Microsoft To Do Graph 客户端](./docs/guide/microsoft-todo-graph.md)
- [VSCode 扩展](./docs/vscode/extensions.md)

## CLI

使用 `workstation` 作为主命令；如果想要更短的入口，可以使用 `wst`。
`df`、`p` 这类短领域别名在两个入口下都可用。历史上的 `dotfiles`
命令会继续保留，用于兼容旧习惯。

```bash
workstation doctor
workstation init --list
workstation init git.include-if --git-profile 'id=github;host=github.com;name=Your Name;email=you@example.com'
workstation dotfiles pull --dry-run
workstation projects clone-active
workstation df pull --dry-run
workstation p active --limit 20
wst init -i
wst df pull --dry-run
wst p active --limit 20
```

这里刻意使用 `wst`，而不是 `ws`，以避开常见的 WebSocket / workspace
联想和全局别名冲突。

### Push (Home -> Repo)

将本地 `~/` 下的 dotfiles 推送到仓库，自动检测并遮罩敏感 token：

```bash
workstation dotfiles push              # 仅推送有变更的文件
workstation dotfiles push --force      # 强制覆盖，自动备份
workstation dotfiles push --dry-run    # 预览变更
```

### Pull (Repo -> Home)

将仓库中的 dotfiles 拉取到本地，自动恢复密钥占位符：

```bash
workstation dotfiles pull              # copy 模式，默认
workstation dotfiles pull --mode link  # symlink 模式
workstation dotfiles pull --force      # 强制覆盖，自动备份
workstation dotfiles pull --dry-run    # 预览变更
```

### Sync

指定方向同步，或使用交互模式：

```bash
workstation dotfiles sync --direction pull
workstation dotfiles sync --direction push --force
workstation dotfiles sync -i           # 交互式选择
```

### Diff & Status

```bash
workstation dotfiles diff              # 查看仓库与本地差异，会遮罩本地 secrets
workstation dotfiles status            # 查看 chezmoi + legacy 同步状态
workstation dotfiles doctor            # 检查 chezmoi source tree 与本地 secrets 准备情况
```

### Chezmoi

这个仓库通过 [`.chezmoiroot`](./.chezmoiroot) 兼容 chezmoi。Chezmoi 只读取 [`home/`](./home) 子树，所以 `README.md`、`package.json`、`packages/cli` 这类仓库文件不会被当作 home 文件处理。

```bash
workstation dotfiles chezmoi diff      # 等价于 chezmoi --source <repo> diff
workstation dotfiles chezmoi apply     # apply home/ 下管理的文件
```

当前受管理的 home 文件位于 `home/`：

- `home/dot_codex/AGENTS.md` -> `~/.codex/AGENTS.md`
- `home/dot_config/ghostty/config` -> `~/.config/ghostty/config`
- `home/dot_config/starship.toml` -> `~/.config/starship.toml`
- `home/dot_zshrc` -> `~/.zshrc`
- `home/Library/Application Support/Code/User/settings.json` -> `~/Library/Application Support/Code/User/settings.json`

VSCode 设置目前只面向 macOS，并会通过 [`home/.chezmoiignore.tmpl`](./home/.chezmoiignore.tmpl) 在非 macOS 主机上被 chezmoi 忽略。使用 `workstation dotfiles diff` 查看会遮罩密钥的安全 diff；原始的 `workstation dotfiles chezmoi diff` 可能显示未遮罩的本地值。

克隆或拉取这个仓库后，运行 `workstation dotfiles doctor` 来检查 `.chezmoiroot`、受管理源文件、本地密钥占位符和 chezmoi 可用性。

### Projects

克隆 `YunYouJun` 名下最近 push 过的仓库。该命令默认 dry-run，默认根目录为 `~/repos`，默认使用 SSH URL，排除 fork / archived 仓库，并采用 `ghq` 目录布局：

```bash
git config --global ghq.root ~/repos
git config --global --get ghq.root
```

```bash
workstation projects clone-active                  # 预览最近 50 个仓库
workstation projects clone-active --yes            # 克隆最近 50 个仓库
workstation projects clone-active --limit 20       # 预览最近 20 个仓库
workstation projects clone-active --limit 50 -i    # 交互式选择仓库
workstation projects clone-active --update --yes   # 同时更新已存在的 checkout
workstation projects clone-active --https --yes    # 使用 HTTPS clone URL
workstation projects status                        # 查看本地仓库的 dirty / unpushed / stash 状态
wst p status --check                               # 任一仓库需要处理时返回非零退出码
wst p status --max-depth 8                         # 扫描更深的嵌套 checkout 布局
wst p active --limit 20                            # 短入口
pnpm projects:clone-active                         # script alias，dry-run
pnpm projects:status                               # script alias，本地仓库审计
```

设置 `WORKSTATION_ACTIVE_PROJECT_LIMIT` 可以修改脚本 / 默认数量：

```bash
WORKSTATION_ACTIVE_PROJECT_LIMIT=20 pnpm projects:clone-active
```

这个命令使用 `gh api graphql` 和 `PUSHED_AT DESC` 排序，所以需要先通过 `gh auth login` 登录 GitHub CLI。如果已安装 `ghq`，并且它的主 `ghq.root` 与请求的根目录一致，CLI 会使用 `ghq get`；否则会回退到 `~/repos/github.com/<owner>/<repo>` 下的显式 `git clone` 路径。

对于私有或内部公共项目，可以把 YAML manifest 保存在本地或私有配置仓库中：

```bash
wst p manifest -i
wst p connect -i
wst p manifest --file projects.local.yaml
wst p manifest --file projects.local.yaml --validate
wst p manifest https://git.example.com/<user>/<config-repo> --group common
wst p manifest https://git.example.com/<user>/<config-repo> --group common --yes
wst p manifest https://git.example.com/<user>/<config-repo>/raw/main/projects.yaml --group common
wst p m https://git.example.com/<user>/<config-repo> -g common --yes
wst p m --file projects.local.yaml -g common --repository git.example.com/example/service
```

Manifest 仓库会缓存到 `~/.cache/workstation/project-manifests/`，远程 manifest 文件也会下载到同一缓存目录；项目 checkout 使用 `~/repos/<host>/<repo-path>` 这样的路径，例如 `~/repos/git.example.com/example/service`。Manifest group 只用于筛选和组织，不会成为目标路径的一部分。如果某个 manifest entry 有意把远程 `path` 映射到不同的本地 `name`，CLI 会回退到显式 `git clone`，而不是使用 `ghq get`。
交互式 manifest 选择会在预览前展示每个仓库的本地状态（`new`、`exists`、`will update` 或 `needs attention`）。本次会跳过或需要处理的仓库不会默认选中；非交互 `--update --yes` 也会跳过不安全更新，而不是直接 pull 到脏工作区或无效 checkout。

切换机器前，使用 `workstation projects status` 扫描 `~/repos` 下的本地仓库。它会报告未提交文件、未 push commit、stash、缺失 upstream 和已消失 upstream。添加 `--all` 可包含干净仓库；添加 `--check` 可在任何仓库需要处理时返回非零退出码。默认最多向下扫描 6 层目录；当 checkout 布局更深或希望更浅扫描时，可以使用 `--max-depth <number>`。

### Secrets

Push 时自动将匹配 `API_KEY`、`TOKEN`、`SECRET`、`PASSWORD` 等关键词的环境变量值替换为 `{{DOTFILES_SECRET:KEY}}` 占位符，真实值保存在仓库根目录的 `.env.local`，该文件已被 gitignore。

Pull 时自动从 `.env.local` 读取真实值并还原。

## 开发

```bash
pnpm run lint        # ESLint
pnpm run typecheck   # TypeScript 类型检查
pnpm test            # Vitest 单元测试
pnpm run build       # 构建 CLI
pnpm run docs:build  # 构建 VitePress 文档
pnpm run ci          # 一键运行 lint + typecheck + test + build + docs:build
```

## 发布

当 push `v*` tag 时，GitHub Actions 会发布 CLI package。需要先为 `@yunyoujun/workstation` 配置 npm Trusted Publishing：

- Publisher: GitHub Actions
- Repository: `YunYouJun/workstation`
- Workflow filename: `release.yml`
- Allowed action: `npm publish`

然后发布新版本：

```bash
pnpm release
git push --follow-tags
```

Release workflow 会验证 lint、typecheck、测试、CLI build、package 内容，以及 Git tag 是否匹配 `packages/cli/package.json`。它使用 OIDC，因此不需要长期有效的 `NPM_TOKEN`。

## 另见

- [antfu/dotfiles](https://github.com/antfu/dotfiles)
