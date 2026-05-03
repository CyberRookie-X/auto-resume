import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

const rawInstallSnippets = [
  "Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.opencode/INSTALL.md",
  "Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.claude/INSTALL.md",
  "Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.codex-plugin/INSTALL.md",
]

const configBlockSnippets = [
  '"$schema": "https://opencode.ai/config.json"',
  '"plugin": ["./"]',
  '"name": "auto-resume"',
  '"description": "Recovery hooks for stopped sessions"',
  '"hooks": "./hooks/hooks.json"',
  '"name": "auto-resume-marketplace"',
  '"source": "./"',
  '"extraKnownMarketplaces"',
  '"enabledPlugins"',
  '"description": "Codex recovery hooks for auto-resume"',
  '"command": "node \\\"${CLAUDE_PLUGIN_ROOT}/hooks/auto-resume-hook.js\\\""',
  '"timeout": 30',
]

const readmeSpecs = [
  {
    path: "README.md",
    installIntro: "Use the native plugin flow first:",
    openCodePrompt: "Tell OpenCode:",
    claudePrompt: "Tell Claude Code:",
    codexPrompt: "Tell Codex:",
    fallbackHeading: "### Offline fallback",
    fallbackLine: "`install.sh` is the offline fallback when you need to unpack a runtime tarball manually.",
    configHeading: "## Configuration Reference",
    configIndexSnippets: [
      "`opencode.json`",
      "`.claude-plugin/plugin.json`",
      "`.claude-plugin/marketplace.json`",
      "`.claude/settings.json`",
      "`.codex-plugin/plugin.json`",
      "`hooks/hooks.json`",
    ],
    legacySnippets: [
      "OpenCode reads this file to load the local plugin checkout.",
      "Claude Code reads this plugin manifest to point at `hooks/hooks.json`.",
      "Claude Code reads this marketplace definition to expose the repo as `auto-resume-marketplace`.",
      "Claude Code reads this settings file to enable `auto-resume@auto-resume-marketplace`.",
      "Codex reads this plugin manifest to point at the shared hook map.",
    ],
  },
  {
    path: "README.zh.md",
    installIntro: "优先使用各客户端的原生插件安装方式：",
    openCodePrompt: "告诉 OpenCode：",
    claudePrompt: "告诉 Claude Code：",
    codexPrompt: "告诉 Codex：",
    fallbackHeading: "### 离线备用方案",
    fallbackLine: "`install.sh` 是离线备用方案，用于需要手动解包运行时 tarball 的情况。",
    configHeading: "## 配置参考",
    configIndexSnippets: [
      "`opencode.json`",
      "`.claude-plugin/plugin.json`",
      "`.claude-plugin/marketplace.json`",
      "`.claude/settings.json`",
      "`.codex-plugin/plugin.json`",
      "`hooks/hooks.json`",
    ],
    legacySnippets: [
      "OpenCode 会通过 `opencode.json` 里的 `plugin: [\"./\"]` 直接加载这个 checkout。",
      "Claude Code 使用 `.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json` 和 `.claude/settings.json`。",
      "Codex 使用 `.codex-plugin/plugin.json`，配合共享的 marketplace 元数据和 `hooks/hooks.json`。",
    ],
  },
]

function assertOrdered(readme: string, headings: string[], filePath: string): void {
  let previousIndex = -1

  for (const heading of headings) {
    const index = readme.indexOf(heading)
    assert.ok(index !== -1, `${filePath} missing ${heading}`)
    assert.ok(index > previousIndex, `${filePath} has out-of-order section ${heading}`)
    previousIndex = index
  }
}

function assertInstallReadme(readme: string, spec: (typeof readmeSpecs)[number]): void {
  assert.ok(readme.includes(spec.installIntro), `${spec.path} missing install intro`)
  assertOrdered(readme, ["### OpenCode", "### Claude Code", "### Codex", spec.fallbackHeading], spec.path)
  assert.ok(readme.includes(spec.openCodePrompt), `${spec.path} missing OpenCode prompt`)
  assert.ok(readme.includes(spec.claudePrompt), `${spec.path} missing Claude Code prompt`)
  assert.ok(readme.includes(spec.codexPrompt), `${spec.path} missing Codex prompt`)

  for (const snippet of rawInstallSnippets) {
    assert.ok(readme.includes(snippet), `${spec.path} missing raw install snippet: ${snippet}`)
  }

  for (const snippet of configBlockSnippets) {
    assert.ok(readme.includes(snippet), `${spec.path} missing config block snippet: ${snippet}`)
  }

  assert.ok(readme.includes(spec.fallbackLine), `${spec.path} missing fallback install.sh guidance`)
  assert.ok(readme.includes(spec.configHeading), `${spec.path} missing configuration index`)

  for (const snippet of spec.configIndexSnippets) {
    assert.ok(readme.includes(snippet), `${spec.path} missing config index item ${snippet}`)
  }

  for (const legacy of spec.legacySnippets) {
    assert.equal(readme.includes(legacy), false, `${spec.path} still includes old reference text: ${legacy}`)
  }
}

test("README files mirror the plugin-first install flow and configuration index", async () => {
  for (const spec of readmeSpecs) {
    const readme = await readFile(join(repoRoot, spec.path), "utf8")
    assertInstallReadme(readme, spec)
  }
})
