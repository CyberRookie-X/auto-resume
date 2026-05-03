import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { refreshRulesSnapshot, startRulesSyncLoop } from "../src/rules-sync.js"

const rawRulesUrl = "https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/auto-resume.rules.jsonc"
const mirrorRulesUrl = `https://ghfast.top/${rawRulesUrl}`
const validRulesText = `{
  "rules": [
    {
      "id": "fetched-rule",
      "scope": "all",
      "match": { "messageRegex": "fetched" },
      "action": { "type": "prompt", "text": "RESUME" },
      "retry": { "baseMs": 1, "factor": 2, "maxMs": 2, "maxAttempts": 1 }
    }
  ]
}`

test("refreshRulesSnapshot fetches the first valid source and writes the cache", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-resume-rules-sync-"))
  const cachePath = join(tempDir, "auto-resume.rules.cache.jsonc")

  const rules = await refreshRulesSnapshot({
    cachePath,
    fetchImpl: async () => new Response(validRulesText),
    sources: ["https://example.com/auto-resume.rules.jsonc"],
  })

  assert.ok(rules)
  assert.equal(rules?.[0].id, "fetched-rule")

  const cached = await readFile(cachePath, "utf8")
  assert.ok(cached.includes("fetched-rule"))
})

test("refreshRulesSnapshot falls back to ghfast when GitHub fails", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-resume-rules-mirror-"))
  const cachePath = join(tempDir, "auto-resume.rules.cache.jsonc")
  const calls: string[] = []

  const rules = await refreshRulesSnapshot({
    cachePath,
    fetchImpl: async (input) => {
      const url = String(input)
      calls.push(url)

      if (url === rawRulesUrl) {
        throw new Error("github unavailable")
      }

      return new Response(validRulesText)
    },
    githubMirror: {
      enabled: false,
    },
    sources: [rawRulesUrl],
  })

  assert.ok(rules)
  assert.equal(rules?.[0].id, "fetched-rule")
  assert.deepEqual(calls, [rawRulesUrl, mirrorRulesUrl])
})

test("refreshRulesSnapshot can prefer ghfast first", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-resume-rules-mirror-first-"))
  const cachePath = join(tempDir, "auto-resume.rules.cache.jsonc")
  const calls: string[] = []

  const rules = await refreshRulesSnapshot({
    cachePath,
    fetchImpl: async (input) => {
      const url = String(input)
      calls.push(url)

      if (url === mirrorRulesUrl) {
        throw new Error("mirror unavailable")
      }

      return new Response(validRulesText)
    },
    githubMirror: {
      enabled: true,
    },
    sources: [rawRulesUrl],
  })

  assert.ok(rules)
  assert.equal(rules?.[0].id, "fetched-rule")
  assert.deepEqual(calls, [mirrorRulesUrl, rawRulesUrl])
})

test("startRulesSyncLoop refreshes again after each interval", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-resume-rules-loop-"))
  const cachePath = join(tempDir, "auto-resume.rules.cache.jsonc")
  const scheduled: Array<{ callback: () => void | Promise<void>; delayMs: number }> = []
  const fetchCalls: string[] = []

  const stop = startRulesSyncLoop({
    cachePath,
    fetchImpl: async (input) => {
      fetchCalls.push(String(input))
      return new Response(validRulesText)
    },
    intervalMs: 1234,
    onRules: async () => undefined,
    sources: ["https://example.com/auto-resume.rules.jsonc"],
    timers: {
      setTimeout(callback, delayMs) {
        scheduled.push({ callback, delayMs })
        return { id: scheduled.length } as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeout() {
        return undefined
      },
    },
  })

  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].delayMs, 0)

  await scheduled[0].callback()

  assert.equal(fetchCalls.length, 1)
  assert.equal(scheduled.length, 2)
  assert.equal(scheduled[1].delayMs, 1234)

  stop()
})
