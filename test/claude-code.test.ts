import test from "node:test"
import assert from "node:assert/strict"

import { planClaudeRecovery, recoverClaudeSession } from "../src/claude-code.js"

function transcript(lines: readonly object[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n")
}

test("replay-safe latest turns reuse the current prompt", () => {
  const plan = planClaudeRecovery(
    {
      sessionID: "ses_safe",
      transcriptPath: "/tmp/ses_safe.jsonl",
      cwd: "/tmp/project",
    },
    transcript([
      {
        type: "user",
        message: { role: "user", content: "ignore this prompt" },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Write", input: { file_path: "unsafe.txt" } }],
        },
      },
      {
        type: "user",
        message: { role: "user", content: "search the docs and summarize" },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", name: "WebFetch", input: { url: "https://example.com" } },
            { type: "tool_use", name: "WebSearch", input: { query: "claude code" } },
          ],
        },
      },
    ]),
  )

  assert.equal(plan.replaySafety, "safe")
  assert.equal(plan.prompt, "search the docs and summarize")
}
)

test("unsafe latest turns fall back to RESUME", () => {
  const plan = planClaudeRecovery(
    {
      sessionID: "ses_unsafe",
      transcriptPath: "/tmp/ses_unsafe.jsonl",
      cwd: "/tmp/project",
    },
    transcript([
      {
        type: "user",
        message: { role: "user", content: "read the docs" },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Read", input: { file_path: "README.md" } }],
        },
      },
      {
        type: "user",
        message: { role: "user", content: "update the file" },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Write", input: { file_path: "src/index.ts" } }],
        },
      },
    ]),
  )

  assert.equal(plan.replaySafety, "unsafe")
  assert.equal(plan.prompt, "RESUME")
}
)

test("tool result user rows do not replace the current prompt", () => {
  const plan = planClaudeRecovery(
    {
      sessionID: "ses_tool_result",
      transcriptPath: "/tmp/ses_tool_result.jsonl",
      cwd: "/tmp/project",
    },
    transcript([
      {
        type: "user",
        message: { role: "user", content: "read the docs" },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Read", input: { file_path: "README.md" } }],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tool_1", content: "README contents" }],
        },
        sourceToolAssistantUUID: "assistant-uuid",
        toolUseResult: true,
      },
      {
        type: "user",
        message: { role: "user", content: "search the docs and summarize" },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", name: "WebFetch", input: { url: "https://example.com" } },
            { type: "tool_use", name: "WebSearch", input: { query: "claude code" } },
          ],
        },
      },
    ]),
  )

  assert.equal(plan.replaySafety, "safe")
  assert.equal(plan.prompt, "search the docs and summarize")
})

test("unreadable transcripts fall back to RESUME", () => {
  const missing = planClaudeRecovery(
    {
      sessionID: "ses_missing",
      transcriptPath: "/tmp/missing.jsonl",
      cwd: "/tmp/project",
    },
    undefined,
  )
  const invalid = planClaudeRecovery(
    {
      sessionID: "ses_invalid",
      transcriptPath: "/tmp/invalid.jsonl",
      cwd: "/tmp/project",
    },
    "not json\n{",
  )

  assert.equal(missing.prompt, "RESUME")
  assert.equal(missing.replaySafety, "unsafe")
  assert.equal(invalid.prompt, "RESUME")
  assert.equal(invalid.replaySafety, "unsafe")
}
)

test("helper uses an injected spawn layer instead of a Claude binary", async () => {
  const spawnCalls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = []

  const plan = await recoverClaudeSession(
    {
      sessionID: "ses_spawn",
      transcriptPath: "/tmp/ses_spawn.jsonl",
      cwd: "/tmp/project",
    },
    {
      readFile: async () =>
        transcript([
          {
            type: "user",
            message: { role: "user", content: "search the docs and summarize" },
          },
          {
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                { type: "tool_use", name: "WebFetch", input: { url: "https://example.com" } },
                { type: "tool_use", name: "WebSearch", input: { query: "claude code" } },
              ],
            },
          },
        ]),
      spawn: (command, args, options) => {
        spawnCalls.push({ command, args: [...args], options })
        return {
          on() {
            return this
          },
          unref() {
            return undefined
          },
        }
      },
    },
  )

  assert.equal(plan.prompt, "search the docs and summarize")
  assert.equal(spawnCalls.length, 1)
  assert.deepEqual(spawnCalls[0], {
    command: "claude",
    args: [
      "-p",
      "--resume",
      "ses_spawn",
      "--settings",
      '{"disableAllHooks":true}',
      "search the docs and summarize",
    ],
    options: { cwd: "/tmp/project", detached: true, stdio: "ignore" },
  })
}
)
