# README Plugin Installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `README.md` and `README.zh.md` so plugin-based installation is the primary path, with a compact configuration reference and `install.sh` as the offline fallback.

**Architecture:** Keep the README as the top-level onboarding doc. Use a short install overview, per-host install notes, and a configuration reference so new users can follow the main path quickly while advanced users can still find every config file. Mirror the English and Chinese docs closely so they do not drift.

**Tech Stack:** Markdown, Node.js test runner, existing docs tests.

---

### Task 1: Rewrite the English README

**Files:**
- Modify: `README.md`
- Modify: `test/release-package.test.ts`
- Modify: `test/install-script.test.ts`

- [ ] **Step 1: Write the failing README assertions**

Update the runtime README assertions so they look for the GitHub install copy instead of the old fallback-first copy.

The runtime README assertions should check for these exact strings:

```ts
assert.equal(runtimeReadme.includes("Use the native plugin flow first:"), true)
assert.equal(
  runtimeReadme.includes(
    "OpenCode loads this plugin directly from GitHub, so you do not need a local build or runtime tarball for this path.",
  ),
  true,
)
assert.equal(
  runtimeReadme.includes(
    "`install.sh` is the offline fallback when you need to unpack a runtime tarball manually.",
  ),
  true,
)
```

Keep the existing runtime package assertions for `package.json.main` and the hook/runtime file checks.

- [ ] **Step 2: Run the focused docs tests and confirm they fail**

Run:

```bash
npm test -- test/release-package.test.ts test/install-script.test.ts
```

Expected: FAIL because the current README still leads with the old install text.

- [ ] **Step 3: Rewrite `README.md`**

Replace the current install section with this structure:

```md
## Install

Use the native plugin flow first:

### OpenCode

- OpenCode loads this plugin directly from GitHub, so you do not need a local build or runtime tarball for this path.

### Claude Code

- Claude Code uses `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `.claude/settings.json`.
- The plugin is enabled as `auto-resume@auto-resume-marketplace`.

### Codex

- Codex uses `.codex-plugin/plugin.json` with the shared marketplace metadata and `hooks/hooks.json`.

### Offline fallback

- `install.sh` is the offline fallback when you need to unpack a runtime tarball manually.
```

Add a `## Configuration Reference` section immediately after the install section with short bullets for:

- `opencode.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `.claude/settings.json`
- `.codex-plugin/plugin.json`
- `hooks/hooks.json`

Each bullet should say which host reads the file and what the file does.

- [ ] **Step 4: Re-run the focused docs tests**

Run:

```bash
npm test -- test/release-package.test.ts test/install-script.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the English README update**

```bash
git add README.md test/release-package.test.ts test/install-script.test.ts
git commit -m "docs: make README plugin installation first"
```

### Task 2: Mirror the Chinese README and add localization coverage

**Files:**
- Modify: `README.zh.md`
- Create: `test/readme-installation.test.ts`

- [ ] **Step 1: Write a failing localization test**

Add a test that reads `README.zh.md` and checks the plugin-first install guidance is present in Chinese.

Use these exact assertions:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

test("Chinese README mirrors plugin-first install guidance", async () => {
  const readme = await readFile(join(repoRoot, "README.zh.md"), "utf8")

  assert.match(readme, /## 安装/)
  assert.match(readme, /优先使用各客户端的原生插件安装方式/)
   assert.match(readme, /OpenCode 会直接从 GitHub 加载这个插件/)
  assert.match(readme, /## 配置参考/)
})
```

- [ ] **Step 2: Run the localization test and confirm it fails**

Run:

```bash
npm test -- test/readme-installation.test.ts
```

Expected: FAIL because `README.zh.md` still has the old install wording.

- [ ] **Step 3: Rewrite `README.zh.md` to mirror the English README**

Use the same structure as `README.md`, translated into Chinese:

```md
## 安装

优先使用各客户端的原生插件安装方式：

### OpenCode

- OpenCode 会直接从 GitHub 加载这个插件，所以这条路径不需要本地构建，也不需要手动解包运行时 tarball。

### Claude Code

- Claude Code 使用 `.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json` 和 `.claude/settings.json`。
- 插件通过 `auto-resume@auto-resume-marketplace` 启用。

### Codex

- Codex 使用 `.codex-plugin/plugin.json`、共享的 marketplace 元数据和 `hooks/hooks.json`。

### 离线备用

- `install.sh` 只作为离线备用方案，在需要手动解包运行时 tarball 时使用。
```

Add a `## 配置参考` section with the same file list as the English README, translated into Chinese.

- [ ] **Step 4: Re-run the localization test**

Run:

```bash
npm test -- test/readme-installation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the Chinese README update**

```bash
git add README.zh.md test/readme-installation.test.ts
git commit -m "docs: mirror plugin installation guidance in Chinese"
```

### Task 3: Final verification

**Files:**
- None

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run the build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Check git status**

Run:

```bash
git status --short
```

Expected: only the README and doc-test changes from this plan, or a clean tree if they were already committed.
