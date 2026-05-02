import test from "node:test"
import assert from "node:assert/strict"

import { runAutoResumeHook } from "../src/auto-resume-hook.js"

test("dispatches to Codex when PLUGIN_ROOT is set", async () => {
  const writes: string[] = []
  let receivedInput: unknown

  await runAutoResumeHook(
    JSON.stringify({
      session_id: "ses_codex",
      transcript_path: "/tmp/ses_codex.jsonl",
      cwd: "/tmp/project",
    }),
    {
      env: { PLUGIN_ROOT: "/tmp/plugin" },
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
          return true
        },
      },
      recoverCodexSession: async (input) => {
        receivedInput = input
        return { continue: false }
      },
      recoverClaudeSession: async () => {
        throw new Error("should not call Claude recovery")
      },
    },
  )

  assert.deepEqual(receivedInput, {
    sessionID: "ses_codex",
    transcriptPath: "/tmp/ses_codex.jsonl",
    cwd: "/tmp/project",
  })
  assert.deepEqual(writes, ['{"continue":false}\n'])
})

test("dispatches to Claude when PLUGIN_ROOT is absent", async () => {
  const writes: string[] = []
  let receivedInput: unknown

  await runAutoResumeHook(
    JSON.stringify({
      session_id: "ses_claude",
      transcript_path: "/tmp/ses_claude.jsonl",
      cwd: "/tmp/project",
    }),
    {
      env: {},
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
          return true
        },
      },
      recoverCodexSession: async () => {
        throw new Error("should not call Codex recovery")
      },
      recoverClaudeSession: async (input) => {
        receivedInput = input
      },
    },
  )

  assert.deepEqual(receivedInput, {
    sessionID: "ses_claude",
    transcriptPath: "/tmp/ses_claude.jsonl",
    cwd: "/tmp/project",
  })
  assert.deepEqual(writes, [])
})
