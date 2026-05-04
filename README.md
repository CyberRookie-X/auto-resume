# auto-resume

OpenCode recovery helpers for resuming stopped sessions.

[中文版](README.zh.md)

## Install

Use the native plugin flow first:

### OpenCode

Tell OpenCode:

```text
Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.opencode/INSTALL.md
```

Create or update `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["github:CyberRookie-X/auto-resume#v0.1.29"]
}
```

OpenCode loads this plugin directly from GitHub, so you do not need a local build or runtime tarball for this path.

Restart OpenCode.

### Claude Code

Tell Claude Code:

```text
Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.claude/INSTALL.md
```

Create or update these files:

`.claude-plugin/plugin.json`

```json
{
  "name": "auto-resume",
  "version": "0.1.29",
  "description": "Recovery hooks for stopped sessions",
  "author": {
    "name": "CyberRookie-X"
  },
  "hooks": "./hooks/hooks.json"
}
```

`.claude-plugin/marketplace.json`

```json
{
  "name": "auto-resume-marketplace",
  "owner": {
    "name": "CyberRookie-X"
  },
  "plugins": [
    {
      "name": "auto-resume",
      "source": "./",
      "description": "Recovery hooks for stopped sessions",
      "version": "0.1.29",
      "author": {
        "name": "CyberRookie-X"
      }
    }
  ]
}
```

`.claude/settings.json`

```json
{
  "extraKnownMarketplaces": {
    "auto-resume-marketplace": {
      "source": {
        "source": "github",
        "repo": "CyberRookie-X/auto-resume"
      }
    }
  },
  "enabledPlugins": {
    "auto-resume@auto-resume-marketplace": true
  }
}
```

Restart Claude Code.

### Codex

Tell Codex:

```text
Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.codex-plugin/INSTALL.md
```

Create or update these files:

`.codex-plugin/plugin.json`

```json
{
  "name": "auto-resume",
  "version": "0.1.29",
  "description": "Codex recovery hooks for auto-resume",
  "hooks": "./hooks/hooks.json"
}
```

`hooks/hooks.json`

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/auto-resume-hook.js\"",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Restart Codex.

### Offline fallback

- `install.sh` is the offline fallback when you need to unpack a runtime tarball manually.

```bash
./install.sh --tarball /path/to/auto-resume-runtime.tar.gz --target /path/to/auto-resume
```

## Configuration Reference

- `auto-resume.jsonc`: runtime settings, the read-only tool allow list, and optional rules sync settings.
- `auto-resume.rules.jsonc`: shared default recovery rules. If rules sync is enabled, OpenCode refreshes a cached copy from the configured sources.
- `opencode.json`: OpenCode reads this file to load the GitHub-hosted plugin directly from the repo.
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `.claude/settings.json`
- `.codex-plugin/plugin.json`
- `hooks/hooks.json`

### Runtime Config

```jsonc
{
  "safeToolNames": ["read", "search", "list", "glob", "grep", "fetch", "websearch", "webfetch"],
  "rulesSync": {
    "enabled": false,
    "intervalMs": 21600000,
    "githubMirror": {
      "enabled": false,
      "baseUrl": "https://ghfast.top"
    },
    "sources": ["https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/auto-resume.rules.jsonc"]
  }
}
```

`githubMirror.enabled` controls the first request order for GitHub raw downloads. When it is `false`, OpenCode tries the official URL first and falls back to the mirror on failure. When it is `true`, it tries the mirror first and falls back to the official URL if the mirror fails.

### Rules File

```jsonc
{
  "rules": [
    {
      "id": "resume-on-stream-read-error",
      "scope": "all",
      "match": { "messageRegex": "stream_read_error" },
      "action": { "type": "prompt", "text": "RESUME" },
      "retry": { "baseMs": 1000, "factor": 2, "maxMs": 8000, "maxAttempts": 3 }
    }
  ]
}
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
