# Terminal

The default terminal stack for a new macOS machine is:

- Homebrew for package installation.
- Zsh as the interactive shell.
- Oh My Zsh for lightweight shell plugins and completions.
- Starship for the prompt.
- fzf for fuzzy selection.
- zoxide for smarter directory jumping.
- Tmux for persistent sessions on remote machines and long-running tasks.
- zsh-autosuggestions and zsh-syntax-highlighting for interactive editing.

## Decision

Use Starship as the default prompt on new machines.

Starship is cross-shell, configured with one TOML file, and easy to reinstall through Homebrew. Powerlevel10k is still excellent if a machine already has a tuned Zsh-only prompt, but it is no longer the default choice for new machines because the upstream project has very limited support and no new features planned.

Keep Oh My Zsh, but do not let it own the prompt. In this setup, Oh My Zsh provides plugins and completions, while Starship owns the prompt rendering.

### Directory Jumping

Use `zoxide` by default on new machines, and do not make `autojump` the default
choice. `zoxide` is a modern `cd` replacement inspired by `z` and `autojump`;
it supports major shells, ranks frequently used directories, jumps with `z`,
and uses `zi` with `fzf` for interactive selection.

Project paths are still owned by `ghq`, keeping the
`~/repos/<host>/<owner>/<repo>` layout close to the remote URL. Use
`ghq list -p` when entering a project for the first time or when an exact path
matters. Use `z <keyword>` for frequent projects, `zi <keyword>` when the match
is ambiguous, and `ghq list -p | fzf` when choosing from every checkout.

`autojump` is now archived as a legacy option. When migrating an old machine,
remove the `autojump` plugin load and Homebrew package, and use `zoxide`
instead.

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
| `tmux` | Terminal multiplexer for keeping remote shells, builds, deploys, or log sessions alive. |
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

## Project Jumping

Enter an exact `ghq` project:

```bash
cd "$(ghq list -p github.com/YunYouJun/workstation)"
```

After visiting it once, let `zoxide` take over:

```bash
z workstation
z YunYouJun workstation
zi workstation
```

Pick from every `ghq` checkout and enter it:

```bash
project="$(ghq list -p | fzf)" && cd "$project"
```

If you want a short command, keep it in machine-local shell config:

```zsh
cdp() {
  local project
  project="$(ghq list -p | fzf --preview 'git -C {} status --short --branch 2>/dev/null | head -50')" && cd "$project"
}
```

## Tmux Sessions

Tmux is useful for remote machines, long builds, deployment debugging, and log
sessions that should keep running after disconnecting.

Create a named session:

```bash
tmux new -s <session-name>
```

Detach from the current session:

```bash
tmux detach
```

Inside Tmux, press `Ctrl-B`, then `d` to detach.

Reattach to a session:

```bash
tmux attach -t <session-name>
```

Kill a named session:

```bash
tmux kill-session -t <session-name>
```

Reference: [Tmux guide](https://www.ruanyifeng.com/blog/2019/10/tmux.html).

## Terminal Proxy

`home/dot_zshrc` provides two temporary proxy functions:

```bash
goproxy
disproxy
```

The default HTTP proxy is `127.0.0.1:8234`, and the default SOCKS proxy is
`127.0.0.1:8235`. When a machine uses different ports, override the machine-local
environment before calling `goproxy`:

```bash
TERMINAL_PROXY_HTTP_PORT=7890 TERMINAL_PROXY_SOCKS_PORT=7890 goproxy
```

In WSL, the proxy usually lives on the Windows side, so set
`TERMINAL_PROXY_HOST` to the nameserver address from `/etc/resolv.conf`. On
macOS, if Surge, Clash, or the system proxy already handles the traffic, leave
the shell-level proxy off.

## p10k Fallback

Powerlevel10k remains a valid fallback for machines that already use it. If `starship` is not installed and Powerlevel10k is available, `.zshrc` may still source it. New machines should install Starship first.

## Migrated Environment Notes

The old Yuque notes for oh-my-zsh, macOS/Linux bootstrap snippets, Tmux, and
Terminal Proxy now collapse into this page and `home/dot_zshrc`:

- New macOS machines use [Bootstrap Flow](./bootstrap.md) and
  [Copyable Commands](./commands.md) instead of a separate ad hoc install script.
- Node.js is installed through `fnm` by default; do not install `nvm` through
  Homebrew.
- Starship is the default prompt; Powerlevel10k is only a fallback for existing
  machines.
- Directory jumping defaults to `zoxide` + `fzf`; do not install or load
  `autojump`.
- `zsh-autosuggestions` and `zsh-syntax-highlighting` prefer Homebrew packages;
  `.zshrc` still supports existing Oh My Zsh custom plugins.

References:

- [Homebrew](https://brew.sh/)
- [Starship](https://starship.rs/guide/)
- [fzf](https://github.com/junegunn/fzf)
- [zoxide](https://github.com/ajeetdsouza/zoxide)
- [ghq](https://github.com/x-motemen/ghq)
- [Powerlevel10k](https://github.com/romkatv/powerlevel10k)
