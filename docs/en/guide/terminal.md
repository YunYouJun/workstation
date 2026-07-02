# Terminal

The default terminal stack for a new macOS machine is:

- Homebrew for package installation.
- Zsh as the interactive shell.
- Oh My Zsh for lightweight shell plugins and completions.
- Starship for the prompt.
- fzf for fuzzy selection.
- zoxide for smarter directory jumping.
- zsh-autosuggestions and zsh-syntax-highlighting for interactive editing.

## Decision

Use Starship as the default prompt on new machines.

Starship is cross-shell, configured with one TOML file, and easy to reinstall through Homebrew. Powerlevel10k is still excellent if a machine already has a tuned Zsh-only prompt, but it is no longer the default choice for new machines because the upstream project has very limited support and no new features planned.

Keep Oh My Zsh, but do not let it own the prompt. In this setup, Oh My Zsh provides plugins and completions, while Starship owns the prompt rendering.

## Install

Install Homebrew from the official installer:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then make `brew` available in the current shell:

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Install the terminal toolchain declared in this repository:

```bash
brew bundle --file Brewfile
```

Install the default Node.js runtime through `fnm`:

```bash
fnm install --lts
fnm default lts-latest
```

Apply the managed dotfiles:

```bash
workstation dotfiles pull --dry-run
workstation dotfiles pull --force
```

Restart Zsh:

```bash
exec zsh
```

## Tools

| Tool | Role |
| --- | --- |
| `starship` | Cross-shell prompt with Git, runtime, package, and command-duration context. |
| `fzf` | Fuzzy finder for history, files, directories, Git branches, and ad hoc selection. |
| `zoxide` | Smarter `cd`; learns frequently used directories and jumps with `z`. |
| `zsh-autosuggestions` | Shows command suggestions from history as you type. |
| `zsh-syntax-highlighting` | Highlights valid commands, strings, paths, and errors in the prompt. |
| `fnm` | Fast Node.js version manager. |
| `ripgrep` | Fast code and text search. |
| `fd` | Fast, friendly file finder. |
| `eza` | Modern `ls` replacement. |

## Shell Init Order

Keep shell startup predictable:

1. Initialize Homebrew so Homebrew-installed tools are on `PATH`.
2. Load Oh My Zsh if it is installed.
3. Load language managers and path additions.
4. Initialize fzf and zoxide after completion is available.
5. Initialize Starship near the end.
6. Source `zsh-syntax-highlighting` last.

## fzf Shortcuts

The Homebrew-installed fzf integration enables:

- `Ctrl-R`: fuzzy search command history.
- `Ctrl-T`: fuzzy insert a file or directory into the current command.
- `Alt-C`: fuzzy jump into a directory.

## p10k Fallback

Powerlevel10k remains a valid fallback for machines that already use it. If `starship` is not installed and Powerlevel10k is available, `.zshrc` may still source it. New machines should install Starship first.

References:

- [Homebrew](https://brew.sh/)
- [Starship](https://starship.rs/guide/)
- [fzf](https://github.com/junegunn/fzf)
- [zoxide](https://github.com/ajeetdsouza/zoxide)
- [Powerlevel10k](https://github.com/romkatv/powerlevel10k)
