import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDefaultConfig } from "../src/index.js"
import { loadAutoResumeConfigFile } from "../src/config-file.js"

test("parses JSONC default config files", async () => {
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

  const config = loadAutoResumeConfigFile(configPath)

  assert.equal(config.rules.length, 1)
  assert.equal(config.rules[0].id, "resume-on-stream-read-error")
})

test("default config matches the checked-in jsonc file", () => {
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

  assert.deepEqual(config.rules.map((rule) => rule.id), [
    "resume-on-stream-read-error",
    "resume-on-reasoning-only-stop",
    "resume-on-tool-abort",
    "resume-on-length-finish",
  ])
})
