import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir, homedir } from "node:os"
import { join } from "node:path"

import { createDefaultConfig } from "../src/index.js"
import {
  discoverUserConfigPath,
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

test("discoverUserConfigPath returns undefined when no config exists", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-resume-discover-"))
  
  const result = discoverUserConfigPath("opencode", tempDir)
  
  assert.equal(result, undefined)
  
  await rm(tempDir, { recursive: true, force: true })
})

test("discoverUserConfigPath finds project-level opencode config", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-resume-opencode-"))
  const configDir = join(tempDir, ".opencode")
  await mkdir(configDir, { recursive: true })
  const configPath = join(configDir, "auto-resume.jsonc")
  await writeFile(configPath, `{ "safeToolNames": ["read"] }`, "utf8")
  
  const result = discoverUserConfigPath("opencode", tempDir)
  
  assert.equal(result, configPath)
  
  await rm(tempDir, { recursive: true, force: true })
})

test("discoverUserConfigPath finds project-level claude config", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-resume-claude-"))
  const configDir = join(tempDir, ".claude")
  await mkdir(configDir, { recursive: true })
  const configPath = join(configDir, "auto-resume.jsonc")
  await writeFile(configPath, `{ "safeToolNames": ["read"] }`, "utf8")
  
  const result = discoverUserConfigPath("claude", tempDir)
  
  assert.equal(result, configPath)
  
  await rm(tempDir, { recursive: true, force: true })
})

test("discoverUserConfigPath finds project-level codex config", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-resume-codex-"))
  const configDir = join(tempDir, ".codex")
  await mkdir(configDir, { recursive: true })
  const configPath = join(configDir, "auto-resume.jsonc")
  await writeFile(configPath, `{ "safeToolNames": ["read"] }`, "utf8")
  
  const result = discoverUserConfigPath("codex", tempDir)
  
  assert.equal(result, configPath)
  
  await rm(tempDir, { recursive: true, force: true })
})

test("discoverUserConfigPath prefers project-level over global for opencode", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-resume-priority-"))
  const projectConfigDir = join(tempDir, ".opencode")
  await mkdir(projectConfigDir, { recursive: true })
  const projectConfigPath = join(projectConfigDir, "auto-resume.jsonc")
  await writeFile(projectConfigPath, `{ "safeToolNames": ["read"] }`, "utf8")
  
  const result = discoverUserConfigPath("opencode", tempDir)
  
  assert.equal(result, projectConfigPath)
  
  await rm(tempDir, { recursive: true, force: true })
})

test("discoverUserConfigPath finds global opencode config", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-resume-global-open-"))
  const globalConfigDir = join(tempDir, ".config", "opencode")
  await mkdir(globalConfigDir, { recursive: true })
  const globalConfigPath = join(globalConfigDir, "auto-resume.jsonc")
  await writeFile(globalConfigPath, `{ "safeToolNames": ["read"] }`, "utf8")
  
  const originalHome = process.env.HOME
  process.env.HOME = tempDir
  
  try {
    const result = discoverUserConfigPath("opencode", tempDir)
    assert.equal(result, globalConfigPath)
  } finally {
    process.env.HOME = originalHome
  }
  
  await rm(tempDir, { recursive: true, force: true })
})

test("discoverUserConfigPath finds global claude config in ~/.claude", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-resume-global-claude-"))
  const globalConfigDir = join(tempDir, ".claude")
  await mkdir(globalConfigDir, { recursive: true })
  const globalConfigPath = join(globalConfigDir, "auto-resume.jsonc")
  await writeFile(globalConfigPath, `{ "safeToolNames": ["read"] }`, "utf8")
  
  const originalHome = process.env.HOME
  process.env.HOME = tempDir
  
  try {
    const result = discoverUserConfigPath("claude", tempDir)
    assert.equal(result, globalConfigPath)
  } finally {
    process.env.HOME = originalHome
  }
  
  await rm(tempDir, { recursive: true, force: true })
})

test("discoverUserConfigPath finds global codex config in ~/.codex", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-resume-global-codex-"))
  const globalConfigDir = join(tempDir, ".codex")
  await mkdir(globalConfigDir, { recursive: true })
  const globalConfigPath = join(globalConfigDir, "auto-resume.jsonc")
  await writeFile(globalConfigPath, `{ "safeToolNames": ["read"] }`, "utf8")
  
  const originalHome = process.env.HOME
  process.env.HOME = tempDir
  
  try {
    const result = discoverUserConfigPath("codex", tempDir)
    assert.equal(result, globalConfigPath)
  } finally {
    process.env.HOME = originalHome
  }
  
  await rm(tempDir, { recursive: true, force: true })
})

test("discoverUserConfigPath respects XDG_CONFIG_HOME for claude platform", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-resume-xdg-"))
  const xdgConfigDir = join(tempDir, "custom-config")
  const claudeConfigDir = join(xdgConfigDir, "claude")
  await mkdir(claudeConfigDir, { recursive: true })
  const xdgConfigPath = join(claudeConfigDir, "auto-resume.jsonc")
  await writeFile(xdgConfigPath, `{ "safeToolNames": ["read"] }`, "utf8")
  
  const originalHome = process.env.HOME
  const originalXdg = process.env.XDG_CONFIG_HOME
  process.env.HOME = tempDir
  process.env.XDG_CONFIG_HOME = xdgConfigDir
  
  try {
    const result = discoverUserConfigPath("claude", tempDir)
    assert.equal(result, xdgConfigPath)
  } finally {
    process.env.HOME = originalHome
    if (originalXdg !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdg
    } else {
      delete process.env.XDG_CONFIG_HOME
    }
  }
  
  await rm(tempDir, { recursive: true, force: true })
})

test("discoverUserConfigPath prefers ~/.claude over XDG_CONFIG_HOME for claude", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-resume-claude-priority-"))
  
  const homeClaudeDir = join(tempDir, ".claude")
  await mkdir(homeClaudeDir, { recursive: true })
  const homeClaudePath = join(homeClaudeDir, "auto-resume.jsonc")
  await writeFile(homeClaudePath, `{ "safeToolNames": ["home"] }`, "utf8")
  
  const xdgConfigDir = join(tempDir, "xdg-config")
  const xdgClaudeDir = join(xdgConfigDir, "claude")
  await mkdir(xdgClaudeDir, { recursive: true })
  const xdgClaudePath = join(xdgClaudeDir, "auto-resume.jsonc")
  await writeFile(xdgClaudePath, `{ "safeToolNames": ["xdg"] }`, "utf8")
  
  const originalHome = process.env.HOME
  const originalXdg = process.env.XDG_CONFIG_HOME
  process.env.HOME = tempDir
  process.env.XDG_CONFIG_HOME = xdgConfigDir
  
  try {
    const result = discoverUserConfigPath("claude", tempDir)
    assert.equal(result, homeClaudePath)
  } finally {
    process.env.HOME = originalHome
    if (originalXdg !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdg
    } else {
      delete process.env.XDG_CONFIG_HOME
    }
  }
  
  await rm(tempDir, { recursive: true, force: true })
})

test("discoverUserConfigPath project config takes priority over global", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-resume-proj-priority-"))
  
  const projectConfigDir = join(tempDir, ".opencode")
  await mkdir(projectConfigDir, { recursive: true })
  const projectConfigPath = join(projectConfigDir, "auto-resume.jsonc")
  await writeFile(projectConfigPath, `{ "safeToolNames": ["project"] }`, "utf8")
  
  const globalConfigDir = join(tempDir, ".config", "opencode")
  await mkdir(globalConfigDir, { recursive: true })
  const globalConfigPath = join(globalConfigDir, "auto-resume.jsonc")
  await writeFile(globalConfigPath, `{ "safeToolNames": ["global"] }`, "utf8")
  
  const originalHome = process.env.HOME
  process.env.HOME = tempDir
  
  try {
    const result = discoverUserConfigPath("opencode", tempDir)
    assert.equal(result, projectConfigPath)
  } finally {
    process.env.HOME = originalHome
  }
  
  await rm(tempDir, { recursive: true, force: true })
})
