import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

test("README.zh.md mirrors the plugin-first install flow and configuration reference", async () => {
  const readme = await readFile(join(repoRoot, "README.zh.md"), "utf8")

  const openCodeIndex = readme.indexOf("### OpenCode")
  const claudeCodeIndex = readme.indexOf("### Claude Code")
  const codexIndex = readme.indexOf("### Codex")
  const offlineFallbackIndex = readme.indexOf("### 离线备用方案")

  assert.equal(readme.includes("优先使用各客户端的原生插件安装方式："), true)
  assert.ok(openCodeIndex !== -1, "missing OpenCode install section")
  assert.ok(claudeCodeIndex !== -1, "missing Claude Code install section")
  assert.ok(codexIndex !== -1, "missing Codex install section")
  assert.ok(offlineFallbackIndex !== -1, "missing offline fallback install section")
  assert.ok(
    openCodeIndex < claudeCodeIndex && claudeCodeIndex < codexIndex && codexIndex < offlineFallbackIndex,
    "install paths are out of order",
  )

  assert.ok(readme.includes("## 配置参考"), "missing configuration reference section")
  assert.ok(readme.includes("`opencode.json`"), "missing OpenCode config reference")
  assert.ok(readme.includes("`.claude-plugin/plugin.json`"), "missing Claude plugin config reference")
  assert.ok(readme.includes("`.codex-plugin/plugin.json`"), "missing Codex config reference")
  assert.ok(readme.includes("`hooks/hooks.json`"), "missing shared hook map reference")
})
