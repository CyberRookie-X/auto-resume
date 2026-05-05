# OpenCode Message Cleanup Recovery Design

## Goal

Make OpenCode recovery clean up the failed message before retrying, so repeated failures do not leave duplicate user prompts or stale assistant turns in the session history.

The adapter should distinguish three recovery cases:

1. If `session.error` fires after a user prompt and there is no assistant message in the latest turn, delete the failed user message and reissue the original prompt.
2. If `session.error` or `session.idle` fires after an assistant turn and the turn is replay-safe, delete the latest assistant message and continue with `RESUME`.
3. If the assistant turn is unsafe, keep the existing history intact and continue with `RESUME`.

This design only changes how recovery rewinds the visible session history before retrying. It does not change the core retry engine or the trigger rules.

## Policy Summary

1. Failed user prompts should not accumulate when the host reports an error before any assistant reply appears.
2. Replay-safe assistant failures should remove the failed assistant turn before resuming.
3. Unsafe assistant failures should not be replayed automatically and should not be deleted automatically.
4. User-initiated aborts remain terminal and must still be ignored by recovery.

## Recommended Approach

### Option 1: Delete the failed message before retrying

This is the recommended approach.

- `session.error` with no assistant reply: delete the last user message, then replay the original prompt.
- `session.error` or `session.idle` with a replay-safe assistant turn: delete the last assistant message, then send `RESUME`.
- unsafe turns: send `RESUME` without deleting anything.

This keeps the session transcript aligned with the recovery action and prevents duplicate visible messages from piling up.

### Option 2: Keep appending retries without deletion

This is the current behavior.

- Pros: simpler, no extra API calls.
- Cons: duplicate user prompts or stale assistant turns remain in history, especially if the same failure repeats.

### Option 3: Replace history with a synthetic recovery turn

This would rewrite the transcript into a cleaner recovery-only state.

- Pros: strongest cleanup.
- Cons: too invasive, and it changes more of the session history than needed.

## Architecture

The existing core/adapter split stays intact.

### Core recovery engine

The shared engine keeps making scheduling decisions:

- whether a failure matches a rule
- whether a recovery is already pending
- whether retry attempts are exhausted
- whether to schedule replay or `RESUME`

It does not need to know about message deletion.

### OpenCode adapter

The adapter owns host-specific cleanup:

- loading session messages
- finding the latest user or assistant message
- deleting the specific failed message with `deleteMessage`
- replaying the original prompt after deleting a failed user message
- sending `RESUME` after deleting a replay-safe assistant message
- leaving unsafe turns untouched

## Recovery Flow

### 1. Failure detection

The adapter still reacts to the existing `session.error` and `session.idle` triggers.

### 2. Message selection

- For `session.error`, if the latest turn has no assistant message, the last user message is the retry target.
- For `session.error` or `session.idle` with an assistant turn, the last assistant message is the cleanup target when the turn is replay-safe.
- If the assistant turn is unsafe, no message is deleted.

### 3. Cleanup execution

The adapter deletes the chosen message by ID before it dispatches the retry.

If deletion fails, the adapter should still avoid getting stuck and continue with the existing recovery flow.

### 4. Retry execution

- Deleted user message: reissue the original prompt.
- Deleted safe assistant message: send `RESUME`.
- Unsafe assistant message: send `RESUME` without deletion.

## Why Not Leave the Old Message In Place

Leaving the original failed user message or assistant turn in the transcript makes repeated retries look like new independent turns.

- A repeated user failure can produce duplicate visible prompts.
- A replay-safe assistant retry can leave a stale assistant turn that no longer reflects the current recovery action.

The host already provides message deletion, so cleanup is a better fit than transcript accumulation.

## Non-Goals

- Rewriting the full session transcript
- Rolling back side effects from failed tool execution
- Changing the retry engine’s attempt counting or backoff
- Treating unsafe turns as replay-safe
- Changing user-abort handling

## Testing Strategy

Adapter tests should cover:

- `session.error` with no assistant reply deletes the last user message before replay
- `session.error` with a replay-safe assistant turn deletes the assistant message before `RESUME`
- `session.error` with an unsafe assistant turn does not delete any message and still sends `RESUME`
- `session.idle` follows the same cleanup behavior for assistant turns
- `MessageAbortedError` still short-circuits recovery

SDK-level expectations:

- `deleteMessage` is available on the OpenCode session API
- message IDs are read from the session message records before deletion

## Scope Boundary

This design only changes cleanup before recovery dispatch.

It does not change rule matching, backoff, retry budgets, or user-abort detection.
