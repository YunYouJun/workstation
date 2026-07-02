# Secrets

Secrets should never be committed to this repository. The repo may contain placeholders, examples, and instructions, but not real credentials.

## Current Flow

When pushing from `$HOME` to the repo, the CLI detects sensitive shell assignments such as `TOKEN`, `API_KEY`, `SECRET`, `PASSWORD`, `PRIVATE_KEY`, and `CREDENTIAL`.

Real values are replaced with placeholders:

```bash
export API_TOKEN="{{DOTFILES_SECRET:API_TOKEN}}"
```

The real value is stored in `.env.local`, which is ignored by Git.

## Rules

- Commit placeholders, not secret values.
- Keep `.env.local` local to the machine.
- Prefer a dedicated secret manager for long-lived credentials.
- Rotate any secret that was committed by mistake.
- Use `.env.example` or docs when a project needs to describe required variables.

## Recovery Checklist

```bash
workstation dotfiles doctor
workstation dotfiles diff
```

If `doctor` reports a missing key, add it back to `.env.local` or restore it from your secret manager before running `workstation dotfiles pull --force`.
