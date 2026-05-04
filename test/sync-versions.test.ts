import test from "node:test"
import assert from "node:assert/strict"
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

async function copyIntoTemp(tempRoot: string, relativePath: string): Promise<void> {
  const source = join(repoRoot, relativePath)
  const target = join(tempRoot, relativePath)
  await mkdir(join(tempRoot, dirname(relativePath)), { recursive: true })
  await copyFile(source, target)
}

test("sync-versions updates Claude and Codex version fields", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "auto-resume-sync-"))

  try {
    for (const file of [
      "package.json",
      "package-lock.json",
      "README.md",
      "README.zh.md",
      "opencode.json",
      ".opencode/INSTALL.md",
      ".claude/INSTALL.md",
      ".codex-plugin/INSTALL.md",
      ".claude-plugin/plugin.json",
      ".claude-plugin/marketplace.json",
      ".codex-plugin/plugin.json",
      "scripts/sync-versions.mjs",
    ]) {
      await copyIntoTemp(tempRoot, file)
    }

    const pkgPath = join(tempRoot, "package.json")
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"))
    pkg.version = "9.9.9"
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

    const lockPath = join(tempRoot, "package-lock.json")
    const lock = JSON.parse(await readFile(lockPath, "utf8"))
    lock.version = "9.9.9"
    lock.packages[""].version = "9.9.9"
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`)

    const result = spawnSync("node", ["scripts/sync-versions.mjs"], {
      cwd: tempRoot,
      encoding: "utf8",
    })

    assert.equal(result.status, 0, result.stderr || result.stdout)

    const opencode = JSON.parse(await readFile(join(tempRoot, "opencode.json"), "utf8"))
    assert.deepEqual(opencode.plugin, ["github:CyberRookie-X/auto-resume#v9.9.9"])

    const claudePlugin = JSON.parse(await readFile(join(tempRoot, ".claude-plugin", "plugin.json"), "utf8"))
    assert.equal(claudePlugin.version, "9.9.9")

    const claudeMarketplace = JSON.parse(await readFile(join(tempRoot, ".claude-plugin", "marketplace.json"), "utf8"))
    assert.equal(claudeMarketplace.plugins[0].version, "9.9.9")

    const codexPlugin = JSON.parse(await readFile(join(tempRoot, ".codex-plugin", "plugin.json"), "utf8"))
    assert.equal(codexPlugin.version, "9.9.9")

    for (const file of ["README.md", "README.zh.md", ".claude/INSTALL.md", ".codex-plugin/INSTALL.md"]) {
      const content = await readFile(join(tempRoot, file), "utf8")
      assert.ok(content.includes('"version": "9.9.9"'), `${file} still has stale plugin versions`)
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
