# Native Install Docs Design

## Goal

Make plugin-based installation the primary onboarding path in `README.md` and `README.zh.md`, with copyable host-specific configuration blocks and host-specific `INSTALL.md` files that agents can fetch directly.

## Why

- The current README tells users which files exist, but it still leaves too much work to the reader.
- A raw `INSTALL.md` path gives agents a deterministic installation script to follow.
- Copyable config blocks let humans configure each host without having to infer file edits.
- `install.sh` should remain a fallback, not the main way users are taught to install.

## Recommended Approach

Use a two-layer install story for each host:

1. A short README section tells the host to fetch and follow a raw `INSTALL.md` file.
2. A manual configuration block immediately below shows the exact files to copy or paste.

The README keeps the onboarding flow short and readable. The `INSTALL.md` files provide host-specific, copyable instructions that can be fetched by an agent or read directly by a user who wants the full steps.

## Alternatives Considered

1. README only with copyable configs. Rejected because it gives no agent-directed install path.
2. README only with raw `INSTALL.md` instructions. Rejected because humans still need direct copy/paste blocks.
3. Two-layer docs with raw `INSTALL.md` plus copyable config blocks. Chosen because it serves both agent and human workflows.

## Architecture

The documentation splits into three focused layers:

- `README.md` and `README.zh.md` act as the entry points.
- `.opencode/INSTALL.md` gives OpenCode a direct install guide.
- `.claude/INSTALL.md` gives Claude Code a direct install guide.
- `.codex-plugin/INSTALL.md` gives Codex a direct install guide.

Each host section in the README should contain:

- a raw fetch command that points at the corresponding `INSTALL.md`
- a manual configuration block with the exact files the host needs
- a short note that `install.sh` is only the offline fallback

The `Configuration Reference` section stays in the README as a short index that explains which host reads each file.

## File Layout

Files to update or create:

- `README.md`: add raw `INSTALL.md` instructions and copyable host config blocks.
- `README.zh.md`: mirror the English README structure and examples in Chinese.
- `.opencode/INSTALL.md`: add OpenCode-specific install instructions and the exact `opencode.json` block.
- `.claude/INSTALL.md`: add Claude Code-specific install instructions and the exact plugin / marketplace / settings blocks.
- `.codex-plugin/INSTALL.md`: add Codex-specific install instructions and the exact plugin / hook blocks.
- `test/readme-installation.test.ts`: add or update coverage for the new install guidance and configuration blocks.

## Host Guidance

### OpenCode

The README should tell OpenCode to fetch and follow:

```text
https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.opencode/INSTALL.md
```

The OpenCode manual configuration block should show the exact repo-local config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["./"]
}
```

### Claude Code

The README should tell Claude Code to fetch and follow:

```text
https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.claude/INSTALL.md
```

The Claude Code manual configuration block should show the plugin manifest, marketplace manifest, and project settings entries that already exist in the repo.

### Codex

The README should tell Codex to fetch and follow:

```text
https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.codex-plugin/INSTALL.md
```

The Codex manual configuration block should show the plugin manifest and shared hook map that already exist in the repo.

## Testing

- Add a localization test that checks the Chinese README mirrors the new install structure and configuration reference.
- Add or update tests so the packaged README includes the raw `INSTALL.md` instructions and the manual config blocks.
- Add simple file-content checks for the new `INSTALL.md` files so they stay aligned with the README.

## Risks

- The README can become repetitive if the raw-install and manual-config sections are not kept short.
- The raw `INSTALL.md` paths must stay aligned with the actual file locations in the repo.
- The README, `INSTALL.md` files, and config manifests must stay synchronized or the docs will contradict each other.

## Acceptance Criteria

- `README.md` presents raw `INSTALL.md` instructions and manual copyable config blocks for OpenCode, Claude Code, and Codex.
- `README.zh.md` mirrors the same structure in Chinese.
- `.opencode/INSTALL.md`, `.claude/INSTALL.md`, and `.codex-plugin/INSTALL.md` exist and contain host-specific install instructions.
- `install.sh` remains documented only as the offline fallback.
- Docs tests pass and guard the new guidance.
