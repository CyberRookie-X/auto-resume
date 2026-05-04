# Native Plugin Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `auto-resume` installable through OpenCode, Claude Code, and Codex native plugin flows without making `install.sh` the primary path.

**Architecture:** Keep the shared recovery logic in TypeScript and add thin host-facing entrypoints plus plugin metadata. OpenCode installs from GitHub using the repo's published package entrypoint; Claude Code and Codex discover the same repo through marketplace/plugin manifests; the runtime tarball remains the offline fallback and now includes the new plugin assets.

**Tech Stack:** TypeScript, Node.js test runner, JSON config files, OpenCode plugin loader, Claude Code plugin/marketplace files, Codex plugin/marketplace files, bash release/install scripts.

---

### Task 1: Add a unified host hook launcher

**Files:**
- Create: `src/auto-resume-hook.ts`
- Create: `hooks/auto-resume-hook.js`
- Test: `test/auto-resume-hook.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test"
import assert from "node:assert/strict"

import { runAutoResumeHook } from "../src/auto-resume-hook.js"

test("dispatches to Codex when PLUGIN_ROOT is set", async () => {
  const calls: string[] = []

  const output = await runAutoResumeHook(
    JSON.stringify({ sessionID: "ses_1", transcriptPath: "/tmp/ses_1.jsonl", cwd: "/tmp/project" }),
    { PLUGIN_ROOT: "/tmp/plugin", CLAUDE_PLUGIN_ROOT: "/tmp/plugin" },
    {
      recoverClaudeSession: async () => {
        throw new Error("should not call Claude path")
      },
      recoverCodexSession: async () => {
        calls.push("codex")
        return { continue: false }
      },
    },
  )

  assert.deepEqual(calls, ["codex"])
  assert.equal(output, "{\"continue\":false}\n")
})

test("dispatches to Claude when PLUGIN_ROOT is absent", async () => {
  const calls: string[] = []

  const output = await runAutoResumeHook(
    JSON.stringify({ sessionID: "ses_2", transcriptPath: "/tmp/ses_2.jsonl", cwd: "/tmp/project" }),
    { CLAUDE_PLUGIN_ROOT: "/tmp/plugin" },
    {
      recoverClaudeSession: async () => {
        calls.push("claude")
      },
      recoverCodexSession: async () => {
        throw new Error("should not call Codex path")
      },
    },
  )

  assert.deepEqual(calls, ["claude"])
  assert.equal(output, undefined)
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- test/auto-resume-hook.test.ts`
Expected: FAIL with `runAutoResumeHook` missing or undefined.

- [ ] **Step 3: Implement the unified dispatcher**

```ts
import { stdin, stdout } from "node:process"

import { parseClaudeHookInput, recoverClaudeSession } from "./claude-code.js"
import { parseCodexHookInput, recoverCodexSession } from "./codex.js"

export type AutoResumeHookDependencies = {
  recoverClaudeSession?: typeof recoverClaudeSession
  recoverCodexSession?: typeof recoverCodexSession
  write?: (chunk: string) => void
}

export async function runAutoResumeHook(
  rawInput: string,
  env: { PLUGIN_ROOT?: string; CLAUDE_PLUGIN_ROOT?: string } = process.env,
  deps: AutoResumeHookDependencies = {},
): Promise<void | string> {
  const recoverClaude = deps.recoverClaudeSession ?? recoverClaudeSession
  const recoverCodex = deps.recoverCodexSession ?? recoverCodexSession

  if (env.PLUGIN_ROOT) {
    const input = parseCodexHookInput(rawInput)
    const output = await recoverCodex(input)
    const text = `${JSON.stringify(output)}\n`
    if (deps.write) deps.write(text)
    else stdout.write(text)
    return text
  }

  const input = parseClaudeHookInput(rawInput)
  if (!input) return
  await recoverClaude(input)
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []

  for await (const chunk of stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  }

  return Buffer.concat(chunks).toString("utf8")
}

async function main(): Promise<void> {
  const rawInput = await readStdin()
  await runAutoResumeHook(rawInput)
}

void main().catch(() => {
  if (process.env.PLUGIN_ROOT) {
    stdout.write(`${JSON.stringify({ decision: "block", reason: "RESUME" })}\n`)
  }
})
```

- [ ] **Step 4: Add the runtime JS wrapper**

```js
import "../dist/auto-resume-hook.js"
```

- [ ] **Step 5: Run the test again and commit**

Run: `npm test -- test/auto-resume-hook.test.ts`
Expected: PASS.

```bash
git add src/auto-resume-hook.ts hooks/auto-resume-hook.js test/auto-resume-hook.test.ts
git commit -m "feat: add unified auto-resume hook launcher"
```

### Task 2: Make OpenCode install through GitHub

**Files:**
- Modify: `src/opencode.ts`
- Modify: `package.json`
- Test: `test/opencode-plugin.test.ts`

- [ ] **Step 1: Write the failing OpenCode plugin test**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import autoResumePlugin, { createOpenCodeAdapter } from "../src/opencode.js"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

test("OpenCode plugin config points at the GitHub repo", async () => {
  const pkg = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"))
  const config = {
    "$schema": "https://opencode.ai/config.json",
    plugin: [`github:CyberRookie-X/auto-resume#v${pkg.version}`],
  }

  assert.deepEqual(config.plugin, [`github:CyberRookie-X/auto-resume#v${pkg.version}`])
  assert.equal(pkg.main, "src/opencode.ts")
  assert.equal(pkg.prepare, undefined)
})

test("default export returns an event hook", async () => {
  const prompts: unknown[] = []
  const client = {
    session: {
      get: async () => ({ data: { id: "ses_1" } }),
      messages: async () => ({ data: [] }),
      prompt: async (call: unknown) => {
        prompts.push(call)
      },
    },
  }

  const plugin = await autoResumePlugin({ client, config: { rules: [] } })

  assert.equal(typeof plugin.event, "function")
  assert.equal(typeof createOpenCodeAdapter, "function")
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- test/opencode-plugin.test.ts`
Expected: FAIL because the default export and config shape are not wired yet.

- [ ] **Step 3: Add the plugin entrypoint and package metadata**

```ts
export type OpenCodePluginInput = {
  client: OpenCodeClient
  config?: Partial<AutoResumeConfig>
  timers?: TimerAPI
}

export type OpenCodePluginHooks = {
  event: ({ event }: { event: OpenCodeEvent }) => Promise<void>
}

export async function autoResumePlugin({ client, config = { rules: [] }, timers }: OpenCodePluginInput): Promise<OpenCodePluginHooks> {
  const adapter = createOpenCodeAdapter({ client, config, timers })

  return {
    event: async ({ event }) => {
      await adapter.handleEvent(event)
    },
  }
}

export default autoResumePlugin
```

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["./"]
}
```

Add this to `package.json` if it is missing:

```json
{
  "main": "dist/opencode.js",
  "prepare": "npm run build"
}
```

- [ ] **Step 4: Run the test again and commit**

Run: `npm test -- test/opencode-plugin.test.ts`
Expected: PASS.

```bash
git add src/opencode.ts package.json test/opencode-plugin.test.ts
git commit -m "feat: make OpenCode load auto-resume directly from source"
```

### Task 3: Add Claude and Codex plugin metadata

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Modify: `.claude/settings.json`
- Modify: `.codex-plugin/plugin.json`
- Modify: `hooks/hooks.json`
- Test: `test/plugin-distribution.test.ts`

- [ ] **Step 1: Write the failing distribution metadata test**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

test("plugin metadata points at the shared hook launcher", async () => {
  const hooks = JSON.parse(await readFile(join(repoRoot, "hooks", "hooks.json"), "utf8"))
  const claudeManifest = JSON.parse(await readFile(join(repoRoot, ".claude-plugin", "plugin.json"), "utf8"))
  const marketplace = JSON.parse(await readFile(join(repoRoot, ".claude-plugin", "marketplace.json"), "utf8"))
  const codexManifest = JSON.parse(await readFile(join(repoRoot, ".codex-plugin", "plugin.json"), "utf8"))
  const claudeSettings = JSON.parse(await readFile(join(repoRoot, ".claude", "settings.json"), "utf8"))

  assert.equal(hooks.hooks.Stop[0].hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/auto-resume-hook.js"')
  assert.equal(claudeManifest.hooks, "./hooks/hooks.json")
  assert.equal(marketplace.plugins[0].source, "./")
  assert.equal(codexManifest.hooks, "./hooks/hooks.json")
  assert.equal(claudeSettings.enabledPlugins["auto-resume@auto-resume-marketplace"], true)
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- test/plugin-distribution.test.ts`
Expected: FAIL because the manifests and settings do not exist yet.

- [ ] **Step 3: Add the marketplace and plugin manifests**

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
      "version": "0.1.0",
      "author": {
        "name": "CyberRookie-X"
      }
    }
  ]
}
```

```json
{
  "name": "auto-resume",
  "version": "0.1.0",
  "description": "Recovery hooks for stopped sessions",
  "author": {
    "name": "CyberRookie-X"
  },
  "hooks": "./hooks/hooks.json"
}
```

```json
{
  "name": "auto-resume",
  "version": "0.1.0",
  "description": "Codex recovery hooks for auto-resume",
  "hooks": "./hooks/hooks.json"
}
```

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

- [ ] **Step 4: Run the test again and commit**

Run: `npm test -- test/plugin-distribution.test.ts`
Expected: PASS.

```bash
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json .claude/settings.json .codex-plugin/plugin.json hooks/hooks.json test/plugin-distribution.test.ts
git commit -m "feat: add Claude and Codex plugin metadata"
```

### Task 4: Update runtime packaging, installer coverage, and docs

**Files:**
- Modify: `scripts/package-runtime.mjs`
- Modify: `test/release-package.test.ts`
- Modify: `test/install-script.test.ts`
- Modify: `README.md`
- Modify: `README.zh.md`

- [ ] **Step 1: Write the failing packaging tests**

Update `test/release-package.test.ts` so the runtime tarball assertions include the new plugin assets and the packaged `package.json`:

```ts
const expectedFiles = [
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
  ".claude/settings.json",
  ".codex-plugin/plugin.json",
  "README.md",
  "dist/auto-resume-hook.js",
  "dist/claude-code.js",
  "dist/claude-hook.js",
  "dist/codex-hook.js",
  "dist/codex.js",
  "dist/config.js",
  "dist/core.js",
  "dist/index.js",
  "dist/opencode.js",
  "dist/replay.js",
  "dist/types.js",
  "hooks/auto-resume-hook.js",
  "hooks/claude-hook.js",
  "hooks/codex-hook.js",
  "hooks/hooks.json",
  "package.json",
]

const runtimePackage = JSON.parse(await readFile(join(extractDir, "package.json"), "utf8"))
assert.equal(runtimePackage.main, "dist/opencode.js")
```

Update `test/install-script.test.ts` so the extracted tree is checked for the new plugin assets:

```ts
for (const relativePath of [
  "hooks/auto-resume-hook.js",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  ".claude/settings.json",
  ".codex-plugin/plugin.json",
  "package.json",
  "dist/auto-resume-hook.js",
  "dist/claude-hook.js",
  "dist/codex-hook.js",
]) {
  await expectFile(join(targetDir, relativePath))
}
```

- [ ] **Step 2: Run the packaging tests and confirm they fail**

Run: `npm test -- test/release-package.test.ts`
Expected: FAIL until `scripts/package-runtime.mjs` copies `.claude-plugin/` and the new hook assets.

Run: `npm test -- test/install-script.test.ts`
Expected: FAIL for the same reason.

- [ ] **Step 3: Update runtime packaging and the docs**

```js
const claudePlugin = join(repoRoot, ".claude-plugin", "plugin.json")
const claudeMarketplace = join(repoRoot, ".claude-plugin", "marketplace.json")

await assertExists(claudePlugin, ".claude-plugin/plugin.json")
await assertExists(claudeMarketplace, ".claude-plugin/marketplace.json")

await cp(join(repoRoot, ".claude-plugin"), join(stageDir, ".claude-plugin"), { recursive: true })

await writeFile(
  join(stageDir, "package.json"),
  JSON.stringify(
    {
      name: packageJson.name ?? "auto-resume-runtime",
      version: packageJson.version ?? "0.1.0",
      private: true,
      type: "module",
      main: "dist/opencode.js",
    },
    null,
    2,
  ),
)

const result = spawnSync("tar", ["-czf", outPath, "-C", stageDir, ".claude-plugin", ".claude", ".codex-plugin", "README.md", "dist", "hooks", "package.json"], {
  encoding: "utf8",
})
```

Replace the Install section in `README.md` with a native-first flow:

```md
## Install

### OpenCode

Use the GitHub repo install path:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["github:CyberRookie-X/auto-resume#v0.1.28"]
}
```

### Claude Code

Add the repo marketplace and enable the plugin:

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

### Codex

Add the repository marketplace with Codex's native plugin browser or CLI:

```bash
codex plugin marketplace add ./
codex /plugins
```

### Offline fallback

```bash
./install.sh --tarball /path/to/auto-resume-runtime.tar.gz --target /path/to/auto-resume
```
```

Mirror the same install order in `README.zh.md`.

- [ ] **Step 4: Run the packaging tests, full test suite, build, and commit**

Run: `npm test -- test/release-package.test.ts`
Expected: PASS.

Run: `npm test -- test/install-script.test.ts`
Expected: PASS.

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

```bash
git add scripts/package-runtime.mjs test/release-package.test.ts test/install-script.test.ts README.md README.zh.md
git commit -m "docs: switch install docs to native plugin flows"
```

### Task 5: Final verification

**Files:**
- None, verification only

- [ ] **Step 1: Re-run the focused checks**

Run: `npm test -- test/auto-resume-hook.test.ts test/opencode-plugin.test.ts test/plugin-distribution.test.ts test/release-package.test.ts test/install-script.test.ts`
Expected: PASS.

- [ ] **Step 2: Re-run the full suite and build**

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: If anything changed during verification, commit a new fixup commit**

Use a fresh commit if verification exposed a gap; do not amend an earlier commit unless the repo is still ahead and the commit was created in this session.
