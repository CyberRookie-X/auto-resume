import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createOpenCodeAdapter } from "../src/opencode.js"

type PromptCall = {
  path: { id: string }
  body: {
    parts: Array<{ type: "text"; text: string }>
    agent?: unknown
    model?: unknown
  }
}

type TimerHandle = { id: number }

function createTimers() {
  type ScheduledTimer = {
    id: number
    callback: () => void | Promise<void>
    cleared: boolean
  }

  const delays: number[] = []
  const queue: ScheduledTimer[] = []
  const scheduledTimers = new Map<number, ScheduledTimer>()
  let nextTimerID = 1

  return {
    delays,
    async flush() {
      while (queue.length > 0) {
        const timer = queue.shift()
        if (!timer) {
          continue
        }

        scheduledTimers.delete(timer.id)
        if (timer.cleared) {
          continue
        }

        await timer.callback()
      }
    },
    timers: {
      setTimeout(callback: () => void | Promise<void>, delay: number): TimerHandle {
        delays.push(delay)
        const timer = {
          id: nextTimerID,
          callback,
          cleared: false,
        }

        nextTimerID += 1
        queue.push(timer)
        scheduledTimers.set(timer.id, timer)
        return { id: timer.id }
      },
      clearTimeout(handle: TimerHandle) {
        const timer = scheduledTimers.get(handle.id)
        if (!timer) {
          return
        }

        timer.cleared = true
        scheduledTimers.delete(handle.id)
      },
    },
  }
}

function createManualTimers() {
  const scheduled: Array<{ callback: () => void | Promise<void>; delay: number }> = []

  return {
    scheduled,
    timers: {
      setTimeout(callback: () => void | Promise<void>, delay: number): TimerHandle {
        scheduled.push({ callback, delay })
        return { id: scheduled.length }
      },
      clearTimeout() {
        return undefined
      },
    },
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

function trackSettlement<T>(promise: Promise<T>, onSettle: () => void): Promise<T> {
  promise.then(onSettle, onSettle)
  return promise
}

async function waitForMacrotask() {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function createClient(options: {
  session: { id: string; parentID?: string | null }
  messages?:
    | Array<{ info?: Record<string, unknown>; parts?: Array<Record<string, unknown>> }>
    | (() => unknown | Promise<unknown>)
  prompt?: (call: PromptCall) => Promise<unknown>
  deleteMessage?: (call: { sessionID: string; messageID: string }) => Promise<unknown>
  deleteMessageCalls?: Array<{ sessionID: string; messageID: string }>
  prompts: PromptCall[]
}) {
  return {
    session: {
      get: async () => ({ data: options.session }),
      messages: async () => {
        if (typeof options.messages === "function") {
          return options.messages()
        }

        return { data: options.messages ?? [] }
      },
      prompt: async (call: PromptCall) => {
        options.prompts.push(call)
        if (options.prompt) {
          return options.prompt(call)
        }
        return undefined
      },
      deleteMessage: async (call: { sessionID: string; messageID: string }) => {
        options.deleteMessageCalls?.push(call)
        if (options.deleteMessage) {
          return options.deleteMessage(call)
        }
        return undefined
      },
    },
  }
}

test("session.error picks up refreshed sync rules", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "auto-resume-opencode-sync-"))
  const cachePath = join(tempDir, "auto-resume.rules.cache.jsonc")
  const prompts: PromptCall[] = []
  const fetchCalls: string[] = []
  const { scheduled, timers } = createManualTimers()

  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_sync" },
      prompts,
    }) as any,
    config: {
      rulesSync: {
        enabled: true,
        intervalMs: 1234,
        sources: ["https://example.com/auto-resume.rules.jsonc"],
      },
    },
    fetch: async (input) => {
      fetchCalls.push(String(input))
      return new Response(`{
  "rules": [
    {
      "id": "synced-rule",
      "scope": "all",
      "match": { "messageRegex": "synced-only-error" },
      "action": { "type": "prompt", "text": "RESUME" },
      "retry": { "baseMs": 5, "factor": 2, "maxMs": 5, "maxAttempts": 1 }
    }
  ]
}`)
    },
    rulesCachePath: cachePath,
    timers: timers as any,
  })

  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].delay, 0)

  await scheduled[0].callback()

  assert.equal(fetchCalls.length, 1)
  assert.ok(scheduled.length >= 2)

  const handleEventPromise = adapter.handleEvent({
    type: "session.error",
    properties: {
      sessionID: "ses_sync",
      error: { name: "UnknownError", data: { message: "synced-only-error" } },
    },
  })

  await handleEventPromise

  assert.equal(prompts.length, 0)

  const recoveryTimer = scheduled.find((timer) => timer.delay === 5)
  assert.ok(recoveryTimer)

  await recoveryTimer!.callback()

  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].path.id, "ses_sync")
  assert.equal(prompts[0].body.parts[0].text, "RESUME")
})

test("session.error with a read-only turn deletes the assistant turn and resumes", async () => {
  const prompts: PromptCall[] = []
  const deleteMessageCalls: Array<{ sessionID: string; messageID: string }> = []
  const { timers, delays, flush } = createTimers()
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
      deleteMessageCalls,
    }) as any,
    config: {
      rules: [
        {
          id: "resume-on-stream-read-error",
          scope: "all",
          match: { messageRegex: "stream_read_error" },
          action: { type: "prompt", text: "RESUME" },
          retry: { baseMs: 10, factor: 2, maxMs: 10, maxAttempts: 1 },
        },
      ],
    },
    timers: timers as any,
  })

  let settled = false
  const handleEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.error",
      properties: {
        sessionID: "ses_1",
        error: { name: "UnknownError", data: { message: "upstream_error: stream_read_error" } },
      },
    }),
    () => {
      settled = true
    },
  )

  await waitForMacrotask()

  assert.equal(settled, true)
  assert.deepEqual(delays, [10])
  assert.equal(prompts.length, 0)

  await flush()
  await handleEventPromise

  assert.deepEqual(deleteMessageCalls, [{ sessionID: "ses_1", messageID: "msg_a1" }])
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].path.id, "ses_1")
  assert.equal(prompts[0].body.parts[0].text, "RESUME")
})

test("session.error without a new assistant turn replays the latest user request", async () => {
  const prompts: PromptCall[] = []
  const deleteMessageCalls: Array<{ sessionID: string; messageID: string }> = []
  const { timers, delays, flush } = createTimers()
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_no_new_assistant" },
      messages: [
        {
          info: { role: "user", id: "msg_u1" },
          parts: [{ type: "text", text: "first task" }],
        },
        {
          info: { role: "assistant", id: "msg_a1" },
          parts: [{ type: "tool", tool: "read", state: { status: "completed" } }],
        },
        {
          info: { role: "user", id: "msg_u2" },
          parts: [{ type: "text", text: "second task" }],
        },
      ],
      prompts,
      deleteMessageCalls,
    }) as any,
    config: {
      rules: [
        {
          id: "resume-on-stream-read-error",
          scope: "all",
          match: { messageRegex: "stream_read_error" },
          action: { type: "prompt", text: "RESUME" },
          retry: { baseMs: 10, factor: 2, maxMs: 10, maxAttempts: 1 },
        },
      ],
    },
    timers: timers as any,
  })

  let settled = false
  const handleEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.error",
      properties: {
        sessionID: "ses_no_new_assistant",
        error: { name: "UnknownError", data: { message: "upstream_error: stream_read_error" } },
      },
    }),
    () => {
      settled = true
    },
  )

  await waitForMacrotask()

  assert.equal(settled, true)
  assert.deepEqual(delays, [10])
  assert.equal(prompts.length, 0)

  await flush()
  await handleEventPromise

  assert.deepEqual(deleteMessageCalls, [{ sessionID: "ses_no_new_assistant", messageID: "msg_u2" }])
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].body.parts[0].text, "second task")
})

test("session.error with multiple read-only assistant messages deletes the latest assistant turn and resumes", async () => {
  const prompts: PromptCall[] = []
  const deleteMessageCalls: Array<{ sessionID: string; messageID: string }> = []
  const { timers, delays, flush } = createTimers()
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_multi_assistant" },
      messages: [
        {
          info: { role: "user", id: "msg_u1", agent: "writer", model: { providerID: "openai", modelID: "gpt-5" } },
          parts: [{ type: "text", text: "complete the task" }],
        },
        {
          info: { role: "assistant", id: "msg_a1", parentID: "msg_u1" },
          parts: [{ type: "tool", tool: "read", state: { status: "completed" } }],
        },
        {
          info: { role: "assistant", id: "msg_a2", parentID: "msg_u1" },
          parts: [{ type: "tool", tool: "search", state: { status: "completed" } }],
        },
      ],
      prompts,
      deleteMessageCalls,
    }) as any,
    config: {
      rules: [
        {
          id: "resume-on-stream-read-error",
          scope: "all",
          match: { messageRegex: "stream_read_error" },
          action: { type: "prompt", text: "RESUME" },
          retry: { baseMs: 10, factor: 2, maxMs: 10, maxAttempts: 1 },
        },
      ],
    },
    timers: timers as any,
  })

  let settled = false
  const handleEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.error",
      properties: {
        sessionID: "ses_multi_assistant",
        error: { name: "UnknownError", data: { message: "upstream_error: stream_read_error" } },
      },
    }),
    () => {
      settled = true
    },
  )

  await waitForMacrotask()

  assert.equal(settled, true)
  assert.deepEqual(delays, [10])
  assert.equal(prompts.length, 0)

  await flush()
  await handleEventPromise

  assert.deepEqual(deleteMessageCalls, [{ sessionID: "ses_multi_assistant", messageID: "msg_a2" }])
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].path.id, "ses_multi_assistant")
  assert.equal(prompts[0].body.parts[0].text, "RESUME")
})

test("session.error with a native Error stack injects RESUME", async () => {
  const prompts: PromptCall[] = []
  const { timers, delays, flush } = createTimers()
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_1b" },
      prompts,
    }) as any,
    config: {
      rules: [
        {
          id: "resume-on-error-stack",
          scope: "all",
          match: { messageRegex: "stream_read_error" },
          action: { type: "prompt", text: "RESUME" },
          retry: { baseMs: 10, factor: 2, maxMs: 10, maxAttempts: 1 },
        },
      ],
    },
    timers: timers as any,
  })

  const error = new Error("upstream_error")
  error.stack = "Error: upstream_error\n    at stream_read_error"

  let settled = false
  const handleEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.error",
      properties: {
        sessionID: "ses_1b",
        error,
      },
    }),
    () => {
      settled = true
    },
  )

  await waitForMacrotask()

  assert.equal(settled, true)
  assert.deepEqual(delays, [10])
  assert.equal(prompts.length, 0)

  await flush()
  await handleEventPromise

  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].path.id, "ses_1b")
  assert.equal(prompts[0].body.parts[0].text, "RESUME")
})

test("session.error with a primitive payload preserves quoted raw text", async () => {
  const prompts: PromptCall[] = []
  const { timers, delays, flush } = createTimers()
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_1c" },
      prompts,
    }) as any,
    config: {
      rules: [
        {
          id: "resume-on-quoted-error-payload",
          scope: "all",
          match: { messageRegex: '"stream_read_error"' },
          action: { type: "prompt", text: "RESUME" },
          retry: { baseMs: 10, factor: 2, maxMs: 10, maxAttempts: 1 },
        },
      ],
    },
    timers: timers as any,
  })

  let settled = false
  const handleEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.error",
      properties: {
        sessionID: "ses_1c",
        error: "stream_read_error",
      },
    }),
    () => {
      settled = true
    },
  )

  await waitForMacrotask()

  assert.equal(settled, true)
  assert.deepEqual(delays, [10])
  assert.equal(prompts.length, 0)

  await flush()
  await handleEventPromise

  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].path.id, "ses_1c")
  assert.equal(prompts[0].body.parts[0].text, "RESUME")
})

test("session.error with a write tool falls back to RESUME", async () => {
  const prompts: PromptCall[] = []
  const deleteMessageCalls: Array<{ sessionID: string; messageID: string }> = []
  const { timers, delays, flush } = createTimers()
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_1d" },
      messages: [
        { info: { role: "user", id: "msg_u1" }, parts: [{ type: "text", text: "update the file" }] },
        {
          info: { role: "assistant", id: "msg_a1" },
          parts: [{ type: "tool", tool: "write", state: { status: "completed" } }],
        },
      ],
      prompts,
      deleteMessageCalls,
    }) as any,
    config: {
      rules: [
        {
          id: "resume-on-stream-read-error",
          scope: "all",
          match: { messageRegex: "stream_read_error" },
          action: { type: "prompt", text: "RESUME" },
          retry: { baseMs: 10, factor: 2, maxMs: 10, maxAttempts: 1 },
        },
      ],
    },
    timers: timers as any,
  })

  let settled = false
  const handleEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.error",
      properties: {
        sessionID: "ses_1d",
        error: { name: "UnknownError", data: { message: "upstream_error: stream_read_error" } },
      },
    }),
    () => {
      settled = true
    },
  )

  await waitForMacrotask()

  assert.equal(settled, true)
  assert.deepEqual(delays, [10])
  assert.equal(prompts.length, 0)

  await flush()
  await handleEventPromise

  assert.deepEqual(deleteMessageCalls, [])
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].path.id, "ses_1d")
  assert.equal(prompts[0].body.parts[0].text, "RESUME")
})

test("session.error with a shell tool falls back to RESUME", async () => {
  const prompts: PromptCall[] = []
  const deleteMessageCalls: Array<{ sessionID: string; messageID: string }> = []
  const { timers, delays, flush } = createTimers()
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_1e" },
      messages: [
        { info: { role: "user", id: "msg_u2" }, parts: [{ type: "text", text: "run the build" }] },
        {
          info: { role: "assistant", id: "msg_a2" },
          parts: [{ type: "tool", tool: "shell", state: { status: "completed" } }],
        },
      ],
      prompts,
      deleteMessageCalls,
    }) as any,
    config: {
      rules: [
        {
          id: "resume-on-stream-read-error",
          scope: "all",
          match: { messageRegex: "stream_read_error" },
          action: { type: "prompt", text: "RESUME" },
          retry: { baseMs: 10, factor: 2, maxMs: 10, maxAttempts: 1 },
        },
      ],
    },
    timers: timers as any,
  })

  let settled = false
  const handleEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.error",
      properties: {
        sessionID: "ses_1e",
        error: { name: "UnknownError", data: { message: "upstream_error: stream_read_error" } },
      },
    }),
    () => {
      settled = true
    },
  )

  await waitForMacrotask()

  assert.equal(settled, true)
  assert.deepEqual(delays, [10])
  assert.equal(prompts.length, 0)

  await flush()
  await handleEventPromise

  assert.deepEqual(deleteMessageCalls, [])
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].path.id, "ses_1e")
  assert.equal(prompts[0].body.parts[0].text, "RESUME")
})

test("session.error cancels a pending recovery before awaiting messages", async () => {
  const prompts: PromptCall[] = []
  const deleteMessageCalls: Array<{ sessionID: string; messageID: string }> = []
  const { timers, delays, flush } = createTimers()
  const deferredMessages = createDeferred<unknown>()
  let messageCalls = 0

  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_1f" },
      messages: () => {
        messageCalls += 1
        if (messageCalls === 1) {
          return {
            data: [
              {
                info: { role: "user", id: "msg_u1" },
                parts: [{ type: "text", text: "first request" }],
              },
              {
                info: { role: "assistant", id: "msg_a1" },
                parts: [{ type: "tool", tool: "read", state: { status: "completed" } }],
              },
            ],
          }
      }

        return deferredMessages.promise
      },
      prompts,
      deleteMessageCalls,
    }) as any,
    config: {
      rules: [
        {
          id: "resume-on-stream-read-error",
          scope: "all",
          match: { messageRegex: "stream_read_error" },
          action: { type: "prompt", text: "RESUME" },
          retry: { baseMs: 10, factor: 2, maxMs: 10, maxAttempts: 3 },
        },
      ],
    },
    timers: timers as any,
  })

  let firstSettled = false
  const firstEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.error",
      properties: {
        sessionID: "ses_1f",
        error: { name: "UnknownError", data: { message: "upstream_error: stream_read_error" } },
      },
    }),
    () => {
      firstSettled = true
    },
  )

  await waitForMacrotask()

  assert.equal(firstSettled, true)
  assert.deepEqual(delays, [10])
  assert.equal(prompts.length, 0)

  let secondSettled = false
  const secondEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.error",
      properties: {
        sessionID: "ses_1f",
        error: { name: "UnknownError", data: { message: "upstream_error: stream_read_error" } },
      },
    }),
    () => {
      secondSettled = true
    },
  )

  await waitForMacrotask()

  await flush()
  assert.equal(prompts.length, 0)

  deferredMessages.resolve({
    data: [
      {
        info: { role: "user", id: "msg_u2" },
        parts: [{ type: "text", text: "second request" }],
      },
      {
        info: { role: "assistant", id: "msg_a2" },
        parts: [{ type: "tool", tool: "read", state: { status: "completed" } }],
      },
    ],
  })

  await waitForMacrotask()

  assert.equal(secondSettled, true)
  assert.deepEqual(delays, [10, 10])

  await flush()
  await firstEventPromise
  await secondEventPromise

  assert.deepEqual(deleteMessageCalls, [{ sessionID: "ses_1f", messageID: "msg_a2" }])
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].body.parts[0].text, "RESUME")
})

test("session.idle replays read-only reasoning-only stops", async () => {
  const prompts: PromptCall[] = []
  const deleteMessageCalls: Array<{ sessionID: string; messageID: string }> = []
  const { timers, flush } = createTimers()
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_2", parentID: "ses_parent" },
      messages: [
        {
          info: { role: "assistant", id: "msg_1" },
          parts: [
            { type: "reasoning", text: "thinking" },
            { type: "tool", tool: "read", state: { status: "completed" } },
            { type: "tool", tool: "search", state: { status: "completed" } },
          ],
        },
        {
          info: { role: "user", id: "msg_2" },
          parts: [{ type: "text", text: "find the config and summarize it" }],
        },
      ],
      prompts,
      deleteMessageCalls,
    }) as any,
    config: {
      rules: [
        {
          id: "resume-on-reasoning-only-stop",
          scope: "child",
          match: { reasoningOnlyStop: true },
          action: { type: "prompt", text: "RESUME" },
          retry: { baseMs: 0, factor: 2, maxMs: 0, maxAttempts: 1 },
        },
      ],
    },
    timers: timers as any,
  })

  let settled = false
  const handleEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.idle",
      properties: { sessionID: "ses_2", reasoningOnlyStop: true },
    }),
    () => {
      settled = true
    },
  )

  await waitForMacrotask()

  assert.equal(settled, true)
  assert.equal(prompts.length, 0)

  await flush()
  await handleEventPromise

  assert.deepEqual(deleteMessageCalls, [{ sessionID: "ses_2", messageID: "msg_1" }])
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].path.id, "ses_2")
  assert.equal(prompts[0].body.parts[0].text, "RESUME")
})

test("session.deleted cancels a pending replay", async () => {
  const prompts: PromptCall[] = []
  const deferredMessages = createDeferred<unknown>()
  const { timers, delays, flush } = createTimers()
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_2b", parentID: "ses_parent" },
      messages: () => deferredMessages.promise,
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
    timers: timers as any,
  })

  let settled = false
  const handleEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.idle",
      properties: { sessionID: "ses_2b", reasoningOnlyStop: true },
    }),
    () => {
      settled = true
    },
  )

  await waitForMacrotask()

  assert.equal(settled, false)
  assert.equal(prompts.length, 0)

  await adapter.handleEvent({
    type: "session.deleted",
    properties: { sessionID: "ses_2b" },
  })

  deferredMessages.resolve({
    data: [
      {
        info: { role: "user", id: "msg_u1" },
        parts: [{ type: "text", text: "find the config and summarize it" }],
      },
      {
        info: { role: "assistant", id: "msg_a1" },
        parts: [{ type: "tool", tool: "read", state: { status: "completed" } }],
      },
    ],
  })

  await waitForMacrotask()

  assert.equal(settled, true)
  assert.deepEqual(delays, [])
  assert.equal(prompts.length, 0)

  await flush()
  await handleEventPromise

  assert.equal(prompts.length, 0)
})

test("session.idle resumes when a tool part reports Tool execution aborted", async () => {
  const prompts: PromptCall[] = []
  const deleteMessageCalls: Array<{ sessionID: string; messageID: string }> = []
  const { timers, flush } = createTimers()
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_2b", parentID: "ses_parent" },
      messages: [
        {
          info: { role: "assistant", id: "msg_1" },
          parts: [
            {
              type: "tool",
              state: {
                status: "error",
                error: "Tool execution aborted",
                metadata: { interrupted: true },
              },
            },
          ],
        },
      ],
      prompts,
      deleteMessageCalls,
    }) as any,
    config: {
      rules: [
        {
          id: "resume-on-tool-abort",
          scope: "child",
          match: { toolExecutionAborted: true },
          action: { type: "prompt", text: "RESUME" },
          retry: { baseMs: 0, factor: 2, maxMs: 0, maxAttempts: 1 },
        },
      ],
    },
    timers: timers as any,
  })

  let settled = false
  const handleEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.idle",
      properties: { sessionID: "ses_2b" },
    }),
    () => {
      settled = true
    },
  )

  await waitForMacrotask()

  assert.equal(settled, true)
  assert.equal(prompts.length, 0)

  await flush()
  await handleEventPromise

  assert.deepEqual(deleteMessageCalls, [])
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].path.id, "ses_2b")
  assert.equal(prompts[0].body.parts[0].text, "RESUME")
})

test("session.idle resumes when assistant finish is length", async () => {
  const prompts: PromptCall[] = []
  const deleteMessageCalls: Array<{ sessionID: string; messageID: string }> = []
  const { timers, flush } = createTimers()
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_2c", parentID: "ses_parent" },
      messages: [
        {
          info: { role: "assistant", id: "msg_1" },
          finish: "length",
          parts: [{ type: "text", text: "truncated output" }],
        },
      ],
      prompts,
      deleteMessageCalls,
    }) as any,
    config: {
      rules: [
        {
          id: "resume-on-length-finish",
          scope: "child",
          match: { finishLengthStop: true },
          action: { type: "prompt", text: "RESUME" },
          retry: { baseMs: 0, factor: 2, maxMs: 0, maxAttempts: 1 },
        },
      ],
    },
    timers: timers as any,
  })

  let settled = false
  const handleEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.idle",
      properties: { sessionID: "ses_2c" },
    }),
    () => {
      settled = true
    },
  )

  await waitForMacrotask()

  assert.equal(settled, true)
  assert.equal(prompts.length, 0)

  await flush()
  await handleEventPromise

  assert.deepEqual(deleteMessageCalls, [{ sessionID: "ses_2c", messageID: "msg_1" }])
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].path.id, "ses_2c")
  assert.equal(prompts[0].body.parts[0].text, "RESUME")
})

test("session.idle resumes when step-finish reason is length", async () => {
  const prompts: PromptCall[] = []
  const { timers, flush } = createTimers()
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_2d", parentID: "ses_parent" },
      messages: [
        {
          info: { role: "assistant", id: "msg_1" },
          parts: [{ type: "step-finish", reason: "length" }],
        },
      ],
      prompts,
    }) as any,
    config: {
      rules: [
        {
          id: "resume-on-step-finish-length",
          scope: "child",
          match: { finishLengthStop: true },
          action: { type: "prompt", text: "RESUME" },
          retry: { baseMs: 0, factor: 2, maxMs: 0, maxAttempts: 1 },
        },
      ],
    },
    timers: timers as any,
  })

  let settled = false
  const handleEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.idle",
      properties: { sessionID: "ses_2d" },
    }),
    () => {
      settled = true
    },
  )

  await waitForMacrotask()

  assert.equal(settled, true)
  assert.equal(prompts.length, 0)

  await flush()
  await handleEventPromise

  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].path.id, "ses_2d")
  assert.equal(prompts[0].body.parts[0].text, "RESUME")
})

test("session.error replay preserves the latest user message agent and model", async () => {
  const prompts: PromptCall[] = []
  const { timers, flush } = createTimers()
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_3" },
      messages: [
        {
          info: {
            role: "user",
            agent: "first-agent",
            model: { providerID: "openai", modelID: "gpt-4.1-mini" },
          },
          parts: [{ type: "text", text: "ignore me" }],
        },
        {
          info: { role: "assistant", id: "msg_2" },
          parts: [{ type: "tool", tool: "read", state: { status: "completed" } }],
        },
        {
          info: {
            role: "user",
            agent: "writer",
            model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
          },
          parts: [{ type: "text", text: "resume" }],
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
          retry: { baseMs: 0, factor: 2, maxMs: 0, maxAttempts: 1 },
        },
      ],
    },
    timers: timers as any,
  })

  let settled = false
  const handleEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.error",
      properties: {
        sessionID: "ses_3",
        error: { name: "UnknownError", data: { message: "stream_read_error" } },
      },
    }),
    () => {
      settled = true
    },
  )

  await waitForMacrotask()

  assert.equal(settled, true)
  assert.equal(prompts.length, 0)

  await flush()
  await handleEventPromise

  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].body.parts[0].text, "resume")
  assert.equal(prompts[0].body.agent, "writer")
  assert.deepEqual(prompts[0].body.model, {
    providerID: "anthropic",
    modelID: "claude-3-5-sonnet-20241022",
  })
})

test("session.error with MessageAbortedError does not auto-resume by default", async () => {
  const prompts: PromptCall[] = []
  const { timers, flush } = createTimers()
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_abort" },
      messages: [
        {
          info: { role: "assistant", id: "msg_abort" },
          parts: [{ type: "text", text: "" }],
        },
      ],
      prompts,
    }) as any,
    config: {
      rules: [
        {
          id: "resume-on-abort",
          scope: "all",
          match: { messageRegex: "The operation was aborted" },
          action: { type: "prompt", text: "RESUME" },
          retry: { baseMs: 0, factor: 2, maxMs: 0, maxAttempts: 1 },
        },
      ],
    },
    timers: timers as any,
  })

  let settled = false
  const handleEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.error",
      properties: {
        sessionID: "ses_abort",
        error: { name: "MessageAbortedError", data: { message: "The operation was aborted." } },
      },
    }),
    () => {
      settled = true
    },
  )

  await waitForMacrotask()

  assert.equal(settled, true)
  assert.equal(prompts.length, 0)

  await flush()
  await handleEventPromise

  assert.equal(prompts.length, 0)
})

test("session.error with MessageAbortedError does not block later retryable errors", async () => {
  const prompts: PromptCall[] = []
  const { timers, delays, flush } = createTimers()
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_abort_then_retry" },
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
    properties: {
      sessionID: "ses_abort_then_retry",
      error: { name: "MessageAbortedError", data: { message: "The operation was aborted." } },
    },
  })

  await adapter.handleEvent({
    type: "session.error",
    properties: {
      sessionID: "ses_abort_then_retry",
      error: { name: "UnknownError", data: { message: "stream_read_error" } },
    },
  })

  await waitForMacrotask()

  assert.deepEqual(delays, [10])

  await flush()

  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].body.parts[0].text, "RESUME")
})

test("session.status retry clears a previous MessageAbortedError lock", async () => {
  const prompts: PromptCall[] = []
  const deleteMessageCalls: Array<{ sessionID: string; messageID: string }> = []
  const { timers, flush } = createTimers()
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_abort_unlock" },
      messages: [
        {
          info: { role: "user", id: "msg_u1" },
          parts: [{ type: "text", text: "search the docs and summarize" }],
        },
        {
          info: { role: "assistant", id: "msg_a1" },
          parts: [{ type: "tool", tool: "read", state: { status: "completed" } }],
        },
      ],
      prompts,
      deleteMessageCalls,
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
    properties: {
      sessionID: "ses_abort_unlock",
      error: { name: "MessageAbortedError", data: { message: "The operation was aborted." } },
    },
  })

  await adapter.handleEvent({
    type: "session.status",
    properties: {
      sessionID: "ses_abort_unlock",
      status: { type: "retry", attempt: 1, message: "retrying", next: Date.now() + 1000 },
    },
  })

  let settled = false
  const handleEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.error",
      properties: {
        sessionID: "ses_abort_unlock",
        error: { name: "UnknownError", data: { message: "stream_read_error" } },
      },
    }),
    () => {
      settled = true
    },
  )

  await waitForMacrotask()

  assert.equal(settled, true)
  assert.equal(prompts.length, 0)

  await flush()
  await handleEventPromise

  assert.deepEqual(deleteMessageCalls, [{ sessionID: "ses_abort_unlock", messageID: "msg_a1" }])
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].body.parts[0].text, "RESUME")
})

test("prompt failure clears pending recovery so a later event can retry", async () => {
  const prompts: PromptCall[] = []
  const { timers, flush } = createTimers()
  let shouldFail = true
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_4" },
      prompts,
      prompt: async () => {
        if (shouldFail) {
          shouldFail = false
          throw new Error("cancelled")
        }
      },
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

  let firstSettled = false
  const firstEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.error",
      properties: {
        sessionID: "ses_4",
        error: { name: "UnknownError", data: { message: "stream_read_error" } },
      },
    }),
    () => {
      firstSettled = true
    },
  )

  await waitForMacrotask()

  assert.equal(firstSettled, true)
  assert.equal(prompts.length, 0)

  await flush()
  await firstEventPromise

  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].body.parts[0].text, "RESUME")

  let secondSettled = false
  const secondEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.error",
      properties: {
        sessionID: "ses_4",
        error: { name: "UnknownError", data: { message: "stream_read_error" } },
      },
    }),
    () => {
      secondSettled = true
    },
  )

  await waitForMacrotask()

  assert.equal(secondSettled, true)
  assert.equal(prompts.length, 1)

  await flush()
  await secondEventPromise

  assert.equal(prompts.length, 2)
  assert.equal(prompts[1].body.parts[0].text, "RESUME")
})

test("session.deleted cancels a scheduled recovery before it fires", async () => {
  const prompts: PromptCall[] = []
  const { timers, flush } = createTimers()
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_5" },
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

  let settled = false
  const handleEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.error",
      properties: {
        sessionID: "ses_5",
        error: { name: "UnknownError", data: { message: "stream_read_error" } },
      },
    }),
    () => {
      settled = true
    },
  )

  await waitForMacrotask()

  assert.equal(settled, true)
  assert.equal(prompts.length, 0)

  await adapter.handleEvent({
    type: "session.deleted",
    properties: { sessionID: "ses_5" },
  })

  await flush()
  await handleEventPromise

  assert.equal(prompts.length, 0)
})

test("session.deleted cancels an in-flight recovery dispatch", async () => {
  const prompts: PromptCall[] = []
  const deferredPromptContext = createDeferred<unknown>()
  const { timers, delays, flush } = createTimers()
  let messagesCalls = 0
  const adapter = createOpenCodeAdapter({
    client: createClient({
      session: { id: "ses_6" },
      messages: () => {
        messagesCalls += 1
        if (messagesCalls === 1) {
          return {
            data: [
              {
                info: { role: "user", id: "msg_u1" },
                parts: [{ type: "text", text: "update the file" }],
              },
              {
                info: { role: "assistant", id: "msg_a1" },
                parts: [{ type: "tool", tool: "write", state: { status: "completed" } }],
              },
            ],
          }
        }

        return deferredPromptContext.promise
      },
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

  let settled = false
  const handleEventPromise = trackSettlement(
    adapter.handleEvent({
      type: "session.error",
      properties: {
        sessionID: "ses_6",
        error: { name: "UnknownError", data: { message: "stream_read_error" } },
      },
    }),
    () => {
      settled = true
    },
  )

  await waitForMacrotask()

  assert.equal(settled, true)
  assert.deepEqual(delays, [10])
  assert.equal(prompts.length, 0)

  const flushPromise = flush()
  await waitForMacrotask()

  await adapter.handleEvent({
    type: "session.deleted",
    properties: { sessionID: "ses_6" },
  })

  assert.equal(prompts.length, 0)

  deferredPromptContext.resolve({ data: [] })

  await flushPromise
  await handleEventPromise

  assert.equal(prompts.length, 0)
})
