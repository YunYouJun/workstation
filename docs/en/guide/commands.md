# Copyable Commands

This page keeps common workstation operations in small, copyable command blocks.
Commands are grouped by safety level so a fresh-machine setup can stay visible
and recoverable.

## Command Rules

- Prefer one phase per command block.
- Run checks and dry-runs before commands that write to the machine.
- Keep interactive commands available, but also document a non-interactive equivalent.
- Print or document the next step when a command cannot safely continue.
- Keep package-manager manifests as the source of truth instead of hiding installs in ad hoc scripts.

## Fresh Machine

Install Homebrew first if the machine does not have it yet:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Load Homebrew into the current shell:

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Install `ghq` and configure the canonical project root:

```bash
brew install ghq
git config --global ghq.root ~/repos
```

Check the configured `ghq` project root:

```bash
git config --global --get ghq.root
```

Clone this repository into the `ghq` layout:

```bash
ghq get git@github.com:YunYouJun/workstation.git
cd "$(ghq list -p github.com/YunYouJun/workstation)"
```

If `ghq` is not available yet, clone directly into the same path:

```bash
mkdir -p ~/repos/github.com/YunYouJun
git clone git@github.com:YunYouJun/workstation.git ~/repos/github.com/YunYouJun/workstation
cd ~/repos/github.com/YunYouJun/workstation
```

Install packages declared by this repository:

```bash
brew bundle --file Brewfile
```

Install the default Node.js runtime:

```bash
fnm install --lts
fnm default lts-latest
```

Install optional desktop apps:

```bash
pnpm software:install --apps
```

Install workspace dependencies and build the CLI:

```bash
pnpm install
pnpm build
```

## Safe Checks

Inspect the current dotfiles state:

```bash
workstation dotfiles doctor
workstation dotfiles status
workstation dotfiles diff
```

Preview a restore from the repository into `$HOME`:

```bash
workstation dotfiles pull --dry-run
```

Preview a push from `$HOME` into the repository:

```bash
workstation dotfiles push --dry-run
```

Preview cloning the recently active `YunYouJun` repositories:

```bash
workstation projects clone-active
```

Preview cloning the 20 most recently active `YunYouJun` repositories:

```bash
workstation projects clone-active --limit 20
```

Preview the same flow with short aliases:

```bash
wst p active --limit 20
```

Select repositories interactively:

```bash
wst p active --limit 50 -i
```

Preview cloning from a local project manifest:

```bash
wst p manifest --file projects.local.yaml
```

Preview reading a project manifest from a private configuration repository:

```bash
wst p manifest https://git.example.com/<user>/<config-repo> --group common
```

Configure the default count through the script entry:

```bash
WORKSTATION_ACTIVE_PROJECT_LIMIT=20 pnpm projects:clone-active
```

Check local projects for uncommitted, unpushed, or stashed work:

```bash
workstation projects status
wst p status --check
wst p status --max-depth 8
pnpm projects:status
```

Check whether Homebrew packages are already installed:

```bash
brew bundle check --file Brewfile
```

Check whether optional desktop apps are already installed:

```bash
pnpm software:check --apps
```

Show which catalog apps are missing:

```bash
pnpm software:missing
```

Open official download pages for selected apps:

```bash
pnpm software:open microsoft-todo vscode neteasemusic qq wechat codex chrome raycast feishu
```

## Apply Changes

Restore managed dotfiles into `$HOME` after reviewing the dry-run:

```bash
workstation dotfiles pull --force
```

Save local dotfile changes back into the repository after reviewing the dry-run:

```bash
workstation dotfiles push --force
```

Apply chezmoi-managed files directly:

```bash
workstation dotfiles chezmoi apply
```

Clone the recently active `YunYouJun` repositories after reviewing the dry-run:

```bash
workstation projects clone-active --yes
```

Restart the current shell:

```bash
exec zsh
```

## Interactive Flow

Use the interactive sync flow when choosing direction and files by hand:

```bash
workstation dotfiles sync -i
```

Equivalent non-interactive restore flow:

```bash
workstation dotfiles sync --direction pull --dry-run
workstation dotfiles sync --direction pull --force
```

Equivalent non-interactive save flow:

```bash
workstation dotfiles sync --direction push --dry-run
workstation dotfiles sync --direction push --force
```

## Release CLI

Before the first GitHub Actions publish, configure npm Trusted Publishing for
`@yunyoujun/workstation` in the package settings:

```text
Publisher: GitHub Actions
Repository: YunYouJun/workstation
Workflow filename: release.yml
Allowed action: npm publish
```

Publish a new version:

```bash
pnpm release
git push --follow-tags
```

After a `v*` tag is pushed, GitHub Actions validates and publishes
`packages/cli`.

## Future Commands

As the repository grows beyond dotfiles, prefer a broader `workstation` command
with domain subcommands while keeping `dotfiles` as a compatibility alias for
the existing sync workflow.

```bash
workstation doctor
workstation bootstrap --dry-run
workstation packages install --dry-run
workstation dotfiles pull --dry-run
workstation projects clone-active
```
