# workstation

[![CI](https://github.com/YunYouJun/workstation/actions/workflows/ci.yml/badge.svg)](https://github.com/YunYouJun/workstation/actions/workflows/ci.yml)

Personal developer workstation configuration, dotfiles sync tooling, setup notes, and operating practices.

This repository is intentionally broader than a plain dotfiles repo: it keeps shell/editor configuration under `home/`, a TypeScript CLI under `packages/cli`, and long-form setup documentation under `docs/`.

Docs: <https://workstation.yunyoujun.cn>

## Usage

```bash
# Install dependencies
pnpm install

# Build CLI packages
pnpm build

# Start documentation site
pnpm docs:dev
```

## Documentation

The VitePress docs are the source of truth for the workstation setup model:

- [Overview](./docs/index.md)
- [Repository scope](./docs/guide/repository.md)
- [Bootstrap flow](./docs/guide/bootstrap.md)
- [Copyable commands](./docs/guide/commands.md)
- [Terminal](./docs/guide/terminal.md)
- [Dotfiles sync](./docs/guide/dotfiles.md)
- [Secrets](./docs/guide/secrets.md)
- [Projects](./docs/guide/projects.md)
- [Packages](./docs/guide/packages.md)
- [Software](./docs/guide/software.md)
- [Codex skills](./docs/guide/codex-skills.md)
- [VSCode extensions](./docs/vscode/extensions.md)

## CLI

Use `workstation` as the primary command, or `wst` when you want a shorter
entrypoint. Short domain aliases such as `df` and `p` are available under both.
The historical `dotfiles` command remains available for compatibility.

```bash
workstation doctor
workstation dotfiles pull --dry-run
workstation projects clone-active
workstation df pull --dry-run
workstation p active --limit 20
wst df pull --dry-run
wst p active --limit 20
```

`wst` is intentionally used instead of `ws` to avoid common WebSocket/workspace
associations and global alias collisions.

### Push (Home -> Repo)

将本地 `~/` 下的 dotfiles 推送到仓库，自动检测并遮罩敏感 token：

```bash
workstation dotfiles push              # 仅推送有变更的文件
workstation dotfiles push --force      # 强制覆盖（自动备份）
workstation dotfiles push --dry-run    # 预览变更
```

### Pull (Repo -> Home)

将仓库中的 dotfiles 拉取到本地，自动恢复 token：

```bash
workstation dotfiles pull              # copy 模式（默认）
workstation dotfiles pull --mode link  # symlink 模式
workstation dotfiles pull --force      # 强制覆盖（自动备份）
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
workstation dotfiles diff              # 查看仓库与本地的差异（会遮罩本地 secrets）
workstation dotfiles status            # 查看 chezmoi + legacy 同步状态
workstation dotfiles doctor            # 检查 chezmoi source tree 与本地 secrets 准备情况
```

### Chezmoi

This repo is chezmoi-compatible via [`.chezmoiroot`](./.chezmoiroot). Chezmoi reads only the [`home/`](./home) subtree, so repo files like `README.md`, `package.json`, and `packages/cli` are not treated as home files.

```bash
workstation dotfiles chezmoi diff      # 等价于 chezmoi --source <repo> diff
workstation dotfiles chezmoi apply     # apply files managed under home/
```

Current managed home files live under `home/`:

- `home/dot_codex/AGENTS.md` -> `~/.codex/AGENTS.md`
- `home/dot_config/starship.toml` -> `~/.config/starship.toml`
- `home/dot_zshrc` -> `~/.zshrc`
- `home/Library/Application Support/Code/User/settings.json` -> `~/Library/Application Support/Code/User/settings.json`

VSCode settings are macOS-only for now and are ignored by chezmoi on non-macOS hosts via [`home/.chezmoiignore.tmpl`](./home/.chezmoiignore.tmpl). Use `workstation dotfiles diff` for secret-safe diffs; raw `workstation dotfiles chezmoi diff` may show unmasked local values.

Run `workstation dotfiles doctor` after cloning or pulling this repo to verify `.chezmoiroot`, managed source files, local secret placeholders, and chezmoi availability.

### Projects

Clone the most recently pushed repositories owned by `YunYouJun`. The command
defaults to dry-run, `~/repos`, SSH URLs, non-forks, non-archived repositories,
and the `ghq` directory layout:

```bash
git config --global ghq.root ~/repos
git config --global --get ghq.root
```

```bash
workstation projects clone-active                  # preview latest 50
workstation projects clone-active --yes            # clone latest 50
workstation projects clone-active --limit 20       # preview latest 20
workstation projects clone-active --limit 50 -i    # select repositories interactively
workstation projects clone-active --update --yes   # update existing checkouts too
workstation projects clone-active --https --yes    # use HTTPS clone URLs
workstation projects status                        # show local repos with dirty/unpushed/stashed work
wst p status --check                               # fail when any repo needs attention
wst p status --max-depth 8                         # scan deeper nested checkout layouts
wst p active --limit 20                            # short entrypoint
pnpm projects:clone-active                         # script alias, dry-run
pnpm projects:status                               # script alias, local repo audit
```

Set `WORKSTATION_ACTIVE_PROJECT_LIMIT` to change the script/default count:

```bash
WORKSTATION_ACTIVE_PROJECT_LIMIT=20 pnpm projects:clone-active
```

The command uses `gh api graphql` with `PUSHED_AT DESC` ordering, so authenticate
GitHub CLI first with `gh auth login`. If `ghq` is installed and its primary
`ghq.root` matches the requested root, the CLI uses `ghq get`; otherwise it
falls back to explicit `git clone` paths under `~/repos/github.com/<owner>/<repo>`.

For private or internal common projects, keep a YAML manifest locally or in a
private configuration repository:

```bash
wst p manifest --file projects.local.yaml
wst p manifest https://git.example.com/<user>/<config-repo> --group common
wst p manifest https://git.example.com/<user>/<config-repo> --group common --yes
```

Manifest repositories are cached under `~/.cache/workstation/project-manifests/`,
and project checkouts use `~/repos/<host>/<repo-path>` paths such as
`~/repos/git.example.com/example/service`. Manifest groups are only for
selection and organization; they do not become part of the target path. If a
manifest entry intentionally maps a remote `path` to a different local `name`,
the CLI falls back to explicit `git clone` instead of `ghq get`.

Use `workstation projects status` before switching machines to scan local
repositories under `~/repos`. It reports uncommitted files, unpushed commits,
stashes, missing upstreams, and gone upstreams. Add `--all` to include clean
repositories or `--check` to return a non-zero exit code when anything needs
attention. The scan descends up to 6 directory levels by default; use
`--max-depth <number>` when your checkout layout is deeper or you want a
shallower audit.

### Secrets

Push 时自动将匹配 `API_KEY`、`TOKEN`、`SECRET`、`PASSWORD` 等关键词的环境变量值替换为 `{{DOTFILES_SECRET:KEY}}` 占位符，真实值保存在仓库根目录的 `.env.local`（已 gitignore）。

Pull 时自动从 `.env.local` 读取真实值并还原。

## Development

```bash
pnpm run lint        # ESLint
pnpm run typecheck   # TypeScript 类型检查
pnpm test            # Vitest 单元测试
pnpm run build       # 构建 CLI
pnpm run docs:build  # 构建 VitePress 文档
pnpm run ci          # 一键运行 lint + typecheck + test + build + docs:build
```

## Release

The CLI package is published by GitHub Actions when a `v*` tag is pushed. Configure
npm Trusted Publishing for `@yunyoujun/workstation` first:

- Publisher: GitHub Actions
- Repository: `YunYouJun/workstation`
- Workflow filename: `release.yml`
- Allowed action: `npm publish`

Then publish a new version:

```bash
pnpm release
git push --follow-tags
```

The release workflow validates lint, typecheck, tests, CLI build, package
contents, and that the Git tag matches `packages/cli/package.json`. It uses OIDC,
so no long-lived `NPM_TOKEN` is required.

## Check Also

- [antfu/dotfiles](https://github.com/antfu/dotfiles)
