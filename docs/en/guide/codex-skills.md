# Agent Skills and APM

This repository uses [APM (Agent Package Manager)](https://microsoft.github.io/apm/)
for public, portable Agent Skills and project-scoped standard MCP servers. APM is
the only source of truth for that lifecycle: workstation no longer maintains a
second Skills manifest, Git downloader, status command, or MCP mapping script.
User-scoped MCP servers that must work across projects use a native client
command or an explicit workstation init task.

## Files and ownership

| File or tool | Ownership |
| --- | --- |
| `home/dot_apm/apm.yml` | Declares public Skills, standard MCP, and agent targets |
| `home/dot_apm/private_apm.lock.yaml` | APM-generated lock; `private_` is chezmoi's `0600` source-state marker |
| `~/.apm/apm.yml` | Global APM manifest after chezmoi apply |
| `~/.apm/apm.lock.yaml` | Global APM lock; never hand-edit it |
| `~/.agents/.skill-lock.json` | Global skills.sh installation source lock; never hand-edit it |
| `~/.agents/.wst-skill-lock.json` | Workstation private Skill provenance and SHA-256 lock; never hand-edit it |
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

## Project, user, and private Codex MCP

Use APM for public MCP servers that travel with a project:

```bash
apm install --mcp io.github.example/server
```

APM 0.26 currently installs self-defined MCP servers only at project scope and
rejects `--global --mcp`. A public MCP that must be available in every Codex
project should use a previewable, idempotent workstation init task or
`codex mcp add`. For Microsoft To Do:

```bash
workstation init codex.microsoft-todo-mcp
workstation init codex.microsoft-todo-mcp --yes
```

TOML containing internal server names, private local commands, Codex plugin
configuration, or top-level OAuth callback fields does not belong in the public
APM manifest. It remains in the allowlisted private overlay:

```bash
wst private mcp-apply --dry-run
wst private mcp-apply --yes
```

`mcp-apply` only writes the `workstation managed private mcp` block in
`~/.codex/config.toml`; it never replaces the full config.

## Skill shape and triggering

A Skill is a directory containing `SKILL.md`, optionally with scripts,
references, and assets. Agents match the name and description in `SKILL.md`
frontmatter, and users can explicitly invoke `$skill-name`.

Keep global Skills intentional and small. Overlapping descriptions increase
false triggers; workflows without cross-project value should remain in the
repository's `.agents/skills` or the private overlay.

An installed Skill that is low-frequency, routed through a hub, or only needed
on explicit request does not need to be uninstalled. Disable implicit invocation
in `agents/openai.yaml`; it leaves the default model context while remaining
available through `$skill-name`:

```yaml
policy:
  allow_implicit_invocation: false
```

A private overlay can record these choices in `skills.policies` and replay them
idempotently with `wst private skills-apply --yes`, without copying or taking
ownership of third-party Skill content.

## Local audit

Use workstation's read-only audit to inspect the APM manifest and lock, the
global skills.sh and workstation provenance locks, locked files and hashes, global and project
discovery roots, unmanaged shared Skills,
duplicate names, metadata size, and invalid frontmatter:

```bash
wst skills audit
wst skills audit --json
wst skills audit --check
```

Only shared Skills declared by none of APM, the global skills.sh lock, or the
workstation provenance lock are aggregated as unmanaged warnings. When both
APM files are absent, APM is simply “not configured”. `--check` exits non-zero
when only one file exists, YAML or its minimum structure is invalid, an explicit
dependency alias is unlocked, a deployed path escapes `~/.agents/skills`, a locked
shared Skill file is missing or modified, a Skill directory or symlink is
unreadable, or a recursively discovered `SKILL.md` has invalid frontmatter.
Descriptions beyond Codex's 1,024-character limit are invalid. Descriptions over
500 characters, bodies over 500 lines, nonstandard names (at most 64 lowercase
letters, digits, and single hyphens), and directory/name mismatches are grouped
as maintainability warnings.
An existing skills.sh lock also fails on invalid JSON or minimum structure. It
may contain global Skills targeting other agents, so the audit uses it to prove
the provenance of shared Skills without requiring every entry in Codex's shared
root.
The workstation provenance lock strictly checks the corresponding shared or
Codex private deployment and directory digest. An invalid lock, missing
deployment, or modified content makes `--check` fail.
The report separates implicit and explicit-only Skills and counts the implicit
description characters that remain in always-on context.
Dependency matching here covers explicitly declared aliases only. Keep
`apm install --global --frozen` as the authority for string shorthands, full
URLs, registries, and non-Skill deployments instead of duplicating APM's
resolver in `wst`. The command never installs, deletes, or moves a Skill.
Top-level Skill symlinks are audited recursively, but each discovery root is
limited to 10,000 directory entries and 32 levels; exceeding either limit fails
closed instead of expanding into an unbounded filesystem scan.
Machine-state auditing belongs in
workstation; move only a reusable rules module to a separate repository if
multiple products need it, while keeping the `wst` interface here.

## Ownership boundary

| Need | Use |
| --- | --- |
| Public Skills, project-scoped standard MCP, locking, updates, and replay | APM; preserve the source lock for existing skills.sh installs |
| Reusable personal public Skill content | A dedicated Skills repository (for example `YunYouJun/ai`), deployed through APM/an installer |
| Public user-scoped Codex MCP | workstation init / `codex mcp` |
| Repository workflows | `.agents/skills` |
| Private local Skills, Codex-only MCP, and 1Password | `wst private` |
| Software installation | `Brewfile` / `pnpm software:*` |
| Repository conventions | `AGENTS.md` |

APM 0.28 still does not expose a global mode for `audit`. Validate global
manifest/lock consistency and replay the locked state with
`apm install --global --frozen`. Do not run project-scope `apm audit --ci` from
`~/.apm`, because it interprets deployed paths relative to the wrong project
root.

## References

- [APM documentation](https://microsoft.github.io/apm/)
- [APM install](https://microsoft.github.io/apm/reference/cli/install/)
- [skills.sh CLI](https://github.com/vercel-labs/skills)
- [Agent Skills](https://agentskills.io/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
