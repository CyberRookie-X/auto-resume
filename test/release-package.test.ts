import test from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

function listTarEntries(tarball: string): string[] {
  const result = spawnSync("tar", ["-tzf", tarball], {
    cwd: repoRoot,
    encoding: "utf8",
  })

  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stderr)

  return result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function extractTarball(tarball: string, targetDir: string): void {
  const result = spawnSync("tar", ["-xzf", tarball, "-C", targetDir], {
    cwd: repoRoot,
    encoding: "utf8",
  })

  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stderr)
}

function runHookCommand(
  command: string,
  input: string,
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", command], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })

    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })

    child.on("error", reject)
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? -1 })
    })

    child.stdin.end(input)
  })
}

function extractFencedBlocks(readme: string): string[] {
  const blocks: string[] = []
  const pattern = /```(?:[a-z]+)?\n([\s\S]*?)\n```/g

  for (const match of readme.matchAll(pattern)) {
    blocks.push(match[1].trim())
  }

  return blocks
}

async function assertRuntimeReadme(readme: string): Promise<void> {
  const pkg = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"))

  const expected = {
    opencode: {
      "$schema": "https://opencode.ai/config.json",
      plugin: ["github:CyberRookie-X/auto-resume#main"],
    },
    claudePlugin: JSON.parse(await readFile(join(repoRoot, ".claude-plugin", "plugin.json"), "utf8")),
    claudeMarketplace: JSON.parse(await readFile(join(repoRoot, ".claude-plugin", "marketplace.json"), "utf8")),
    claudeSettings: JSON.parse(await readFile(join(repoRoot, ".claude", "settings.json"), "utf8")),
    codexPlugin: JSON.parse(await readFile(join(repoRoot, ".codex-plugin", "plugin.json"), "utf8")),
    hooks: JSON.parse(await readFile(join(repoRoot, "hooks", "hooks.json"), "utf8")),
  }

  const orderedSections = ["### OpenCode", "### Claude Code", "### Codex", "### Offline fallback"]
  let previousIndex = -1

  for (const section of orderedSections) {
    const index = readme.indexOf(section)
    assert.ok(index !== -1, `missing README section: ${section}`)
    assert.ok(index > previousIndex, `README section out of order: ${section}`)
    previousIndex = index
  }

  assert.ok(readme.includes("Use the native plugin flow first:"), "missing install intro")
  assert.ok(readme.includes("Tell OpenCode:"), "missing OpenCode prompt")
  assert.ok(readme.includes("Tell Claude Code:"), "missing Claude Code prompt")
  assert.ok(readme.includes("Tell Codex:"), "missing Codex prompt")
  assert.ok(readme.includes(`github:CyberRookie-X/auto-resume#v${pkg.version}`), "missing pinned version option")
  assert.ok(readme.includes("## Configuration Reference"), "missing configuration reference")
  assert.ok(readme.includes("`auto-resume.jsonc`"), "missing shared default config index")
  assert.ok(readme.includes("`auto-resume.rules.jsonc`"), "missing shared rules config index")
  assert.ok(readme.includes("`opencode.json`"), "missing OpenCode config index")
  assert.ok(readme.includes("`.claude-plugin/plugin.json`"), "missing Claude plugin config index")
  assert.ok(readme.includes("`.claude-plugin/marketplace.json`"), "missing Claude marketplace config index")
  assert.ok(readme.includes("`.claude/settings.json`"), "missing Claude settings config index")
  assert.ok(readme.includes("`.codex-plugin/plugin.json`"), "missing Codex plugin config index")
  assert.ok(readme.includes("`hooks/hooks.json`"), "missing shared hook map index")
  assert.ok(readme.includes("`install.sh` is the offline fallback when you need to unpack a runtime tarball manually."), "missing fallback guidance")

  const installSection = readme.slice(readme.indexOf("Use the native plugin flow first:"), readme.indexOf("## Configuration Reference"))
  const blocks = extractFencedBlocks(installSection)
  assert.equal(blocks.length, 11, "README should have 11 fenced blocks")
  assert.equal(blocks[0], "Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.opencode/INSTALL.md")
  assert.deepEqual(JSON.parse(blocks[1]), expected.opencode)
  assert.deepEqual(JSON.parse(blocks[2]), {"$schema":"https://opencode.ai/config.json","plugin":[`github:CyberRookie-X/auto-resume#v${pkg.version}`]})
  assert.equal(blocks[3], "Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.claude/INSTALL.md")
  assert.deepEqual(JSON.parse(blocks[4]), expected.claudePlugin)
  assert.deepEqual(JSON.parse(blocks[5]), expected.claudeMarketplace)
  assert.deepEqual(JSON.parse(blocks[6]), expected.claudeSettings)
  assert.equal(blocks[7], "Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.codex-plugin/INSTALL.md")
  assert.deepEqual(JSON.parse(blocks[8]), expected.codexPlugin)
  assert.deepEqual(JSON.parse(blocks[9]), expected.hooks)
  assert.equal(blocks[10], "./install.sh --tarball /path/to/auto-resume-runtime.tar.gz --target /path/to/auto-resume")
}

test("runtime release tarball includes release-safe launchers and assets", async () => {
  const releaseDir = await mkdtemp(join(tmpdir(), "auto-resume-release-"))
  const releaseTarball = join(releaseDir, "auto-resume-runtime.tar.gz")

  try {
    const build = spawnSync("npx", ["tsc", "-p", "tsconfig.json"], {
      cwd: repoRoot,
      encoding: "utf8",
    })

    assert.equal(build.error, undefined, build.error?.message)
    assert.equal(build.status, 0, build.stderr || build.stdout)

    const result = spawnSync("npm", ["run", "release:runtime", "--", "--out", releaseTarball], {
      cwd: repoRoot,
      encoding: "utf8",
    })

    assert.equal(result.error, undefined, result.error?.message)
    assert.equal(result.status, 0, result.stderr || result.stdout)

    const entries = listTarEntries(releaseTarball)
    const filesOnly = entries.filter((entry) => !entry.endsWith("/"))
    const expectedFiles = [
      "auto-resume.jsonc",
      "auto-resume.rules.jsonc",
      ".claude-plugin/marketplace.json",
      ".claude-plugin/plugin.json",
      ".claude/settings.json",
      ".codex-plugin/plugin.json",
      "README.md",
      "dist/auto-resume-hook.js",
      "dist/claude-code.js",
      "dist/claude-hook.js",
      "dist/codex-hook.js",
      "dist/codex.js",
      "dist/config-file.js",
      "dist/config.js",
      "dist/core.js",
      "dist/index.js",
      "dist/opencode.js",
      "dist/rules-sync.js",
      "dist/replay.js",
      "dist/types.js",
      "hooks/auto-resume-hook.js",
      "hooks/claude-hook.js",
      "hooks/codex-hook.js",
      "hooks/hooks.json",
      "package.json",
    ]

    for (const expected of expectedFiles) {
      assert.equal(filesOnly.includes(expected), true, expected)
    }

    assert.equal(filesOnly.length, expectedFiles.length, filesOnly.join("\n"))

    assert.equal(filesOnly.some((entry) => /\.tsx?$/.test(entry)), false, filesOnly.join("\n"))

    const extractDir = await mkdtemp(join(tmpdir(), "auto-resume-release-extract-"))
    try {
      extractTarball(releaseTarball, extractDir)

      const runtimeReadme = await readFile(join(extractDir, "README.md"), "utf8")
      await assertRuntimeReadme(runtimeReadme)

      const runtimePackage = JSON.parse(await readFile(join(extractDir, "package.json"), "utf8"))
      assert.equal(runtimePackage.main, "dist/opencode.js")

      const claude = runHookCommand(
        'node "${CLAUDE_PROJECT_DIR}/hooks/claude-hook.js"',
        "not json\n",
        { CLAUDE_PROJECT_DIR: extractDir },
      )
      const codex = runHookCommand(
        'node "${CLAUDE_PLUGIN_ROOT}/hooks/codex-hook.js"',
        "not json\n",
        { CLAUDE_PLUGIN_ROOT: extractDir, PLUGIN_ROOT: extractDir },
      )

      const [claudeResult, codexResult] = await Promise.all([claude, codex])

      assert.equal(claudeResult.code, 0)
      assert.equal(claudeResult.stdout, "")
      assert.equal(claudeResult.stderr, "")
      assert.equal(codexResult.code, 0)
      assert.equal(codexResult.stdout.trim(), '{"continue":false}')
      assert.equal(codexResult.stderr, "")
    } finally {
      await rm(extractDir, { recursive: true, force: true })
    }
  } finally {
    await rm(releaseDir, { recursive: true, force: true })
  }
})
