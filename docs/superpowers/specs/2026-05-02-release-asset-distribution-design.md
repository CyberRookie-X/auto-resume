# Release Asset Distribution Design

## Goal

Keep the repository source-of-truth in TypeScript, but distribute installable JavaScript assets through GitHub Releases.

## Why

- Users should not need an npm account.
- Hook entrypoints must run as plain JS.
- Source and release artifacts should stay separate so development stays ergonomic and installs stay reliable.

## Model

- Source tree: TypeScript, tests, docs, and packaging metadata.
- Release source archive: GitHub's built-in tag archive for auditing and source inspection.
- Release runtime archive: generated tarball containing compiled JS and install-ready runtime files.

## Runtime Package

The runtime archive must contain only what an installer needs:

- compiled JS entrypoints for Claude Code and Codex hooks
- compiled shared runtime code
- hook config files that point at the compiled JS
- any README or install notes needed for local install

It must not depend on `tsx`, TypeScript, or a local build step at install time.

## Source Package

The source archive remains the canonical development input:

- `.ts` source files
- tests
- docs/specs/plans
- release scripts and CI config

The source archive is for review, debugging, and local development only.

## Install Flow

1. User downloads the runtime archive from the GitHub Release.
2. User unpacks it into the plugin directory or installer target.
3. Hook configs in the runtime package point directly at compiled JS.
4. No npm publish, npm login, or local TypeScript compilation is required.

## Build Flow

1. CI runs `npm test` and `npm run build` on the tagged commit.
2. CI packages the built runtime files into a release tarball.
3. CI publishes the tarball as the runtime asset for the GitHub Release.

## Compatibility Rules

- Source files stay TypeScript.
- Runtime files stay JavaScript.
- Hook commands must reference only release-package paths.
- The runtime package must be usable without the source tree present.

## Risks

- If the runtime package leaks a source-only path, installs will fail.
- If the package depends on a dev-only tool, release installs will be brittle.
- If CI packaging and local build output diverge, release assets will not match tests.

## Acceptance Criteria

- The repo remains TS-first.
- The GitHub Release includes a source archive and a runtime archive.
- The runtime archive runs hook entrypoints directly with plain `node`.
- No npm account is needed for installation.
- The installed runtime package does not require `tsx` or a build step.
