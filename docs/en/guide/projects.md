# Projects

Project checkout automation should be explicit and safe. A public workstation
repo can describe common structure without exposing private work.

## Canonical Layout

Use the `ghq` directory model for local checkouts:

```text
~/repos/github.com/YunYouJun/workstation
```

Configure `ghq` once per machine:

```bash
git config --global ghq.root ~/repos
```

Check the current value:

```bash
git config --global --get ghq.root
```

Clone repositories through `ghq` when possible:

```bash
ghq get git@github.com:YunYouJun/workstation.git
cd "$(ghq list -p github.com/YunYouJun/workstation)"
```

This keeps the local path close to the remote URL and avoids private shorthand
such as `~/repos/gh/yyj`.

## Jump To Projects

Let `ghq` own reproducible checkout paths, and let `zoxide` handle daily
jumping.

Enter an exact repository:

```bash
cd "$(ghq list -p github.com/YunYouJun/workstation)"
```

After the first visit, `zoxide` learns the directory and can jump by keyword:

```bash
z workstation
z YunYouJun workstation
```

When a keyword matches multiple directories, use `zi` for interactive selection:

```bash
zi workstation
```

To choose from every checkout, combine `ghq` and `fzf`:

```bash
project="$(ghq list -p | fzf)" && cd "$project"
```

This split keeps project paths auditable and avoids committing private
shorthands, machine-local paths, or temporary aliases to the public repository.

## Active GitHub Repositories

Use the CLI to fetch and clone the most recently pushed repositories owned by
`YunYouJun`:

```bash
workstation projects clone-active
```

The command is a dry-run by default. Apply it explicitly after reviewing the
target paths:

```bash
workstation projects clone-active --yes
```

Configure how many active repositories to fetch:

```bash
workstation projects clone-active --limit 20
```

Shorter form:

```bash
wst p active --limit 20
```

Select repositories interactively before previewing or cloning:

```bash
wst p active --limit 50 -i
```

You can also set the script/default count, which works well in a shell profile
or machine-local config:

```bash
WORKSTATION_ACTIVE_PROJECT_LIMIT=20 pnpm projects:clone-active
```

Configure the project root:

```bash
workstation projects clone-active --root ~/repos
```

Update existing checkouts:

```bash
workstation projects clone-active --update --yes
```

Use HTTPS clone URLs:

```bash
workstation projects clone-active --https --yes
```

Include forks and archived repositories:

```bash
workstation projects clone-active --include-forks --include-archived
```

For script-style use, run the root package alias:

```bash
pnpm projects:clone-active
```

The implementation delegates repository discovery to `gh api graphql` and sorts
by `PUSHED_AT DESC`, which is closer to "recently active" than alphabetical or
created-time listings. Authenticate once with:

```bash
gh auth login
```

When `ghq` is installed and the primary `ghq.root` matches the requested
`--root`, the command uses `ghq get`. Otherwise it falls back to explicit
`git clone` targets under:

```text
~/repos/github.com/<owner>/<repo>
```

## Local Status Audit

Before switching machines or cleaning up an old machine, inspect local Git
repositories under `~/repos`:

```bash
workstation projects status
```

Short alias and script entry:

```bash
wst p status
pnpm projects:status
```

By default, only repositories that need attention are shown. The audit reports
uncommitted files, committed-but-unpushed work, stashes, missing upstreams, and
gone upstreams. Show every repository:

```bash
workstation projects status --all
```

The scan descends up to 6 directory levels by default. Increase it for deeper
checkout layouts, or lower it to constrain the audit:

```bash
workstation projects status --max-depth 8
```

For scripts or pre-migration checks, return a non-zero exit code when any
repository needs attention:

```bash
workstation projects status --check
```

## Manifest Pattern

Manifest mode can clone common projects from any Git host, including GitHub,
GitHub Enterprise, GitLab, `git.example.com`, or other internal sources. It also
defaults to dry-run; add `--yes` after reviewing the target paths:

When you do not want to remember manifest paths or group names, use the
interactive wizard. It lets you choose a local manifest, private configuration
repository, groups, and repositories, then prints a reusable command:

```bash
wst p manifest -i
wst p connect -i
wst p m -i
```

The wizard shows a compact local plan before selection. Each repository is
tagged as `new`, `exists`, `exists clean, will update`, or `needs attention`.
Repositories that will be skipped or need attention are left unselected by
default, so you can focus on actionable clones and clean updates first.

```bash
wst p manifest --file projects.local.yaml
wst p manifest --file projects.local.yaml --validate
wst p manifest --file projects.local.yaml --yes
```

You can also keep the manifest in a private configuration repository. The CLI
clones that repository into a local cache, then reads `projects.yaml`:

```bash
wst p manifest https://git.example.com/<user>/<config-repo>
wst p manifest https://git.example.com/<user>/<config-repo> --group common --yes
wst p m https://git.example.com/<user>/<config-repo> -g common --yes
```

You can also pass a remote YAML file URL directly. `raw` URLs are downloaded as
is; `blob` page URLs are converted to the matching `raw` URL:

```bash
wst p manifest https://git.example.com/<user>/<config-repo>/raw/main/projects.yaml -g common
wst p manifest https://git.example.com/<user>/<config-repo>/blob/main/projects.yaml -g common
```

Private raw/blob URLs must be directly accessible to `curl`; if the browser is
signed in but the command line receives a login-page HTML response, use
`--repo <git-url> --manifest <path>` instead.

To handle only part of a group, pass target repository names with
`--repository`. The interactive wizard also prints this copyable form after you
choose a repository subset:

```bash
wst p m --file projects.local.yaml -g common --repository git.example.com/example/service
```

If the manifest does not live at `projects.yaml` or `projects.yml` in the
configuration repository root, pass the internal path:

```bash
wst p manifest --repo https://git.example.com/<user>/<config-repo> --manifest workstation/projects.yaml
```

Private configuration repositories and remote manifest files are cached under
`~/.cache/workstation/project-manifests/`. Projects still clone into the
`~/repos/<host>/<repo-path>` layout. `group` is only a manifest selection and
organization mechanism; it does not become part of the target path. When the
primary `ghq.root` matches the target root and the target path matches the path
inferred from the clone URL, the CLI uses `ghq get`; otherwise it falls back to
explicit `git clone`.

Non-interactive `--update --yes` uses the same local safety checks. Dirty
repositories, repositories with unpushed work or stashes, missing upstreams,
gone upstreams, and existing non-Git paths are skipped with a reason instead of
being updated blindly.

Commit only a sample manifest to the public repo:

```text
projects.example.yaml
```

Keep private or machine-specific projects in:

```text
projects.local.yaml
```

`projects.local.yaml` is ignored by Git.

Manifest shape:

```yaml
groups:
  common:
    root: ~/repos
    host: git.example.com
    repositories:
      - name: github.com/YunYouJun/workstation
        url: git@github.com:YunYouJun/workstation.git
      - example/private-service
      - name: local-alias/private-service
        path: example/private-service
```

If an entry only has `name: git.example.com/<group>/<repo>`, the CLI infers an SSH
clone URL by default; with `--https`, it infers an HTTPS clone URL instead. For
entries that need both, define `sshUrl` and `httpsUrl`, and the command will
choose based on `--https`. You can also define `host` at the manifest or group
level and then list concise repository paths such as `example/private-service`.

When the local target path intentionally differs from the remote repository
path, use object entries with `name` for the local path and `path` for the
remote repository path. Those entries automatically avoid `ghq get` and use
explicit `git clone <url> <target>`, so ghq does not place the checkout at the
remote URL path instead.

`--validate` validates the manifest and exits without printing a clone preview.
The CLI checks manifest structure, field types, requested groups, shorthand
paths without `host`, clone URL/target path inference, and duplicate target
directories. Normal dry-runs and `--yes` writes run the same validation first.

## SSH Baseline

SSH keys, `~/.ssh/config`, and remote hostnames are machine-local configuration,
not public repository content. This repo documents the reusable shape only.

Generate a new GitHub SSH key:

```bash
ssh-keygen -t ed25519 -C "you@example.com"
cat ~/.ssh/id_ed25519.pub
```

Install a public key on a remote machine:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@example-host
```

Use explicit host entries for remote development machines so VS Code Remote
SSH, terminal sessions, and scripts share the same connection name:

```text
Host devbox
  HostName example-host
  User user
  PreferredAuthentications publickey
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
```

If the network only allows outbound 443, add a GitHub SSH fallback on port 443.
Do not keep stale hosts-file IP lists as the default way to reach GitHub:

```text
Host github.com
  HostName ssh.github.com
  Port 443
  User git
  IdentityFile ~/.ssh/id_ed25519_github
  IdentitiesOnly yes
```

Verify GitHub SSH:

```bash
ssh -T git@github.com
```

On macOS, enable "Remote Login" in System Settings -> Sharing before accepting
SSH connections to the machine. Do not commit real internal hostnames,
usernames, or ports to the public repository.

Temporary local SSH port forwarding:

```bash
ssh -L <local-port>:<remote-host>:<remote-port> <ssh-hostname>
```

A common example is forwarding a remote database port to localhost only:

```bash
ssh -L 3306:localhost:3306 user@example-host
```

Add `-fN` only when the tunnel should stay in the background. Use `-g` only when
other machines must be allowed to connect to the forwarded local port.

## Multiple Git Accounts and Source Isolation

When one machine talks to GitHub, GitHub Enterprise, company GitLab, or other
internal Git hosts, keep commit identity separate from remote authentication:

- Select commit identity with Git `includeIf` rules based on checkout paths.
- Select authentication accounts with SSH `Host` / `IdentityFile` entries or
  HTTPS credential helpers.
- Enable `user.useConfigOnly` globally so Git does not guess the wrong email.
- When the same host has multiple accounts, use SSH host aliases and point
  repository remotes at those aliases.

Keep the global Git config as routing only, without a default identity:

```ini
[user]
  useConfigOnly = true

[includeIf "gitdir:~/repos/github.com/"]
  path = ~/.gitconfig-github

[includeIf "gitdir:~/repos/git.example.com/"]
  path = ~/.gitconfig-work
```

Put per-source identities in separate files:

```ini
# ~/.gitconfig-github
[user]
  name = Your Name
  email = you@example.com
```

```ini
# ~/.gitconfig-work
[user]
  name = Your Name
  email = you@company.example
```

Choose SSH authentication through host entries:

```text
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_github
  IdentitiesOnly yes

Host git.example.com-work
  HostName git.example.com
  User git
  IdentityFile ~/.ssh/id_ed25519_work
  IdentitiesOnly yes
```

For multiple accounts on the same host, point the repository remote at the
alias:

```bash
git remote set-url origin git@git.example.com-work:team/repo.git
```

Inspect the effective identity and authentication entry for the current
repository:

```bash
git config --show-origin --get user.name
git config --show-origin --get user.email
git remote -v
ssh -G git.example.com-work | grep identityfile
```

Avoid making `includeIf "hasconfig:remote.*.url:..."` the default way to select
identity from remote URLs. New clones, fork + upstream setups, and multi-remote
repositories can make those rules ambiguous; path-based identity under
`~/repos/<host>/...` is easier to predict and audit.

The matching CLI init task is `git.include-if`. List tasks and preview writes
first:

```bash
wst init --list
wst init git.include-if --git-profile 'id=github;host=github.com;name=Your Name;email=you@example.com'
```

Apply after reviewing the plan:

```bash
wst init git.include-if --git-profile 'id=github;host=github.com;name=Your Name;email=you@example.com' --yes
```

If the machine already has `~/.gitconfig-github` with `user.name` and
`user.email`, the CLI can infer the default GitHub profile:

```bash
wst init git.include-if --yes
```

Use interactive mode when you want to choose init tasks and enter identities by
hand:

```bash
wst init -i
```

## Best Practices

- Prefer `ghq` for ordinary project checkouts.
- Switch Git commit identity by `~/repos/<host>/...` path, and switch remote
  authentication by SSH host or credential helper.
- Enable `user.useConfigOnly` so repositories without a matching identity cannot
  commit.
- Group projects by purpose, not by accident of history; groups should not
  change clone target paths.
- Keep public examples generic.
- Prefer SSH URLs for repositories you actively push to.
- Make clone scripts default to dry-run.
- Skip repositories that already exist unless an explicit update mode is requested.
- Keep target directories configurable, with `~/repos` as the default root.
- Use `gh` for GitHub-specific listing and authentication workflows.
- Use `PUSHED_AT` ordering for active repository discovery.

Manifest mode can keep expanding around this shape without forcing private
repository names into public Git. For ordinary Git repositories, it produces the
same target path shape as `ghq`.

## Migrating Old Paths

If this repository already exists at an older shorthand path, move it once and
leave a compatibility symlink only while old editor windows or scripts still
refer to the previous location:

```bash
mkdir -p ~/repos/github.com/YunYouJun
mv ~/repos/gh/yyj/workstation ~/repos/github.com/YunYouJun/workstation

mkdir -p ~/repos/gh/yyj
ln -s ~/repos/github.com/YunYouJun/workstation ~/repos/gh/yyj/workstation
```

After shell history, editor workspaces, and local scripts use the new path, the
compatibility symlink can be removed.
