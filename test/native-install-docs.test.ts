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

test("host INSTALL docs expose raw fetch instructions and copyable configs", async () => {
  const opencode = await readFile(join(repoRoot, ".opencode", "INSTALL.md"), "utf8")
  const claude = await readFile(join(repoRoot, ".claude", "INSTALL.md"), "utf8")
  const codex = await readFile(join(repoRoot, ".codex-plugin", "INSTALL.md"), "utf8")
  const opencodeJson = await readFile(join(repoRoot, "opencode.json"), "utf8")
  const claudePlugin = await readFile(join(repoRoot, ".claude-plugin", "plugin.json"), "utf8")
  const claudeMarketplace = await readFile(join(repoRoot, ".claude-plugin", "marketplace.json"), "utf8")
  const claudeSettings = await readFile(join(repoRoot, ".claude", "settings.json"), "utf8")
  const codexPlugin = await readFile(join(repoRoot, ".codex-plugin", "plugin.json"), "utf8")
  const hooksJson = await readFile(join(repoRoot, "hooks", "hooks.json"), "utf8")

  assert.match(
    opencode,
    /Fetch and follow instructions from https:\/\/raw\.githubusercontent\.com\/CyberRookie-X\/auto-resume\/refs\/heads\/main\/\.opencode\/INSTALL\.md/,
  )
  assert.equal(extractFencedBlocks(opencode)[0], "Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.opencode/INSTALL.md")
  assertJsonBlock(opencode, 1, JSON.parse(opencodeJson))

  assert.match(
    claude,
    /Fetch and follow instructions from https:\/\/raw\.githubusercontent\.com\/CyberRookie-X\/auto-resume\/refs\/heads\/main\/\.claude\/INSTALL\.md/,
  )
  assert.equal(extractFencedBlocks(claude)[0], "Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.claude/INSTALL.md")
  assertJsonBlock(claude, 1, JSON.parse(claudePlugin))
  assertJsonBlock(claude, 2, JSON.parse(claudeMarketplace))
  assertJsonBlock(claude, 3, JSON.parse(claudeSettings))

  assert.match(
    codex,
    /Fetch and follow instructions from https:\/\/raw\.githubusercontent\.com\/CyberRookie-X\/auto-resume\/refs\/heads\/main\/\.codex-plugin\/INSTALL\.md/,
  )
  assert.equal(extractFencedBlocks(codex)[0], "Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.codex-plugin/INSTALL.md")
  assertJsonBlock(codex, 1, JSON.parse(codexPlugin))
  assertJsonBlock(codex, 2, JSON.parse(hooksJson))
})
