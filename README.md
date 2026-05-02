# auto-resume

OpenCode recovery helpers for resuming stopped sessions.

[中文版](README.zh.md)

## Install

Use the native plugin flow first:

### OpenCode

- OpenCode loads this checkout directly from `opencode.json` with `plugin: ["./"]`.

### Claude Code

- Claude Code uses `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `.claude/settings.json`.
- The plugin is enabled as `auto-resume@auto-resume-marketplace`.

### Codex

- Codex uses `.codex-plugin/plugin.json` with the shared marketplace metadata and `hooks/hooks.json`.

### Offline fallback

- `install.sh` is the offline fallback when you need to unpack a runtime tarball manually.

```bash
./install.sh --tarball /path/to/auto-resume-runtime.tar.gz --target /path/to/auto-resume
```

## Configuration Reference

- `opencode.json`: OpenCode reads this file to load the local plugin checkout.
- `.claude-plugin/plugin.json`: Claude Code reads this plugin manifest to connect the marketplace entry to the hook bundle.
- `.claude-plugin/marketplace.json`: Claude Code reads this marketplace definition to expose the repo as `auto-resume-marketplace`.
- `.claude/settings.json`: Claude Code reads this settings file to enable `auto-resume@auto-resume-marketplace`.
- `.codex-plugin/plugin.json`: Codex reads this plugin manifest to point at the shared hook map.
- `hooks/hooks.json`: Claude Code and Codex read this shared hook map to launch `hooks/auto-resume-hook.js` on `Stop`.

## Development

```bash
npm install
```

## Run

```bash
npm test
npm run build
```

## Public API

```ts
import {
  createDefaultConfig,
  createOpenCodeAdapter,
  createRecoveryEngine,
} from "auto-resume"
```

## Rule Format

Each rule needs:

- `id`
- `scope`: `root`, `child`, or `all`
- `match`: `errorName`, `messageIncludes`, `messageRegex`, `reasoningOnlyStop`, `toolExecutionAborted`, `finishLengthStop`
- `action`: `{ type: "prompt", text: string }`
- `retry`: `baseMs`, `factor`, `maxMs`, `maxAttempts`

```ts
{
  id: "resume-on-stream-read-error",
  scope: "all",
  match: { messageRegex: "stream_read_error" },
  action: { type: "prompt", text: "RESUME" },
  retry: { baseMs: 1000, factor: 2, maxMs: 8000, maxAttempts: 3 },
}
```

## Example

`stream_read_error -> RESUME` means: when a matching session error is observed, schedule the `RESUME` prompt after the configured backoff.

## Replay Policy

Read-only terminal turns may auto-replay the original user request after recovery. If the turn included write, delete, move, or shell work, or it cannot be reconstructed safely, the adapter falls back to injecting `RESUME`.

## Scope Behavior

- `root` matches sessions without a `parentID`
- `child` matches sessions with a `parentID`
- `all` matches both

The OpenCode adapter resolves scope from session metadata before it asks the recovery engine for a decision.

## First-Release Non-Goals

- Persistent recovery state across process restarts
- Actions other than text prompt injection
- A general-purpose rule language
- Automatic repair beyond the configured prompt
