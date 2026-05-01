# OpenCode Auto Resume Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-release `opencode` plugin that resumes stopped sessions by reacting to `session.error` events and post-stop message scans, then injecting a configured prompt such as `RESUME`.

**Architecture:** Split the package into a host-agnostic recovery core and a thin `opencode` adapter. The core owns rule matching, scope filtering, retry state, and backoff decisions; the adapter owns OpenCode SDK event wiring, message scanning, and prompt injection.

**Tech Stack:** TypeScript, Node.js test runner, `@opencode-ai/sdk`, local plugin entrypoint.

**Verification:** Run tests and builds inside a Docker container with the workspace mounted and `node_modules` isolated in a container volume. Do not rely on the host OpenCode environment for verification.

---

### Task 1: Scaffold package and test harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`
- Create: `src/types.ts`
- Create: `test/smoke.test.ts`

- [ ] **Step 1: Write the failing smoke test**

```ts
import test from "node:test"
import assert from "node:assert/strict"

import { createDefaultConfig } from "../src/index.js"

test("exports a default config factory", () => {
  const config = createDefaultConfig()
  assert.equal(typeof config, "object")
  assert.ok(Array.isArray(config.rules))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/smoke.test.ts`
Expected: FAIL because `src/index.ts` and its exports do not exist yet.

- [ ] **Step 3: Add the minimal package scaffold**

```json
{
  "name": "auto-resume",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "node --test --import tsx"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.3"
  },
  "dependencies": {
    "@opencode-ai/sdk": "latest"
  }
}
```

```ts
export type AutoResumeConfig = {
  rules: unknown[]
}

export function createDefaultConfig(): AutoResumeConfig {
  return { rules: [] }
}
```

- [ ] **Step 4: Run tests to verify the scaffold passes**

Run: `npm test`
Expected: PASS with the smoke test green.

### Task 2: Drive the recovery core with failing tests

**Files:**
- Create: `src/core.ts`
- Modify: `src/types.ts`
- Create: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for core behavior**

```ts
import test from "node:test"
import assert from "node:assert/strict"

import { createRecoveryEngine } from "../src/core.js"

test("matches session.error rules and schedules recovery", () => {
  const engine = createRecoveryEngine({
    now: () => 0,
    rules: [
      {
        id: "resume-on-stream-read-error",
        scope: "all",
        match: { messageRegex: "stream_read_error" },
        action: { type: "prompt", text: "RESUME" },
        retry: { baseMs: 1000, factor: 2, maxMs: 8000, maxAttempts: 3 },
      },
    ],
  })

  const decision = engine.onError({
    sessionID: "ses_1",
    scope: "root",
    errorName: "UnknownError",
    message: "upstream_error: stream_read_error",
    raw: "upstream_error: stream_read_error",
  })

  assert.deepEqual(decision, {
    type: "schedule",
    sessionID: "ses_1",
    ruleID: "resume-on-stream-read-error",
    prompt: "RESUME",
    delayMs: 1000,
  })
})

test("matches post-stop scans for reasoning-only assistant turns", () => {
  const engine = createRecoveryEngine({
    now: () => 0,
    rules: [
      {
        id: "resume-on-reasoning-only-stop",
        scope: "all",
        match: { reasoningOnlyStop: true },
        action: { type: "prompt", text: "RESUME" },
        retry: { baseMs: 500, factor: 2, maxMs: 4000, maxAttempts: 2 },
      },
    ],
  })

  const decision = engine.onScan({
    sessionID: "ses_2",
    scope: "child",
    flags: { reasoningOnlyStop: true, toolExecutionAborted: false, finishLengthStop: false },
    latestMessageFingerprint: "assistant:reasoning-only",
  })

  assert.equal(decision?.type, "schedule")
  assert.equal(decision?.prompt, "RESUME")
})

test("deduplicates repeated identical failures", () => {
  const engine = createRecoveryEngine({
    now: () => 0,
    rules: [
      {
        id: "resume-on-stream-read-error",
        scope: "all",
        match: { messageRegex: "stream_read_error" },
        action: { type: "prompt", text: "RESUME" },
        retry: { baseMs: 1000, factor: 2, maxMs: 8000, maxAttempts: 3 },
      },
    ],
  })

  const first = engine.onError({
    sessionID: "ses_3",
    scope: "root",
    errorName: "UnknownError",
    message: "stream_read_error",
    raw: "stream_read_error",
  })
  const second = engine.onError({
    sessionID: "ses_3",
    scope: "root",
    errorName: "UnknownError",
    message: "stream_read_error",
    raw: "stream_read_error",
  })

  assert.equal(first?.type, "schedule")
  assert.equal(second?.type, "ignore")
})
```

- [ ] **Step 2: Run only the core tests and verify they fail**

Run: `npm test -- test/core.test.ts`
Expected: FAIL because the recovery engine and its types do not exist yet.

- [ ] **Step 3: Implement the minimal core and types**

Implement:

- `Scope = "root" | "child" | "all"`
- rule match fields for `errorName`, `messageIncludes`, `messageRegex`, `reasoningOnlyStop`, `toolExecutionAborted`, `finishLengthStop`
- `createRecoveryEngine()` with `onError()` and `onScan()`
- per-session/rule state for attempts and fingerprint de-duplication
- exponential delay calculation with cap

- [ ] **Step 4: Re-run the core tests**

Run: `npm test -- test/core.test.ts`
Expected: PASS for rule matching, scan matching, and de-duplication.

### Task 3: Add scope and retry-budget coverage

**Files:**
- Modify: `test/core.test.ts`
- Modify: `src/core.ts`

- [ ] **Step 1: Add failing tests for scope and retry caps**

```ts
test("does not schedule when scope excludes the session", () => {
  const engine = createRecoveryEngine({
    now: () => 0,
    rules: [
      {
        id: "children-only",
        scope: "child",
        match: { messageRegex: "stream_read_error" },
        action: { type: "prompt", text: "RESUME" },
        retry: { baseMs: 1000, factor: 2, maxMs: 8000, maxAttempts: 3 },
      },
    ],
  })

  const decision = engine.onError({
    sessionID: "ses_root",
    scope: "root",
    errorName: "UnknownError",
    message: "stream_read_error",
    raw: "stream_read_error",
  })

  assert.equal(decision?.type, "ignore")
})

test("stops scheduling after max attempts", () => {
  let now = 0
  const engine = createRecoveryEngine({
    now: () => now,
    rules: [
      {
        id: "bounded",
        scope: "all",
        match: { messageRegex: "stream_read_error" },
        action: { type: "prompt", text: "RESUME" },
        retry: { baseMs: 1000, factor: 2, maxMs: 8000, maxAttempts: 2 },
      },
    ],
  })

  engine.onError({ sessionID: "ses_4", scope: "root", errorName: "UnknownError", message: "stream_read_error#1", raw: "stream_read_error#1" })
  now = 10_000
  engine.markExecuted({ sessionID: "ses_4", ruleID: "bounded" })
  engine.onError({ sessionID: "ses_4", scope: "root", errorName: "UnknownError", message: "stream_read_error#2", raw: "stream_read_error#2" })
  now = 20_000
  engine.markExecuted({ sessionID: "ses_4", ruleID: "bounded" })
  const finalDecision = engine.onError({ sessionID: "ses_4", scope: "root", errorName: "UnknownError", message: "stream_read_error#3", raw: "stream_read_error#3" })

  assert.equal(finalDecision?.type, "ignore")
})
```

- [ ] **Step 2: Run the core tests and verify the new assertions fail**

Run: `npm test -- test/core.test.ts`
Expected: FAIL if scope or retry-budget logic is incomplete.

- [ ] **Step 3: Implement the missing state transitions**

Make sure the core:

- filters root vs child sessions correctly
- increments attempts only for executed recoveries
- stops after `maxAttempts`
- grows delay with `baseMs * factor^(attempt-1)` capped by `maxMs`

- [ ] **Step 4: Re-run the core tests**

Run: `npm test -- test/core.test.ts`
Expected: PASS for scope and retry-budget behavior.

### Task 4: Build the OpenCode adapter against mocked host events

**Files:**
- Create: `src/config.ts`
- Create: `src/opencode.ts`
- Create: `test/opencode.test.ts`

- [ ] **Step 1: Write failing adapter tests**

```ts
import test from "node:test"
import assert from "node:assert/strict"

import { createOpenCodeAdapter } from "../src/opencode.js"

test("injects RESUME after matching session.error", async () => {
  const prompts: Array<{ sessionID: string; text: string }> = []
  const adapter = createOpenCodeAdapter({
    client: {
      session: {
        prompt: async ({ path, body }: any) => {
          prompts.push({ sessionID: path.id, text: body.parts[0].text })
        },
        get: async () => ({ data: { id: "ses_1" } }),
        messages: async () => ({ data: [] }),
      },
    } as any,
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
    timers: { setTimeout: (fn: () => void) => { fn(); return 0 as any }, clearTimeout: () => {} },
  })

  await adapter.handleEvent({
    type: "session.error",
    properties: {
      sessionID: "ses_1",
      error: { name: "UnknownError", data: { message: "upstream_error: stream_read_error" } },
    },
  })

  assert.deepEqual(prompts, [{ sessionID: "ses_1", text: "RESUME" }])
})

test("scans terminal messages and resumes reasoning-only stops", async () => {
  const prompts: Array<{ sessionID: string; text: string }> = []
  const adapter = createOpenCodeAdapter({
    client: {
      session: {
        prompt: async ({ path, body }: any) => {
          prompts.push({ sessionID: path.id, text: body.parts[0].text })
        },
        get: async () => ({ data: { id: "ses_2", parentID: "ses_parent" } }),
        messages: async () => ({
          data: [
            {
              info: { role: "assistant", id: "msg_1" },
              parts: [{ type: "reasoning", text: "thinking" }],
            },
          ],
        }),
      },
    } as any,
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
    timers: { setTimeout: (fn: () => void) => { fn(); return 0 as any }, clearTimeout: () => {} },
  })

  await adapter.handleEvent({
    type: "session.idle",
    properties: { sessionID: "ses_2" },
  })

  assert.deepEqual(prompts, [{ sessionID: "ses_2", text: "RESUME" }])
})
```

- [ ] **Step 2: Run the adapter tests and verify they fail**

Run: `npm test -- test/opencode.test.ts`
Expected: FAIL because the adapter implementation does not exist yet.

- [ ] **Step 3: Implement the adapter minimally**

Implement:

- config normalization with sane defaults
- event handling for `session.error` and `session.idle`
- session scope detection from `parentID`
- message scan flags for reasoning-only stop, tool-aborted stop, and `finish: "length"`
- prompt injection via `client.session.prompt()` using a single text part

- [ ] **Step 4: Re-run the adapter tests**

Run: `npm test -- test/opencode.test.ts`
Expected: PASS for both event-driven and scan-driven recovery.

### Task 5: Wire public exports and document configuration

**Files:**
- Modify: `src/index.ts`
- Create: `README.md`

- [ ] **Step 1: Write a failing documentation-facing export test**

```ts
import test from "node:test"
import assert from "node:assert/strict"

import { createOpenCodeAdapter, createRecoveryEngine } from "../src/index.js"

test("public entrypoint exports the core and adapter", () => {
  assert.equal(typeof createRecoveryEngine, "function")
  assert.equal(typeof createOpenCodeAdapter, "function")
})
```

- [ ] **Step 2: Run the full test suite and verify the export test fails**

Run: `npm test`
Expected: FAIL if the root entrypoint does not re-export the finished modules.

- [ ] **Step 3: Add final exports and README usage docs**

Document:

- install and run steps
- rule format
- `stream_read_error -> RESUME` example
- root vs child scope behavior
- first-release non-goals

- [ ] **Step 4: Run the full suite and build**

Run: `npm test && npm run build`
Expected: PASS with all tests green and TypeScript compiling cleanly.
