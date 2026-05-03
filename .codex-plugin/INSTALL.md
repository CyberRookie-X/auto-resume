# Installing auto-resume for Codex

Tell Codex:

```text
Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.codex-plugin/INSTALL.md
```

Create or update these files:

`.codex-plugin/plugin.json`

```json
{
  "name": "auto-resume",
  "version": "0.1.2",
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
