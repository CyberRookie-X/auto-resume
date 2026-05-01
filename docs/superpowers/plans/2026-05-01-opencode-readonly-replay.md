# OpenCode Read-Only Replay Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically replay only pure read-only OpenCode turns after stream-like failures, and fall back to `RESUME` whenever the turn may have written, deleted, or executed shell commands.

**Architecture:** Keep the existing recovery core and extend the OpenCode adapter with a conservative replay-safety classifier. The adapter will inspect the latest turn, decide whether it is replay-safe, and either resubmit the original user request or inject `RESUME`. Unsafe or unclassified turns never auto-replay.

**Tech Stack:** TypeScript, Node.js test runner, `tsx`, `@opencode-ai/sdk`.

---

### Task 1: Add replay-safety classification tests and helper

**Files:**
- Create: `src/replay.ts`
- Create: `test/replay-safety.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import test from "node:test"
import assert from "node:assert/strict"

import { classifyReplaySafety } from "../src/replay.js"

test("read-only tool chains are replay-safe", () => {
  const mode = classifyReplaySafety([
    {
      info: { role: "assistant", id: "msg_1" },
      parts: [
        { type: "tool", tool: "read", state: { status: "completed" } },
        { type: "tool", tool: "search", state: { status: "completed" } },
      ],
    } as any,
  ])

  assert.equal(mode, "safe")
})

test("write and shell tool chains are unsafe", () => {
  assert.equal(
    classifyReplaySafety([
      {
        info: { role: "assistant", id: "msg_2" },
        parts: [{ type: "tool", tool: "write", state: { status: "completed" } }],
      } as any,
    ]),
    "unsafe",
  )

  assert.equal(
    classifyReplaySafety([
      {
        info: { role: "assistant", id: "msg_3" },
        parts: [{ type: "tool", tool: "shell", state: { status: "completed" } }],
      } as any,
    ]),
    "unsafe",
  )
})
```

- [ ] **Step 2: Run the focused test in Docker and confirm it fails**

Run: `docker run --rm -v "$PWD":/workspace -v auto-resume-node_modules:/workspace/node_modules -w /workspace node:22-bullseye bash -lc "npm test -- test/replay-safety.test.ts"`

Expected: FAIL because `src/replay.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal helper**

```ts
export type ReplaySafety = "safe" | "unsafe"

export type ReplayRequest = {
  parts: Array<{ type: "text"; text: string }>
  agent?: unknown
  model?: unknown
}

export function classifyReplaySafety(messages: readonly Record<string, unknown>[]): ReplaySafety {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const info = (message as { info?: Record<string, unknown> }).info
    if (!info || info.role !== "assistant") continue

    const parts = Array.isArray((message as { parts?: unknown[] }).parts) ? ((message as { parts?: unknown[] }).parts as unknown[]) : []
    for (const part of parts) {
      if (!part || typeof part !== "object") continue
      if ((part as { type?: unknown }).type !== "tool") continue

      const tool = (part as { tool?: unknown }).tool
      if (typeof tool !== "string") return "unsafe"
      if (tool === "read" || tool === "search" || tool === "list" || tool === "glob" || tool === "grep" || tool === "fetch") {
        continue
      }

      return "unsafe"
    }

    return "safe"
  }

  return "unsafe"
}

export function extractReplayRequest(messages: readonly Record<string, unknown>[]): ReplayRequest | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const info = (message as { info?: Record<string, unknown> }).info
    if (!info || info.role !== "user") continue

    const parts = Array.isArray((message as { parts?: unknown[] }).parts) ? ((message as { parts?: unknown[] }).parts as unknown[]) : []
    if (parts.length === 0) return null

    const textParts: Array<{ type: "text"; text: string }> = []
    for (const part of parts) {
      if (!part || typeof part !== "object") return null
      if ((part as { type?: unknown }).type !== "text") return null

      const text = (part as { text?: unknown }).text
      if (typeof text !== "string" || text.length === 0) return null

      textParts.push({ type: "text", text })
    }

    return {
      parts: textParts,
      agent: info.agent,
      model: info.model,
    }
  }

  return null
}
```

- [ ] **Step 4: Re-run the focused test in Docker**

Run: `docker run --rm -v "$PWD":/workspace -v auto-resume-node_modules:/workspace/node_modules -w /workspace node:22-bullseye bash -lc "npm test -- test/replay-safety.test.ts"`

Expected: PASS.

### Task 2: Replay safe turns instead of injecting `RESUME`

**Files:**
- Modify: `src/opencode.ts`
- Modify: `test/opencode.test.ts`
- Modify: `src/replay.ts`

- [ ] **Step 1: Write the failing adapter tests**

```ts
test("session.error replays a read-only turn", async () => {
  const prompts: PromptCall[] = []
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_1" },
      messages: [
        {
          info: { role: "user", id: "msg_u1" },
          parts: [{ type: "text", text: "search the docs and summarize" }],
        },
        {
          info: { role: "assistant", id: "msg_a1" },
          parts: [
            { type: "tool", tool: "read", state: { status: "completed" } },
            { type: "tool", tool: "search", state: { status: "completed" } },
          ],
        },
      ],
      prompts,
    }) as any,
    config: {
      rules: [
        {
          id: "resume-on-stream-read-error",
          scope: "all",
          match: { messageRegex: "stream_read_error" },
          action: { type: "prompt", text: "RESUME" },
          retry: { baseMs: 10, factor: 2, maxMs: 20, maxAttempts: 3 },
        },
      ],
    },
  })

  await adapter.handleEvent({
    type: "session.error",
    properties: { sessionID: "ses_1", error: { name: "UnknownError", data: { message: "upstream_error: stream_read_error" } } },
  })

  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].body.parts[0].text, "search the docs and summarize")
  assert.notEqual(prompts[0].body.parts[0].text, "RESUME")
})

test("session.error falls back to RESUME for write or shell turns", async () => {
  const writePrompts: PromptCall[] = []
  const shellPrompts: PromptCall[] = []

  const writeAdapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_2" },
      messages: [
        { info: { role: "user", id: "msg_u1" }, parts: [{ type: "text", text: "update the file" }] },
        { info: { role: "assistant", id: "msg_a1" }, parts: [{ type: "tool", tool: "write", state: { status: "completed" } }] },
      ],
      prompts: writePrompts,
    }) as any,
    config: {
      rules: [
        {
          id: "resume-on-stream-read-error",
          scope: "all",
          match: { messageRegex: "stream_read_error" },
          action: { type: "prompt", text: "RESUME" },
          retry: { baseMs: 10, factor: 2, maxMs: 20, maxAttempts: 3 },
        },
      ],
    },
  })

  await writeAdapter.handleEvent({
    type: "session.error",
    properties: { sessionID: "ses_2", error: { name: "UnknownError", data: { message: "upstream_error: stream_read_error" } } },
  })

  assert.equal(writePrompts.length, 1)
  assert.equal(writePrompts[0].body.parts[0].text, "RESUME")

  const shellAdapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_3" },
      messages: [
        { info: { role: "user", id: "msg_u2" }, parts: [{ type: "text", text: "run the build" }] },
        { info: { role: "assistant", id: "msg_a2" }, parts: [{ type: "tool", tool: "shell", state: { status: "completed" } }] },
      ],
      prompts: shellPrompts,
    }) as any,
    config: {
      rules: [
        {
          id: "resume-on-stream-read-error",
          scope: "all",
          match: { messageRegex: "stream_read_error" },
          action: { type: "prompt", text: "RESUME" },
          retry: { baseMs: 10, factor: 2, maxMs: 20, maxAttempts: 3 },
        },
      ],
    },
  })

  await shellAdapter.handleEvent({
    type: "session.error",
    properties: { sessionID: "ses_3", error: { name: "UnknownError", data: { message: "upstream_error: stream_read_error" } } },
  })

  assert.equal(shellPrompts.length, 1)
  assert.equal(shellPrompts[0].body.parts[0].text, "RESUME")
})
```

- [ ] **Step 2: Run the adapter test file in Docker and confirm it fails**

Run: `docker run --rm -v "$PWD":/workspace -v auto-resume-node_modules:/workspace/node_modules -w /workspace node:22-bullseye bash -lc "npm test -- test/opencode.test.ts"`

Expected: FAIL because the adapter still always injects `RESUME`.

- [ ] **Step 3: Implement safe replay selection in the adapter**

```ts
// In src/opencode.ts:
const replayRequest = classifyReplaySafety(messages) === "safe" ? extractReplayRequest(messages) : null

if (replayRequest) {
  await client.session.prompt({
    path: { id: sessionID },
    body: replayRequest,
  })
} else {
  await client.session.prompt({
    path: { id: sessionID },
    body: { parts: [{ type: "text", text: "RESUME" }] },
  })
}
```

- [ ] **Step 4: Re-run the adapter test file in Docker**

Run: `docker run --rm -v "$PWD":/workspace -v auto-resume-node_modules:/workspace/node_modules -w /workspace node:22-bullseye bash -lc "npm test -- test/opencode.test.ts"`

Expected: PASS for both read-only replay and unsafe fallback.

### Task 3: Apply the same gate to idle scans, cancellation, and docs

**Files:**
- Modify: `src/opencode.ts`
- Modify: `test/opencode.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the remaining regression tests**

```ts
test("session.idle replays a read-only turn", async () => {
  const prompts: PromptCall[] = []
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_4", parentID: "ses_parent" },
      messages: [
        { info: { role: "user", id: "msg_u1" }, parts: [{ type: "text", text: "find the config and summarize it" }] },
        { info: { role: "assistant", id: "msg_a1" }, parts: [{ type: "tool", tool: "read", state: { status: "completed" } }] },
      ],
      prompts,
    }) as any,
    config: {
      rules: [
        {
          id: "resume-on-reasoning-only-stop",
          scope: "child",
          match: { reasoningOnlyStop: true },
          action: { type: "prompt", text: "RESUME" },
          retry: { baseMs: 10, factor: 2, maxMs: 20, maxAttempts: 3 },
        },
      ],
    },
  })

  await adapter.handleEvent({ type: "session.idle", properties: { sessionID: "ses_4" } })

  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].body.parts[0].text, "find the config and summarize it")
})

test("session.deleted cancels a pending replay", async () => {
  const prompts: PromptCall[] = []
  const { timers, flush } = createTimers()
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_5" },
      messages: [
        { info: { role: "user", id: "msg_u2" }, parts: [{ type: "text", text: "search the docs" }] },
        { info: { role: "assistant", id: "msg_a2" }, parts: [{ type: "tool", tool: "read", state: { status: "completed" } }] },
      ],
      prompts,
    }) as any,
    config: {
      rules: [
        {
          id: "resume-on-stream-read-error",
          scope: "all",
          match: { messageRegex: "stream_read_error" },
          action: { type: "prompt", text: "RESUME" },
          retry: { baseMs: 10, factor: 2, maxMs: 20, maxAttempts: 3 },
        },
      ],
    },
    timers: timers as any,
  })

  await adapter.handleEvent({
    type: "session.error",
    properties: { sessionID: "ses_5", error: { name: "UnknownError", data: { message: "upstream_error: stream_read_error" } } },
  })

  await adapter.handleEvent({ type: "session.deleted", properties: { sessionID: "ses_5" } })
  await flush()

  assert.equal(prompts.length, 0)
})
```

- [ ] **Step 2: Update the adapter to use the same safety gate for `session.idle`**

```ts
if (event.type === "session.idle") {
  const messages = await readMessages(sessionID, client)
  const replayRequest = classifyReplaySafety(messages) === "safe" ? extractReplayRequest(messages) : null

  if (replayRequest) {
    scheduleReplay(replayRequest)
  } else {
    scheduleResume()
  }
}
```

- [ ] **Step 3: Update README with the new recovery policy**

Add a short section that says:

- read-only turns may auto-replay
- write/delete/move/shell turns do not auto-replay
- unsafe or unknown turns fall back to `RESUME`

- [ ] **Step 4: Run the full Docker verification**

Run: `docker run --rm -v "$PWD":/workspace -v auto-resume-node_modules:/workspace/node_modules -w /workspace node:22-bullseye bash -lc "npm test && npm run build"`

Expected: PASS with all tests green and TypeScript compiling cleanly.
