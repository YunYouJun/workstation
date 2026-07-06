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
  names, private MCP fragments, explicit installable skills, 1Password
  `op://...` references, and local inventory.
- Default to `dry-run` and status checks; writing into `$HOME` must require an
  explicit confirmation.
- Read only allowlisted relative paths, never recursively scan the whole
  private repository.
- Back up targets before writing, and write only managed blocks, local ignored
  output files, or explicitly declared `$CODEX_HOME/skills/<name>` skill
  directories.
- Never copy over the full `~/.codex/config.toml`, `~/.codex/skills`, `.env`,
  `auth.json`, or files that contain resolved tokens.

A private repository can expose `config/sync-manifest.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/YunYouJun/workstation/main/schemas/codex-tools-manifest.schema.json",
  "version": 1,
  "visibility": "private",
  "workstationOverlay": {
    "contractVersion": 1,
    "defaultMode": "dry-run",
    "secretSource": "1Password",
    "allowedOperations": [
      "inventory",
      "mcp-export",
      "op-inject-template",
      "codex-skill-install",
      "codex-mcp-fragment",
      "managed-block-fragment"
    ],
    "allowedReadPaths": [
      "config/sync-manifest.json",
      "mcp/*.op.example.json",
      "mcp/codex-mcp.overlay.toml",
      "skills/install/*"
    ],
    "neverApply": [
      "$HOME/.codex/config.toml",
      "$HOME/.codex/skills",
      "$HOME/.env",
      "$HOME/.codex/auth.json"
    ]
  },
  "skills": {
    "install": [
      {
        "id": "internal-example",
        "targetName": "internal-example",
        "description": "Private internal workflow.",
        "source": {
          "type": "local",
          "path": "skills/install/internal-example"
        }
      }
    ]
  },
  "mcp": {
    "fragments": [
      {
        "id": "private-codex",
        "path": "mcp/codex-mcp.overlay.toml",
        "format": "toml-codex",
        "operation": "managed-block-fragment"
      }
    ],
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

The published CLI provides `wst private` commands that read the overlay
manifest. Repository-level `pnpm private:*` scripts remain compatibility
entrypoints:

```bash
wst private connect
wst private connect --repo git@example.com:user/dotfiles.git --target-dir ~/repos/private/dotfiles --dry-run
wst private connect --repo git@example.com:user/dotfiles.git --target-dir ~/repos/private/dotfiles --yes
wst private list
wst private status
wst private check
wst private mcp-export --server gongfeng,iwiki,knot --dry-run
wst private mcp-export --server gongfeng,iwiki,knot --yes
wst private apply --dry-run
wst private apply --yes
wst private inventory --section skills
wst private ios-secrets-import --yes
wst private ios-run -- <command>
wst private secrets-check
wst private secret-scan
```

`apply` may only process templates, MCP fragments, explicit installable skills,
and local ignored outputs declared in the manifest. It must not copy arbitrary
files from the private repository into `$HOME`. Without `--yes`, `apply` still
runs as a dry-run.

`mcp-export` reads selected servers from the manifest's Codex TOML source
(usually `~/.codex/config.toml`) and writes the declared
`mcp/codex-mcp.overlay.toml`. It never exports the full Codex config; literal
`env` values are converted to `${ENV_NAME}` references, and literal
header/token values that cannot be safely inferred are refused. After exporting
and committing private dotfiles on the old machine, a new machine can run
`wst private apply --yes` to merge that overlay into the Codex managed block.

`wst private connect --yes` stores the private manifest path in
`~/.config/workstation/private.json`, so later commands can omit `--manifest`.
Without that config, the CLI discovers common
`~/repos/**/dotfiles/config/sync-manifest.json` paths automatically. Passing
`--manifest <path>` still overrides the default.

`wst private connect` asks in a TTY whether to connect a private Git dotfiles
repository and lets the user paste the Git URL. Non-interactive environments
must pass `--repo`; without `--yes`, it only previews `git clone`.
