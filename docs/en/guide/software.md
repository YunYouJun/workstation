<script setup>
import SoftwareCatalog from '../../.vitepress/theme/components/SoftwareCatalog.vue'
</script>

# Software

This page lists common fresh-machine applications. Official-site links are for
product context; download-page links are for fast installs. Repeatable installs
should use Homebrew manifests or the thin helper script in this repository.

## Install Strategy

- Use `Brewfile` for terminal foundations and daily CLI tools.
- Use `Brewfile.apps` for optional desktop applications.
- Keep download links for apps that need manual review, account setup, or
  license checks.
- Keep one-off experiments out of the manifests until they become part of daily
  work.

## Interactive Catalog

<SoftwareCatalog />

Search or switch categories in the catalog to open download pages for the
current result set, or open an individual app's official site. Search accepts
multiple space- or comma-separated keywords. Use the commands below for terminal
batch operations.

## Quick Commands

List known software ids:

```bash
pnpm software list
```

Open selected official download pages:

```bash
pnpm software:open raycast feishu microsoft-todo ima
```

Fast-install Raycast, Feishu, and Microsoft To Do; keep ima on the official
download page until it has a stable package-manager path:

```bash
brew install --cask raycast feishu
brew install mas
mas install 1274495053
pnpm software:open ima
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
