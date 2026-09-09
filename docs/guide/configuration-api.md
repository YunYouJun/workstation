# Configuration API v1

`workstation configuration` reads one JSON request from stdin and writes one JSON envelope to stdout. The CLI is the only filesystem and Git implementation. Craft Hub uses the same interface through a trusted local subprocess with `shell: false`.

```sh
printf '%s\n' '{"version":1,"operation":"inspect"}' | workstation configuration
```

Replies are `{ "ok": true, "result": { "version": 1, ... } }` or `{ "ok": false, "error": "display-safe message" }`. Never embed raw configuration in command arguments. Exit status is nonzero on rejected requests. An accepted `apply` can return `state: "failed"`; callers must display it and recovery history rather than treating receipt as success.

## Operations

- `inspect`: read-only item inventory. Optional `projectPath` is read-only; a host must derive it from its trusted registry. Each item includes stable ID, source/target paths, origin, owner, status, opaque revision, redacted comparison and changed fields.
- `preview`: `decisions: [{ id, revision, choice, fields? }]`. Choices are `local` (write source), `source` (write local), `merge` (write both), `skip`. A merge requires every differing field or aligned line to have an explicit `local`/`source` selection. The reply is a plan ID and the exact changed paths/directions/deletions.
- `apply`: `planId`. Validates the manifest, both file versions, baseline and path safety again, journals backups, scans source exports and writes safely. Repeat application of a successful plan is idempotent.
- `history`: returns plan IDs, state and safe errors. It never returns raw backups.
- `restore`: `planId`. Restores only unchanged plan outputs; subsequent edits or a later baseline prevent recovery. A partially applied or interrupted plan retains its journal.
- `git-status`: public/private repository IDs, dirty paths, ahead/behind counts, divergence, review revision, outgoing commit IDs and changed-line counts. Unknown upstream is `null`, never zero.
- `git-action`: `repository`, `revision`, and `action` (`fetch`, `commit`, `publish`). Commit also requires explicit managed `paths` and `message`. Existing staged work blocks it. Git operations do not apply HOME files. Publishing reuses the existing scanned non-forced transport.

## Ownership and state

The existing workstation dotfile map covers global Codex instructions, Zsh, Starship and Ghostty. The connected private manifest supplies MCP fragments and locally maintained skill directories. Other local skills are inventoried as unmanaged; symlinks, system roots, external installer lock entries, remote-installed skills and Codex plugin cache remain installer-managed. Declare a user-owned local skill through the existing private manifest before synchronizing it; no scripts belong in that repository.

The first comparison without a successful v1 baseline is `first-adoption`, not a three-way conflict. States with a baseline are `synced`, `local-modified`, `source-modified` and `conflict`. Read failures are explicit error rows. Global synchronization excludes project overrides, login/cache state and execution-approval fields; deleting a server with retained approval fields is blocked.

State and recovery journals live under `~/.local/state/workstation/configuration-v1`, in mode-0700 directories with mode-0600 files, outside Git. Raw local backups can contain credentials and must stay local. `DOTFILES_HOME`, `DOTFILES_REPO_ROOT`, `WORKSTATION_PRIVATE_MANIFEST` and `CODEX_HOME` select the existing sources. Tests use isolated HOME directories and temporary bare remotes.

## Deliberate limits

- Display redaction is conservative: literal prose and unknown values are withheld. Known MCP commands, booleans, timeout values, secret references and credential-free URL hosts can be shown. `!` identifies differing aligned text lines; `=` identifies matching lines. Display output is never used as write input.
- Text merge is manual selection of aligned line positions, not a semantic merge or an inferred three-way merge. Review insertions/deletions carefully. TOML and Zsh syntax are checked before a plan is accepted; generic skill documents and Ghostty configuration do not have full semantic validation.
- A missing declared MCP fragment is a scan error. Deletion of an individual server is supported and remains tracked by the baseline.
- Source export and commit require `gitleaks`; unavailable or failing scans block writes/publication. Repository fetch requires a clean checkout and follows existing fast-forward policy. New upstream setup, rebase, divergence resolution and signing remain normal Git operations.
- Locks coordinate workstation processes. External editors do not honor them; versions are checked again immediately before replacement. Multi-file operations are recoverable journaled operations, not an OS-level transaction. A crash can leave `applying` state. Verify that a crashed process has stopped before removing its existing workstation lock.
- Backups are retained for recovery; automatic pruning and cross-device backup migration are not implemented. CLI v1 must remain installed while a Host Plugin uses it.
