import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

function extractFencedBlocks(doc: string): string[] {
  const blocks: string[] = []
  const pattern = /```(?:[a-z]+)?\n([\s\S]*?)\n```/g
  for (const match of doc.matchAll(pattern)) {
    blocks.push(match[1])
  }
  return blocks
}

function assertJsonBlock(doc: string, index: number, expected: unknown): void {
  const blocks = extractFencedBlocks(doc)
  assert.ok(blocks[index] !== undefined, `missing fenced block ${index}`)
  assert.deepEqual(JSON.parse(blocks[index]), expected)
}

test("host INSTALL docs have clear installation instructions and config locations", async () => {
  const opencode = await readFile(join(repoRoot, ".opencode", "INSTALL.md"), "utf8")
  const claude = await readFile(join(repoRoot, ".claude", "INSTALL.md"), "utf8")
  const codex = await readFile(join(repoRoot, ".codex-plugin", "INSTALL.md"), "utf8")
  const pkg = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"))
  const claudePlugin = await readFile(join(repoRoot, ".claude-plugin", "plugin.json"), "utf8")
  const claudeMarketplace = await readFile(join(repoRoot, ".claude-plugin", "marketplace.json"), "utf8")
  const claudeSettings = await readFile(join(repoRoot, ".claude", "settings.json"), "utf8")
  const codexPlugin = await readFile(join(repoRoot, ".codex-plugin", "plugin.json"), "utf8")
  const hooksJson = await readFile(join(repoRoot, "hooks", "hooks.json"), "utf8")
  const expectedOpenCode = {
    "$schema": "https://opencode.ai/config.json",
    plugin: ["github:CyberRookie-X/auto-resume#v0.1.29"],
  }

  // OpenCode INSTALL.md checks
  assert.ok(opencode.includes("# Installing auto-resume for OpenCode"), "missing OpenCode heading")
  assert.ok(opencode.includes("## Install"), "missing Install heading")
  assert.ok(opencode.includes("## Configuration"), "missing Configuration heading")
  assert.ok(opencode.includes("~/.config/opencode/auto-resume.jsonc"), "missing global config location")
  assert.ok(opencode.includes(".opencode/auto-resume.jsonc"), "missing project config location")
  assertJsonBlock(opencode, 0, expectedOpenCode)
  assertJsonBlock(opencode, 1, expectedOpenCode)

  // Claude Code INSTALL.md checks
  assert.ok(claude.includes("# Installing auto-resume for Claude Code"), "missing Claude Code heading")
  assert.ok(claude.includes("## Configuration"), "missing Configuration heading")
  assert.ok(claude.includes("~/.claude/auto-resume.jsonc"), "missing global config location")
  assert.ok(claude.includes(".claude/auto-resume.jsonc"), "missing project config location")
  assertJsonBlock(claude, 0, JSON.parse(claudePlugin))
  assertJsonBlock(claude, 1, JSON.parse(claudeMarketplace))
  assertJsonBlock(claude, 2, JSON.parse(claudeSettings))

  // Codex INSTALL.md checks
  assert.ok(codex.includes("# Installing auto-resume for Codex"), "missing Codex heading")
  assert.ok(codex.includes("## Configuration"), "missing Configuration heading")
  assert.ok(codex.includes("~/.codex/auto-resume.jsonc"), "missing global config location")
  assert.ok(codex.includes(".codex/auto-resume.jsonc"), "missing project config location")
  assertJsonBlock(codex, 0, JSON.parse(codexPlugin))
  assertJsonBlock(codex, 1, JSON.parse(hooksJson))
})