import test from "node:test"
import assert from "node:assert/strict"

import { createRecoveryEngine } from "../src/core.js"

test("onError schedules recovery for stream read errors", () => {
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

test("onScan schedules recovery for reasoning-only stops", () => {
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

  assert.deepEqual(decision, {
    type: "schedule",
    sessionID: "ses_2",
    ruleID: "resume-on-reasoning-only-stop",
    prompt: "RESUME",
    delayMs: 500,
  })
})

test("repeated identical failures are deduplicated until consumed", () => {
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

  engine.markExecuted({ sessionID: "ses_3", ruleID: "resume-on-stream-read-error" })

  const third = engine.onError({
    sessionID: "ses_3",
    scope: "root",
    errorName: "UnknownError",
    message: "stream_read_error",
    raw: "stream_read_error",
  })

  assert.equal(third?.type, "schedule")
  assert.equal(third?.delayMs, 2000)
})

test("a pending recovery blocks other rules in the same session until consumed", () => {
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
      {
        id: "resume-on-other-error",
        scope: "all",
        match: { messageRegex: "other_error" },
        action: { type: "prompt", text: "RESUME" },
        retry: { baseMs: 1000, factor: 2, maxMs: 8000, maxAttempts: 3 },
      },
    ],
  })

  const first = engine.onError({
    sessionID: "ses_4",
    scope: "root",
    errorName: "UnknownError",
    message: "stream_read_error",
    raw: "stream_read_error",
  })
  const second = engine.onError({
    sessionID: "ses_4",
    scope: "root",
    errorName: "UnknownError",
    message: "other_error",
    raw: "other_error",
  })

  assert.equal(first.type, "schedule")
  assert.equal(second.type, "ignore")

  engine.markExecuted({ sessionID: "ses_4", ruleID: "resume-on-stream-read-error" })

  const third = engine.onError({
    sessionID: "ses_4",
    scope: "root",
    errorName: "UnknownError",
    message: "other_error",
    raw: "other_error",
  })

  assert.equal(third.type, "schedule")
  assert.equal(third.ruleID, "resume-on-other-error")
})

test('scope: "child" rules do not match scope: "root" events', () => {
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

  assert.equal(decision.type, "ignore")
})

test("maxAttempts stops additional recovery scheduling after executed recoveries", () => {
  const engine = createRecoveryEngine({
    now: () => 0,
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

  const first = engine.onError({
    sessionID: "ses_12",
    scope: "root",
    errorName: "UnknownError",
    message: "stream_read_error#1",
    raw: "stream_read_error#1",
  })
  engine.markExecuted({ sessionID: "ses_12", ruleID: "bounded" })

  const second = engine.onError({
    sessionID: "ses_12",
    scope: "root",
    errorName: "UnknownError",
    message: "stream_read_error#2",
    raw: "stream_read_error#2",
  })
  engine.markExecuted({ sessionID: "ses_12", ruleID: "bounded" })

  const third = engine.onError({
    sessionID: "ses_12",
    scope: "root",
    errorName: "UnknownError",
    message: "stream_read_error#3",
    raw: "stream_read_error#3",
  })

  assert.equal(first.type, "schedule")
  assert.equal(second.type, "schedule")
  assert.equal(second.delayMs, 2000)
  assert.equal(third.type, "ignore")
})

test("messageIncludes ignores raw payload and error name", () => {
  const engine = createRecoveryEngine({
    now: () => 0,
    rules: [
      {
        id: "resume-on-error-name-text",
        scope: "all",
        match: { messageIncludes: "UnknownError" },
        action: { type: "prompt", text: "RESUME" },
        retry: { baseMs: 1000, factor: 2, maxMs: 8000, maxAttempts: 3 },
      },
    ],
  })

  const decision = engine.onError({
    sessionID: "ses_5",
    scope: "root",
    errorName: "UnknownError",
    message: "different payload",
    raw: "wrapped payload: UnknownError",
  })

  assert.equal(decision.type, "ignore")
})

test("markFailed clears a pending recovery and advances backoff", () => {
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
    sessionID: "ses_7",
    scope: "root",
    errorName: "UnknownError",
    message: "stream_read_error",
    raw: "stream_read_error",
  })

  engine.markFailed({ sessionID: "ses_7", ruleID: "resume-on-stream-read-error" })

  const second = engine.onError({
    sessionID: "ses_7",
    scope: "root",
    errorName: "UnknownError",
    message: "stream_read_error",
    raw: "stream_read_error",
  })

  assert.equal(first.type, "schedule")
  assert.equal(second.type, "schedule")
  assert.equal(second.delayMs, 2000)
})

test("clearSession removes finished session state", () => {
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
    sessionID: "ses_8",
    scope: "root",
    errorName: "UnknownError",
    message: "stream_read_error",
    raw: "stream_read_error",
  })

  engine.markExecuted({ sessionID: "ses_8", ruleID: "resume-on-stream-read-error" })
  engine.clearSession("ses_8")

  const second = engine.onError({
    sessionID: "ses_8",
    scope: "root",
    errorName: "UnknownError",
    message: "stream_read_error",
    raw: "stream_read_error",
  })

  assert.equal(first.type, "schedule")
  assert.equal(second.type, "schedule")
  assert.equal(second.delayMs, 1000)
})

test("messageRegex does not match only the error name", () => {
  const engine = createRecoveryEngine({
    now: () => 0,
    rules: [
      {
        id: "resume-on-error-name-regex",
        scope: "all",
        match: { messageRegex: "UnknownError" },
        action: { type: "prompt", text: "RESUME" },
        retry: { baseMs: 1000, factor: 2, maxMs: 8000, maxAttempts: 3 },
      },
    ],
  })

  const decision = engine.onError({
    sessionID: "ses_6",
    scope: "root",
    errorName: "UnknownError",
    message: "different payload",
    raw: "different payload",
  })

  assert.equal(decision.type, "ignore")
})

test("blank messageRegex does not match everything", () => {
  const engine = createRecoveryEngine({
    now: () => 0,
    rules: [
      {
        id: "blank-message-regex",
        scope: "all",
        match: { messageRegex: "" },
        action: { type: "prompt", text: "RESUME" },
        retry: { baseMs: 1000, factor: 2, maxMs: 8000, maxAttempts: 3 },
      },
    ],
  })

  const decision = engine.onError({
    sessionID: "ses_9",
    scope: "root",
    errorName: "UnknownError",
    message: "stream_read_error",
    raw: "stream_read_error",
  })

  assert.equal(decision.type, "ignore")
})

test("invalid messageRegex does not throw during matching", () => {
  const engine = createRecoveryEngine({
    now: () => 0,
    rules: [
      {
        id: "invalid-message-regex",
        scope: "all",
        match: { messageRegex: "(" },
        action: { type: "prompt", text: "RESUME" },
        retry: { baseMs: 1000, factor: 2, maxMs: 8000, maxAttempts: 3 },
      },
    ],
  })

  assert.doesNotThrow(() => {
    const decision = engine.onError({
      sessionID: "ses_10",
      scope: "root",
      errorName: "UnknownError",
      message: "stream_read_error",
      raw: "stream_read_error",
    })

    assert.equal(decision.type, "ignore")
  })
})

test("distinct error payloads keep pipe-delimited fingerprints distinct", () => {
  const originalSet = Map.prototype.set
  let capturedRuleState: { pendingFingerprint?: string } | undefined

  ;(Map.prototype as typeof Map.prototype & { set: typeof Map.prototype.set }).set = function (
    this: Map<unknown, unknown>,
    key: unknown,
    value: unknown,
  ) {
    if (key === "resume-on-pipe-fingerprint" && value && typeof value === "object") {
      capturedRuleState = value as { pendingFingerprint?: string }
    }

    return originalSet.call(this, key, value)
  }

  try {
    const engine = createRecoveryEngine({
      now: () => 0,
      rules: [
        {
          id: "resume-on-pipe-fingerprint",
          scope: "all",
          match: {},
          action: { type: "prompt", text: "RESUME" },
          retry: { baseMs: 1000, factor: 2, maxMs: 8000, maxAttempts: 3 },
        },
      ],
    })

    engine.onError({
      sessionID: "ses_11",
      scope: "root",
      errorName: "A|B",
      message: "C",
      raw: "D",
    })

    const firstFingerprint = capturedRuleState?.pendingFingerprint
    assert.ok(firstFingerprint)

    engine.markFailed({ sessionID: "ses_11", ruleID: "resume-on-pipe-fingerprint" })

    engine.onError({
      sessionID: "ses_11",
      scope: "root",
      errorName: "A",
      message: "B|C",
      raw: "D",
    })

    const secondFingerprint = capturedRuleState?.pendingFingerprint
    assert.ok(secondFingerprint)
    assert.notEqual(firstFingerprint, secondFingerprint)
  } finally {
    ;(Map.prototype as typeof Map.prototype & { set: typeof Map.prototype.set }).set = originalSet
  }
})
