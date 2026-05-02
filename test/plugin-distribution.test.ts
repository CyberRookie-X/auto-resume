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
  assert.equal(claudeSettings.extraKnownMarketplaces["auto-resume-marketplace"].source.repo, "CyberRookie-X/auto-resume")
  assert.equal(claudeSettings.enabledPlugins["auto-resume@auto-resume-marketplace"], true)
  assert.equal(claudeSettings.hooks, undefined)
})
