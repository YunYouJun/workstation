# workstation

[![CI](https://github.com/YunYouJun/workstation/actions/workflows/ci.yml/badge.svg)](https://github.com/YunYouJun/workstation/actions/workflows/ci.yml)

[English](./README.md) | [简体中文](./README.zh-CN.md)

Personal developer workstation configuration, dotfiles sync tooling, setup notes, and operating practices.

This repository is intentionally broader than a plain dotfiles repo: it keeps shell/editor configuration under `home/`, a TypeScript CLI under `packages/cli`, and long-form setup documentation under `docs/`.

Docs: <https://workstation.yunyoujun.cn/en/>

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

- [Overview](./docs/en/index.md)
- [Repository scope](./docs/en/guide/repository.md)
- [Bootstrap flow](./docs/en/guide/bootstrap.md)
- [Copyable commands](./docs/en/guide/commands.md)
- [Terminal](./docs/en/guide/terminal.md)
- [Dotfiles sync](./docs/en/guide/dotfiles.md)
- [Secrets](./docs/en/guide/secrets.md)
- [Projects](./docs/en/guide/projects.md)
- [Packages](./docs/en/guide/packages.md)
- [Software](./docs/en/guide/software.md)
- [Codex skills](./docs/en/guide/codex-skills.md)
- [VSCode extensions](./docs/en/vscode/extensions.md)

## CLI

Use `workstation` as the primary command, or `wst` when you want a shorter
entrypoint. Short domain aliases such as `df` and `p` are available under both.
The historical `dotfiles` command remains available for compatibility.

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

`wst` is intentionally used instead of `ws` to avoid common WebSocket/workspace
associations and global alias collisions.

### Push (Home -> Repo)

Push dotfiles from local `~/` into the repository. Sensitive tokens are detected
and masked automatically:

```bash
workstation dotfiles push              # push only changed files
workstation dotfiles push --force      # overwrite with automatic backups
workstation dotfiles push --dry-run    # preview changes
```

### Pull (Repo -> Home)

Pull dotfiles from the repository back into local HOME. Secret placeholders are
restored automatically:

```bash
workstation dotfiles pull              # copy mode, the default
workstation dotfiles pull --mode link  # symlink mode
workstation dotfiles pull --force      # overwrite with automatic backups
workstation dotfiles pull --dry-run    # preview changes
```

### Sync

Sync in a chosen direction, or use interactive mode:

```bash
workstation dotfiles sync --direction pull
workstation dotfiles sync --direction push --force
workstation dotfiles sync -i           # choose interactively
```

### Diff & Status

```bash
workstation dotfiles diff              # show repo/local diffs with local secrets masked
workstation dotfiles status            # show chezmoi + legacy sync status
workstation dotfiles doctor            # check chezmoi source tree and local secret readiness
```

### Chezmoi

This repo is chezmoi-compatible via [`.chezmoiroot`](./.chezmoiroot). Chezmoi reads only the [`home/`](./home) subtree, so repo files like `README.md`, `package.json`, and `packages/cli` are not treated as home files.

```bash
workstation dotfiles chezmoi diff      # equivalent to chezmoi --source <repo> diff
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
wst p manifest -i
wst p manifest --file projects.local.yaml
wst p manifest --file projects.local.yaml --validate
wst p manifest https://git.example.com/<user>/<config-repo> --group common
wst p manifest https://git.example.com/<user>/<config-repo> --group common --yes
wst p manifest https://git.example.com/<user>/<config-repo>/raw/main/projects.yaml --group common
wst p m https://git.example.com/<user>/<config-repo> -g common --yes
wst p m --file projects.local.yaml -g common --repository git.example.com/example/service
```

Manifest repositories are cached under `~/.cache/workstation/project-manifests/`,
remote manifest files are downloaded to the same cache, and project checkouts use `~/repos/<host>/<repo-path>` paths such as
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

During push, environment variable values whose names match keywords such as
`API_KEY`, `TOKEN`, `SECRET`, or `PASSWORD` are replaced with
`{{DOTFILES_SECRET:KEY}}` placeholders. Real values are stored in `.env.local` at
the repository root, which is ignored by git.

During pull, real values are read from `.env.local` and restored automatically.

## Development

```bash
pnpm run lint        # ESLint
pnpm run typecheck   # TypeScript type checks
pnpm test            # Vitest unit tests
pnpm run build       # build the CLI
pnpm run docs:build  # build the VitePress docs
pnpm run ci          # run lint + typecheck + test + build + docs:build
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

## See Also

- [antfu/dotfiles](https://github.com/antfu/dotfiles)
