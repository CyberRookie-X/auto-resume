# OpenCode Abort Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop auto-resume from continuing after a user manually stops an OpenCode session, while keeping safe recovery for explicit retry and idle-based recoveries.

**Architecture:** Keep the shared recovery engine unchanged. Update the OpenCode adapter to treat `MessageAbortedError` as ambiguous and only allow recovery when other positive signals are present, and narrow the default built-in rules so child sessions do not resume unless users opt in. Add regression tests around both the rule defaults and the OpenCode event flow.

**Tech Stack:** TypeScript, Node.js test runner, OpenCode SDK event adapter, existing recovery core.

---

### Task 1: Narrow the default OpenCode rule scope

**Files:**
- Modify: `auto-resume.rules.jsonc`
- Modify: `test/config-file.test.ts`

- [ ] **Step 1: Add a failing assertion for the default rule scope**

```ts
assert.deepEqual(config.rules.map((rule) => ({ id: rule.id, scope: rule.scope })), [
  { id: "resume-on-stream-read-error", scope: "root" },
  { id: "resume-on-reasoning-only-stop", scope: "root" },
  { id: "resume-on-tool-abort", scope: "root" },
  { id: "resume-on-length-finish", scope: "root" },
])
```

- [ ] **Step 2: Update the checked-in default rules to root-only**

Change every built-in rule scope from `"all"` to `"root"` in `auto-resume.rules.jsonc`.

- [ ] **Step 3: Re-run the config-file test**

Run:

```bash
npm test -- test/config-file.test.ts
```

Expected: PASS once the default scopes are narrowed.

### Task 2: Gate OpenCode recovery on aborted sessions

**Files:**
- Modify: `src/opencode.ts`
- Modify: `test/opencode.test.ts`

- [ ] **Step 1: Add a failing regression test for user stop handling**

Add a test that sends an OpenCode `session.error` event with `error.name === "MessageAbortedError"`, plus a session snapshot that looks idle/terminal, and assert that no recovery prompt is injected for that session.

Representative shape:

```ts
test("session.error with MessageAbortedError does not auto-resume by default", async () => {
  // event payload + session snapshot that would otherwise look recoverable
  // assert no prompt is scheduled or injected
})
```

- [ ] **Step 2: Run the targeted OpenCode test and confirm it fails**

Run:

```bash
npm test -- test/opencode.test.ts
```

Expected: the new test fails before the adapter change.

- [ ] **Step 3: Implement the minimal OpenCode gating logic**

In `src/opencode.ts`, add a short-circuit that treats `MessageAbortedError` as terminal unless a later positive recovery signal is already present for the same session. Keep the existing `session.deleted` cancellation path intact, and only let `session.error` / `session.idle` schedule recovery when the session is not in the aborted-stop state.

- [ ] **Step 4: Re-run the OpenCode test file**

Run:

```bash
npm test -- test/opencode.test.ts
```

Expected: PASS, including existing `session.idle` and replay-preservation cases.

### Task 3: Verify the whole suite

**Files:**
- No new files

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

- [ ] **Step 2: Run TypeScript check if tests pass**

Run:

```bash
npx tsc -p tsconfig.json
```

Expected: clean pass with no type regressions.
