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

## Software Center API

### Repository sources

Craft Hub can link this repository online and as a local checkout under one source.
Its local origin identifies the repository; users explicitly choose online or local
reading without pulling, changing branches or granting project execution trust.

Craft Hub statically parses the root `software.config.ts` directly, without a
build or JSON export. Keep `export const softwareGroups` as a literal array.
Type annotations, `as const` and `satisfies` are supported; imported values,
function calls, references and spreads cannot compute catalog data. Repository
code is never imported or executed by this reader.

Preview before saving a snapshot. Local mode reads current TS, including
uncommitted edits; online mode reads the chosen branch at a fixed commit. Failed
refreshes preserve cached data. Removing a source retains the builtin catalog and
personal favorites.

`software.config.ts` is the only editable catalog. Craft Hub maintainers copy a
validated TS snapshot using `pnpm software-catalog:sync /path/to/workstation/software.config.ts`
for offline browsing without Workstation installed. Connected plugins use the
API below for current machine state and management operations.

Workbenches such as Craft Hub can reuse `software.config.ts` through a separate,
versioned API instead of maintaining another catalog:

```bash
printf '%s\n' '{"version":1,"operation":"catalog"}' | workstation software-json
```

Successful responses use `{ "ok": true, "result": { "version": 1, ... } }`.
Entries contain localized names, categories, official sites, optional download
and source-repository links, descriptions, installation methods, `canInstall`
and `canOpen`. Products
without a published source repository omit that link.

`catalog` checks declared apps in standard macOS Applications directories and
executable files in absolute PATH entries and known installation directories,
without running them. Codex CLI detection also includes native binaries inside
official Codex / ChatGPT apps. Entries whose installation cannot be verified
return `unknown`.
`not-detected` does not prove an app is absent, and detecting VS Code does not
prove an extension is installed.

The catalog includes the verified magpie app and source repository, Orca,
VS Code, CodeBuddy CN and the separate CodeBuddy VS Code extension download.
The following v1 operations support selected-software installation:

| Operation | Additional request fields | Result |
| --- | --- | --- |
| `preview` | Unique `softwareIds: string[]`, at most 50 | An immutable plan valid for 30 minutes with install, skip or manual items and Homebrew prerequisites |
| `install` | `planId: string, confirmed: true` | Starts a detached worker and returns a durable run; submitting the same plan returns the same run |
| `runs` | None | The latest 20 runs and their logs |
| `run` | `runId: string` | One durable run |
| `cancel` | `runId: string` | Requests cancellation; state remains `cancelling` until installer processes stop |
| `open` | `softwareId: string` | Opens a freshly detected declared application |

Running items optionally include `progress`, with a `phase` of `preparing`,
`downloading` or `installing`. Download `percent` (0–100) comes from Homebrew's
observed file sizes or curl's progress; `resource` identifies the current file.
Dependencies have separate file percentages, not an overall plan percentage.
Unknown totals omit `percent`. On macOS an output terminal enables Homebrew's
live progress while the worker still starts the installer directly, owns its
process group and forwards no interactive input. Installation clears download
percentages; success still requires exit zero and fresh application detection.
Terminal states clear progress. Persisted progress survives client refreshes;
older records without this optional field remain valid.

Automatic installation supports declared Homebrew casks and formulas on macOS.
It never executes `installCommand`. Each item is checked again before installing;
existing software is skipped, and the worker never calls `brew upgrade`.
Homebrew auto-update, automatic upgrades of existing packages, upgrade/reinstall
checks for installed dependents, and cleanup are disabled. Required dependencies
of the selected software are still handled by Homebrew. Exit zero only counts as success when
the declared app or executable is detected afterward. Missing Homebrew, manual
downloads, App Store login, and administrator interaction require user action.
After automatic items finish, remaining manual items leave a run in `waiting`.

Plans and runs are saved in the local Workstation state directory, outside the
configuration repository (`~/Library/Application Support/Workstation/software-v1`
on macOS). Each item retains the latest 16 KiB of logs, redacted as complete lines
before persistence. Interrupted runs do not restart automatically. Retry failed
or interrupted items by creating and explicitly confirming a new preview.
Cancellation can leave partial downloads or installations; refresh detection
before retrying.

Failure envelopes use `{ "ok": false, "code": "...", "error": "..." }` with fixed
codes such as `PLAN_STALE`, `PLAN_EXPIRED`, `INSTALL_BUSY`, `NOT_FOUND`,
`CONFIRMATION_REQUIRED` or `UNAVAILABLE`. Raw request content and internal
diagnostics are not echoed.

## Quick Commands

List known software ids:

```bash
pnpm software list
```

Open selected official download pages:

```bash
pnpm software:open raycast feishu wetype microsoft-todo ima
```

Fast-install Raycast, Feishu, and Microsoft To Do; keep WeType and ima on the
official download pages:

```bash
brew install --cask raycast feishu
brew install mas
mas install 1274495053
pnpm software:open wetype ima
```

Prefer the official WeType installer over the Homebrew cask so the WeChat Input
Method site controls the current macOS package.

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
