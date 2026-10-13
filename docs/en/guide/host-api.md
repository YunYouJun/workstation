# Host API v1

`workstation host-json` reads one JSON request from stdin and writes one JSON envelope to stdout. It provides protocol negotiation and read-only diagnostics to Craft Hub or other local GUI clients. Configuration writes, Git operations, software installation and application opening continue to use the existing CLI protocols.

```sh
printf '%s\n' '{"version":1,"operation":"capabilities"}' | workstation host-json
printf '%s\n' '{"version":1,"operation":"doctor"}' | workstation host-json
```

`capabilities` and `doctor` requests contain exactly `version` and `operation`; `validate-projects` additionally accepts one `content` string. The host must invoke an installed, trusted executable with `shell: false`; requests cannot choose paths, commands or dependency probes. The CLI accepts at most 1 MiB of UTF-8 stdin. Responses are `{ "ok": true, "result": ... }` or `{ "ok": false, "code": "...", "error": "fixed display-safe guidance" }`. Invalid JSON and extra fields return `INVALID_REQUEST`, other protocol versions return `UNSUPPORTED_VERSION`, unknown operations return `UNSUPPORTED_OPERATION`. Unexpected failures return `UNAVAILABLE` without parser excerpts or subprocess output. Rejected requests exit nonzero.

## Capability negotiation

`capabilities` returns `{ version: 1, cliVersion, platform, protocols, operations }`. Current `protocols` are `{ host: 1, configuration: 1, software: 1, repositoryValidation: 1 }`; `platform` uses Node.js names such as `darwin`, `linux` and `win32`.

`operations.configuration` contains `inspect`, `preview`, `apply`, `restore`, `history`, `git-status`, `git-fetch`, `git-commit` and `git-publish`. `operations.software` contains `catalog`, `preview`, `install`, `runs`, `cancel` and `open`; `operations.doctor` and `operations.repositoryValidation` are standalone capabilities.

Capabilities describe the CLI's implemented platform support, not whether dependencies are installed. Dependency readiness comes from `doctor`, and operation-specific previews retain their own checks. `git-fetch`, `git-commit` and `git-publish` describe the respective `configuration` protocol `git-action` values.

| Operations | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Doctor, configuration inspection/history/Git status, software catalog/runs | Supported | Supported | Supported |
| Configuration preview/apply/restore and Git actions | Supported | Supported | Unavailable |
| Software preview | Supported | Manual installation preview | Manual installation preview |
| Software install/open | Supported | Unavailable | Unavailable |
| Software cancel | Supported | Supported | Unavailable |

Unavailable operations return `{ "supported": false, "reason": "unsupported-platform" }`. GUI clients should hide or disable actions using this capability map and keep their own confirmation/trust requirements. An older CLI without `host-json` has unknown capabilities: clients must explicitly show the compatibility state and avoid inferring support from the GUI's operating system. Windows write support is intentionally conservative until executable entry points and platform-specific paths are adapted and tested.

## Structured doctor

`doctor` returns `{ version: 1, checkedAt, checks, summary }`. Each check is `{ code, severity: "info" | "warning" | "error", message, path? }`; `summary` contains `errors`, `warnings` and `passed` counts. `checkedAt` is an ISO UTC timestamp. A missing source or dependency is an accepted diagnosis, so the envelope remains `ok: true` even when `summary.errors` is nonzero. Request processing failures remain separate from diagnosed configuration problems.

The terminal `workstation doctor` and `workstation df doctor` render this same inspection report. They exit nonzero when the report contains errors.

Checks cover `.chezmoiroot`, the home source tree, APM YAML source syntax, the existing declared dotfile sources, unresolved local secret placeholders, an optional private manifest and dependency readiness for Git, chezmoi, APM and gitleaks. Unix also checks Zsh; macOS checks Homebrew. macOS-only client sources are skipped on other platforms. YAML checks establish parseability, not APM installation or successful Agent loading. The private manifest check validates the declaration; it does not restore secrets or execute its operations.

Diagnostics never echo `.chezmoiroot` contents, YAML/JSON errors, secret names or values, stdout or stderr. Text reads are limited to 1 MiB per file, private-manifest fallback discovery is limited to 512 directories, 4096 entries and 1 second, each executable probe has a 1-second timeout and a 64 KiB output limit, and reports contain at most 200 checks. Probe failures produce fixed warnings. Excess source/check counts add `doctor-report-truncated`; private discovery exceeding its scan limits returns `private-manifest-unavailable`. Neither implies complete coverage. No state directories, lock files or configuration are written by inspection.

## Project manifest content validation

`{ "version": 1, "operation": "validate-projects", "content": "repositories: []\n" }` validates only the supplied YAML text. The result is `{ version: 1, valid, issues: [{ code, path, message }], summary? }`. Format problems retain `ok: true` and use `valid: false`; valid summaries contain repository/group counts only. The capability `repositoryValidation: 1` is supported on every platform.

Validation shares the semantic parser used by `projects manifest --validate`. Existing versionless manifests, keyed groups, top-level repositories, inherited host/root fields and URL/path aliases remain supported. It does not read machine configuration, expand HOME, probe dependencies, access the network, execute Git or create caches/state. Duplicate detection uses lexical paths; execution still requires its normal preview and platform path checks.

UTF-8 content is limited to 256 KiB, with at most 10000 structure nodes and 32 levels and bounded YAML alias expansion. Custom tags, cycles and invalid YAML are rejected. Reports contain at most 100 issues, with fixed field/index paths such as `groups[0].repositories[1]` instead of private group names, URLs, credentials or parser excerpts. `issue-limit` explicitly marks truncated reports.

`schemas/projects.schema.json` is generated from the schema export in `packages/cli/src/projects-manifest.ts`. Run `pnpm projects:schema` to update it or `pnpm projects:schema:check` to detect stale output; CI performs the same check. The editor schema provides structure assistance; the shared CLI parser owns host inheritance, target inference and duplicate detection.
