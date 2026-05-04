# AGENTS.md - Development Guide for auto-resume

## Project Overview
auto-resume is a plugin for OpenCode, ClaudeCode, and Codex that provides session recovery and replay safety features.

## Branch Strategy
- **dev branch**: Development branch (hooks use tsx → src/*.ts, no dist/)
- **main branch**: Release branch (hooks use dist/*.js, compiled output committed)

## Commands

### Development (dev branch)
```bash
# Run tests
npm test

# Compile TypeScript (optional on dev)
npx tsc -p tsconfig.json

# Package runtime tarball
npm run release:runtime -- --out .release/auto-resume-runtime.tar.gz
```

### Release (main branch)
```bash
# Merge dev to main
git checkout main
git merge dev

# Bump version
npm version patch

# Tag and push
git tag v0.1.XX
git push origin main --tags
```

## Testing
Tests run with Node.js test runner + tsx:
```bash
npm test
```

## Dependencies
- **Production**: `@opencode-ai/sdk`
- **Development**: `tsx`, `typescript`, `@types/node`

## Hooks
- **dev branch**: hooks/*.js spawn tsx to run src/*.ts
- **main branch**: hooks/*.js import dist/*.js

## Key Files
- `src/opencode.ts`: OpenCode plugin entrypoint
- `src/claude-code.ts`: ClaudeCode adapter
- `src/codex.ts`: Codex adapter
- `hooks/*.js`: Hook wrappers
- `opencode.json`: OpenCode config
- `.claude-plugin/plugin.json`: ClaudeCode plugin manifest
- `.codex-plugin/plugin.json`: Codex plugin manifest

## Version Control
- Tags are used for releases (v0.1.XX)
- Users install specific versions: `github:CyberRookie-X/auto-resume#v0.1.XX`
- main branch always has compiled dist/ committed
- dev branch excludes dist/ from git

## Release Checklist
1. Complete development on dev branch
2. Test: `npm test`
3. Compile: `npx tsc -p tsconfig.json`
4. Merge to main: `git checkout main && git merge dev`
5. Bump version: `npm version patch`
6. Update opencode.json version
7. Tag: `git tag v0.1.XX`
8. Push: `git push origin main --tags && git push origin dev`