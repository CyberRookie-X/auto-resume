import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

const rawInstallSnippets = {
  en: [
    "Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.opencode/INSTALL.md",
    "Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.claude/INSTALL.md",
    "Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.codex-plugin/INSTALL.md",
  ],
  zh: [
    "Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.opencode/INSTALL.md",
    "Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.claude/INSTALL.md",
    "Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.codex-plugin/INSTALL.md",
  ],
}

function extractFencedBlocks(readme: string): string[] {
  const blocks: string[] = []
  const pattern = /```(?:[a-z]+)?\n([\s\S]*?)\n```/g

  for (const match of readme.matchAll(pattern)) {
    blocks.push(match[1].trim())
  }

  return blocks
}

function assertOrdered(readme: string, headings: string[], filePath: string): void {
  let previousIndex = -1

  for (const heading of headings) {
    const index = readme.indexOf(heading)
    assert.ok(index !== -1, `${filePath} missing ${heading}`)
    assert.ok(index > previousIndex, `${filePath} has out-of-order section ${heading}`)
    previousIndex = index
  }
}

async function loadExpectedJson() {
  const pkg = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"))

  return {
    opencode: {
      "$schema": "https://opencode.ai/config.json",
      plugin: [`github:CyberRookie-X/auto-resume#v${pkg.version}`],
    },
    claudePlugin: JSON.parse(await readFile(join(repoRoot, ".claude-plugin", "plugin.json"), "utf8")),
    claudeMarketplace: JSON.parse(await readFile(join(repoRoot, ".claude-plugin", "marketplace.json"), "utf8")),
    claudeSettings: JSON.parse(await readFile(join(repoRoot, ".claude", "settings.json"), "utf8")),
    codexPlugin: JSON.parse(await readFile(join(repoRoot, ".codex-plugin", "plugin.json"), "utf8")),
    hooks: JSON.parse(await readFile(join(repoRoot, "hooks", "hooks.json"), "utf8")),
  }
}

function assertInstallReadme(
  readme: string,
  spec: {
    path: string
    installIntro: string
    openCodePrompt: string
    claudePrompt: string
    codexPrompt: string
    fallbackHeading: string
    fallbackLine: string
    configHeading: string
  configIndexSnippets: string[]
  legacySnippets: string[]
  labelSnippets: string[]
  language: "en" | "zh"
},
expected: Awaited<ReturnType<typeof loadExpectedJson>>,
): void {
  assert.ok(readme.includes(spec.installIntro), `${spec.path} missing install intro`)
  assertOrdered(readme, ["### OpenCode", "### Claude Code", "### Codex", spec.fallbackHeading], spec.path)
  assert.ok(readme.includes(spec.openCodePrompt), `${spec.path} missing OpenCode prompt`)
  assert.ok(readme.includes(spec.claudePrompt), `${spec.path} missing Claude Code prompt`)
  assert.ok(readme.includes(spec.codexPrompt), `${spec.path} missing Codex prompt`)
  assert.ok(readme.includes(spec.fallbackLine), `${spec.path} missing fallback install.sh guidance`)
  assert.ok(readme.includes(spec.configHeading), `${spec.path} missing configuration index`)

  for (const snippet of spec.configIndexSnippets) {
    assert.ok(readme.includes(snippet), `${spec.path} missing config index item ${snippet}`)
  }

  for (const legacy of spec.legacySnippets) {
    assert.equal(readme.includes(legacy), false, `${spec.path} still includes old reference text: ${legacy}`)
  }

  for (const snippet of spec.labelSnippets) {
    assert.ok(readme.includes(snippet), `${spec.path} missing label snippet ${snippet}`)
  }

  const installStart = readme.indexOf(spec.installIntro)
  const installEnd = readme.indexOf(spec.configHeading)
  const blocks = extractFencedBlocks(readme.slice(installStart, installEnd))
  assert.equal(blocks.length, 10, `${spec.path} should have 10 fenced blocks`)

  assert.equal(blocks[0], rawInstallSnippets[spec.language][0])
  assert.deepEqual(JSON.parse(blocks[1]), expected.opencode)
  assert.equal(blocks[2], rawInstallSnippets[spec.language][1])
  assert.deepEqual(JSON.parse(blocks[3]), expected.claudePlugin)
  assert.deepEqual(JSON.parse(blocks[4]), expected.claudeMarketplace)
  assert.deepEqual(JSON.parse(blocks[5]), expected.claudeSettings)
  assert.equal(blocks[6], rawInstallSnippets[spec.language][2])
  assert.deepEqual(JSON.parse(blocks[7]), expected.codexPlugin)
  assert.deepEqual(JSON.parse(blocks[8]), expected.hooks)
  assert.equal(blocks[9], "./install.sh --tarball /path/to/auto-resume-runtime.tar.gz --target /path/to/auto-resume")
}

test("README files mirror the plugin-first install flow and configuration index", async () => {
  const expected = await loadExpectedJson()

  const specs = [
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
        "`auto-resume.jsonc`",
        "`auto-resume.rules.jsonc`",
        "`opencode.json`",
        "`.claude-plugin/plugin.json`",
        "`.claude-plugin/marketplace.json`",
        "`.claude/settings.json`",
        "`.codex-plugin/plugin.json`",
        "`hooks/hooks.json`",
      ],
      legacySnippets: [
        "shared default recovery rules and the read-only tool allow list.",
        "Claude Code reads this plugin manifest to point at `hooks/hooks.json`.",
        "Claude Code reads this marketplace definition to expose the repo as `auto-resume-marketplace`.",
        "Claude Code reads this settings file to enable `auto-resume@auto-resume-marketplace`.",
        "Codex reads this plugin manifest to point at the shared hook map.",
      ],
      labelSnippets: [
        "Create or update `opencode.json`:",
        "Create or update these files:",
        "`.claude-plugin/plugin.json`",
        "`.claude-plugin/marketplace.json`",
        "`.claude/settings.json`",
        "`.codex-plugin/plugin.json`",
        "`hooks/hooks.json`",
      ],
      language: "en" as const,
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
        "`auto-resume.jsonc`",
        "`auto-resume.rules.jsonc`",
        "`opencode.json`",
        "`.claude-plugin/plugin.json`",
        "`.claude-plugin/marketplace.json`",
        "`.claude/settings.json`",
        "`.codex-plugin/plugin.json`",
        "`hooks/hooks.json`",
      ],
      legacySnippets: [
        "所有运行时共享的默认恢复规则和只读工具白名单。",
        "Claude Code 使用 `.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json` 和 `.claude/settings.json`。",
        "Codex 使用 `.codex-plugin/plugin.json`，配合共享的 marketplace 元数据和 `hooks/hooks.json`。",
      ],
      labelSnippets: [
        "创建或更新 `opencode.json`：",
        "创建或更新这些文件：",
        "`.claude-plugin/plugin.json`",
        "`.claude-plugin/marketplace.json`",
        "`.claude/settings.json`",
        "`.codex-plugin/plugin.json`",
        "`hooks/hooks.json`",
      ],
      language: "zh" as const,
    },
  ]

  for (const spec of specs) {
    const readme = await readFile(join(repoRoot, spec.path), "utf8")
    assertInstallReadme(readme, spec, expected)
  }
})
