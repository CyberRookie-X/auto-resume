# User Config Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to customize auto-resume plugin behavior through standard platform-specific config file locations with project-level override support.

**Architecture:** Add config discovery system that searches platform-specific directories (project → global) and loads user config if found, otherwise uses plugin built-in defaults with warning message.

**Tech Stack:** TypeScript, Node.js fs/path modules, existing config-file.ts infrastructure

---

## File Structure

**Modified files:**
- `src/config-file.ts` - Add config discovery functions
- `src/opencode.ts` - Pass cwd and platform to config loader
- `src/claude-code.ts` - Pass cwd and platform to config loader  
- `src/codex.ts` - Pass cwd and platform to config loader
- `.opencode/INSTALL.md` - Remove circular reference, add config locations
- `.claude/INSTALL.md` - Remove circular reference, add config locations
- `.codex-plugin/INSTALL.md` - Remove circular reference, add config locations
- `README.md` - Update config section
- `README.zh.md` - Update config section (Chinese)

**Test file:**
- `test/config-file.test.ts` - Add discovery tests

---

### Task 1: Add Config Discovery to config-file.ts

**Files:**
- Modify: `src/config-file.ts:1-13`

- [ ] **Step 1: Import existsSync and add Platform type**

```typescript
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { AutoResumeConfig, AutoResumeRuntimeConfig, RecoveryRule, RulesSyncConfig } from "./types.js"

export const DEFAULT_RUNTIME_CONFIG_URL = new URL("../auto-resume.jsonc", import.meta.url)
export const DEFAULT_RULES_CONFIG_URL = new URL("../auto-resume.rules.jsonc", import.meta.url)
export const DEFAULT_RULES_CACHE_PATH = join(homedir(), ".cache", "auto-resume", "auto-resume.rules.jsonc")
export const DEFAULT_RULES_SOURCE_URL = "https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/auto-resume.rules.jsonc"
export const DEFAULT_GITHUB_MIRROR_BASE_URL = "https://ghfast.top"
export const DEFAULT_SAFE_TOOL_NAMES = ["read", "search", "list", "glob", "grep", "fetch", "websearch", "webfetch"] as const

export type Platform = "opencode" | "claude" | "codex"
```

- [ ] **Step 2: Add getPlatformConfigDirs helper function**

Add after line 13 (after `DEFAULT_SAFE_TOOL_NAMES`):

```typescript
function getPlatformConfigDirs(platform: Platform, cwd: string = process.cwd()): string[] {
  const home = homedir()
  
  const projectDir = platform === "opencode" 
    ? ".opencode" 
    : platform === "claude" 
    ? ".claude" 
    : ".codex"
  
  const globalDirs: string[] = []
  
  if (platform === "opencode") {
    globalDirs.push(join(home, ".config", "opencode"))
  } else if (platform === "claude") {
    globalDirs.push(join(home, ".claude"))
    const xdgConfigHome = process.env.XDG_CONFIG_HOME
    if (xdgConfigHome) {
      globalDirs.push(join(xdgConfigHome, "claude"))
    }
  } else if (platform === "codex") {
    globalDirs.push(join(home, ".codex"))
  }
  
  const candidates: string[] = []
  
  candidates.push(join(cwd, projectDir, "auto-resume.jsonc"))
  
  for (const globalDir of globalDirs) {
    candidates.push(join(globalDir, "auto-resume.jsonc"))
  }
  
  return candidates
}
```

- [ ] **Step 3: Add discoverUserConfigPath function**

Add after `getPlatformConfigDirs`:

```typescript
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

- [ ] **Step 4: Run tests to verify no breakage**

Run: `npm test`
Expected: All existing tests pass (no changes to tested behavior yet)

- [ ] **Step 5: Commit**

```bash
git add src/config-file.ts
git commit -m "feat: add config discovery functions for platform-specific locations"
```

---

### Task 2: Modify loadAutoResumeRuntimeConfigFile to use discovery

**Files:**
- Modify: `src/config-file.ts:217-220`

- [ ] **Step 1: Write failing test for config discovery**

Add to `test/config-file.test.ts`:

```typescript
import { join } from "node:path"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { discoverUserConfigPath, loadAutoResumeRuntimeConfigFile } from "../src/config-file.js"

describe("discoverUserConfigPath", () => {
  const testDir = join(tmpdir(), "auto-resume-test-" + Date.now())
  
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })
  
  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })
  
  it("should find project-level config first", () => {
    const projectConfigDir = join(testDir, ".opencode")
    mkdirSync(projectConfigDir, { recursive: true })
    const projectConfigPath = join(projectConfigDir, "auto-resume.jsonc")
    writeFileSync(projectConfigPath, JSON.stringify({
      safeToolNames: ["read", "glob"],
    }))
    
    const found = discoverUserConfigPath("opencode", testDir)
    assert.strictEqual(found, projectConfigPath)
  })
  
  it("should return undefined when no user config exists", () => {
    const found = discoverUserConfigPath("opencode", testDir)
    assert.strictEqual(found, undefined)
  })
})

describe("loadAutoResumeRuntimeConfigFile with platform", () => {
  const testDir = join(tmpdir(), "auto-resume-test-" + Date.now())
  
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })
  
  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })
  
  it("should load user config when found", () => {
    const projectConfigDir = join(testDir, ".opencode")
    mkdirSync(projectConfigDir, { recursive: true })
    const projectConfigPath = join(projectConfigDir, "auto-resume.jsonc")
    writeFileSync(projectConfigPath, JSON.stringify({
      safeToolNames: ["custom-tool"],
    }))
    
    const config = loadAutoResumeRuntimeConfigFile(undefined, { platform: "opencode", cwd: testDir })
    assert.deepStrictEqual(config.safeToolNames, ["custom-tool"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: New tests fail with "config not loaded from discovered path" or similar

- [ ] **Step 3: Modify loadAutoResumeRuntimeConfigFile signature and implementation**

Replace `src/config-file.ts:217-220`:

```typescript
export function loadAutoResumeRuntimeConfigFile(
  path: string | URL | undefined = DEFAULT_RUNTIME_CONFIG_URL,
  options?: { platform?: Platform; cwd?: string }
): AutoResumeRuntimeConfig {
  if (path) {
    return parseAutoResumeRuntimeConfig(readFileSync(path, "utf8"))
  }
  
  if (options?.platform) {
    const userConfigPath = discoverUserConfigPath(options.platform, options.cwd ?? process.cwd())
    if (userConfigPath) {
      return parseAutoResumeRuntimeConfig(readFileSync(userConfigPath, "utf8"))
    }
    
    console.warn(`[auto-resume] User config file not found, using plugin built-in defaults.`)
    const candidates = getPlatformConfigDirs(options.platform, options.cwd ?? process.cwd())
    if (candidates.length > 0) {
      console.warn(`  Project-level config location: ${candidates[0]}`)
    }
    if (candidates.length > 1) {
      console.warn(`  Global-level config location: ${candidates[1]}`)
    }
  }
  
  return parseAutoResumeRuntimeConfig(readFileSync(DEFAULT_RUNTIME_CONFIG_URL, "utf8"))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: All tests pass including new discovery tests

- [ ] **Step 5: Commit**

```bash
git add src/config-file.ts test/config-file.test.ts
git commit -m "feat: integrate config discovery into loadAutoResumeRuntimeConfigFile"
```

---

### Task 3: Update LoadAutoResumeConfigOptions type

**Files:**
- Modify: `src/config-file.ts:235-238`

- [ ] **Step 1: Add platform and cwd to options type**

Replace `src/config-file.ts:235-238`:

```typescript
export type LoadAutoResumeConfigOptions = {
  cachePath?: string | URL
  rulesPath?: string | URL
  platform?: Platform
  cwd?: string
}
```

- [ ] **Step 2: Run tests to verify no breakage**

Run: `npm test`
Expected: All tests pass (type change doesn't affect runtime)

- [ ] **Step 3: Commit**

```bash
git add src/config-file.ts
git commit -m "feat: add platform and cwd options to LoadAutoResumeConfigOptions"
```

---

### Task 4: Update OpenCode adapter

**Files:**
- Modify: `src/opencode.ts:449-455` (createOpenCodeAdapter function)
- Modify: `src/opencode.ts:698-700` (autoResumePlugin function)
- Modify: `src/opencode.ts:20-27` (AdapterOptions and OpenCodePluginInput types)

- [ ] **Step 1: Add cwd to AdapterOptions type**

Find `src/opencode.ts:20-27` (AdapterOptions definition) and add `cwd?: string`:

```typescript
type AdapterOptions = {
  client: OpenCodeClient
  config?: Partial<AutoResumeConfig>
  fetch?: typeof globalThis.fetch
  rulesCachePath?: string
  timers?: TimerAPI
  cwd?: string
}
```

- [ ] **Step 2: Add cwd to OpenCodePluginInput type**

Find `src/opencode.ts:20-27` area (OpenCodePluginInput definition) and add `cwd?: string`:

```typescript
type OpenCodePluginInput = {
  client: OpenCodeClient
  config?: Partial<AutoResumeConfig>
  fetch?: typeof globalThis.fetch
  rulesCachePath?: string
  timers?: TimerAPI
  cwd?: string
}
```

- [ ] **Step 3: Modify createOpenCodeAdapter to pass cwd**

Replace `src/opencode.ts:449-455`:

```typescript
export function createOpenCodeAdapter({ client, config, fetch: fetchImpl, rulesCachePath, timers, cwd }: AdapterOptions) {
  const resolvedRulesCachePath = rulesCachePath ?? DEFAULT_RULES_CACHE_PATH
  const normalizedConfig = normalizeConfig(config, { cachePath: resolvedRulesCachePath, platform: "opencode", cwd })
  const engine = createRecoveryEngine({
    now: () => Date.now(),
    rules: normalizedConfig.rules,
  })
```

- [ ] **Step 4: Modify autoResumePlugin to accept cwd**

Replace `src/opencode.ts:698-700`:

```typescript
export default async function autoResumePlugin({ client, config, timers, cwd }: OpenCodePluginInput) {
  const adapter = createOpenCodeAdapter({ client, config, timers, cwd })
```

- [ ] **Step 5: Run tests to verify no breakage**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/opencode.ts
git commit -m "feat: pass cwd to config loader in OpenCode adapter"
```

---

### Task 5: Update Claude Code adapter

**Files:**
- Modify: `src/claude-code.ts` (similar changes to opencode.ts)

- [ ] **Step 1: Find adapter function and add cwd parameter**

Search for the main adapter function in `src/claude-code.ts` (similar structure to opencode.ts).

Add `cwd?: string` to the options type and pass it to config loading with `platform: "claude"`.

Implementation follows same pattern as Task 4.

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/claude-code.ts
git commit -m "feat: pass cwd to config loader in Claude Code adapter"
```

---

### Task 6: Update Codex adapter

**Files:**
- Modify: `src/codex.ts` (similar changes to opencode.ts)

- [ ] **Step 1: Find adapter function and add cwd parameter**

Search for the main adapter function in `src/codex.ts`.

Add `cwd?: string` to the options type and pass it to config loading with `platform: "codex"`.

Implementation follows same pattern as Task 4.

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/codex.ts
git commit -m "feat: pass cwd to config loader in Codex adapter"
```

---

### Task 7: Update OpenCode INSTALL.md

**Files:**
- Modify: `.opencode/INSTALL.md`

- [ ] **Step 1: Rewrite INSTALL.md with clear structure**

Replace entire file:

```markdown
# Installing auto-resume for OpenCode

Add the plugin to your OpenCode configuration.

## Install

**Global installation** (applies to all projects):

Edit `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["github:CyberRookie-X/auto-resume#v0.1.29"]
}
```

**Project installation** (only for this project):

Edit `.opencode/opencode.json` in your project root:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["github:CyberRookie-X/auto-resume#v0.1.29"]
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
```

- [ ] **Step 2: Commit**

```bash
git add .opencode/INSTALL.md
git commit -m "docs: remove circular reference and add config location docs for OpenCode"
```

---

### Task 8: Update Claude Code INSTALL.md

**Files:**
- Modify: `.claude/INSTALL.md`

- [ ] **Step 1: Rewrite INSTALL.md with clear structure**

Replace entire file with similar structure to Task 7, but using Claude Code paths:
- Config locations: `.claude/auto-resume.jsonc` and `~/.claude/auto-resume.jsonc`
- Install instructions follow existing Claude Code plugin pattern

Content follows same template as Task 7 adapted for Claude Code.

- [ ] **Step 2: Commit**

```bash
git add .claude/INSTALL.md
git commit -m "docs: remove circular reference and add config location docs for Claude Code"
```

---

### Task 9: Update Codex INSTALL.md

**Files:**
- Modify: `.codex-plugin/INSTALL.md`

- [ ] **Step 1: Rewrite INSTALL.md with clear structure**

Replace entire file with similar structure to Task 7, but using Codex paths:
- Config locations: `.codex/auto-resume.jsonc` and `~/.codex/auto-resume.jsonc`
- Install instructions follow existing Codex plugin pattern

Content follows same template as Task 7 adapted for Codex.

- [ ] **Step 2: Commit**

```bash
git add .codex-plugin/INSTALL.md
git commit -m "docs: remove circular reference and add config location docs for Codex"
```

---

### Task 10: Update README.md

**Files:**
- Modify: `README.md` (config section)

- [ ] **Step 1: Add config file location section**

Find the Configuration section in README.md and add a subsection about config file locations:

```markdown
## Configuration File Locations

auto-resume looks for configuration files in standard platform-specific locations:

### OpenCode
- **Project-level**: `.opencode/auto-resume.jsonc` (highest priority)
- **Global-level**: `~/.config/opencode/auto-resume.jsonc`

### Claude Code
- **Project-level**: `.claude/auto-resume.jsonc` (highest priority)
- **Global-level**: `~/.claude/auto-resume.jsonc`

### Codex
- **Project-level**: `.codex/auto-resume.jsonc` (highest priority)
- **Global-level**: `~/.codex/auto-resume.jsonc`

Project-level config overrides global-level config. If neither exists, the plugin uses built-in defaults.

See platform-specific INSTALL.md files for detailed setup instructions:
- [OpenCode Installation](/.opencode/INSTALL.md)
- [Claude Code Installation](/.claude/INSTALL.md)
- [Codex Installation](/.codex-plugin/INSTALL.md)
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add config file locations section to README"
```

---

### Task 11: Update README.zh.md

**Files:**
- Modify: `README.zh.md` (config section)

- [ ] **Step 1: Translate config location section to Chinese**

Add Chinese translation of the config file locations section (similar to Task 10).

- [ ] **Step 2: Commit**

```bash
git add README.zh.md
git commit -m "docs: add Chinese config file locations section to README.zh"
```

---

### Task 12: Add comprehensive config discovery tests

**Files:**
- Modify: `test/config-file.test.ts`

- [ ] **Step 1: Add tests for all platforms**

Add tests verifying config discovery for each platform (opencode, claude, codex):

```typescript
describe("discoverUserConfigPath for all platforms", () => {
  const testDir = join(tmpdir(), "auto-resume-test-" + Date.now())
  
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })
  
  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })
  
  it("should find Claude Code project config", () => {
    const projectConfigDir = join(testDir, ".claude")
    mkdirSync(projectConfigDir, { recursive: true })
    const projectConfigPath = join(projectConfigDir, "auto-resume.jsonc")
    writeFileSync(projectConfigPath, JSON.stringify({ safeToolNames: ["read"] }))
    
    const found = discoverUserConfigPath("claude", testDir)
    assert.strictEqual(found, projectConfigPath)
  })
  
  it("should find Codex project config", () => {
    const projectConfigDir = join(testDir, ".codex")
    mkdirSync(projectConfigDir, { recursive: true })
    const projectConfigPath = join(projectConfigDir, "auto-resume.jsonc")
    writeFileSync(projectConfigPath, JSON.stringify({ safeToolNames: ["read"] }))
    
    const found = discoverUserConfigPath("codex", testDir)
    assert.strictEqual(found, projectConfigPath)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add test/config-file.test.ts
git commit -m "test: add comprehensive config discovery tests for all platforms"
```

---

### Task 13: Final verification and integration test

**Files:**
- None (verification step)

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Compile TypeScript**

Run: `npx tsc -p tsconfig.json`
Expected: No compilation errors

- [ ] **Step 3: Test in worktree**

Verify the implementation works in the dev worktree by checking:
- Config files can be discovered
- Plugin loads user config correctly
- Warning message appears when config not found

- [ ] **Step 4: Create final commit**

```bash
git add -A
git commit -m "feat: complete user config discovery system with platform-specific locations"
```

---

## Self-Review Checklist

After implementation, verify:
- ✓ Spec coverage: All requirements from design spec implemented
- ✓ No placeholders: All steps contain complete code/content
- ✓ Type consistency: Platform type used consistently across all files
- ✓ Documentation: All INSTALL.md files updated without circular references
- ✓ Tests: Comprehensive test coverage for discovery logic