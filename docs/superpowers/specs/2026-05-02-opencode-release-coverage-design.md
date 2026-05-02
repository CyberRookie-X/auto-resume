# OpenCode Release Coverage Design

## Goal

Make it explicit that OpenCode continues to ship as part of the same GitHub Release runtime package, with docs and tests that prevent accidental removal.

## Why

- OpenCode is the reference in-process adapter and should stay on the same release path as the shared runtime.
- The repo already ships Claude Code and Codex as release assets; OpenCode should be called out as included, not treated as a special case.
- A small docs-plus-test closure is enough here. No separate OpenCode installer or plugin packaging is needed.

## Model

- Source tree: TypeScript library code, tests, docs.
- Release runtime package: compiled JS plus `hooks/`, `.claude/`, `.codex-plugin/`, and `dist/opencode.js`.
- Documentation: README explains that OpenCode is bundled in the same runtime package and remains a library consumer, not a standalone installer.

## Coverage

The release package must continue to include OpenCode-related runtime files:

- `dist/opencode.js`
- `dist/index.js`
- the shared runtime code that `createOpenCodeAdapter` depends on

The repository docs must make this relationship obvious to users so they do not expect a separate OpenCode release artifact.

## Testing

- Keep the existing runtime tarball test as the primary guard.
- Add or adjust a small assertion so the OpenCode adapter is explicitly listed as part of the release runtime package.
- Add a README assertion or a docs-oriented test if needed so the install docs mention OpenCode’s inclusion in the shared release package.

## Risks

- If the release tarball stops shipping `dist/opencode.js`, OpenCode users would lose the adapter even though Claude Code and Codex still install.
- If the README only talks about Claude Code and Codex, users may assume OpenCode has a different release path.

## Acceptance Criteria

- The README says OpenCode is included in the same release runtime package.
- The release package test explicitly guards `dist/opencode.js`.
- No new OpenCode-specific release pipeline is introduced.
