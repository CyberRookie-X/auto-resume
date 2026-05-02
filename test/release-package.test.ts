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

test("runtime release tarball includes release-safe launchers and assets", async () => {
  const releaseDir = await mkdtemp(join(tmpdir(), "auto-resume-release-"))
  const releaseTarball = join(releaseDir, "auto-resume-runtime.tar.gz")

  try {
    const build = spawnSync("npm", ["run", "build"], {
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
      "dist/config.js",
      "dist/core.js",
      "dist/index.js",
      "dist/opencode.js",
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
      assert.equal(runtimeReadme.includes("Use the native integration for each client first:"), true)
      assert.equal(
        runtimeReadme.includes(
          'OpenCode loads this checkout directly from `opencode.json` with `plugin: ["./"]`.',
        ),
        true,
      )
      assert.equal(
        runtimeReadme.includes(
          "`install.sh` is the offline fallback when you need to unpack a runtime tarball manually.",
        ),
        true,
      )

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
