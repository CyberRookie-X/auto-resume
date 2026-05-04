import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const repoRoot = join(new URL("..", import.meta.url).pathname)

async function main() {
  const pkg = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"))
  const version = pkg.version

  console.log(`Syncing version ${version} to all files...`)

  // Update opencode.json
  const opencodePath = join(repoRoot, "opencode.json")
  const opencode = JSON.parse(await readFile(opencodePath, "utf8"))
  opencode.plugin[0] = `github:CyberRookie-X/auto-resume#v${version}`
  await writeFile(opencodePath, JSON.stringify(opencode, null, 2) + "\n")
  console.log("✓ opencode.json")

  // Update Claude and Codex plugin manifests
  const manifestFiles = [
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    ".codex-plugin/plugin.json",
  ]
  for (const file of manifestFiles) {
    const manifestPath = join(repoRoot, file)
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))

    if (file === ".claude-plugin/marketplace.json") {
      for (const plugin of manifest.plugins ?? []) {
        plugin.version = version
      }
    } else {
      manifest.version = version
    }

    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
    console.log(`✓ ${file}`)
  }

  // Update README and INSTALL files
  const textFiles = ["README.md", "README.zh.md", ".opencode/INSTALL.md", ".claude/INSTALL.md", ".codex-plugin/INSTALL.md"]
  for (const file of textFiles) {
    const textPath = join(repoRoot, file)
    try {
      let content = await readFile(textPath, "utf8")
      content = content.replace(/v?0\.1\.\d+/g, (match) => (match.startsWith("v") ? `v${version}` : version))
      await writeFile(textPath, content)
      console.log(`✓ ${file}`)
    } catch {
      console.log(`⊗ ${file} (not found)`)
    }
  }

  console.log(`\n✓ All files synced to version ${version}`)
}

main().catch(err => {
  console.error("Error:", err.message)
  process.exit(1)
})
