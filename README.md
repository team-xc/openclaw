# OpenClaw

This fork is a private, Telegram-focused OpenClaw setup.

It keeps:

- the `openclaw` CLI
- the Gateway
- the Web/Control UI
- the Telegram channel
- browser tooling

It intentionally drops the public product shell:

- macOS / iOS / Android apps
- release and updater workflows
- installer scripts
- most public docs and community metadata
- non-Telegram bundled extensions

## Local workflow

Runtime: Node `>=22.12.0`

```bash
pnpm install
pnpm build
pnpm ui:build
pnpm openclaw gateway
```

Useful commands:

```bash
pnpm openclaw onboard
pnpm openclaw channels status
pnpm openclaw browser
pnpm openclaw logs --follow
```

## Scope

This repository is maintained for personal use. It is not set up as an upstream-tracking,
public release, or multi-platform app distribution repo.
