# Feature Request: Make Links in Assistant Responses Clickable

**Project:** OCode fork of OpenCode

**Area:** TUI / assistant message rendering

## Problem

Models often return pull-request, documentation, and website links. Users currently have to select and copy URLs manually before opening them, which interrupts the workflow and makes long or wrapped URLs cumbersome to handle.

## Desired Behavior

- Make Markdown links and bare HTTP(S) URLs in assistant responses openable by an explicit mouse click.
- Open links in the user's default browser only after the click; never launch a URL automatically during streaming.
- Preserve link text selection and copying, including for links that wrap across terminal rows.
- Allow incomplete streamed URLs to become clickable only once a valid link has rendered.
- Keep non-HTTP(S) destinations inert unless a separately reviewed safe behavior is explicitly supported.

## Relevant OCode Areas

- Assistant Markdown rendering: `packages/tui/src/routes/session/message-parts.tsx`
- Existing terminal link component/selection handling: `packages/tui/src/ui/link.tsx`
- App-level terminal click dispatch: `packages/tui/src/app.tsx`
- URL validation/opening: `packages/util/src/open.ts`

Prefer completing the existing end-to-end terminal hyperlink path rather than introducing a second unrelated URL-opening mechanism.

## Acceptance Criteria

- Clicking a Markdown pull-request link opens the exact URL.
- Clicking a bare HTTP(S) URL also opens the correct destination.
- Clicking any visible row of a wrapped link opens its complete URL.
- Text selection/copy does not accidentally open a link.
- Streaming partial links and unsupported schemes are not opened.

## Tests

- [ ] Click Markdown and plain-text HTTP(S) links.
- [ ] Verify wrapped links retain the complete target.
- [ ] Verify selection/copy gestures do not activate links.
- [ ] Verify partial streamed URLs and unsupported schemes remain inert.
