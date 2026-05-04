# Assistant-Turn-Aware Recovery Design

## Goal

Stop auto-resume from replaying an old user prompt when the failed recovery target is no longer the first assistant turn for that prompt.

The new policy is conservative:

1. Replay the original user request only when the adapter can prove the latest assistant turn is read-only.
2. Earlier assistant messages in the same user flow do not participate in the safety decision.
3. If the adapter cannot reliably identify the latest assistant turn, treat recovery as ambiguous and fall back to `RESUME`.

## Why

The current replay logic is user-message-oriented. It looks for the latest replay-safe assistant/tool state and then replays the latest user message. The safety decision should be based on the latest assistant turn only, not on earlier assistant messages from the same user flow.

In real sessions, a single user prompt can produce multiple assistant messages over time. If a later assistant message fails with `stream_read_error`, replaying the original user prompt can effectively rewind the session back to the beginning of the task. That is worse than sending `RESUME`.

## Recommended Approach

### Option 1: Latest-assistant replay with conservative fallback

This is the recommended option.

- Identify the latest assistant turn first.
- Replay only if that latest assistant turn is read-only.
- Otherwise send `RESUME`.

### Option 2: Keep replay keyed to the latest user message

- Pros: highest automatic replay coverage.
- Cons: can replay the wrong request after a long-running task and duplicate earlier assistant work.

### Option 3: Disable automatic replay entirely

- Pros: safest semantics.
- Cons: loses the read-only replay optimization that still works well for simple interrupted turns.

## Host-Specific Rules

### OpenCode

- Use the latest assistant message as the recovery anchor.
- Replay only when that assistant message is read-only.
- Earlier assistant messages in the transcript are ignored for safety classification.

### Claude Code

- Keep using transcript-based turn reconstruction.
- Treat the latest user plus the latest assistant message as the active request window.
- Replay only when that latest assistant message is read-only.
- Earlier assistant messages in the same user flow do not affect the decision.

### Codex

- Keep using transcript-based turn reconstruction.
- Replay only when the latest assistant message is read-only.
- Earlier assistant messages in the same user flow do not affect the decision.

## Non-Goals

- True assistant-message rollback with automatic invisible continuation.
- Reverting a failed assistant message and resuming generation without a new prompt.
- Automatic replay of ambiguous multi-assistant chains.

Those behaviors need host capabilities that are not available uniformly across OpenCode, Claude Code, and Codex.

## Testing Strategy

Add regression tests for all three hosts:

1. A single read-only assistant turn still replays the original user request.
2. A read-only chain with multiple assistant messages for the same user falls back to `RESUME`.
3. Existing unsafe write/shell recovery still falls back to `RESUME`.
