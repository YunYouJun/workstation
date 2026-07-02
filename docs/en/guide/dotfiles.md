# Dotfiles Sync

Dotfiles live under `home/` and are managed through `workstation dotfiles`. The
old `dotfiles` command remains as a compatibility entrypoint.

## Managed Files

- `home/dot_codex/AGENTS.md` -> `~/.codex/AGENTS.md`
- `home/dot_zshrc` -> `~/.zshrc`
- `home/Library/Application Support/Code/User/settings.json` -> `~/Library/Application Support/Code/User/settings.json`

## Commands

Safe checks:

```bash
workstation dotfiles doctor
workstation dotfiles status
workstation dotfiles diff
workstation dotfiles pull --dry-run
workstation dotfiles push --dry-run
```

Commands that write files:

```bash
workstation dotfiles pull --force
workstation dotfiles push --force
```

## Chezmoi Compatibility

The repository uses `.chezmoiroot` so chezmoi reads only the `home/` subtree.

```bash
workstation dotfiles chezmoi diff
workstation dotfiles chezmoi apply
```

Use the CLI diff for everyday checks because it masks local secrets before printing file differences.

## Sync Rules

- Pull restores placeholders from `.env.local` when possible.
- Push masks matching secret-like shell assignments before writing to the repo.
- Force writes back up existing files first.
- macOS-only files can be excluded on other platforms with `home/.chezmoiignore.tmpl`.

Keep this layer focused on files that should map directly into `$HOME`. Higher-level setup tasks belong in scripts or docs.
