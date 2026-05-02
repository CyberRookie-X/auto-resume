# Unified Recovery Implementation Plan

> **For agentic workers:** use `superpowers:subagent-driven-development` for implementation. Keep host-facing verification in Docker so local Claude Code, Codex, and OpenCode state is not disturbed.

**Goal:** ship one recovery core plus three host surfaces: the existing OpenCode adapter, a Claude Code plugin/hook surface, and a Codex plugin/hook surface. All three should use the same replay-safety gate and retry policy.

**Architecture:** keep the shared decision engine in TypeScript, then add thin host adapters. OpenCode stays in-process. Claude Code uses hook scripts plus resume commands. Codex uses hook scripts, plugin packaging, and `codex resume` / `codex exec resume` for continuation.

**Verification:** run host-facing tests and CLI checks in Docker with the repo mounted read/write and `node_modules` isolated in a container volume. Use local tests only for quick pure-core iterations.

---

### Phase 1: Harden the shared recovery core

**Files:**
- Modify: `src/core.ts`
- Modify: `src/replay.ts`
- Modify: `src/types.ts`
- Modify: `test/core.test.ts`
- Modify: `test/replay-safety.test.ts`

- [ ] **Step 1: Write failing tests for the shared policy**

Add coverage for:

- read-only turns remain replay-safe even with benign reasoning/tool noise
- write/delete/move/shell/unknown tools are unsafe
- scope filtering still blocks mismatched root/child sessions
- repeated identical failures do not re-trigger the same recovery loop
- backoff increases across executed recoveries and caps correctly

- [ ] **Step 2: Run the focused tests and confirm the failures are real**

Run:

```bash
npm test -- test/replay-safety.test.ts test/core.test.ts
```

- [ ] **Step 3: Implement the shared engine cleanup**

Make sure the core:

- compiles regexes safely
- fingerprints error and scan failures consistently
- keeps recovery state per session and per rule
- exposes enough data for adapters to decide between replay and `RESUME`

- [ ] **Step 4: Re-run the focused core suite**

Run:

```bash
npm test -- test/replay-safety.test.ts test/core.test.ts
```

---

### Phase 2: Add Claude Code recovery

**Files:**
- Create: `src/claude-code.ts`
- Create: `scripts/claude-recover.ts` or equivalent hook entrypoint
- Create: `.claude/settings.json` or `.claude/hooks/hooks.json`
- Create: `test/claude-code.test.ts`

- [ ] **Step 1: Write failing tests for Claude Code recovery**

Test cases should cover:

- a `StopFailure` or `Stop`-adjacent failure snapshot leads to a resumed Claude invocation
- replay-safe turns reissue the original user request via `claude --resume` or `claude -p --resume`
- unsafe turns fall back to `RESUME`
- the helper reads `session_id` and `transcript_path` and avoids duplicate relaunches

Representative assertions:

```ts
test("Claude Code replays a safe read-only turn", async () => {
  // hook payload + transcript fixture
  // expect the helper to call `claude --resume <id> <original prompt>`
})

test("Claude Code falls back to RESUME for unsafe turns", async () => {
  // write/shell fixture
  // expect `claude --resume <id> RESUME`
})
```

- [ ] **Step 2: Run the Claude-focused tests in Docker and confirm they fail**

Run:

```bash
docker run --rm -v "$PWD":/workspace -v auto-resume-node_modules:/workspace/node_modules -w /workspace node:22-bullseye bash -lc "npm test -- test/claude-code.test.ts"
```

- [ ] **Step 3: Implement the Claude Code hook surface**

Implement:

- hook payload parsing for `session_id`, `transcript_path`, `hook_event_name`, and stop-related fields
- transcript loading and latest-turn classification
- replay-safe request extraction
- `RESUME` fallback when the turn cannot be proved safe
- a recursion guard so the helper does not keep re-triggering itself

Use the documented Claude Code resume surface rather than trying to mutate `StopFailure` in place. `StopFailure` is observational; recovery must happen through a helper invocation or a resumed session.

- [ ] **Step 4: Re-run the Claude-focused tests in Docker**

Run:

```bash
docker run --rm -v "$PWD":/workspace -v auto-resume-node_modules:/workspace/node_modules -w /workspace node:22-bullseye bash -lc "npm test -- test/claude-code.test.ts"
```

---

### Phase 3: Add Codex recovery and plugin packaging

**Files:**
- Create: `src/codex.ts`
- Create: `hooks/hooks.json` or plugin lifecycle config
- Create: `.codex-plugin/plugin.json`
- Create: `test/codex.test.ts`
- Create: `scripts/codex-recover.ts` or equivalent hook entrypoint

- [ ] **Step 1: Write failing tests for Codex recovery**

Test cases should cover:

- `Stop` on a replay-safe turn creates a continuation that reuses the original user prompt
- unsafe turns continue with `RESUME`
- `codex exec --json` / resume flows can feed the same policy through JSONL events
- hook concurrency does not create duplicate recovery actions

Representative assertions:

```ts
test("Codex Stop hook replays a safe turn", async () => {
  // transcript fixture
  // expect a continuation prompt matching the original request
})

test("Codex Stop hook falls back to RESUME for unsafe turns", async () => {
  // write/shell fixture
  // expect `RESUME`
})
```

- [ ] **Step 2: Run the Codex-focused tests in Docker and confirm they fail**

Run:

```bash
docker run --rm -v "$PWD":/workspace -v auto-resume-node_modules:/workspace/node_modules -w /workspace node:22-bullseye bash -lc "npm test -- test/codex.test.ts"
```

- [ ] **Step 3: Implement the Codex hook surface and plugin files**

Implement:

- hook parsing for `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`, and non-interactive `turn.failed`/`error` streams where applicable
- transcript loading and replay-safe classification
- continuation prompt generation from the original user request
- plugin manifest wiring under `.codex-plugin/plugin.json`
- hook wiring under `hooks/hooks.json` or equivalent lifecycle config

Prefer `codex resume` / `codex exec resume` where the host is in CLI automation mode, and the normal `Stop` continuation prompt path where the host is interactive.

- [ ] **Step 4: Re-run the Codex-focused tests in Docker**

Run:

```bash
docker run --rm -v "$PWD":/workspace -v auto-resume-node_modules:/workspace/node_modules -w /workspace node:22-bullseye bash -lc "npm test -- test/codex.test.ts"
```

---

### Phase 4: Wire docs, examples, and final verification

**Files:**
- Modify: `README.md`
- Modify: any host-specific install docs
- Modify: any example manifests or marketplace entries if needed

- [ ] **Step 1: Add user-facing documentation**

Document:

- the shared recovery policy
- OpenCode vs Claude Code vs Codex behavior
- read-only replay vs `RESUME`
- plugin installation and hook wiring
- the reason Claude Code uses helper-driven resume paths while Codex can continue more directly

- [ ] **Step 2: Run the full suite in Docker**

Run:

```bash
docker run --rm -v "$PWD":/workspace -v auto-resume-node_modules:/workspace/node_modules -w /workspace node:22-bullseye bash -lc "npm test && npm run build"
```

- [ ] **Step 3: Confirm no host state was touched**

Verify the repo still behaves as a pure workspace package:

- no local Claude Code or Codex session files were modified outside the repo
- no destructive commands were run on the host
- host-facing verification stayed inside Docker
