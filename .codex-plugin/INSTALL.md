# Installing auto-resume for Codex

Create or update these files:

`.codex-plugin/plugin.json`

```json
{
  "name": "auto-resume",
  "version": "0.1.33",
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

## Configuration

Customize behavior by creating config files:

**Global config** (applies to all projects):
```
~/.codex/auto-resume.jsonc
```

**Project config** (only for this project):
```
.codex/auto-resume.jsonc
```

Project config overrides global config. If neither exists, the plugin uses built-in defaults.

Example `auto-resume.jsonc`:

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
    "sources": [
      "https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/auto-resume.rules.jsonc"
    ]
  }
}
```

See [Configuration Reference](https://github.com/CyberRookie-X/auto-resume#configuration-reference) for all available options.