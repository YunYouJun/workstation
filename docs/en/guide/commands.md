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

Sync personal Codex skills and the MCP fragment:

```bash
pnpm skills:status
pnpm skills:install
pnpm mcp:status
pnpm mcp:install --dry-run
pnpm mcp:install
```

Read a private dotfiles overlay and preview the local ignored config that would
be generated:

```bash
wst private connect
wst private status
wst private file-restore --bundle wecom-cli --dry-run
wst private mcp-export --server gongfeng,iwiki,knot --dry-run
wst private apply --dry-run
```

Connect a private repository non-interactively:

```bash
wst private connect --repo git@example.com:user/dotfiles.git --target-dir ~/repos/private/dotfiles --yes
```

After confirming 1Password is signed in, apply it explicitly:

```bash
wst private apply --yes
wst private file-restore --bundle wecom-cli --yes
```

Export installed Codex MCP servers from the old machine into the private
overlay. After committing the private dotfiles, a new machine can read the same
overlay with `wst private apply --yes`:

```bash
wst private mcp-export --server gongfeng,iwiki,knot --yes
```

## SSH And Remote Access

Generate a new GitHub SSH key and print the public key:

```bash
ssh-keygen -t ed25519 -C "you@example.com"
cat ~/.ssh/id_ed25519.pub
```

Install the public key on a remote machine:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@example-host
```

Check GitHub SSH authentication:

```bash
ssh -T git@github.com
```

## macOS And Unix Maintenance

Flush the macOS DNS cache:

```bash
sudo killall -HUP mDNSResponder
```

If the built-in Apache server is occupying `localhost`, stop it first:

```bash
sudo apachectl stop
```

Temporarily inspect internal-disk SMART data:

```bash
brew install smartmontools
smartctl -a /dev/disk0
```

List installed JDKs and register Homebrew OpenJDK with the macOS Java wrapper:

```bash
/usr/libexec/java_home -V
brew install openjdk
sudo ln -sfn "$(brew --prefix openjdk)/libexec/openjdk.jdk" /Library/Java/JavaVirtualMachines/openjdk.jdk
```

If a machine needs to switch between multiple JDKs long-term, install `jenv`:

```bash
brew install jenv
echo 'export PATH="$HOME/.jenv/bin:$PATH"' >> ~/.zshrc
echo 'eval "$(jenv init -)"' >> ~/.zshrc
jenv add "$(/usr/libexec/java_home)"
jenv versions
```

If a machine already has `rar`, use `-ep1` to avoid storing the full source path
inside the archive. `rar` does not belong in the default workstation manifest;
use it only when the recipient specifically requires RAR.

```bash
rar a -ep1 archive.rar /path/to/source
```

Common macOS shortcuts:

| Shortcut | Action |
| --- | --- |
| `Control-Command-Space` | Show emoji and symbols |
| `Control-Command-F` | Enter or exit full screen |
| `Shift-Command-5` | Open screenshot and screen recording tools |
| `Shift-Command-.` | Show or hide hidden files in Finder |
| `Command-Option-C` | Copy the selected Finder item's path |
| `Command-Shift-G` | Go to a path in Finder |

Common Linux/Unix read-only checks:

```bash
hostname
uname -m
df -h
du -sh <path>
```

## Windows PowerShell

List all TCP port usage:

```powershell
Get-NetTCPConnection
```

Check one port, such as `8080`:

```powershell
Get-NetTCPConnection | Where-Object { $_.LocalPort -eq 8080 }
```

Open the current directory in File Explorer:

```powershell
ii .
```

Use the current Windows command for WSL setup. The older feature-toggle commands
from historical notes are archived only:

```powershell
wsl --install
wsl --list --verbose
```

## Safe Checks

Inspect the current dotfiles state:

```bash
workstation dotfiles doctor
workstation dotfiles status
workstation dotfiles diff
```

List available init tasks:

```bash
wst init --list
```

Preview Git `includeIf` identity routing setup:

```bash
wst init git.include-if --git-profile 'id=github;host=github.com;name=Your Name;email=you@example.com'
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
wst p manifest -i
```

Preview cloning from a local project manifest:

```bash
wst p manifest --file projects.local.yaml
wst p manifest --file projects.local.yaml --validate
```

Preview reading a project manifest from a private configuration repository:

```bash
wst p manifest https://git.example.com/<user>/<config-repo> --group common
wst p manifest https://git.example.com/<user>/<config-repo>/raw/main/projects.yaml -g common
wst p m https://git.example.com/<user>/<config-repo> -g common
wst p m --file projects.local.yaml -g common --repository git.example.com/example/service
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

Enter a known `ghq` project:

```bash
cd "$(ghq list -p github.com/YunYouJun/workstation)"
```

Jump to a project that `zoxide` has already learned:

```bash
z workstation
zi workstation
```

Pick from every `ghq` checkout and enter it:

```bash
project="$(ghq list -p | fzf)" && cd "$project"
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
pnpm software:open raycast feishu microsoft-todo ima
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

Apply Git `includeIf` identity routing after reviewing the dry-run:

```bash
wst init git.include-if --git-profile 'id=github;host=github.com;name=Your Name;email=you@example.com' --yes
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

Use interactive init when choosing setup tasks and entering machine-local
identity values by hand:

```bash
wst init -i
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
