# OpenCode Read-Only Replay Safety Design

## Goal

Add a safer recovery mode for interrupted OpenCode turns: automatically replay only pure read-only turns after transport-like failures such as `upstream_error: stream_read_error`.

If a turn may have changed state, or if the adapter cannot prove the turn is read-only, do not replay it automatically. Fall back to the existing `RESUME` prompt flow instead.

This is a follow-up to the existing auto-resume design. It narrows automatic retry; it does not broaden recovery into writes, shell commands, or snapshot-based rollback.

## Policy Summary

1. Read-only turns may be replayed automatically.
2. Turns that include writes, deletes, shell execution, or any unknown tool are not replayed automatically.
3. Ambiguous turns are treated as unsafe.
4. `RESUME` remains the fallback for unsafe or ambiguous turns.

This is safe because read-only requests are effectively idempotent, while mutating turns may already have partially applied side effects before the stream broke.

## Recommended Approach

### Option 1: Conservative replay gate with `RESUME` fallback

The adapter classifies the interrupted turn as `replay-safe` or `unsafe`.

- `replay-safe`: automatically reissue the original request.
- `unsafe`: stop automatic replay and inject `RESUME`.

This is the recommended option.

### Option 2: Always use `RESUME`

This is the current behavior.

- Pros: simplest and safest.
- Cons: users must manually continue even when the interrupted turn was purely read-only.

### Option 3: Snapshot or idempotency for every tool

This would try to make writes and shell commands safely replayable.

- Pros: broader automatic recovery.
- Cons: too heavy for first release, and not practical for shell execution or other external side effects.

## Architecture

The existing core/adapter split stays intact.

### Core recovery engine

The core keeps the trigger logic and retry bookkeeping.

It decides:

- whether a failure matches a recovery rule
- whether a recovery is already pending
- whether the retry budget is exhausted
- whether a replay-safe or resume-only recovery should be scheduled

### OpenCode adapter

The adapter keeps host-specific work:

- loading session and message data
- reading the latest assistant/tool state
- classifying the interrupted turn
- resubmitting the original request when the turn is safe
- injecting `RESUME` for unsafe turns

## Replay Safety Rules

A turn is replay-safe only when the adapter can prove that no mutating tool was involved.

Replay-safe inputs include:

- read-only file inspection
- search/list style tools
- other host tools explicitly marked read-only

Unsafe inputs include:

- file writes
- deletes
- renames/moves
- shell execution
- any unknown or unclassified tool

If the adapter cannot confidently classify a tool, it must assume the tool is unsafe.

## Recovery Flow

### 1. Failure detection

The existing trigger path remains the same. The adapter still reacts to `session.error` and terminal-state scans such as `session.idle`.

### 2. Safety classification

Before scheduling a recovery, the adapter examines the most recent turn and marks it safe only if the tool chain is fully read-only.

- If the turn is replay-safe, the adapter schedules a replay of the same request.
- If the turn is unsafe, the adapter schedules `RESUME` instead.

### 3. Replay execution

For replay-safe turns, the adapter reissues the original request after the configured delay.

If the replay fails again, the adapter does not keep replaying forever. It falls back to the normal recovery path and stops automatic replay for that fingerprint.

### 4. Unsafe recovery

For unsafe turns, the adapter injects `RESUME` so the model can continue from the surviving session state, but it does not attempt to repeat the original request automatically.

## Why Not Replay Writes

The main risk is that a stream error does not tell us whether the tool already completed.

- A read-only tool can be repeated with little risk.
- A write tool may already have modified files before the connection died.
- A shell command may have mutated the working tree, installed packages, or touched external state.

Without a real rollback system, replaying those turns can duplicate or corrupt work. That is exactly the case this design avoids.

## Non-Goals

- Tool-level rollback or transactional snapshots
- Automatic replay of shell execution
- Automatic replay of write/delete/move operations
- Cross-process persistence of replay state
- Making every OpenCode tool safe by default

## Testing Strategy

Core tests should cover:

- replay-safe vs unsafe classification
- replay allowed for read-only turns
- `RESUME` fallback for write or unknown tools
- no replay after the retry budget is spent

Adapter tests should cover:

- `session.error` on a read-only turn replays the original request
- `session.error` on a write or shell turn injects `RESUME`
- `session.idle` scans still use the same safety gate
- `session.deleted` cancels pending replay or resume work

## Scope Boundary

This design only changes what happens after a recovery trigger fires.

It does not change how triggers are detected, and it does not try to recover writes safely.
