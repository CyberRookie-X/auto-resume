# Release Asset Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` task-by-task. Keep host-facing verification in Docker so local OpenCode / Claude / Codex state is not disturbed.

**Goal:** keep the source of truth in TypeScript, but publish a GitHub Release runtime archive that users can install without npm or a local build step.

**Architecture:** keep the current TS sources and tests in the repo, compile them to `dist/` for release, and use small plain-JS hook launchers that load the compiled runtime. GitHub’s built-in source archive remains the source package; the CI workflow publishes one self-contained runtime tarball for installation.

**Tech Stack:** TypeScript, Node.js, GitHub Actions, `tar`, `curl`, `npm test`, `npm run build`

---

### Task 1: Make the runtime entrypoints release-safe

**Files:**
- Modify: `hooks/claude-hook.js`
- Modify: `hooks/codex-hook.js`
- Modify: `test/claude-code.test.ts`
- Modify: `test/codex.test.ts`
- Modify: `test/hook-runtime-paths.test.ts`
- Delete: `src/claude-code.js`
- Delete: `src/codex.js`
- Delete: `src/replay.js`

- [ ] **Step 1: Write the failing runtime-path test**

Add a test that:

- reads `.claude/settings.json` and `hooks/hooks.json`
- asserts the configured commands point at the checked-in hook launchers, not `dist/` and not `tsx`
- runs `npm run build`
- then executes the actual hook commands with plain `node`

Representative assertions:

```ts
test("release runtime hooks run under plain node", async () => {
  // build first
  // spawn the exact hook command from the config
  // expect the launcher to exit 0 and print the expected JSON/no-op output
})
```

- [ ] **Step 2: Run the focused test and confirm it fails first**

Run:

```bash
npm test -- test/hook-runtime-paths.test.ts
```

Expected: fail because the current launchers still depend on temporary bridge files / non-release-safe paths.

- [ ] **Step 3: Implement plain-JS release launchers**

Make `hooks/claude-hook.js` and `hooks/codex-hook.js` load the compiled runtime from `dist/` so the release archive can execute them with plain `node`.

Keep the hook launchers tiny. Their job is only to read stdin, delegate to the compiled runtime, and write the hook response.

- [ ] **Step 4: Re-run the focused runtime-path test**

Run:

```bash
npm test -- test/hook-runtime-paths.test.ts
```

Expected: pass.

---

### Task 2: Package a release runtime archive

**Files:**
- Modify: `package.json`
- Create: `scripts/package-runtime.mjs`
- Create: `.github/workflows/release.yml`
- Create: `test/release-package.test.ts`

- [ ] **Step 1: Write the failing packaging test**

Add a test that runs the packaging script into a temp directory and inspects the archive contents.

Representative assertions:

```ts
test("runtime package includes release-safe files", async () => {
  // run scripts/package-runtime.mjs --out /tmp/auto-resume-runtime.tar.gz
  // inspect tar entries
  // assert the archive includes dist/*.js, hooks/*.js, manifests, and README
})
```

- [ ] **Step 2: Run the focused packaging test and confirm it fails first**

Run:

```bash
npm test -- test/release-package.test.ts
```

Expected: fail because the packaging script does not exist yet.

- [ ] **Step 3: Implement the packaging script and release workflow**

Implement:

- `scripts/package-runtime.mjs` to build a staging directory from the compiled `dist/` output plus the runtime manifests and hook launchers
- a GitHub Actions workflow that runs `npm test` and `npm run build` on tags, then uploads the runtime tarball as the release asset
- a `package.json` script such as `release:runtime` that invokes the packaging script locally

The workflow should treat GitHub’s default source archive as the source package. Only the runtime tarball needs to be produced manually.

- [ ] **Step 4: Re-run the packaging test**

Run:

```bash
npm test -- test/release-package.test.ts
```

Expected: pass.

---

### Task 3: Add an install path that does not require npm

**Files:**
- Create: `install.sh`
- Modify: `README.md`
- Create: `test/install-script.test.ts`

- [ ] **Step 1: Write the failing install smoke test**

Add a test or Docker smoke command that installs from a local runtime tarball into a temp target and checks that the hook files are present.

Representative command:

```bash
./install.sh --tarball /tmp/auto-resume-runtime.tar.gz --target /tmp/auto-resume-install
test -f /tmp/auto-resume-install/hooks/claude-hook.js
test -f /tmp/auto-resume-install/hooks/codex-hook.js
```

- [ ] **Step 2: Run the smoke command and confirm it fails first**

Run it in Docker so the host workspace stays untouched.

- [ ] **Step 3: Implement the installer and docs**

Implement an installer that:

- accepts a local tarball for offline testing
- otherwise downloads the latest runtime asset from GitHub Releases
- unpacks the runtime archive into the target directory

Update `README.md` with the GitHub Release install path and make clear that users do not need npm.

- [ ] **Step 4: Re-run the install smoke command**

Run it again in Docker and confirm the target directory contains the release runtime files.

---

### Task 4: End-to-end verification in Docker

**Files:**
- None

- [ ] **Step 1: Run the full suite in Docker**

Run:

```bash
docker run --rm -v "$PWD":/workspace -v auto-resume-node_modules:/workspace/node_modules -w /workspace node:24-bullseye bash -lc "npm test && npm run build && npm run release:runtime"
```

- [ ] **Step 2: Smoke-test the installed runtime package in Docker**

Run the installer against the freshly built runtime tarball, then execute the hook launchers with plain `node`.

Example:

```bash
docker run --rm -v "$PWD":/workspace -v auto-resume-node_modules:/workspace/node_modules -w /workspace node:24-bullseye bash -lc '
  npm test && npm run build && npm run release:runtime && \
  ./install.sh --tarball /workspace/release/auto-resume-runtime.tar.gz --target /tmp/auto-resume-install && \
  node /tmp/auto-resume-install/hooks/claude-hook.js < /dev/null && \
  node /tmp/auto-resume-install/hooks/codex-hook.js < /dev/null
'
```

- [ ] **Step 3: Confirm the host remains untouched**

Verify that no local OpenCode / Claude / Codex session state was modified outside the repository and Docker container.
