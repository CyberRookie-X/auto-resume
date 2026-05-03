# Native Install Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make plugin-based installation the primary onboarding path in `README.md` and `README.zh.md`, while adding host-specific `INSTALL.md` files that agents can fetch directly and copyable config blocks that humans can paste without guessing.

**Architecture:** Keep the README as the top-level entry point, but split host setup into two layers: a raw `INSTALL.md` that tells the host to fetch and follow instructions, and a manual config block that can be copied directly. Each host gets its own focused `INSTALL.md`, and the README stays concise by linking to those docs while still showing the exact config users need.

**Tech Stack:** Markdown, Node.js test runner, existing packaging/install tests.

---

### Task 1: Add host-specific INSTALL docs

**Files:**
- Create: `.opencode/INSTALL.md`
- Create: `.claude/INSTALL.md`
- Create: `.codex-plugin/INSTALL.md`
- Create: `test/native-install-docs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/native-install-docs.test.ts` with checks that each host INSTALL doc exists and contains the raw fetch instruction plus the matching copyable config blocks.

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

test("host INSTALL docs expose raw fetch instructions and copyable configs", async () => {
  const opencode = await readFile(join(repoRoot, ".opencode", "INSTALL.md"), "utf8")
  const claude = await readFile(join(repoRoot, ".claude", "INSTALL.md"), "utf8")
  const codex = await readFile(join(repoRoot, ".codex-plugin", "INSTALL.md"), "utf8")

  assert.match(
    opencode,
    /Fetch and follow instructions from https:\/\/raw\.githubusercontent\.com\/CyberRookie-X\/auto-resume\/refs\/heads\/main\/\.opencode\/INSTALL\.md/,
  )
  assert.match(opencode, /"plugin": \["\.\/"\]/)

  assert.match(
    claude,
    /Fetch and follow instructions from https:\/\/raw\.githubusercontent\.com\/CyberRookie-X\/auto-resume\/refs\/heads\/main\/\.claude\/INSTALL\.md/,
  )
  assert.match(claude, /"hooks": "\.\/hooks\/hooks\.json"/)
  assert.match(claude, /"auto-resume@auto-resume-marketplace": true/)

  assert.match(
    codex,
    /Fetch and follow instructions from https:\/\/raw\.githubusercontent\.com\/CyberRookie-X\/auto-resume\/refs\/heads\/main\/\.codex-plugin\/INSTALL\.md/,
  )
  assert.match(codex, /"hooks": "\.\/hooks\/hooks\.json"/)
})
```

- [ ] **Step 2: Run the focused test and confirm it fails first**

Run:

```bash
npm test -- test/native-install-docs.test.ts
```

Expected: fail with `ENOENT` because the three `INSTALL.md` files do not exist yet.

- [ ] **Step 3: Implement the three INSTALL docs**

Create the files with these exact contents.

`.opencode/INSTALL.md`

    # Installing auto-resume for OpenCode

    Tell OpenCode:

    ```text
    Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.opencode/INSTALL.md
    ```

    Create or update `opencode.json`:

    ```json
    {
      "$schema": "https://opencode.ai/config.json",
      "plugin": ["./"]
    }
    ```

    Restart OpenCode.

`.claude/INSTALL.md`

    # Installing auto-resume for Claude Code

    Tell Claude Code:

    ```text
    Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.claude/INSTALL.md
    ```

    Create or update these files:

    `.claude-plugin/plugin.json`

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
          "version": "0.1.0",
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

`.codex-plugin/INSTALL.md`

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
      "version": "0.1.0",
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

- [ ] **Step 4: Re-run the focused test**

Run:

```bash
npm test -- test/native-install-docs.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the INSTALL docs**

```bash
git add .opencode/INSTALL.md .claude/INSTALL.md .codex-plugin/INSTALL.md test/native-install-docs.test.ts
git commit -m "docs: add host INSTALL guides"
```

### Task 2: Update the README install guidance

**Files:**
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `test/readme-installation.test.ts`
- Modify: `test/release-package.test.ts`
- Modify: `test/install-script.test.ts`

- [ ] **Step 1: Write the failing README assertions**

Update `test/readme-installation.test.ts` so it checks both README files expose the raw-install flow, the manual config blocks, and the section order.

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

test("README install guidance mirrors raw-install plus copyable configs", async () => {
  const en = await readFile(join(repoRoot, "README.md"), "utf8")
  const zh = await readFile(join(repoRoot, "README.zh.md"), "utf8")

  const enOrder = [
    en.indexOf("### OpenCode"),
    en.indexOf("### Claude Code"),
    en.indexOf("### Codex"),
    en.indexOf("### Offline fallback"),
  ]

  const zhOrder = [
    zh.indexOf("### OpenCode"),
    zh.indexOf("### Claude Code"),
    zh.indexOf("### Codex"),
    zh.indexOf("### 离线备用方案"),
  ]

  assert.ok(en.includes("Tell OpenCode:"))
  assert.ok(en.includes("https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.opencode/INSTALL.md"))
  assert.ok(en.includes("Tell Claude Code:"))
  assert.ok(en.includes("https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.claude/INSTALL.md"))
  assert.ok(en.includes("Tell Codex:"))
  assert.ok(en.includes("https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.codex-plugin/INSTALL.md"))
  assert.ok(en.includes("## Configuration Reference"))
  assert.ok(en.includes("`opencode.json`"))
  assert.ok(en.includes("`.claude-plugin/plugin.json`"))
  assert.ok(en.includes("`.codex-plugin/plugin.json`"))

  assert.ok(zh.includes("优先使用各客户端的原生插件安装方式："))
  assert.ok(zh.includes("让 OpenCode："))
  assert.ok(zh.includes("https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.opencode/INSTALL.md"))
  assert.ok(zh.includes("让 Claude Code："))
  assert.ok(zh.includes("https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.claude/INSTALL.md"))
  assert.ok(zh.includes("让 Codex："))
  assert.ok(zh.includes("https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.codex-plugin/INSTALL.md"))
  assert.ok(zh.includes("## 配置参考"))

  assert.ok(enOrder.every((index) => index !== -1), "missing English install headings")
  assert.ok(enOrder[0] < enOrder[1] && enOrder[1] < enOrder[2] && enOrder[2] < enOrder[3], "English install order is wrong")
  assert.ok(zhOrder.every((index) => index !== -1), "missing Chinese install headings")
  assert.ok(zhOrder[0] < zhOrder[1] && zhOrder[1] < zhOrder[2] && zhOrder[2] < zhOrder[3], "Chinese install order is wrong")
})
```

Update `test/release-package.test.ts` and `test/install-script.test.ts` so the packaged/runtime README checks look for the raw install instructions and copyable config blocks, not the earlier summary-only wording.

Use these assertions in both tests:

```ts
assert.equal(runtimeReadme.includes("Tell OpenCode:"), true)
assert.equal(
  runtimeReadme.includes(
    "https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.opencode/INSTALL.md",
  ),
  true,
)
assert.equal(runtimeReadme.includes("Tell Claude Code:"), true)
assert.equal(
  runtimeReadme.includes(
    "https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.claude/INSTALL.md",
  ),
  true,
)
assert.equal(runtimeReadme.includes("Tell Codex:"), true)
assert.equal(
  runtimeReadme.includes(
    "https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.codex-plugin/INSTALL.md",
  ),
  true,
)
assert.equal(runtimeReadme.includes("## Configuration Reference"), true)
assert.equal(runtimeReadme.includes("`.claude-plugin/plugin.json`"), true)
assert.equal(runtimeReadme.includes("`.codex-plugin/plugin.json`"), true)
```

- [ ] **Step 2: Run the focused docs tests and confirm they fail first**

Run:

```bash
npm test -- test/native-install-docs.test.ts test/readme-installation.test.ts test/release-package.test.ts test/install-script.test.ts
```

Expected: fail because the README files do not yet contain the raw `INSTALL.md` fetch instructions or the direct copyable blocks.

- [ ] **Step 3: Rewrite the README install sections**

Replace the `Install` section in `README.md` with:

    ## Install

    Use the native plugin flow first.

    ### OpenCode

    Tell OpenCode:

    ```text
    Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.opencode/INSTALL.md
    ```

    If you want the direct config instead, create or update `opencode.json` with:

    ```json
    {
      "$schema": "https://opencode.ai/config.json",
      "plugin": ["./"]
    }
    ```

    ### Claude Code

    Tell Claude Code:

    ```text
    Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.claude/INSTALL.md
    ```

    If you want the direct config instead, create or update these files:

    `.claude-plugin/plugin.json`

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
          "version": "0.1.0",
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

    ### Codex

    Tell Codex:

    ```text
    Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.codex-plugin/INSTALL.md
    ```

    If you want the direct config instead, create or update these files:

    `.codex-plugin/plugin.json`

    ```json
    {
      "name": "auto-resume",
      "version": "0.1.0",
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

    ### Offline fallback

    - `install.sh` is the offline fallback when you need to unpack a runtime tarball manually.

    ```bash
    ./install.sh --tarball /path/to/auto-resume-runtime.tar.gz --target /path/to/auto-resume
    ```

Replace the `Install` section in `README.zh.md` with the same structure, translated into Chinese and keeping the raw URLs and JSON blocks identical:

    ## 安装

    优先使用各客户端的原生插件安装方式。

    ### OpenCode

    让 OpenCode：

    ```text
    Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.opencode/INSTALL.md
    ```

    如果要直接配置，请创建或更新 `opencode.json`：

    ```json
    {
      "$schema": "https://opencode.ai/config.json",
      "plugin": ["./"]
    }
    ```

    ### Claude Code

    让 Claude Code：

    ```text
    Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.claude/INSTALL.md
    ```

    如果要直接配置，请创建或更新这些文件：

    `.claude-plugin/plugin.json`

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
          "version": "0.1.0",
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

    ### Codex

    让 Codex：

    ```text
    Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.codex-plugin/INSTALL.md
    ```

    如果要直接配置，请创建或更新这些文件：

    `.codex-plugin/plugin.json`

    ```json
    {
      "name": "auto-resume",
      "version": "0.1.0",
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

    ### 离线备用方案

    - `install.sh` 只作为离线备用方案，用于需要手动解包运行时 tarball 的情况。

    ```bash
    ./install.sh --tarball /path/to/auto-resume-runtime.tar.gz --target /path/to/auto-resume
    ```

Keep the `Configuration Reference` section, but shorten it to a quick index because the install sections now show the copyable configuration blocks directly.

- [ ] **Step 4: Re-run the focused docs tests**

Run:

```bash
npm test -- test/native-install-docs.test.ts test/readme-installation.test.ts test/release-package.test.ts test/install-script.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the README updates**

```bash
git add README.md README.zh.md test/readme-installation.test.ts test/release-package.test.ts test/install-script.test.ts
git commit -m "docs: show raw install guides and copyable configs"
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

Expected: clean tree.
