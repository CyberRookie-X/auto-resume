# Design: User Config File Discovery

**Date**: 2026-05-04  
**Status**: Draft  
**Author**: auto-resume development

## Problem Statement

auto-resume plugin currently bundles configuration files (`auto-resume.jsonc`) inside the plugin package. Users cannot customize configuration without modifying plugin internals or forking the repository.

Additionally, INSTALL.md files contain circular references (fetching instructions from themselves), which confuses users.

## Goals

1. Enable users to customize plugin behavior through standard config file locations
2. Make config files easy to discover and edit
3. Follow platform conventions for each supported platform (OpenCode, Claude Code, Codex)
4. Support team-shared (project-level) and personal (global-level) configurations
5. Fix circular references in INSTALL.md documentation

## Non-Goals

- Real-time config reloading (config is loaded once at initialization)
- Complex config validation beyond existing schema checks
- Plugin-specific config passed through platform config systems (e.g., OpenCode's `plugin_config`)

## Solution Overview

Add a config file discovery system that searches standard platform-specific locations in priority order:
1. Project-level config (highest priority)
2. Global-level config
3. Plugin built-in defaults (fallback)

Each platform follows its own conventions:
- **OpenCode**: `.opencode/` and `~/.config/opencode/`
- **Claude Code**: `.claude/` and `~/.claude/`
- **Codex**: `.codex/` and `~/.codex/`

## Detailed Design

### 1. Config File Locations

#### OpenCode
- Project: `.opencode/auto-resume.jsonc` (in project root)
- Global: `~/.config/opencode/auto-resume.jsonc`
- XDG: `$XDG_CONFIG_HOME/opencode/auto-resume.jsonc` (if XDG_CONFIG_HOME is set)

#### Claude Code
- Project: `.claude/auto-resume.jsonc` (in project root)
- Global: `~/.claude/auto-resume.jsonc`
- XDG: `$XDG_CONFIG_HOME/claude/auto-resume.jsonc` (if XDG_CONFIG_HOME is set, fallback)

#### Codex
- Project: `.codex/auto-resume.jsonc` (in project root)
- Global: `~/.codex/auto-resume.jsonc`

### 2. Config Discovery Function

**Function**: `discoverUserConfigPath(platform: Platform, cwd?: string): string | undefined`

**Behavior**:
- Generate candidate paths in priority order (project → global)
- Return first existing file path
- Return `undefined` if no user config found

**Implementation**:
```typescript
export type Platform = "opencode" | "claude" | "codex"

function getPlatformConfigDirs(platform: Platform, cwd: string): string[] {
  const home = homedir()
  
  // Platform-specific directory names
  const projectDir = platform === "opencode" ? ".opencode" 
    : platform === "claude" ? ".claude" 
    : ".codex"
  
  // Global config directories (respect XDG for OpenCode and Claude)
  const globalDirs: string[] = []
  if (platform === "opencode") {
    globalDirs.push(join(home, ".config", "opencode"))
  } else if (platform === "claude") {
    globalDirs.push(join(home, ".claude"))
    if (process.env.XDG_CONFIG_HOME) {
      globalDirs.push(join(process.env.XDG_CONFIG_HOME, "claude"))
    }
  } else if (platform === "codex") {
    globalDirs.push(join(home, ".codex"))
  }
  
  // Candidates in priority order
  const candidates: string[] = []
  
  // Project-level (highest priority)
  candidates.push(join(cwd, projectDir, "auto-resume.jsonc"))
  
  // Global-level (lower priority)
  for (const globalDir of globalDirs) {
    candidates.push(join(globalDir, "auto-resume.jsonc"))
  }
  
  return candidates
}

export function discoverUserConfigPath(platform: Platform, cwd: string = process.cwd()): string | undefined {
  const candidates = getPlatformConfigDirs(platform, cwd)
  
  for (const path of candidates) {
    if (existsSync(path)) {
      return path
    }
  }
  
  return undefined
}
```

### 3. Config Loading Function Modification

**Function**: `loadAutoResumeRuntimeConfigFile(path?: string | URL, options?: { platform?: Platform; cwd?: string })`

**Modified Behavior**:
- If `path` is provided: load from that path directly
- If `path` is undefined and `options.platform` is provided:
  - Call `discoverUserConfigPath(platform, cwd)` to search for user config
  - If found: load user config
  - If not found: log warning + use plugin built-in default (`DEFAULT_RUNTIME_CONFIG_URL`)
- Otherwise: use plugin built-in default

**Warning Message** (when user config not found):
```
[auto-resume] User config file not found, using plugin built-in defaults.
  Project-level config location: {projectPath}
  Global-level config location: {globalPath}
```

### 4. Plugin Adapter Modifications

#### OpenCode (`src/opencode.ts`)
- Add `cwd?: string` to `AdapterOptions` type
- Pass `cwd` through: `autoResumePlugin → createOpenCodeAdapter → normalizeConfig → loadAutoResumeRuntimeConfigFile`
- Set `platform: "opencode"` in config loading

#### Claude Code (`src/claude-code.ts`)
- Similar modifications
- Set `platform: "claude"`

#### Codex (`src/codex.ts`)
- Similar modifications  
- Set `platform: "codex"`

### 5. Documentation Updates

#### INSTALL.md Files (3 files)

Remove circular references and add config location documentation:

**Structure**:
```markdown
# Installing auto-resume for [Platform]

## Install
[Clear installation steps with config file locations]

## Configuration
[Config file locations with examples]

- Global config: `{globalPath}`
- Project config: `{projectPath}`
- Project config overrides global config

Example `auto-resume.jsonc`:
[Example config with common options]
```

#### README Files

Add config file location section explaining:
- Where to find config files for each platform
- Config priority order
- Link to INSTALL.md for detailed examples

## Error Handling

- **Config file not found**: Log warning, use built-in defaults (no error thrown)
- **Config file parse error**: Throw error with clear message (existing behavior)
- **Config validation error**: Throw error with validation details (existing behavior)

## Testing

Tests should verify:
1. Config discovery finds project-level config first
2. Config discovery falls back to global-level config
3. Config discovery returns undefined when no user config exists
4. Warning is logged when using built-in defaults
5. Each platform uses correct directory names
6. XDG_CONFIG_HOME is respected for OpenCode and Claude Code

## Migration Path

No breaking changes:
- Existing plugin installations continue working (built-in defaults always available)
- Users can optionally create config files to customize behavior
- No need to modify existing configurations

## Open Questions

None. Design is complete and ready for implementation.