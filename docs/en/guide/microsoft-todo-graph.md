# Microsoft To Do Graph client

This repository uses a local, least-privilege Microsoft Graph client to read and update Microsoft To Do. It calls the official Microsoft API directly instead of relying on a community MCP intermediary, and uses Microsoft's `@azure/msal-node` library for device-code authentication.

The implementation lives in [`packages/microsoft-todo-graph`](https://github.com/YunYouJun/workstation/tree/main/packages/microsoft-todo-graph). OAuth tokens stay in a local cache and are never written to the repository or printed to the terminal.

## Why this approach

- Microsoft Graph provides first-party To Do list/task APIs. Delegated `Tasks.Read` is sufficient for reads; task updates require `Tasks.ReadWrite`.
- Device-code authentication works well for a local CLI and does not require storing a client secret in the repository.
- Unlike a general-purpose MCP server, this client allows only `/v1.0/me/todo/`, keeping its reachable API surface easy to audit.
- Separate write and delete gates prevent an ordinary read operation from mutating tasks accidentally.

## Install and authorize

Run from the repository root:

```bash
pnpm install
pnpm todo:auth
```

The terminal prints a sign-in URL and a one-time code. Keep the command running while completing sign-in in the browser. Device-code authentication requires the CLI to continue polling; terminating it early can leave the browser flow complete without a local token.

For a personal Microsoft account, select the `consumers` tenant explicitly:

```bash
MS_TODO_TENANT=consumers pnpm todo:auth
```

The default is the public-client ID used by Microsoft Graph command-line tooling. For long-term use or an organization account, register an Entra public-client app that you control and configure it explicitly:

```bash
export MS_TODO_CLIENT_ID="YOUR_ENTRA_APP_CLIENT_ID"
export MS_TODO_TENANT="consumers"
```

Use the same tenant and client ID for later commands.

## Read tasks

```bash
pnpm todo:status
pnpm todo:lists
pnpm todo:tasks -- --open
pnpm todo:tasks -- LIST_ID
```

Task bodies are omitted by default. Request them only when notes are needed:

```bash
pnpm todo:tasks -- LIST_ID --include-body
```

These read scripts reuse the authorized `Tasks.ReadWrite` scope but execute fixed GET operations only. The underlying configuration still defaults to `Tasks.Read`; non-GET requests remain blocked unless `MS_TODO_WRITE=1` is present.

## Update and complete tasks

Without `--apply`, mutation commands print a preview and send no Graph write request:

```bash
MS_TODO_WRITE=1 pnpm todo -- update LIST_ID TASK_ID --title "New title"
MS_TODO_WRITE=1 pnpm todo -- complete LIST_ID TASK_ID
```

Apply the change only after checking the preview:

```bash
MS_TODO_WRITE=1 pnpm todo -- update LIST_ID TASK_ID --title "New title" --apply
MS_TODO_WRITE=1 pnpm todo -- complete LIST_ID TASK_ID --apply
```

Updates also support `--importance`, `--status`, `--due YYYY-MM-DD`, and `--clear-due`.

## Delete a task

Deletion requires all three controls: the explicit delete capability, `--apply`, and an exact task-ID confirmation.

```bash
MS_TODO_WRITE=1 MS_TODO_ALLOW_DELETE=1 pnpm todo -- delete LIST_ID TASK_ID \
  --confirm-id TASK_ID --apply
```

Task-list deletion is not implemented.

## Security boundary

- The URL allowlist accepts only requests under `https://graph.microsoft.com/v1.0/me/todo/`, including Graph pagination URLs.
- Non-GET requests require `MS_TODO_WRITE=1`.
- PATCH requires `--apply`.
- DELETE additionally requires `MS_TODO_ALLOW_DELETE=1` and an exact `--confirm-id` match.
- The token cache defaults to `~/Library/Application Support/Codex/microsoft-todo-graph/token-cache.json`, with `0700` directory and `0600` file permissions.
- Requests time out after 20 seconds and enumeration is capped at 500 items per invocation.
- The client does not print access or refresh tokens and cannot reach Graph resources outside To Do.

Sign out and remove the local cache:

```bash
pnpm todo -- logout
```

## Resolved failures

### Browser sign-in completes, but the client remains unauthenticated

Device-code authentication is a polling protocol. Keep `pnpm todo:auth` alive until it prints `authenticated: true`.

### A Graph request loses `/v1.0`

Resolving `/me/todo/...` directly against `https://graph.microsoft.com/v1.0` replaces the base pathname. The client joins relative paths explicitly, then validates the final origin and `/v1.0/me/todo/` prefix.

### Read commands ask for sign-in after write consent

MSAL looks up cached tokens by scope. The `todo:status`, `todo:lists`, and `todo:tasks` scripts request the already-authorized `Tasks.ReadWrite` scope so they reuse the same cache; their command surface still exposes reads only.

## Official references

- [Microsoft Graph To Do API overview](https://learn.microsoft.com/graph/api/resources/todo-overview?view=graph-rest-1.0)
- [List To Do tasks](https://learn.microsoft.com/graph/api/todotasklist-list-tasks?view=graph-rest-1.0)
- [Update todoTask](https://learn.microsoft.com/graph/api/todotask-update?view=graph-rest-1.0)
- [Microsoft identity platform device-code flow](https://learn.microsoft.com/entra/identity-platform/v2-oauth2-device-code)
