# OpenCode Message Cleanup Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the failed OpenCode message before retrying so repeated recovery attempts do not accumulate duplicate user prompts or stale assistant turns.

**Architecture:** Keep the shared recovery engine unchanged. Update the OpenCode adapter to delete the specific failed message when it can identify one, then either replay the original user prompt or inject `RESUME` depending on the turn type and replay safety.

**Tech Stack:** TypeScript, Node.js test runner, `tsx`, `@opencode-ai/sdk`.

---

### Task 1: Add cleanup-focused adapter tests

**Files:**
- Modify: `test/opencode.test.ts`

- [ ] **Step 1: Add a failing test for user-message cleanup**

Add a `session.error` test where the latest turn contains only a user message, and assert that the adapter deletes that user message before replaying the original prompt.

- [ ] **Step 2: Add a failing test for safe assistant cleanup**

Add a `session.error` or `session.idle` test where the latest assistant turn is replay-safe, and assert that the adapter deletes the latest assistant message before sending `RESUME`.

- [ ] **Step 3: Add a failing test for unsafe assistant handling**

Add a test where the latest assistant turn is unsafe, and assert that the adapter does not delete any message and still sends `RESUME`.

- [ ] **Step 4: Add a regression test for user abort handling**

Keep or extend the existing `MessageAbortedError` coverage so manual aborts still short-circuit recovery and do not get cleaned up as retryable failures.

### Task 2: Extend the OpenCode client surface for deletion

**Files:**
- Modify: `src/opencode.ts`

- [ ] **Step 1: Extend the local client type**

Add `session.deleteMessage(...)` to the local `OpenCodeClient` type so the adapter can call the SDK delete API.

- [ ] **Step 2: Add a message-ID helper**

Add a small helper that reads a message ID from either `info.id` or the top-level `id`, matching the existing message parsing style.

- [ ] **Step 3: Add a delete helper**

Add a helper that reads messages, picks the target message, and calls `client.session.deleteMessage({ sessionID, messageID })` before retrying.

### Task 3: Wire deletion into `session.error`

**Files:**
- Modify: `src/opencode.ts`
- Modify: `test/opencode.test.ts`

- [ ] **Step 1: Update the no-assistant error path**

When the latest turn has no assistant message, delete the latest user message and then schedule a replay of the original prompt.

- [ ] **Step 2: Update the safe assistant error path**

When the latest turn has an assistant message and `classifyReplaySafety(...)` is `safe`, delete the latest assistant message and then schedule `RESUME`.

- [ ] **Step 3: Leave unsafe assistant turns intact**

When the latest turn is unsafe, do not delete anything. Keep the existing `RESUME` fallback.

### Task 4: Apply the same cleanup to `session.idle`

**Files:**
- Modify: `src/opencode.ts`
- Modify: `test/opencode.test.ts`

- [ ] **Step 1: Make idle recovery use the same assistant cleanup rule**

For replay-safe assistant idle states, delete the latest assistant message before sending `RESUME`.

- [ ] **Step 2: Preserve the existing user-abort gate**

Keep the `MessageAbortedError` / terminal-stop logic so manual stops still suppress idle recovery.

### Task 5: Verify the full suite

**Files:**
- No new files

- [ ] **Step 1: Run the focused OpenCode test file**

Run: `npm test -- test/opencode.test.ts`

- [ ] **Step 2: Run the full test suite**

Run: `npm test`

- [ ] **Step 3: Run TypeScript validation if tests pass**

Run: `npx tsc -p tsconfig.json`
