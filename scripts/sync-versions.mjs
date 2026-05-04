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
  
  // Update README files
  const readmeFiles = ["README.md", "README.zh.md"]
  for (const file of readmeFiles) {
    const readmePath = join(repoRoot, file)
    let content = await readFile(readmePath, "utf8")
    content = content.replace(/v0\.1\.\d+/g, `v${version}`)
    await writeFile(readmePath, content)
    console.log(`✓ ${file}`)
  }
  
  // Update INSTALL.md files
  const installFiles = [
    ".opencode/INSTALL.md",
    ".claude/INSTALL.md",
    ".codex-plugin/INSTALL.md"
  ]
  for (const file of installFiles) {
    const installPath = join(repoRoot, file)
    try {
      let content = await readFile(installPath, "utf8")
      content = content.replace(/v0\.1\.\d+/g, `v${version}`)
      await writeFile(installPath, content)
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