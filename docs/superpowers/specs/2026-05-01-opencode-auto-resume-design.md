# OpenCode Auto Resume Plugin Design

## Goal

Build a first-release plugin focused on `opencode` that resumes stopped sessions when `opencode` does not recover them on its own.

The first release does not replace OpenCode's built-in retry policy. It only reacts after a session has stopped or gone idle in recoverable-looking failure states.

## Scope

This release supports two recovery signals:

1. Explicit `session.error` events.
2. Post-stop message scanning after `session.idle` / terminal state transitions.

This release does not include:

- Taking over OpenCode's built-in retry engine.
- Rewriting OpenCode's internal exponential backoff.
- Active watchdog handling for long-running `busy` stalls with no terminal signal.
- Tool-output keyword matching.

## User-Facing Behavior

Users configure rules that decide when the plugin should inject a follow-up prompt such as `RESUME`.

Each rule defines:

- A scope: `root`, `child`, or `all`.
- Match conditions against normalized session errors and recent message state.
- A retry policy owned by the plugin: base delay, multiplier, max delay, max attempts.
- An action prompt, usually `RESUME`, but fully configurable.

Example first-release rule:

```json
{
  "id": "resume-on-stream-read-error",
  "scope": "all",
  "match": {
    "errorName": ["APIError", "UnknownError"],
    "messageRegex": "(upstream_error.*stream_read_error|stream_read_error|Type validation failed.*server_error)"
  },
  "action": {
    "type": "prompt",
    "text": "RESUME"
  },
  "retry": {
    "baseMs": 1000,
    "factor": 2,
    "maxMs": 8000,
    "maxAttempts": 3
  }
}
```

## Architecture

The package is split into a small core and an `opencode` host adapter.

### Core recovery engine

The core is host-agnostic and owns:

- Rule parsing and validation.
- Error normalization.
- Message-scan normalization.
- Per-session retry state.
- Backoff scheduling.
- De-duplication so the same failure fingerprint does not trigger repeated prompt injection loops.

The core should not know about OpenCode SDK types directly. It should receive normalized host events and emit recovery decisions.

### OpenCode adapter

The adapter owns:

- Subscribing to OpenCode event streams.
- Loading session and message data from the SDK when needed.
- Determining whether a session is root or child from `parentID`.
- Converting OpenCode events into the core's normalized inputs.
- Injecting recovery prompts through `client.session.prompt()`.

## Event Handling Model

### 1. `session.error`

When the adapter receives `session.error`, it normalizes:

- `sessionID`
- error name
- error message text
- raw serialized payload for regex matching

The core evaluates error-driven rules immediately. If a rule matches and the session is within the configured scope and retry budget, the core schedules a recovery action.

### 2. `session.idle` / terminal follow-up scan

Some failures stop the run without a sufficiently useful `session.error`, or they stop after leaving only partial assistant state.

When the adapter sees a terminal transition, it loads recent session messages and computes scan facts such as:

- latest assistant contains reasoning but no text output
- latest assistant has an error
- latest tool parts ended in `Tool execution aborted`
- latest assistant finished with suspicious partial state such as `finish: "length"`

The core evaluates scan-driven rules against those facts.

## Failure Categories To Cover First

The first-release defaults should target these known stop-causing classes:

1. Wrapped stream/protocol/provider failures:
   - `upstream_error: stream_read_error`
   - `Type validation failed`
   - `invalid_union`
   - wrapped server/rate-limit error payloads surfaced as `UnknownError`

2. Tool-call parsing/truncation failures that stop the turn:
   - `Invalid input for tool ...: JSON parsing failed`
   - `Invalid diff: now finding less tool calls`
   - `Tool execution aborted`

3. Interrupted reasoning-only terminal states:
   - last assistant message has reasoning but no output-producing parts
   - abort-like messages that stop the session unexpectedly

## Scope Rules

Scope is evaluated from session metadata:

- `root`: only sessions without `parentID`
- `child`: only sessions with `parentID`
- `all`: both

This lets users restrict rules for failures where automatically injecting `RESUME` into child sessions would be harmful.

## Recovery Safety

The plugin must avoid runaway loops.

Per session and per rule, it tracks:

- attempt count
- last failure fingerprint
- whether a recovery prompt is already scheduled or in flight
- last recovery timestamp

Fingerprinting uses the normalized failure category plus selected message-state markers so repeated identical stop states do not trigger duplicate prompt injection.

## Prompt Injection

Recovery uses `client.session.prompt()` with a synthetic user message.

The adapter should preserve the most recent user-facing session context when practical, especially:

- session ID
- current agent if available from the last user message
- current model if available from the last user message

The injected prompt text is fully configurable. `RESUME` is only the default example.

## Package Structure

The initial package layout should be:

```text
package.json
tsconfig.json
src/index.ts
src/config.ts
src/core.ts
src/types.ts
src/opencode.ts
test/core.test.ts
test/opencode.test.ts
README.md
```

## Testing Strategy

The first release is test-driven.

Core tests should cover:

- error rule matching
- message-scan rule matching
- scope filtering for root vs child sessions
- backoff and max-attempt enforcement
- de-duplication across repeated identical failures

Adapter tests should cover:

- reacting to `session.error`
- reacting to terminal state scans
- injecting the configured recovery prompt once
- not injecting when scope or retry budget blocks it

## Open Questions Deferred From First Release

The following are intentionally deferred to later releases:

- taking over built-in OpenCode retry via `delegate_to_plugin`
- configurable keyword matching inside tool outputs
- active watchdogs for `busy` sessions that silently stall with no terminal signal
- automated repair flows more advanced than prompt injection
