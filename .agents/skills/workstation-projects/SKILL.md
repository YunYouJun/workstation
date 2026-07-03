---
name: workstation-projects
description: Guide Codex through this repository's project checkout workflow. Use when the user asks about cloning, previewing, updating, or documenting workstation project checkouts; recent or active GitHub repositories for a GitHub owner/org such as YunYouJun or YunLeFun; ghq layout; wst/workstation project commands; projects.example.yaml; or safe project bootstrap practices. Do not use for dotfiles sync, software installation, or package catalog work unless the task also involves project checkout policy.
---

# Workstation Projects

Use the repository CLI as the source of truth for project checkout and local
project audit behavior. Do not reimplement GitHub listing, clone paths, update
logic, or dirty-repository checks in ad hoc scripts unless the CLI is missing
the required capability.

## References

Read only when needed:

- `docs/guide/projects.md` or `docs/en/guide/projects.md` for checkout policy and user-facing command examples.
- `docs/guide/commands.md` or `docs/en/guide/commands.md` for copyable setup commands.
- `packages/cli/src/projects.ts` for exact CLI behavior.
- `projects.example.yaml` for the manifest shape.

## Workflow

1. Verify prerequisites before applying changes:

```bash
gh auth status
git config --global --get ghq.root
```

2. If `ghq.root` is missing and the task concerns normal workstation checkout,
   recommend or apply:

```bash
git config --global ghq.root ~/repos
```

3. Preview first. Use the repo script when working inside this repository:

```bash
pnpm projects:clone-active --limit 50
```

Use the built CLI outside the repo:

```bash
wst p active --limit 50
```

To target a different GitHub owner or organization, pass it as the target. The
repo script already includes `p active`, so pass the owner directly after the
script name:

```bash
pnpm projects:clone-active YunLeFun --limit 20
wst p active YunLeFun --limit 20
```

When the user wants to choose a subset by hand, use interactive selection:

```bash
wst p active --limit 50 -i
```

4. Apply only when the user clearly asks to clone/update, or after they approve
   the dry-run. Use `--yes` for writes:

```bash
wst p active --limit 50 --yes
wst p active YunLeFun --limit 20 --yes
```

5. For existing checkouts, update only when requested:

```bash
wst p active --limit 50 --update --yes
```

6. Before switching machines or cleaning up old checkouts, audit local Git
   repositories through the CLI:

```bash
wst p status
```

Use `--check` when a non-zero exit code should block a migration or cleanup:

```bash
wst p status --check
```

Use `--all` to include clean repositories. The audit scans down 6 directory
levels by default; use `--max-depth <number>` for unusually deep or intentionally
shallow checkout layouts:

```bash
wst p status --all
wst p status --max-depth 8
```

## Safety Rules

- Keep clone commands defaulting to dry-run in docs and examples.
- Keep status/audit commands read-only.
- Prefer `gh` for GitHub authentication and repository discovery.
- Prefer `ghq` layout under `~/repos/github.com/<owner>/<repo>`.
- Do not commit private or machine-specific repository names to this public repo.
- Do not expose private repository names in docs. In chat summaries, include
  only the detail needed for the user's current request.
- If `gh`, `git`, or network/auth fails, report the failing command and the next
  command the user should run; do not guess repository lists.
- Keep deterministic machine-state changes in CLI/scripts, not only in this skill.

## Command Surface

Preferred commands:

```bash
workstation projects clone-active
workstation p active --limit 50
wst p active --limit 50
wst p status
wst p status --check
```

Compatibility remains available:

```bash
dotfiles projects clone-active
```
