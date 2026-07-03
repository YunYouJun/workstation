# Public Codex Skills Inventory

Generated: 2026-07-03

This file records the public-safe portion of the local skills inventory. It is
an inventory, not an install manifest. Promote a skill into
`config/codex-tools.manifest.json` only after its reproducible upstream source is
known.

Private, internal, project-specific, or credential-bearing skills are omitted
from this public repository and tracked in the private dotfiles overlay instead.

## Sources Scanned

| Source | Top-level skills | Notes |
| --- | ---: | --- |
| `~/.codex/skills` | 15 | User-local Codex skills; `.system` excluded |
| `~/.codex/skills/.system` | 5 | Codex system skills; excluded from this inventory |
| `~/.agents/skills` | 73 | User-local agent skills after duplicate cleanup |

## Already Managed

These are already represented by `config/codex-tools.manifest.json`.

```text
ui-ux-pro-max
```

## Public Candidates

These local skill IDs look safe to mention in a public workstation inventory.
They still need source review before becoming reproducible install entries.

```text
agent-browser
agents-sdk
algorithmic-art
antfu
brand-guidelines
canvas-design
claude-api
cloudbase
cloudflare
cloudflare-email-service
component-generator
doc-coauthoring
durable-objects
edgeone-pages-deploy
edgeone-pages-dev
find-skills
frontend-design
generate-npm-readme
git-archaeologist
hatch-pet
mcp-builder
mockery
nuxt
pinia
pnpm
sandbox-sdk
setup-vitepress-docs
skill-reflection
slack-gif-creator
slidev
test-helper
theme-factory
tsdown
turborepo
turnstile-spin
unocss
vite
vitepress
vitest
vue
vue-best-practices
vue-router-best-practices
vue-testing-best-practices
vueuse-functions
web-artifacts-builder
web-design-guidelines
web-perf
webapp-testing
weui-icons
workers-best-practices
wrangler
yunyoujun
```

## Cleanup Candidates

These public-safe local skill IDs were duplicated in both `~/.agents/skills` and
`~/.codex/skills` with identical directory contents. On 2026-07-03, the
`~/.agents/skills` copies were archived and the `~/.codex/skills` copies were
kept as the Codex canonical copies.

```text
agents-sdk
cloudflare
cloudflare-email-service
durable-objects
sandbox-sdk
turnstile-spin
web-perf
workers-best-practices
wrangler
```

Archive path:

```text
~/.local/share/workstation/skills-archive/20260703-183135/agents-duplicates
```

`ui-ux-pro-max` previously existed in both roots with different contents. The
upstream source configured by `config/codex-tools.manifest.json` was reinstalled
into `~/.codex/skills/ui-ux-pro-max`, and the old `~/.agents/skills` variant was
archived under the same archive path as `ui-ux-pro-max-agents-old`.

## Omitted From Public Inventory

Do not list internal WOA, TAPD, OA Pages, LiteApp, Orange CI, resdeploy,
red-envelope, local release, or credential-adjacent skills here. Keep those in
the private dotfiles inventory and only promote sanitized, generally useful
workflows back into this repository.
