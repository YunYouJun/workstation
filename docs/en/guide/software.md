<script setup>
import SoftwareCatalog from '../../.vitepress/theme/components/SoftwareCatalog.vue'
</script>

# Software

This page lists common fresh-machine applications. The download links point to
official project pages, while repeatable installs should use Homebrew manifests
or the thin helper script in this repository.

## Install Strategy

- Use `Brewfile` for terminal foundations and daily CLI tools.
- Use `Brewfile.apps` for optional desktop applications.
- Keep download links for apps that need manual review, account setup, or
  license checks.
- Keep one-off experiments out of the manifests until they become part of daily
  work.

## Interactive Catalog

<SoftwareCatalog />

## Quick Commands

List known software ids:

```bash
pnpm software list
```

Open selected official download pages:

```bash
pnpm software:open microsoft-todo vscode neteasemusic qq wechat codex chrome raycast feishu
```

Show install status from the shared software catalog:

```bash
pnpm software:status
pnpm software:missing
```

Check install state before changing the machine:

```bash
pnpm software:check --core
pnpm software:check --apps
```

Install the terminal foundation:

```bash
pnpm software:install --core
```

Install optional desktop apps:

```bash
pnpm software:install --apps
```

`Brewfile.apps` also includes Mac App Store apps through `mas`, so sign in to
the App Store before installing those entries.

Install both manifests:

```bash
pnpm software:install --all
```

## Skill vs Script

A Codex skill can help operate or document the setup flow, but it is not the
best source of truth for machine state. Scripts and package-manager manifests
are better because they are versioned in the repository, reviewable in pull
requests, and safe to rerun.

Use skills for orchestration and maintenance notes. Use `Brewfile`,
`Brewfile.apps`, and `pnpm software:*` commands for actual installs. See
[Codex Skills](./codex-skills.md) for when to use a skill, local script, or
plugin.
