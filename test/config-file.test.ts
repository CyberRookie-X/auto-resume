import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDefaultConfig } from "../src/index.js"
import {
  loadAutoResumeConfigFile,
  loadAutoResumeRulesFile,
  loadAutoResumeRuntimeConfigFile,
} from "../src/config-file.js"

test("parses the runtime config file", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-resume-jsonc-"))
  const configPath = join(tempDir, "auto-resume.jsonc")

  await writeFile(
    configPath,
    `{
  "safeToolNames": [
    "read",
    "search",
    "list",
    "glob",
    "grep",
    "fetch",
    "websearch",
    "webfetch",
  ],
  // optional remote rule refresh
  "rulesSync": {
    "enabled": true,
    "intervalMs": 3600000,
    "githubMirror": {
      "enabled": true,
      "baseUrl": "https://ghfast.top",
    },
    "sources": [
      "https://example.com/auto-resume.rules.jsonc",
    ],
  },
}
`,
    "utf8",
  )

  const config = loadAutoResumeRuntimeConfigFile(configPath)

  assert.deepEqual(config.safeToolNames, [
    "read",
    "search",
    "list",
    "glob",
    "grep",
    "fetch",
    "websearch",
    "webfetch",
  ])
  assert.deepEqual(config.rulesSync, {
    enabled: true,
    intervalMs: 3600000,
    githubMirror: {
      enabled: true,
      baseUrl: "https://ghfast.top",
    },
    sources: ["https://example.com/auto-resume.rules.jsonc"],
  })
})

test("parses the standalone rules file", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-resume-rules-"))
  const rulesPath = join(tempDir, "auto-resume.rules.jsonc")

  await writeFile(
    rulesPath,
    `{
  // default stream read retry
  "rules": [
    {
      "id": "resume-on-stream-read-error",
      "scope": "all",
      "match": { "messageRegex": "stream_read_error" },
      "action": { "type": "prompt", "text": "RESUME" },
      "retry": { "baseMs": 1000, "factor": 2, "maxMs": 8000, "maxAttempts": 3 },
    },
  ],
}
`,
    "utf8",
  )

  const rules = loadAutoResumeRulesFile(rulesPath)

  assert.equal(rules.length, 1)
  assert.equal(rules[0].id, "resume-on-stream-read-error")
})

test("default config matches the checked-in jsonc files", () => {
  const config = createDefaultConfig()

  assert.deepEqual(config.safeToolNames, [
    "read",
    "search",
    "list",
    "glob",
    "grep",
    "fetch",
    "websearch",
    "webfetch",
  ])

  assert.deepEqual(config.rulesSync, {
    enabled: false,
    intervalMs: 21600000,
    githubMirror: {
      enabled: false,
      baseUrl: "https://ghfast.top",
    },
    sources: ["https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/auto-resume.rules.jsonc"],
  })

  assert.deepEqual(config.rules.map((rule) => ({ id: rule.id, scope: rule.scope })), [
    { id: "resume-on-stream-read-error", scope: "root" },
    { id: "resume-on-reasoning-only-stop", scope: "root" },
    { id: "resume-on-tool-abort", scope: "root" },
    { id: "resume-on-length-finish", scope: "root" },
  ])
})

test("loads cached rules when sync is enabled", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-resume-cache-"))
  const runtimePath = join(tempDir, "auto-resume.jsonc")
  const cachePath = join(tempDir, "auto-resume.rules.cache.jsonc")
  const fallbackRulesPath = join(tempDir, "fallback.rules.jsonc")

  await writeFile(
    runtimePath,
    `{
  "safeToolNames": ["read"],
  "rulesSync": {
    "enabled": true,
    "intervalMs": 60000,
    "sources": ["https://example.com/auto-resume.rules.jsonc"],
  },
}
`,
    "utf8",
  )

  await writeFile(
    cachePath,
    `{
  "rules": [
    {
      "id": "cached-rule",
      "scope": "all",
      "match": { "messageRegex": "cached" },
      "action": { "type": "prompt", "text": "RESUME" },
      "retry": { "baseMs": 1, "factor": 2, "maxMs": 2, "maxAttempts": 1 },
    },
  ],
}
`,
    "utf8",
  )

  await writeFile(
    fallbackRulesPath,
    `{
  "rules": [
    {
      "id": "fallback-rule",
      "scope": "all",
      "match": { "messageRegex": "fallback" },
      "action": { "type": "prompt", "text": "RESUME" },
      "retry": { "baseMs": 1, "factor": 2, "maxMs": 2, "maxAttempts": 1 },
    },
  ],
}
`,
    "utf8",
  )

  const config = loadAutoResumeConfigFile(runtimePath, { cachePath, rulesPath: fallbackRulesPath })

  assert.equal(config.rules[0].id, "cached-rule")
})
