# APM Alignment Design

Date: 2026-07-18

## Outcome

Use APM as the only source of truth for public, portable agent dependencies.
Workstation keeps only capabilities that APM does not own: chezmoi-based machine
bootstrap, private overlay policy, 1Password materialization, inventory-only
sources, and Codex-specific configuration fragments.

There is no compatibility wrapper for the removed public Skills or MCP scripts.
Users call APM directly for the lifecycle APM owns.

## Ownership

### APM owns

- Public and portable Skills.
- Standard MCP server declarations.
- Git dependency resolution and downloads.
- Target-specific deployment, including the converged `.agents/skills` path.
- Direct and transitive dependency locking.
- Updates, frozen installs, content hashes, and audit/drift checks where the
  selected APM scope supports them.

### Workstation owns

- Distribution of `~/.apm/apm.yml` and `~/.apm/apm.lock.yaml` through chezmoi.
- Installation of the APM CLI through the core Brewfile.
- Private overlay validation and allowlisted local reads.
- Private local Skill installation that must not be declared in the public APM
  manifest.
- Codex-only MCP TOML fragments that are not portable APM MCP declarations.
- 1Password materialization, secret file restoration, and inventory-only inputs.

## Files and data flow

The repository source tree contains:

```text
home/dot_apm/apm.yml
home/dot_apm/private_apm.lock.yaml
```

Chezmoi maps these files to:

```text
~/.apm/apm.yml
~/.apm/apm.lock.yaml
```

The `private_` prefix is chezmoi source-state metadata: APM writes the global
lockfile with mode `0600`, so chezmoi preserves that mode while still deploying
the target as `~/.apm/apm.lock.yaml`. It does not mean the lockfile contains
private dependencies.

The normal public dependency flow is:

```text
workstation checkout
  -> chezmoi apply
  -> apm install --global --frozen
  -> ~/.agents/skills and supported global MCP client configs
```

The explicit update flow is:

```text
apm update --global
  -> review changes
  -> chezmoi re-add ~/.apm/apm.yml ~/.apm/apm.lock.yaml
  -> commit reviewed manifest and lock changes
```

The private flow remains separate:

```text
private overlay manifest
  -> wst private apply
  -> allowlisted local Skills under ~/.codex/skills
  -> Codex-only managed TOML block under ~/.codex/config.toml
```

Public and private Skills use separate roots deliberately. A public Skill ID
must not also be installed by the private overlay.

## Module and seam design

APM itself is the external Module for public dependencies. Its CLI is the
Interface and process execution is the seam. Workstation does not add a shallow
`wst agents` pass-through Module.

`wst private apply` remains the Interface for private state. Its implementation
will call private Skill and Codex MCP helpers in-process instead of spawning the
deleted public scripts through pnpm. Tests exercise observable filesystem
results through `wst private apply`.

## Removal scope

Remove:

- `config/codex-tools.manifest.json` as a public desired-state manifest.
- `codex-skills.config.ts`.
- `codex-skills.inventory.md`.
- `codex-mcp.toml` as an empty public fragment.
- `scripts/codex-skills.ts`.
- `scripts/codex-mcp.ts`.
- Root `skills:*` and `mcp:*` package scripts.
- Documentation teaching the removed commands or dual-manifest model.

Keep the private overlay schema and private manifest shape in this phase. Its
Skill and MCP fields describe private-only operations and are not a competing
public dependency manifest.

## Migration behavior

The public `ui-ux-pro-max` dependency moves to the global APM manifest. The APM
lockfile records the resolved commit and deployed files.

Before the first real APM install, an existing legacy public copy at
`~/.codex/skills/ui-ux-pro-max` is moved outside all Skill discovery roots into
`~/.local/share/workstation/skills-archive/<timestamp>/`. The archive is kept
because the legacy copy may differ from the newly locked upstream version.

No private Skill directory is migrated automatically.

## Failure behavior

- A missing APM executable is reported by workstation doctor with the Brewfile
  installation command.
- A missing manifest or lockfile is a doctor error.
- `apm install --global --frozen` is the normal restore command and must fail on
  manifest/lock drift instead of resolving new state silently.
- Updates require the explicit `apm update --global` consent flow.
- A private overlay read outside its allowlist fails before any copy or config
  write.
- Private Skill and MCP application remains idempotent. A failed replacement
  restores the previous file or directory from its backup.

## Verification

- Unit/integration tests prove `wst private apply` installs local private Skills
  and private Codex MCP fragments without pnpm or the removed scripts.
- Doctor tests cover the APM manifest, lockfile, and executable.
- APM validates the committed manifest and generates the committed lockfile.
- `apm install --global --frozen` verifies global replay. APM v0.25.0 does not
  expose a global mode on `apm audit`; do not run project-scope audit from
  `~/.apm`, because it resolves deployed paths relative to the wrong root.
- Repository lint, typecheck, tests, build, and docs build must pass.
