# Packages

Package installation should be reproducible enough to restore the machine, but not so rigid that every temporary experiment becomes permanent setup.

## Recommended Layers

- Homebrew formulae and casks for system-level tools and apps.
- `ghq` for reproducible local repository layout under `~/repos`.
- pnpm workspace dependencies for repo-local development.
- Editor extension lists for editor-specific tooling.
- Language version managers only when the ecosystem benefits from them.

## Best Practices

- Add a package to automation only after it becomes part of daily work.
- Keep one-off experiments out of bootstrap manifests.
- Prefer package-manager manifests over custom install commands.
- Separate core tools from optional apps.
- Run package setup before dotfiles that assume those tools exist.

## Migrating Old Environment Notes

When migrating historical environment notes, add only long-lived, repeatable
tools to manifests. One-off server stacks, old mirrors, old install scripts, and
deprecated casks should not become part of the workstation baseline.

For example, OneinStack, LNMP one-click installers, and old `nvm`/Taobao mirror
snippets are better archived or deleted than moved into `Brewfile`. Occasional
compatibility tools such as `rar` can stay as temporary commands without being
installed by default.

## Brewfiles

Use the root `Brewfile` for terminal foundations and daily CLI tools:

```bash
brew bundle dump --file Brewfile --force
brew bundle --file Brewfile
```

Use `Brewfile.apps` for optional desktop applications:

```bash
brew bundle --file Brewfile.apps
```

Mac App Store entries in `Brewfile.apps` use `mas`, which requires the App Store
to be signed in locally.

Review generated changes before committing. Brewfiles should describe the workstation, not every app ever tried.
