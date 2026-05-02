# OpenCode Release Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** keep OpenCode explicitly covered by the same GitHub Release runtime package, with docs and tests that prevent accidental removal.

**Architecture:** do not add a new OpenCode installer or release pipeline. Keep OpenCode as the in-process library adapter, update the install docs so they clearly say OpenCode is included in the shared runtime tarball, and strengthen the release-package test so it checks that the packaged README carries that message while `dist/opencode.js` remains in the runtime asset allowlist.

**Tech Stack:** Markdown, TypeScript, `node:test`, `child_process`, `tar`

---

### Task 1: Document OpenCode in the shared release package

**Files:**
- Modify: `README.md`
- Modify: `test/release-package.test.ts`

- [ ] **Step 1: Write the failing test assertion**

Add an assertion to `test/release-package.test.ts` after the runtime tarball is extracted and before the hook launchers are executed:

```ts
const runtimeReadme = await readFile(join(extractDir, "README.md"), "utf8")
assert.match(
  runtimeReadme,
  /OpenCode is included in the same release runtime package\./,
)
```

Keep `dist/opencode.js` in the existing `expectedFiles` list so the runtime tarball still explicitly guards the OpenCode adapter file.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
npm test -- test/release-package.test.ts
```

Expected: FAIL because the runtime README does not yet say that OpenCode is included in the shared release package.

- [ ] **Step 3: Update the install docs**

Add this sentence to the Install section in `README.md` immediately after the existing `./install.sh --target ...` example:

```md
OpenCode is included in the same release runtime package. The same tarball also ships the Claude Code and Codex runtime entrypoints.
```

- [ ] **Step 4: Re-run the focused release-package test**

Run:

```bash
npm test -- test/release-package.test.ts
```

Expected: PASS.

- [ ] **Step 5: Verify the full suite and build**

Run:

```bash
npm test && npm run build
```

Expected: PASS, with all tests green and the TypeScript build succeeding.

---

### Task 2: Final OpenCode release-coverage sanity check

**Files:**
- None

- [ ] **Step 1: Re-read the release package test and README together**

Confirm these two facts remain true:

- `test/release-package.test.ts` still checks `dist/opencode.js` in the tarball.
- `README.md` tells users that OpenCode is part of the same shared release runtime package.

- [ ] **Step 2: Stop if any OpenCode-specific release path has been introduced**

There should be no new OpenCode installer, no new OpenCode-specific release tarball, and no separate OpenCode packaging workflow.
