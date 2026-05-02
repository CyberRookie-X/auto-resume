import test from "node:test"
import assert from "node:assert/strict"

import { recoverCodexSession } from "../src/codex.js"

function transcript(lines: readonly object[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n")
}

test("replay-safe latest turns reuse the original user prompt", async () => {
  const output = await recoverCodexSession(
    {
      sessionID: "ses_safe",
      transcriptPath: "/tmp/ses_safe.jsonl",
      cwd: "/tmp/project",
    },
    {
      readFile: async (path, encoding) => {
        assert.equal(path, "/tmp/ses_safe.jsonl")
        assert.equal(encoding, "utf8")

        return transcript([
          {
            type: "user",
            message: { role: "user", content: "ignore this prompt" },
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
            message: { role: "user", content: "search the docs and summarize" },
          },
          {
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                { type: "tool_use", name: "WebFetch", input: { url: "https://example.com" } },
                { type: "tool_use", name: "WebSearch", input: { query: "codex hooks" } },
              ],
            },
          },
        ])
      },
    },
  )

  assert.deepEqual(output, {
    decision: "block",
    reason: "search the docs and summarize",
  })
})

test("unsafe latest turns fall back to RESUME", async () => {
  const output = await recoverCodexSession(
    {
      sessionID: "ses_unsafe",
      transcriptPath: "/tmp/ses_unsafe.jsonl",
      cwd: "/tmp/project",
    },
    {
      readFile: async () =>
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
    },
  )

  assert.deepEqual(output, {
    decision: "block",
    reason: "RESUME",
  })
})

test("plain-text latest turns do not continue", async () => {
  const output = await recoverCodexSession(
    {
      sessionID: "ses_text",
      transcriptPath: "/tmp/ses_text.jsonl",
      cwd: "/tmp/project",
      lastAssistantMessage: "I am done",
    },
    {
      readFile: async () =>
        transcript([
          {
            type: "user",
            message: { role: "user", content: "say hello" },
          },
          {
            type: "assistant",
            message: { role: "assistant", content: "Hello there" },
          },
        ]),
    },
  )

  assert.deepEqual(output, {
    continue: false,
    stopReason: "plain assistant completion",
  })
})

test("already-continued turns do not continue again", async () => {
  const output = await recoverCodexSession(
    {
      sessionID: "ses_loop",
      transcriptPath: "/tmp/ses_loop.jsonl",
      cwd: "/tmp/project",
      stopHookActive: true,
      lastAssistantMessage: "I am done",
    },
    {
      readFile: async () => {
        throw new Error("should not read transcript")
      },
    },
  )

  assert.deepEqual(output, {
    continue: false,
    stopReason: "already continued",
  })
})

test("tool-result user rows do not hijack prompt selection", async () => {
  const output = await recoverCodexSession(
    {
      sessionID: "ses_tool_result",
      transcriptPath: "/tmp/ses_tool_result.jsonl",
      cwd: "/tmp/project",
    },
    {
      readFile: async () =>
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
            message: { role: "user", content: "search the docs and summarize" },
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
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                { type: "tool_use", name: "WebFetch", input: { url: "https://example.com" } },
                { type: "tool_use", name: "WebSearch", input: { query: "codex hooks" } },
              ],
            },
          },
        ]),
    },
  )

  assert.deepEqual(output, {
    decision: "block",
    reason: "search the docs and summarize",
  })
})
