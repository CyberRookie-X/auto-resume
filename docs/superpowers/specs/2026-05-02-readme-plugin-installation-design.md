# README Plugin Installation Design

## Goal

Make `README.md` and `README.zh.md` present plugin-based installation as the primary path, with complete host-specific installation and configuration instructions.

## Why

- The current README still leads with `install.sh`, which makes the offline fallback look like the default path.
- The repo now supports native installation flows for OpenCode, Claude Code, and Codex.
- Users need one place that explains which files belong to each host and how they fit together.

## Recommended Approach

Use a plugin-first README structure with a short install overview and a later configuration reference.

1. Keep the introduction and language switch link.
2. Rewrite `Install` so it lists hosts in this order: OpenCode, Claude Code, Codex, then `install.sh` as the offline fallback.
3. Add a short subsection for each host with:
   - the install path
   - the files involved
   - a minimal working example or command
   - one short note on how the host discovers the plugin
4. Add a `Configuration Reference` section that explains the purpose of each plugin/config file.
5. Mirror the same content and order in `README.zh.md`.

This keeps the README usable for new users while still documenting the full plugin setup.

## Alternatives Considered

1. Keep a single install paragraph and mention all hosts inline. Rejected because it is hard to scan and easy to miss the configuration files.
2. Move the installation guide to a separate document. Rejected because the request is specifically to keep the instructions in the README.
3. Plugin-first README with a compact configuration reference. Chosen because it is direct, discoverable, and keeps the fallback path secondary.

## README Structure

### Install

The install section should present the primary paths in this order:

1. OpenCode: load the repository directly from `opencode.json` with `plugin: ["./"]`.
2. Claude Code: use `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `.claude/settings.json`.
3. Codex: use `.codex-plugin/plugin.json` with the shared marketplace metadata and hook definitions.
4. `install.sh`: offline fallback for unpacking a runtime tarball manually.

### Host Subsections

Each host subsection should answer three questions:

- How do I install it?
- Which files does it use?
- What is the minimum config I need to edit?

### Configuration Reference

Add a short reference table or bullet list for these files:

- `opencode.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `.claude/settings.json`
- `.codex-plugin/plugin.json`
- `hooks/hooks.json`

Each entry should explain what the file does and which host reads it.

## Testing

- Update the README-related assertions in the existing release/runtime tests so they match the new plugin-first wording.
- Keep the runtime and install smoke tests focused on behavior, not prose beyond the updated install guidance.

## Risks

- The README can become too long if each host section repeats too much detail.
- The wording must stay aligned with the actual manifests and workflow files.
- The Chinese README must mirror the English structure closely enough that users can follow either one.

## Acceptance Criteria

- `README.md` presents plugin installation before `install.sh`.
- `README.md` includes a clear explanation of the configuration files used by OpenCode, Claude Code, and Codex.
- `README.zh.md` mirrors the English README's install order and configuration guidance.
- The existing documentation-related tests pass after the README updates.
