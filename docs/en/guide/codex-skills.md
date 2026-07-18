# Agent Skills and APM

This repository uses [APM (Agent Package Manager)](https://microsoft.github.io/apm/)
for public, portable Agent Skills and standard MCP servers. APM is the only
source of truth for that lifecycle: workstation no longer maintains a second
Skills manifest, Git downloader, status command, or MCP mapping script.

## Files and ownership

| File or tool | Ownership |
| --- | --- |
| `home/dot_apm/apm.yml` | Declares public Skills, standard MCP, and agent targets |
| `home/dot_apm/private_apm.lock.yaml` | APM-generated lock; `private_` is chezmoi's `0600` source-state marker |
| `~/.apm/apm.yml` | Global APM manifest after chezmoi apply |
| `~/.apm/apm.lock.yaml` | Global APM lock; never hand-edit it |
| `wst private` | Private local Skills, Codex-only MCP, 1Password, and inventory-only config |

APM deploys shared Skills to `~/.agents/skills` by default. Repository workflows
remain under `.agents/skills`. Local Skills explicitly declared by the private
overlay remain under `~/.codex/skills`, so private paths never enter the public
manifest.

## Restore a new machine

The core Brewfile installs APM. Apply dotfiles, then replay the lock in frozen
mode:

```bash
brew bundle --file Brewfile
wst df chezmoi apply
apm install --global --frozen
```

Inspect global dependencies with:

```bash
apm deps list --global
apm deps tree --global
```

## Add or update dependencies

Let APM mutate the global manifest, install, and generate the lock. Then capture
both files back into the chezmoi source tree:

```bash
apm install --global owner/repo --skill skill-name
wst df chezmoi re-add ~/.apm/apm.yml ~/.apm/apm.lock.yaml
git diff -- home/dot_apm
```

Preview and explicitly approve updates:

```bash
apm update --global --dry-run
apm update --global
wst df chezmoi re-add ~/.apm/apm.yml ~/.apm/apm.lock.yaml
apm install --global --frozen
```

Never hand-edit `apm.lock.yaml`. The manifest may track `main` or a version
range; the lock still pins the resolved commit, and only an explicit
`apm update --global` advances it.

## Standard MCP and private Codex MCP

Use APM for public, portable MCP servers:

```bash
apm install --global --mcp io.github.example/server
```

TOML containing internal server names, private local commands, Codex plugin
configuration, or top-level OAuth callback fields does not belong in the public
APM manifest. It remains in the allowlisted private overlay:

```bash
wst private apply --dry-run
wst private apply --yes
```

Private apply only writes the `workstation managed private mcp` block in
`~/.codex/config.toml`; it never replaces the full config.

## Skill shape and triggering

A Skill is a directory containing `SKILL.md`, optionally with scripts,
references, and assets. Agents match the name and description in `SKILL.md`
frontmatter, and users can explicitly invoke `$skill-name`.

Keep global Skills intentional and small. Overlapping descriptions increase
false triggers; workflows without cross-project value should remain in the
repository's `.agents/skills` or the private overlay.

## Ownership boundary

| Need | Use |
| --- | --- |
| Public Skills, standard MCP, locking, updates, and replay | APM |
| Repository workflows | `.agents/skills` |
| Private local Skills, Codex-only MCP, and 1Password | `wst private` |
| Software installation | `Brewfile` / `pnpm software:*` |
| Repository conventions | `AGENTS.md` |

APM v0.25.0 does not expose a global mode for `audit`. Validate global
manifest/lock consistency and replay the locked state with
`apm install --global --frozen`. Do not run project-scope `apm audit --ci` from
`~/.apm`, because it interprets deployed paths relative to the wrong project
root.

## References

- [APM documentation](https://microsoft.github.io/apm/)
- [APM install](https://microsoft.github.io/apm/reference/cli/install/)
- [Agent Skills](https://agentskills.io/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
