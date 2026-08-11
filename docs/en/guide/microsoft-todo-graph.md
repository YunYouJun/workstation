# Microsoft To Do: MCP and Graph client

## Current decision

Use MCP for routine Microsoft To Do operations from Codex instead of wrapping tool instructions in a dedicated Skill. Workstation pins `@softeria/ms-365-mcp-server@0.140.0` as an optional init task and limits Graph resource access to To Do list/get/create/update tools with delegated `Tasks.ReadWrite`. Delete tools and non-To Do Microsoft 365 resources such as mail, calendar, and files are not exposed. The server still provides local login, verification, account-selection, and account-removal helpers. This workstation uses a personal Microsoft account, so the tenant is pinned to `consumers` to prevent later refresh-token failures through the `common` authority.

Preview the change, apply it to the current user's Codex config, and inspect the result:

```bash
workstation init codex.microsoft-todo-mcp
workstation init codex.microsoft-todo-mcp --yes
codex mcp get microsoft-todo
```

Open a new Codex task after configuration so the client reloads its MCP servers. Follow the Microsoft sign-in prompt on the first To Do tool call; OAuth tokens remain local. The `npx` command and pinned npm version make the same configuration reusable on macOS, Linux, and Windows.

APM remains the source of truth for public Skills and project-scoped MCP servers. APM 0.26 currently installs self-defined MCP servers only at project scope, so it cannot generate this user-level Codex configuration directly. The explicit workstation init task therefore manages this global server and replaces only `mcp_servers.microsoft-todo`, never the complete `~/.codex/config.toml`.

The existing local Graph client remains available as the more auditable fallback for scripts, dry-run updates, and deletion with a second confirmation. Its implementation lives in [`packages/microsoft-todo-graph`](https://github.com/YunYouJun/workstation/tree/main/packages/microsoft-todo-graph).

## Why this split

- MCP is the agent execution interface and is discovered directly by compatible clients. Add a Skill only when a fixed workflow, extra validation, or an approval policy becomes necessary.
- Microsoft Graph provides first-party To Do list/task APIs. Delegated `Tasks.Read` is sufficient for reads; this MCP uses `Tasks.ReadWrite` to support creation and updates.
- Startup arguments narrow both tools and scopes at the server boundary, and the package is pinned instead of following `latest`.
- The local Graph CLI still permits only `/v1.0/me/todo/` and retains separate write, `--apply`, and deletion gates.

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
