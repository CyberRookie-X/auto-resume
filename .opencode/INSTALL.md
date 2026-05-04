# Installing auto-resume for OpenCode

Add the plugin to your OpenCode configuration.

## Install

**Global installation** (applies to all projects):

Edit `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["github:CyberRookie-X/auto-resume#v0.1.31"]
}
```

**Project installation** (only for this project):

Edit `.opencode/opencode.json` in your project root:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["github:CyberRookie-X/auto-resume#v0.1.31"]
}
```

OpenCode loads the plugin directly from GitHub, so this path does not need a local build or runtime tarball.

Restart OpenCode.

## Configuration

Customize behavior by creating config files:

**Global config** (applies to all projects):
```
~/.config/opencode/auto-resume.jsonc
```

**Project config** (only for this project):
```
.opencode/auto-resume.jsonc
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