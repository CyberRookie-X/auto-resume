# Assistant-Turn-Aware Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent replay from re-sending an old user prompt when the latest assistant turn is the only part that should be considered for recovery safety.

**Architecture:** Keep the shared replay-safety classifier, but tighten each host adapter so replay is allowed only when the latest assistant turn is read-only. OpenCode will keep using the latest assistant message directly; Claude Code and Codex will only carry the latest assistant message into the replay window.

**Tech Stack:** TypeScript, Node.js test runner, `tsx`, `@opencode-ai/sdk`.

---

### Task 1: Add failing multi-assistant regression tests

**Files:**
- Modify: `test/opencode.test.ts`
- Modify: `test/claude-code.test.ts`
- Modify: `test/codex.test.ts`

- [ ] Add one test per host showing that multiple assistant messages do not block replay when the latest assistant message is read-only.
- [ ] Run the focused tests and verify they fail under the current implementation.

### Task 2: Tighten host replay selection

**Files:**
- Modify: `src/opencode.ts`
- Modify: `src/claude-code.ts`
- Modify: `src/codex.ts`

- [ ] Remove the multi-assistant fallback gates from OpenCode, Claude Code, and Codex.
- [ ] Ensure Claude Code and Codex only feed the latest assistant message into replay safety classification.

### Task 3: Verify behavior and guard existing cases

**Files:**
- Modify: `test/replay-safety.test.ts` only if shared helper behavior needs direct coverage.

- [ ] Run targeted host tests.
- [ ] Run `npm test` from the dev worktree.
- [ ] Confirm existing single-assistant read-only replay still works and unsafe write/shell cases still use `RESUME`.
