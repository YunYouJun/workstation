# Bootstrap Flow

Bootstrap should be boring, visible, and recoverable. A fresh-machine script is useful only if it can be rerun safely after a partial failure.

## First Run

Install Homebrew first if the machine does not have it yet:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Install `ghq`, configure the project root, and clone this repository into the
canonical checkout path:

```bash
brew install ghq
git config --global ghq.root ~/repos
ghq get git@github.com:YunYouJun/workstation.git
cd "$(ghq list -p github.com/YunYouJun/workstation)"
```

Install packages and runtime tools:

```bash
brew bundle --file Brewfile
fnm install --lts
fnm default lts-latest
```

Optionally install desktop apps from the separate app manifest:

```bash
pnpm software:install --apps
```

Install workspace dependencies and build the CLI:

```bash
pnpm install
pnpm build
```

Run checks before writing to `$HOME`:

```bash
workstation dotfiles doctor
workstation dotfiles pull --dry-run
```

After reviewing the dry-run output, apply the dotfiles:

```bash
workstation dotfiles pull --force
```

For more copyable command blocks, see [Copyable Commands](./commands.md).

## Best Practices

- Start with `doctor` checks before mutating the machine.
- Use `--dry-run` for any command that writes to `$HOME`.
- Back up overwritten files before replacing them.
- Keep bootstrap scripts idempotent.
- Split setup into small phases: packages, dotfiles, secrets, projects, app preferences.
- Print clear next steps when a script cannot complete automatically.

## Suggested Phases

1. Install command-line prerequisites.
2. Restore dotfiles.
3. Configure local secrets.
4. Clone common projects.
5. Install editor extensions and language tooling.
6. Run `doctor` again.

The goal is not a magical one-command setup. The goal is a setup process that can be audited, resumed, and improved over time.
