import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

import autoResumePlugin, { createOpenCodeAdapter } from "../src/opencode.js"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

test("OpenCode config points at the GitHub release", async () => {
  const config = JSON.parse(await readFile(join(repoRoot, "opencode.json"), "utf8"))
  const pkg = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"))

  assert.deepEqual(config.plugin, ["github:CyberRookie-X/auto-resume#v0.1.5"])
  assert.equal(pkg.main, "src/opencode.ts")
  assert.equal(pkg.scripts.prepare, undefined)
  assert.equal(pkg.dependencies?.["auto-resume"], undefined)
})

test("default export forwards events through the adapter", async () => {
  let sessionGets = 0
  const plugin = await autoResumePlugin({
    client: {
      session: {
        get: async () => {
          sessionGets += 1
          return { data: { id: "ses_1" } }
        },
        messages: async () => ({ data: [] }),
        prompt: async () => undefined,
      },
    } as any,
    config: { rules: [] },
  })

  assert.equal(typeof createOpenCodeAdapter, "function")
  assert.equal(typeof plugin.event, "function")

  await plugin.event({
    event: {
      type: "session.error",
      properties: {
        sessionID: "ses_1",
        error: { name: "UnknownError", data: { message: "stream_read_error" } },
      },
    },
  } as any)

  assert.equal(sessionGets, 1)
})
