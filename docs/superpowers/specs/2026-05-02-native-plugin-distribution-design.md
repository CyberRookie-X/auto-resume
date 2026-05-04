# Native Plugin Distribution Design

## Goal

Make `auto-resume` installable through each host's native plugin mechanism instead of making users run `install.sh` first.

## Why

- The current shell installer works, but it is not the primary way these hosts expect extensions to be installed.
- OpenCode already supports config-driven plugin install.
- Claude Code and Codex both have native marketplace/plugin systems that can carry the same repo without a custom bootstrap script.
- We should keep one repo as the source of truth and teach each host how to discover it natively.

## Recommended Approach

Use one repository with three host-specific surfaces:

1. OpenCode loads the package directly from GitHub using the repo's published entrypoint.
2. Claude Code reads a repo marketplace plus a Claude plugin manifest.
3. Codex reads the same repo plugin package and marketplace metadata, then installs/enables it through its own plugin flow.

This keeps the shared recovery logic unchanged and removes the shell installer from the primary docs path.

## Alternatives Considered

1. Keep `install.sh` as the main install path and only improve the README. Rejected because it still makes the script the center of the workflow.
2. Split into separate host-specific repos. Rejected because it duplicates the shared recovery code and makes releases harder to keep aligned.
3. Single repo with native host manifests and marketplace metadata. Chosen because it matches each host's own install model and keeps the codebase unified.

## Architecture

The shared runtime stays where it is: `src/core.ts`, `src/replay.ts`, `src/types.ts`, and the existing host adapters continue to own the recovery rules and replay safety logic.

The install surface changes are mostly metadata and thin entrypoints:

- OpenCode: `src/opencode.ts` remains the OpenCode adapter entrypoint. The GitHub install path should resolve the package entrypoint directly from the repository, so `package.json` must keep the runtime entrypoint aligned with the checked-in source.
- Claude Code: add `.claude-plugin/plugin.json` and a Claude marketplace file at `.claude-plugin/marketplace.json`. The Claude hook config should live in `hooks/hooks.json` so the plugin can be installed from a marketplace rather than copied by hand. `.claude/settings.json` only handles project-level marketplace registration and plugin enablement; it does not carry the hook implementation.
- Codex: keep `.codex-plugin/plugin.json` as the Codex manifest and reuse the same `hooks/hooks.json`. Codex can read the Claude-style marketplace file, so the repo does not need a separate custom installer.

`install.sh` remains only as an offline/manual fallback. It should no longer be the first install method shown in the docs.

## Repository Layout

Files that will change:

- `package.json`: add package entrypoint metadata for OpenCode resolution.
- OpenCode install docs: point at the repository's native GitHub plugin source instead of a custom bootstrap path.
- `src/opencode.ts`: add the OpenCode plugin-module default export while preserving the existing recovery adapter exports.
- `.claude-plugin/plugin.json`: new Claude plugin manifest.
- `.claude-plugin/marketplace.json`: new shared marketplace metadata for Claude Code and Codex.
- `hooks/hooks.json`: keep the shared hook definition here so Claude and Codex load the same behavior.
- `.claude/settings.json`: keep project-level Claude enablement/bootstrap, not the actual hook implementation.
- `.codex-plugin/plugin.json`: keep the Codex manifest and align it with the shared package metadata.
- `README.md`: document native install paths first.
- `README.zh.md`: mirror the same install guidance in Chinese.
- `test/opencode-plugin.test.ts`: verify the module still exposes the recovery adapter and the plugin-module entrypoint.
- `test/claude-code.test.ts`: verify the Claude plugin manifest and marketplace metadata are valid and point at the repo source.
- `test/codex.test.ts`: verify Codex still sees the plugin manifest and the shared marketplace metadata.

## Host-Specific Behavior

### OpenCode

OpenCode should be installable from GitHub without running a shell script. The config will reference the repository as the plugin source, and the package entrypoint will resolve from the checked-in source.

Example shape: the OpenCode config points its `plugin` entry at the repository's GitHub URL.

### Claude Code

Claude Code should install from the repo marketplace and enable the plugin through project settings. The plugin manifest lives at `.claude-plugin/plugin.json`, while the hook implementation lives at `hooks/hooks.json`.

Example shape: `.claude/settings.json` registers the repository git URL as a known marketplace and enables `auto-resume@auto-resume`.

### Codex

Codex should discover the same repo package through the shared marketplace metadata and install it through its own plugin flow. The Codex manifest stays at `.codex-plugin/plugin.json`, and Codex can read the Claude-style marketplace file directly.

Codex does not get a custom bootstrap script. The repo marketplace is the install path.

## Documentation

`README.md` and `README.zh.md` should present the native plugin install paths first, in this order:

1. OpenCode GitHub plugin config
2. Claude Code plugin/marketplace settings
3. Codex marketplace/plugin flow
4. `install.sh` as an offline/manual fallback only

Both READMEs should make it explicit that `install.sh` is no longer the primary path.

## Testing

- Keep the release tarball test as a regression guard for runtime packaging.
- Add tests that the new plugin manifest and marketplace files are valid and point at the repo source.
- Add or update an OpenCode entrypoint test so the package still loads as a plugin module.
- Update README assertions so the primary install text mentions the native plugin paths, not the shell installer.

## Risks

- OpenCode's package entrypoint must match its plugin loader expectations. If the default export shape is wrong, config-based install will succeed but loading will fail.
- Claude Code and Codex trust policies can still block marketplace installation in managed environments.
- Codex and Claude do not expose identical config keys, so the docs must explain each host separately instead of pretending there is one universal config file.

## Acceptance Criteria

- Users can install or enable the plugin without running `install.sh` first.
- OpenCode can install through the GitHub plugin path without a shell script.
- Claude Code can install the plugin through the repo marketplace and project settings.
- Codex can discover and install the plugin through native marketplace/plugin flow.
- `README.md` and `README.zh.md` both show the native install path first and the shell script only as fallback.
- Existing release/runtime packaging and recovery tests still pass.
