# Repository Scope

`workstation` is the top-level home for personal development environment setup. It can contain dotfiles, bootstrap scripts, package manifests, project checkout conventions, and docs.

## Naming Convention

- Repository: `workstation`
- Checkout path: `~/repos/github.com/YunYouJun/workstation`
- Dotfiles source tree: `home/`
- Primary command: `workstation`
- Short entrypoint: `wst`
- Domain aliases: `df`, `p`
- Compatibility command: `dotfiles`
- Documentation: `docs/`
- CLI package: `packages/cli`

This keeps the repo name and primary command broad while preserving the old
`dotfiles` CLI as a compatibility entrypoint.

## CLI Naming

Use `workstation` as the primary command and split behavior by domain:

```bash
workstation doctor
workstation bootstrap --dry-run
workstation packages install --dry-run
workstation dotfiles pull --dry-run
workstation projects clone-active
```

Use short aliases for repetitive daily commands:

```bash
workstation df pull --dry-run
workstation p active --limit 20
wst df pull --dry-run
wst p active --limit 20
```

Use `wst` instead of `ws` so the published binary is less likely to be confused
with WebSocket or workspace aliases. The old `dotfiles` command remains as a
compatibility alias for existing sync workflows.

## What Belongs Here

- Shell, Git, editor, terminal, and Codex configuration.
- macOS setup notes and scripts.
- Package manager manifests such as `Brewfile` when package automation is added.
- Safe project checkout manifests such as `projects.example.yaml`.
- Local development scripts that make machine setup easier to inspect and repeat.
- Notes explaining setup decisions, tradeoffs, and recovery steps.

## What Does Not Belong Here

- Tokens, private keys, passwords, and generated `.env` files.
- Company-only repository names in a public repo.
- Machine-specific absolute paths unless they are examples or clearly configurable.
- Generated build output such as `dist/` and `docs/.vitepress/dist`.
- Large binaries and app exports that are better installed by a package manager.

## Layout

```text
workstation/
  docs/                 # VitePress documentation
  home/                 # chezmoi-compatible managed home files
  packages/cli/         # workstation CLI
  projects.example.yaml # public example project manifest
  package.json          # workspace scripts
```

As the repository grows, prefer adding a documented module over mixing unrelated setup logic into one large script.
