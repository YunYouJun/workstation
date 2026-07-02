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

```bash
wst p manifest --file projects.local.yaml
wst p manifest --file projects.local.yaml --yes
```

You can also keep the manifest in a private configuration repository. The CLI
clones that repository into a local cache, then reads `projects.yaml`:

```bash
wst p manifest https://git.example.com/<user>/<config-repo>
wst p manifest https://git.example.com/<user>/<config-repo> --group common --yes
```

If the manifest does not live at `projects.yaml` or `projects.yml` in the
configuration repository root, pass the internal path:

```bash
wst p manifest --repo https://git.example.com/<user>/<config-repo> --manifest workstation/projects.yaml
```

Private configuration repositories are cached under
`~/.cache/workstation/project-manifests/`. Projects still clone into the
`~/repos/<host>/<group>/<repo>` layout. When the primary `ghq.root` matches the
target root, the CLI uses `ghq get`; otherwise it falls back to `git clone`.

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
    repositories:
      - name: github.com/YunYouJun/workstation
        url: git@github.com:YunYouJun/workstation.git
      - name: git.example.com/<group>/<repo>
        url: git@git.example.com:<group>/<repo>.git
```

If an entry only has `name: git.example.com/<group>/<repo>`, the CLI infers an SSH
clone URL by default; with `--https`, it infers an HTTPS clone URL instead. For
entries that need both, define `sshUrl` and `httpsUrl`, and the command will
choose based on `--https`.

## Best Practices

- Prefer `ghq` for ordinary project checkouts.
- Group projects by purpose, not by accident of history.
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
