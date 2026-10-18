# Feature Request: Synchronize Session Activity with Terminal Tab Titles

**Project:** OCode fork of OpenCode

**Area:** TUI / terminal integration

## Problem

While a session is thinking or running tools, OCode animates the activity indicator on its in-app session tab. The containing terminal application's outer tab/title does not reflect that activity, so users cannot tell from the terminal tab strip which OCode window is working.

## Desired Behavior

- Reflect the activity state of the currently selected OCode session in the outer terminal tab title, using a spinner or activity marker alongside the session title.
- When the user selects a different in-app session, update the outer title to that session and its current state.
- Stop the animation when the selected session becomes idle; restore a stable title without a stale spinner.
- Keep permission/question attention distinct from active model work so a session waiting for the user is not shown as continuously working.
- Respect OCode's animation setting and avoid overwriting unrelated terminal title state when the application exits.

## Acceptance Criteria

- Starting model work causes the outer terminal tab to show activity in sync with the selected in-app tab.
- Completing or interrupting work removes the activity marker promptly.
- Switching between idle, running, and user-attention sessions updates the outer title correctly.
- Renaming a session updates the title while preserving its activity state.
- The behavior works with supported terminal emulators and degrades gracefully when title updates are unsupported.

## Relevant Code

- In-app session activity/status: `packages/tui/src/component/session-tabs.tsx`
- Terminal title updates in mini mode: `packages/tui/src/mini/runtime.ts`
- Existing session-tab status source: `SessionTabsController.status()`

The implementation should reuse the selected session's existing status as its source of truth, rather than start a separate activity timer that can drift out of sync.

## Tests

- [ ] Outer title shows activity during an active model/tool run.
- [ ] Outer title returns to idle after completion or interruption.
- [ ] Selecting another session immediately reflects that session's title and state.
- [ ] Permission/question attention is distinguishable from active work.
- [ ] Disabled animations and unsupported terminal title controls are handled gracefully.
