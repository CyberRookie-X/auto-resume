# Unified Recovery Design for OpenCode, Claude Code, and Codex

## Goal

Build one recovery system that can resume interrupted agent sessions across three hosts:

1. OpenCode, using the existing in-process adapter.
2. Claude Code, using hook-driven scripts and the Claude resume surface.
3. Codex, using hook-driven scripts plus `codex resume` / `codex exec resume`.

The shared policy is the same everywhere:

- replay pure read-only turns automatically when recovery is safe
- fall back to `RESUME` when the turn may have written, deleted, moved, or shelled out
- stop looping on repeated identical failures

## Scope

This release includes:

- a host-agnostic recovery core
- read-only replay safety classification
- retry budgeting and de-duplication
- OpenCode as the reference in-process adapter
- Claude Code plugin hooks and local helper scripts
- Codex plugin hooks, local helper scripts, and exec/resume support

This release does not include:

- rollback or transactional snapshots for writes
- cross-process persistence of recovery state beyond the host session
- automatic repair beyond replay or `RESUME`
- support for unknown host APIs without an adapter

## Recommended Approach

### Option 1: Shared core + host adapters + host-specific packaging

Keep one pure TypeScript recovery core and add thin adapters for each host. Ship host-specific hook scripts and manifests, but make all policy decisions in one place.

This is the recommended approach.

### Option 2: Separate packages per host

Split OpenCode, Claude Code, and Codex into separate packages that share copied logic or a small utility library.

- Pros: packaging matches each host cleanly.
- Cons: duplicated policy logic and harder parity.

### Option 3: Generic hook runner only

Build one generic hook runner and hand-wire each host to it.

- Pros: smallest packaging surface.
- Cons: weaker host-specific ergonomics and less explicit delivery.

## Architecture

### Shared recovery core

The core owns the host-neutral policy:

- rule parsing and validation
- scope filtering (`root`, `child`, `all`)
- failure fingerprinting
- backoff and retry budgets
- replay safety decisions
- recovery action selection

The core never talks to a host SDK directly. It only accepts normalized inputs and emits normalized decisions.

### Host adapters

Each host adapter owns the host-specific details:

- reading session state and transcripts
- classifying the latest turn
- translating host event payloads into normalized inputs
- executing the selected recovery action
- preventing duplicate recovery loops

### Execution model

Each host uses the same decision flow:

1. Observe a failure or stop event.
2. Load the latest turn and transcript state.
3. Classify the turn as replay-safe or unsafe.
4. Ask the core for a recovery decision.
5. Either replay the original user request or inject `RESUME`.

## Host Behavior

### OpenCode

OpenCode keeps the current in-process adapter.

- `session.error` and terminal scans feed the core.
- replay-safe turns use `client.session.prompt()` with the original request
- unsafe turns use the configured `RESUME` prompt

### Claude Code

Claude Code is implemented as a plugin hook plus helper scripts.

- hooks read `session_id`, `transcript_path`, `hook_event_name`, and the turn context
- the helper script inspects the transcript to find the latest user request and assistant/tool state
- replay-safe turns invoke the Claude resume surface with the original prompt
- unsafe turns invoke the Claude resume surface with `RESUME`

`StopFailure` cannot alter the current hook result, so Claude recovery must happen through the helper process or a resumed invocation, not by trying to mutate the failed turn in place.

### Codex

Codex is implemented as a plugin hook plus helper scripts, and also supports `codex exec` automation.

- hook payloads or JSONL event streams feed the core
- interactive `Stop` recovery uses the original prompt when replay is safe
- unsafe turns use `RESUME` as the continuation prompt
- non-interactive `codex exec` flows can resume from `turn.failed` / `error` events through the same policy

Codex is the most direct host for continuation because `Stop` can produce a follow-up prompt, but the same replay gate still applies.

## Replay Safety Rules

A turn is replay-safe only if the adapter can prove that the latest assistant/tool chain is read-only.

Safe inputs include:

- read-only file inspection
- search/list style tools
- other host tools explicitly marked read-only

Unsafe inputs include:

- write
- delete
- move or rename
- shell execution
- unknown or unclassified tools

If the adapter cannot prove safety, it must assume the turn is unsafe.

## Recovery State

The core tracks, per session and per rule:

- attempt count
- last scheduled fingerprint
- last executed timestamp
- whether a recovery is already pending

Repeated identical failures must not trigger duplicate recovery loops.

## Packaging

The repo will ship as a single workspace with multiple surfaces:

- shared library code in `src/`
- OpenCode adapter in the current package
- Claude Code plugin assets under `.claude/`
- Codex plugin assets under `.codex-plugin/`
- helper scripts under `scripts/` or `bin/`
- host-specific examples and install notes in `README.md`

## Testing Strategy

Core tests cover:

- rule matching
- scope filtering
- fingerprint de-duplication
- retry budgets and backoff
- replay-safe vs unsafe classification

Host tests cover:

- OpenCode error and scan handling
- Claude Code transcript parsing and resume invocation
- Codex hook handling and continuation behavior
- fallback to `RESUME` for unsafe or unknown turns

Host-facing tests and any CLI-based verification should run in Docker so local Claude/Codex/OpenCode state is not disturbed.

## Non-Goals

- automatic rollback of writes
- speculative repair beyond replay or `RESUME`
- persistence that survives process restarts
- one-off host-specific policy forks
