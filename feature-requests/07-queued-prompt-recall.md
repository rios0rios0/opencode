# Feature Request: Recall Undelivered Queued Prompts with the Up Arrow

**Project:** OCode fork of OpenCode

**Area:** TUI prompt composer / session inbox

## Problem

When the model is busy, a submitted prompt may still be pending in the session inbox and may not yet have reached the model. Pressing Up currently recalls prompt history. Users must instead open the queued-prompt controls to undo and recover a prompt that has not been delivered.

## Desired Behavior

- When the composer is empty and the user presses Up, check whether the current session has an undelivered prompt pending.
- If so, cancel/remove the most recently submitted pending prompt and restore it to the composer for editing, matching the queued-prompt undo behavior.
- Restore the full prompt payload—not only visible text—including file attachments, agent/skill mentions, and pasted-text metadata where available.
- If no undelivered prompt is pending, preserve the existing Up-arrow prompt-history behavior.
- Never cancel or pull back a prompt that has already been delivered to the model.
- Preserve normal Up-arrow cursor movement inside a non-empty or multiline draft.
- If multiple prompts are pending, recall them newest-first on repeated Up presses.

Pending-versus-delivered state must come from the session inbox, not from prompt-history entries. If delivery races with cancellation, do not silently lose or duplicate prompt content.

## Relevant OCode Areas

- Up-arrow/history handling: `packages/tui/src/component/prompt/index.tsx`
- Prompt history storage/navigation: `packages/tui/src/prompt/history.tsx`
- Pending inbox state, cancellation, and existing undo path: `packages/tui/src/routes/session/index.tsx`

Reuse the existing inbox cancellation and composer restoration paths where practical.

## Acceptance Criteria

- Up in an empty composer cancels and restores the latest undelivered prompt.
- The full prompt payload and mentions are retained.
- With no pending prompt, Up recalls history as it does today.
- A delivered prompt remains untouched and is accessible through normal history behavior.
- Repeated Up recalls multiple pending prompts newest-first.
- Up still navigates within an active multiline draft.
- Cancellation failure or a delivery/cancel race cannot silently lose or duplicate a prompt.

## Tests

- [ ] Restore one pending prompt and verify it is removed from the pending queue.
- [ ] Verify files, mentions, pasted content, and prompt text are restored.
- [ ] Verify history fallback and delivered-message behavior.
- [ ] Verify newest-first behavior for multiple queued prompts.
- [ ] Verify multiline cursor movement and cancellation/delivery failure handling.
