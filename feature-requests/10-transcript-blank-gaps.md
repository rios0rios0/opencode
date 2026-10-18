# Feature Request: Remove the Blank Gaps Between Low-Verbosity Activity Summaries

**Project:** OCode fork of OpenCode — the same defect is present in the official OpenCode V2 build and is upstreamable.

**Area:** TUI transcript (low verbosity)

## Problem

In low verbosity, a single multi-step assistant turn can render as several `+ N commands, N thoughts` summary rows separated by stacks of blank lines. The turn looks broken: activity that belongs to one run is split into fragments with two to five empty rows between them, and the transcript is taller than its content.

Reproduced on 2026-10-17 in the official OpenCode V2 TUI against the official free provider `opencode/deepseek-v4.1-flash-free` and bisected to the session data: the model emits assistant text parts whose entire content is a single zero-width space (`U+200B`) between reasoning and tool steps. Two independent checks confirm the cause:

1. `.trim()` does not remove `U+200B`—it is Unicode category `Cf` (Format), not `White_Space`—so the emptiness guards that protect the transcript treat the part as visible content.
2. A text part never joins the low-verbosity activity group, so each invisible-only part terminates the current run and starts a new `+ …` summary while its own row renders as blank lines.

The row-level mechanics:

- `reduceSessionRows` in `packages/tui/src/routes/session/rows.ts` keeps the row because `!part.text.trim()` is false for `"\u200b"`.
- The live path in the same file (`session.text.delta`, `session.text.ended`, `session.reasoning.delta`, `session.reasoning.ended`) uses `delta.trim()`/`text.trim()` for the same decision.
- `TextPart` in `packages/tui/src/routes/session/message-parts.tsx` renders through `<markdown>` when `props.part.text.trim()` is truthy; a markdown block with invisible-only content still occupies vertical space.
- `reasoningContent()` drops only `[REDACTED]`, so invisible-only reasoning is counted as a thought by `activitySummary` in `packages/tui/src/routes/session/activity-summary.ts` while rendering nothing.

Reproduction in the TUI test renderer (low verbosity fixture, `packages/tui/test/session-activity-anchor.test.tsx` harness): steps shaped `text, reasoning, shell, "\u200b"` render separate `+ 1 command, 1 thought` rows with a stack of blank rows between them; replacing the invisible-only parts with nothing renders one merged summary with single-row spacing.

## Desired Behavior

- Text and reasoning parts with no visible characters never create transcript rows, never break a low-verbosity activity group, and never count as thoughts.
- The emptiness decision is shared: text has visible content when it contains a character outside Unicode whitespace and format categories—for example `/[^\s\p{Cf}]/u.test(text)`. The same predicate is used by hydration (`reduceSessionRows`), the live stream handlers, `TextPart`, `ReasoningPart`, and `reasoningContent()`.
- Only the emptiness decision changes. Never strip invisible characters from content that also has visible text, and never alter the stored message parts—display and grouping only.
- Hydration and streaming produce identical rows for the same history.

## Relevant Code

- `packages/tui/src/routes/session/rows.ts` — `reduceSessionRows` and the live `session.text.*` / `session.reasoning.*` handlers.
- `packages/tui/src/routes/session/message-parts.tsx` — `TextPart`, `ReasoningPart`, `reasoningContent`.
- `packages/tui/src/routes/session/activity-summary.ts` — thought counting in `activitySummary` / `summarizeActivity`.
- `packages/tui/src/routes/session/grouping/session.ts` — `partPath` documents why a text part ends the activity run.
- Existing coverage to extend: `packages/tui/test/cli/tui/session-verbosity.test.ts` and `packages/tui/test/session-activity-anchor.test.tsx`.

## Acceptance Criteria

- A fixture shaped like the report—`[text, reasoning, tool, "\u200b"]` steps followed by more tools—renders one `+ …` summary with no blank rows beyond the normal row margin.
- `U+200B`-only, `U+FEFF`-only, `U+200D`-only, and whitespace-plus-invisible reasoning parts are neither rendered nor counted; `[REDACTED]` handling is unchanged.
- Text that mixes invisible characters with visible content still renders it fully, and emoji ZWJ sequences (for example 👩🏽💻) are never treated as empty.
- Scrolling, mount-budget row weights, and group anchors are unaffected; older sessions render correctly after the change.
- No provider change is required: the transcript stays robust regardless of which model emits the invisible-only parts.

## Tests

- [ ] Unit: `reduceSessionRows` drops parts whose text has no visible characters (`\u200b`, `\u200b\u200b`, `\ufeff`, `\u200d`, mixtures with spaces and newlines) and keeps text that has visible content.
- [ ] Unit: invisible-only reasoning is not a "thought" in `activitySummary` and `summarizeActivity`; visible reasoning is unchanged.
- [ ] Render: replay the reporter's shape in a low-verbosity fixture and assert the summaries merge with single-row spacing.
- [ ] Live: `session.text.delta` with `"\u200b"` alone creates no row; a delta with visible content does.
- [ ] Negative control: emoji ZWJ sequences and paragraphs containing `\u200b` beside visible text still render, so the predicate does not over-filter.
