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

## Fork-specific changes

Recent Telegram-focused changes in this fork:

- preserve Telegram media downloads when an explicit network proxy is configured
- prune redundant top-level Telegram multi-account defaults after config saves
- localize the Web UI plus Chinese command / Telegram reply surfaces
- add Debug/Admin actions to build the project and restart the gateway
- merge Telegram account-level TTS settings with global TTS defaults for per-bot voices
- keep Telegram custom commands usable alongside native commands, including native passthrough for quota
- clear stale Telegram emoji reactions when a reply resolves to `NO_REPLY`
- add session-level fast mode controls and preserve think / fast settings across `/new` and `/reset`
- honor the configured default Telegram account in group fallback routing
- avoid silent background STT for unaddressed multi-bot Telegram group voice messages
- start Telegram typing earlier during explicit voice transcription / fallback flows

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
