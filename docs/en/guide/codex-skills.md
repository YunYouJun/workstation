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
| User | `~/.agents/skills` | Personal workflows across repositories |
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
