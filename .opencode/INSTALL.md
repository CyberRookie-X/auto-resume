# Installing auto-resume for OpenCode

Tell OpenCode:

```text
Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.opencode/INSTALL.md
```

Create or update `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["github:CyberRookie-X/auto-resume#v0.1.3"]
}
```

OpenCode loads the plugin directly from GitHub, so this path does not need a local build or the runtime tarball.

Restart OpenCode.
