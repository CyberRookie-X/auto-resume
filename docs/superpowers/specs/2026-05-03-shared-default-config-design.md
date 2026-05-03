# Shared Default Config Design

## Goal

Ship one checked-in `auto-resume.jsonc` as the canonical default recovery policy, and make sure the shipped runtime bundles all carry that same editable file.

## Why

- The current default config is empty, so the repo ships behavior but not the rules that explain it.
- Users need a visible file they can inspect and edit without reading source code.
- The same rule set should work across hosts, but each host still needs its own input normalization.
- A single file keeps GitHub distribution, docs, and runtime behavior aligned.

## Recommended Approach

Use one root-level JSONC file as the source of truth, plus a tiny shared loader that parses it and feeds the OpenCode recovery engine.

1. `auto-resume.jsonc` contains the default rule list and short comments.
2. A shared config loader parses JSONC from disk and returns `AutoResumeConfig`.
3. `createDefaultConfig()` returns the file-backed defaults instead of an empty rule list.
4. OpenCode uses those defaults when no explicit host config is supplied.
5. Claude Code and Codex ship the same file in their runtime bundles so the editable policy stays visible and portable across hosts.

## Architecture

The recovery engine stays unchanged. Only config sourcing changes.

- `auto-resume.jsonc` is the canonical editable config file.
- `src/config-file.ts` owns file resolution and JSONC parsing.
- `src/config.ts` normalizes raw config objects and keeps array copying behavior.
- `src/index.ts` exposes the default config factory backed by the file.
- `src/opencode.ts` continues to normalize host config, but starts from the file-backed defaults.
- `src/claude-code.ts` and `src/codex.ts` load the bundled defaults before making replay decisions.

The file path must be stable in both source checkout and compiled output, so the loader should resolve the config relative to the module location rather than the current working directory.

## File Layout

Files to add or modify:

- `auto-resume.jsonc`: canonical default rules with comments.
- `src/config-file.ts`: JSONC parser and file loader.
- `src/config.ts`: normalize loaded config objects.
- `src/index.ts`: return file-backed defaults.
- `src/opencode.ts`: start from file-backed defaults before applying host config.
- `src/claude-code.ts`: load the shared defaults before replaying Claude hooks.
- `src/codex.ts`: load the shared defaults before returning Codex hook decisions.
- `scripts/package-runtime.mjs`: include `auto-resume.jsonc` in the release tarball.
- `test/*.test.ts`: cover parser behavior, default config loading, and packaging coverage.

## Default Rules

The first shipping default rules should cover the common recovery paths already supported by the engine:

- `stream_read_error` retry for OpenCode-style upstream read failures.
- `reasoningOnlyStop` replay for safe reasoning-only turns.
- `toolExecutionAborted` replay for safe aborted tool sequences.
- `finishLengthStop` replay for length-limited safe turns.

The file should remain user-editable, so the comments must explain what each rule is for without embedding host-specific implementation details.

## Testing

- Add a parser test that proves JSONC comments and trailing commas are accepted.
- Add a default-config test that proves `createDefaultConfig()` matches the checked-in `auto-resume.jsonc` file.
- Keep the existing OpenCode/Claude/Codex behavior tests passing with the file-backed defaults.
- Add packaging assertions so `auto-resume.jsonc` is included in the runtime tarball and install tree.

## Risks

- JSONC parsing needs to preserve strings that contain `//` or `/*` characters.
- The compiled `dist/` layout must still resolve the root config file correctly.
- If the release tarball omits the config file, the runtime will fall back to an empty policy and the install promise will be broken.

## Acceptance Criteria

- `auto-resume.jsonc` exists in the repo and contains the default rule set.
- `createDefaultConfig()` returns the rules from that file.
- OpenCode, Claude Code, and Codex all run with the same bundled defaults.
- The release tarball and runtime install tree include `auto-resume.jsonc`.
- The parser and packaging tests cover the new file-backed behavior.
