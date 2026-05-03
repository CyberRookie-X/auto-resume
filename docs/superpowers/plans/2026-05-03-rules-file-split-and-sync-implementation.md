# Rules File Split and Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split recovery rules into a separate `auto-resume.rules.jsonc` file, keep runtime knobs in `auto-resume.jsonc`, and add optional best-effort remote rule refresh with a local cache.

**Architecture:** The config loader will read two JSONC files: a small runtime config file and a rules file. The recovery engine will gain a rule-replacement hook so OpenCode can hot-swap refreshed rules without losing session state. A lightweight sync loop will fetch rules from configured URLs, write the latest valid snapshot to a cache file, and keep long-lived OpenCode sessions up to date while other hosts keep using the cached or bundled snapshot at startup.

**Tech Stack:** TypeScript, `node:test`, Node `fs/promises`, Node timers, global `fetch`.

---

### Task 1: Split config files and parsing

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config-file.ts`
- Modify: `src/config.ts`
- Modify: `src/index.ts`
- Modify: `auto-resume.jsonc`
- Add: `auto-resume.rules.jsonc`
- Modify: `test/config-file.test.ts`

- [ ] **Step 1: write failing tests**
- [ ] **Step 2: run the targeted config tests and confirm they fail for the missing split files / missing parser APIs**
- [ ] **Step 3: implement the minimal runtime-config and rules-file loaders**
- [ ] **Step 4: run the targeted config tests and confirm they pass**

### Task 2: Add rules refresh support

**Files:**
- Modify: `src/core.ts`
- Add: `src/rules-sync.ts`
- Modify: `src/opencode.ts`
- Modify: `test/core.test.ts`
- Add: `test/rules-sync.test.ts`

- [ ] **Step 1: write failing tests for rule hot-swap and cache refresh**
- [ ] **Step 2: run the targeted tests and confirm they fail before implementation**
- [ ] **Step 3: implement the rule replacement hook and sync loop**
- [ ] **Step 4: run the targeted tests and confirm they pass**

### Task 3: Update host loaders, docs, and packaging

**Files:**
- Modify: `src/claude-code.ts`
- Modify: `src/codex.ts`
- Modify: `scripts/package-runtime.mjs`
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `test/release-package.test.ts`
- Modify: `test/readme-installation.test.ts`
- Modify: `test/native-install-docs.test.ts`

- [ ] **Step 1: write failing tests for the new config file references and packaged assets**
- [ ] **Step 2: run the targeted docs/packaging tests and confirm they fail before the updates**
- [ ] **Step 3: update the host loaders and documentation text**
- [ ] **Step 4: run the targeted tests and confirm they pass**

### Task 4: Full verification

**Files:**
- No code changes expected

- [ ] **Step 1: run the full test suite**
- [ ] **Step 2: run the build**
- [ ] **Step 3: inspect any failures and fix them before completion**
