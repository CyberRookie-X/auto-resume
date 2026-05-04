# Installing auto-resume for Claude Code

Create or update these files:

`.claude-plugin/plugin.json`

```json
{
  "name": "auto-resume",
  "version": "0.1.31",
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
      "version": "0.1.31",
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

## Configuration

Customize behavior by creating config files:

**Global config** (applies to all projects):
```
~/.claude/auto-resume.jsonc
```

**Project config** (only for this project):
```
.claude/auto-resume.jsonc
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