import test from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

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

function runBuild(): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsc", "-p", "tsconfig.json"], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
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
  })
}

test("hook configs point at checked-in JS runtimes", async () => {
  const pluginManifest = JSON.parse(await readFile(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8")) as {
    hooks: string
  }
  const codexHooks = JSON.parse(await readFile(new URL("../hooks/hooks.json", import.meta.url), "utf8")) as {
    hooks: {
      Stop: Array<{
        hooks: Array<{
          command: string
        }>
      }>
    }
  }
  const autoResumeHookSource = await readFile(new URL("../hooks/auto-resume-hook.js", import.meta.url), "utf8")
  const claudeHookSource = await readFile(new URL("../hooks/claude-hook.js", import.meta.url), "utf8")
  const codexHookSource = await readFile(new URL("../hooks/codex-hook.js", import.meta.url), "utf8")

  assert.equal(pluginManifest.hooks, "./hooks/hooks.json")
  assert.equal(codexHooks.hooks.Stop[0].hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/auto-resume-hook.js"')
  assert.equal(autoResumeHookSource.includes('../dist/auto-resume-hook.js'), true)
  assert.equal(claudeHookSource.includes('../dist/claude-hook.js'), true)
  assert.equal(codexHookSource.includes('../dist/codex-hook.js'), true)

  const build = await runBuild()
  assert.equal(build.code, 0, build.stderr)

  const claude = await runHookCommand(
    'node "${CLAUDE_PROJECT_DIR}/hooks/claude-hook.js"',
    "not json\n",
    { CLAUDE_PROJECT_DIR: repoRoot },
  )
  const codex = await runHookCommand(
    codexHooks.hooks.Stop[0].hooks[0].command,
    "not json\n",
    { CLAUDE_PLUGIN_ROOT: repoRoot, PLUGIN_ROOT: repoRoot },
  )

  assert.equal(claude.code, 0)
  assert.equal(claude.stdout, "")
  assert.equal(claude.stderr, "")
  assert.equal(codex.code, 0)
  assert.equal(codex.stdout.trim(), '{"continue":false}')
  assert.equal(codex.stderr, "")
})
