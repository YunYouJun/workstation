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

## Private Dotfiles Overlay

`workstation` can support reading a private dotfiles repository, but the
recommended shape is an overlay manifest instead of treating the private
repository as a second `home/` tree to apply directly.

Recommended boundary:

- `workstation` remains the public, reproducible, installable source of truth.
- Private dotfiles only provide a machine-readable manifest, internal server
  names, 1Password `op://...` references, and local inventory.
- Default to `dry-run` and status checks; writing into `$HOME` must require an
  explicit confirmation.
- Read only allowlisted relative paths, never recursively scan the whole
  private repository.
- Back up targets before writing, and write only managed blocks or local ignored
  output files.
- Never copy over the full `~/.codex/config.toml`, `~/.codex/skills`, `.env`,
  `auth.json`, or files that contain resolved tokens.

A private repository can expose `config/sync-manifest.json`:

```json
{
  "version": 1,
  "workstationOverlay": {
    "contractVersion": 1,
    "defaultMode": "dry-run",
    "secretSource": "1Password",
    "allowedOperations": [
      "inventory",
      "op-inject-template",
      "managed-block-fragment"
    ],
    "neverApply": [
      "$HOME/.codex/config.toml",
      "$HOME/.codex/skills",
      "$HOME/.env",
      "$HOME/.codex/auth.json"
    ]
  },
  "mcp": {
    "templates": [
      {
        "id": "json-op-template",
        "path": "mcp/mcp.op.example.json",
        "usage": "op inject --in-file mcp/mcp.op.example.json --out-file mcp/mcp.local.json"
      }
    ],
    "sources": [
      {
        "id": "codex-user",
        "path": "$HOME/.codex/config.toml",
        "format": "toml-codex",
        "syncMode": "inventory-only",
        "managedBy": "workstation codex-mcp.toml managed block plus local unmanaged entries"
      }
    ]
  }
}
```

This repository currently provides repo-level scripts that read the overlay
manifest:

```bash
pnpm private:connect
pnpm private:connect -- --repo git@example.com:user/dotfiles.git --target-dir ~/repos/private/dotfiles --dry-run
pnpm private:connect -- --repo git@example.com:user/dotfiles.git --target-dir ~/repos/private/dotfiles --yes
pnpm private:list -- --manifest ~/repos/<host>/<user>/dotfiles/config/sync-manifest.json
pnpm private:status -- --manifest ~/repos/<host>/<user>/dotfiles/config/sync-manifest.json
pnpm private:check -- --manifest ~/repos/<host>/<user>/dotfiles/config/sync-manifest.json
pnpm private:apply -- --manifest ~/repos/<host>/<user>/dotfiles/config/sync-manifest.json --dry-run
pnpm private:apply -- --manifest ~/repos/<host>/<user>/dotfiles/config/sync-manifest.json --yes
```

`apply` may only process templates, fragments, and local ignored outputs
declared in the manifest. It must not copy arbitrary files from the private
repository into `$HOME`. Without `--yes`, `apply` still runs as a dry-run.

`private:connect` asks in a TTY whether to connect a private Git dotfiles
repository and lets the user paste the Git URL. Non-interactive environments
must pass `--repo`; without `--yes`, it only previews `git clone`.

If overlay support is later moved into the published CLI, keep the command shape
equally explicit:

```bash
workstation dotfiles overlay status --manifest ~/repos/<host>/<user>/dotfiles/config/sync-manifest.json
workstation dotfiles overlay apply --manifest ~/repos/<host>/<user>/dotfiles/config/sync-manifest.json --dry-run
workstation dotfiles overlay apply --manifest ~/repos/<host>/<user>/dotfiles/config/sync-manifest.json --yes
```
