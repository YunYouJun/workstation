# Configuration API v1

`workstation configuration` reads one JSON request from stdin and writes one JSON envelope to stdout. The CLI is the only filesystem and Git implementation. Craft Hub uses the same interface through a trusted local subprocess with `shell: false`.

```sh
printf '%s\n' '{"version":1,"operation":"inspect"}' | workstation configuration
```

Replies are `{ "ok": true, "result": { "version": 1, ... } }` or `{ "ok": false, "error": "display-safe message" }`. Never embed raw configuration in command arguments. Exit status is nonzero on rejected requests. An accepted `apply` can return `state: "failed"`; callers must display it and recovery history rather than treating receipt as success.

## Skills audit and provenance

`inspect` now adds optional `client`, `scope`, `manager` and `provenance: { label, path? }` metadata to configuration items, plus a display-safe `skillsAudit` report. The report includes `state`, `checkedAt`, summary counts and bounded `{ code, severity, message, paths }` findings from the existing Skills audit. Global inspection excludes the CLI working directory; project Skills are inspected only when the host supplies its registered `projectPath`.

APM, Skills CLI and Workstation ownership comes from their existing records. Native plugin assets and external links stay read-only; unknown ownership is not assigned by a matching name. Observations describe files and client destinations, not successful loading by a running Agent. A failed audit returns its own error state while configuration inventory and recovery remain available.

User-maintained private Skill trees retain the existing review workflow. Their plans freeze ownership controls as well as file revisions. Application and recovery reject a later installer takeover, including when the installer only creates a lock and leaves file content unchanged. Older recovery plans also check current Skill ownership before restoring. Installer locks are never rewritten by configuration inspection or synchronization.

These additions keep protocol version 1. Callers using an older v1 CLI should treat missing audit fields as unsupported, not as an empty successful audit.

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

## Multiple sources and encrypted backup targets

The additive v1 operations `repositories`, `repositories-update` and `backup-preview` are advertised by `host-json`. Older clients keep their existing operations. The registry is device-local, under the configuration state directory; checkout paths, ownership selections and passphrase variable names are never exported as shared configuration.

`inspect` includes `registry` and each managed item's `sourceId`, `audience` and `resource`. A source is an existing Git checkout with a stable ID, a display name, a `dotfiles` or `overlay` format and a content audience (`public`, `personal`, or `work`). Format and repository visibility are independent. Multiple overlay sources use the existing `config/sync-manifest.json` format. Existing public/private bindings are available without creating a registry on read; the legacy private source starts `unclassified` and must be classified before it can join a backup target. Reclassifying a configured source, changing its root or format requires a new source ID.

Send `{ version: 1, operation: 'repositories-update', registry: { revision, action: 'save-source', source } }` to register or edit a source. The registry revision is returned by `inspect` or `repositories`. Other registry actions are `remove-source`, `save-target`, `remove-target` and `claim` (a reviewed `resource` and `sourceId`). Registration never applies configuration, grants execution trust, commits or contacts a remote. Removing a registration never deletes a checkout. Sources referenced by backups or ownership records must be disabled instead of removed.

Configuration writes use the item's original source; they cannot select a different destination. Duplicate declarations of the same local file or MCP server produce `ownership-conflict`. An explicit owner can resolve competing declarations in the same audience. Ownership cannot transfer between public, personal and work audiences. Successful application remembers ownership even if the source is later disabled. Split declarations when different audiences need the same local destination; there is no implicit override order. Unknown local MCP servers are not automatically assigned to an arbitrary registered overlay.

### Backup targets

A target has `id`, `name`, `audience` (`personal` or `work`), `driver`, optional `root`, repository-relative `directory`, and `sourceIds`. An omitted root reserves a target without creating a directory or repository. Bind it later to an existing local Git checkout. Sources and backup targets use separate checkouts. Target identities and directories are stable; use a new target for a different scope or destination.

- `driver: 'workstation'` encrypts declared, managed source files. Set `keyEnvironment` to the name of an environment variable supplied to the local backend by your secret manager. The passphrase itself is never accepted through the UI, stored in the registry or included in Git. It must contain at least 16 characters; use a strong generated value and retain it outside the repository.
- `driver: 'external'` records a target managed by its original application. It has no Workstation file, encryption or Git write actions. Application-specific backups retain their original formats and restore workflows.

Personal and work sources cannot share a backup audience; public sources may be included in either. Different private audiences cannot share one backup checkout. Workstation writes only `<directory>/configuration.backup.json`, using AES-256-GCM with a fresh nonce and salt and fixed scrypt parameters (N=32768, r=8, p=1). The authenticated versioned payload contains stable source IDs and repository-relative paths, with a 1 MiB plaintext limit. This is a small configuration archive, not an application database or a full-machine backup. Manifests and source checkouts must already be available on the recovery device with matching source IDs; the archive does not bootstrap them.

Use `{ version: 1, operation: 'backup-preview', targetId, revision, action: 'save' | 'restore' }`, then apply the returned plan through the existing `apply` operation. `save` reads source files, not unexported HOME changes. First export any local edits to their owning source. A changed or previously unseen archive blocks replacement unless the preview explicitly includes `resolution: 'replace'`. The old encrypted file remains in local recovery history. A wrong key, tampered archive, changed scope, unknown source or undeclared/path-traversing destination blocks restoration.

Restoration previews source-file changes and retains the previous files in the protected local journal. It does not apply them to HOME; review that as a separate configuration plan. Source writes still require the secret scanner. Passphrases must be available in the backend environment, including when using a desktop application launched outside a terminal.

### Conflicts and recovery

Plans freeze registry, manifest and file revisions. Changes made after preview reject application. Recovery refuses to overwrite subsequent independent file edits, preserves unrelated source baselines, and journals each restored file so interrupted recovery can be retried. Local recovery history may contain plaintext configuration and remains protected outside Git. Ownership records are retained during recovery to prevent accidental cross-audience adoption.

Git remains explicit: review and commit selected managed files, then publish. Targets use repository IDs `target:<id>`. New empty target checkouts support their first commit; configure an upstream before transport. Existing fast-forward-only fetch and scanned, non-forced push remain unchanged. Branch divergence retains both histories and requires reconciliation before another publish. No automatic background sync or cross-repository atomic transaction is implied.
