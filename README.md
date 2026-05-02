# auto-resume

OpenCode recovery helpers for resuming stopped sessions.

## Install

Install from the latest GitHub Release:

```bash
./install.sh --target /path/to/auto-resume
```

The script downloads `https://github.com/<owner>/<repo>/releases/latest/download/auto-resume-runtime.tar.gz`.

It resolves `<owner>/<repo>` from `GITHUB_REPOSITORY` when available, or from the `origin` git remote when you run it inside a checkout.

For offline installs, pass a local runtime tarball:

```bash
./install.sh --tarball /path/to/auto-resume-runtime.tar.gz --target /path/to/auto-resume
```

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
