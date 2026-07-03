# Codex Skills

Codex skills are reusable workflows. A skill packages task-specific
instructions, references, and optional scripts so Codex can follow the same
process reliably across threads.

Use a skill when the workflow is reusable. Use a script or package-manager
manifest when the output should be deterministic machine state.

## Invocation

Invoke a skill explicitly when you know which workflow you want:

```text
$skill-name
```

In Codex CLI and IDE surfaces, use `/skills` or type `$` to choose a skill.
Installed plugins may also expose skills that can be invoked explicitly from
the prompt.

Codex can also invoke skills implicitly when your request matches the skill
description. Good skill descriptions should say exactly when the skill should
and should not trigger.

## Skill Shape

A skill is a directory with a `SKILL.md` file:

```md
---
name: workstation-software
description: Maintain the workstation software catalog, Brewfiles, and docs.
---

Follow the repository's software setup workflow.
```

Optional folders can hold scripts, references, templates, or assets. Codex first
sees the skill name, description, and path. It reads the full `SKILL.md` only
after deciding the skill applies.

## Local Locations

Codex discovers skills from several scopes:

| Scope | Location | Use |
| --- | --- | --- |
| Repo | `.agents/skills` | Workflows shared by this repository |
| User | `$CODEX_HOME/skills` (defaults to `~/.codex/skills`) | Personal workflows across repositories |
| Admin | `/etc/codex/skills` | Machine or organization defaults |
| System | Bundled with Codex | Built-in workflows such as skill creation |

Repo skills can also live in parent directories when Codex is launched inside a
nested project. Restart Codex if a new or changed skill does not appear.

## Create or Install

Create a new skill with the built-in creator:

```text
$skill-creator
```

Install curated or external skills for local use:

```text
$skill-installer
```

For a workflow that should be distributed to other developers, package it as a
plugin instead of only checking in a local skill.

## Personal Skill Manifest

This repository keeps reusable personal skills in
[`config/codex-tools.manifest.json`](../../../config/codex-tools.manifest.json).
The sync script installs them into `$CODEX_HOME/skills`, which defaults to
`~/.codex/skills`.
Public-safe local candidates are recorded in `codex-skills.inventory.md`. That
file is only an inventory; promote entries into the install manifest only after
their upstream source is known.

```bash
pnpm skills:list      # show configured sources
pnpm skills:status    # show installed/missing skills
pnpm skills:check     # fail when a configured skill is missing
pnpm skills:install   # install missing skills
```

To add another personal skill, add an entry under `skills.install` with `id`,
`description`, `source`, and optional `targetName`. `source.ref` can track
`main`, or it can be pinned to a tag or commit for more reproducible machine
migrations.

```json
{
  "skills": {
    "install": [
      {
        "id": "ui-ux-pro-max",
        "targetName": "ui-ux-pro-max",
        "description": "Broad UI/UX design intelligence for web, mobile, dashboards, landing pages, and component review.",
        "visibility": "public",
        "syncMode": "install",
        "source": {
          "type": "github",
          "repo": "nextlevelbuilder/ui-ux-pro-max-skill",
          "path": ".claude/skills/ui-ux-pro-max",
          "ref": "main"
        }
      }
    ]
  }
}
```

Here `id` is the unique workstation manifest key, and `targetName` is the
directory installed at `$CODEX_HOME/skills/<targetName>`. In most cases, keep
`id`, `targetName`, and the `name` inside `SKILL.md` the same. Prefer a small,
intentional list: too many global skills can overlap in their trigger
descriptions and make Codex noisier.

## Codex MCP Sync

Codex MCP servers use Codex's native `config.toml` shape. This repository uses
[`schemas/codex-tools-manifest.schema.json`](../../../schemas/codex-tools-manifest.schema.json)
to validate manifest metadata, but it does not redefine MCP server TOML or sync
the full `~/.codex/config.toml`. Instead, `config/codex-tools.manifest.json`
declares `codex-mcp.toml` as a reviewable MCP fragment, and the sync script
merges it into a managed block in
`$CODEX_HOME/config.toml`, which defaults to `~/.codex/config.toml`.

```bash
pnpm mcp:list             # show the repository MCP fragment
pnpm mcp:status           # show managed block status
pnpm mcp:check            # fail when the managed block is missing or stale
pnpm mcp:install --dry-run
pnpm mcp:install          # merge the managed block and back up config.toml
```

The MCP fragment should only contain `[mcp_servers.*]`, plugin MCP policy, and
the small set of top-level MCP OAuth callback settings. Do not commit
`auth.json`, OAuth tokens, bearer token values, plugin runtime state, or
machine-generated MCP servers. When credentials are needed, commit only the
environment variable name, such as `bearer_token_env_var = "FIGMA_OAUTH_TOKEN"`.

## Relationship With Private Dotfiles

`workstation` is the reproducible install source:
`config/codex-tools.manifest.json` decides which personal skills are installed
and which MCP fragments enter the workstation managed block inside
`~/.codex/config.toml`.

A private `dotfiles` repository may record local skills/MCP inventory, internal
server names, and 1Password `op://...` references, but it should not directly
copy over or replace `~/.codex/skills` or the full `~/.codex/config.toml`. When
a configuration should become reproducible across machines, promote it into the
`workstation` manifest or managed block.

## Skills vs Plugins vs Scripts

| Need | Use |
| --- | --- |
| Reusable instructions for Codex | Skill |
| Shareable bundle with skills, app integrations, MCP servers, or assets | Plugin |
| Deterministic local install or machine-state change | Script or manifest |
| Scheduled checks or reminders | Automation |
| Repo conventions and commands | `AGENTS.md` |

For this workstation repository, software installation should stay in
`Brewfile`, `Brewfile.apps`, and `pnpm software:*`. A skill can help maintain
the catalog, explain choices, or run the documented flow, but it should not be
the only place that knows what to install.

This repository also provides a repo-scoped skill:

| Skill | Use |
| --- | --- |
| `$workstation-projects` | Have Codex follow the dry-run, `gh`, `ghq`, and `wst p active` workflow for project checkouts. |

## Example Workflow

Ask Codex to use a skill for maintenance:

```text
$workstation-software update the software catalog for a new Mac setup
```

Ask Codex to use the project checkout workflow:

```text
$workstation-projects preview cloning YunYouJun's 50 most active repositories
```

Ask Codex to run the deterministic script for machine state:

```text
Check missing software and install the app manifest.
```

Codex should resolve that second request to:

```bash
pnpm software:missing
pnpm software:install --apps
```

## References

- [Agent Skills](https://developers.openai.com/codex/skills)
- [Plugins](https://developers.openai.com/codex/plugins)
- [Build plugins](https://developers.openai.com/codex/plugins/build)
