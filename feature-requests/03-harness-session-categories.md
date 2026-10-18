# Feature Request: Group Resumable Sessions by Harness and Current Directory

**Project:** OCode fork of OpenCode

**Area:** Resume/session browser / cross-harness interoperability

## Problem

The resume flow should help users find relevant history from the directory they currently opened, including sessions created by different coding-agent harnesses. A flat list of OCode sessions does not make it easy to find prior Claude Code or Codex sessions for the current project.

## Desired Behavior

- In the resume/session browser, group discovered sessions by source harness, such as OCode/OpenCode, Claude Code, and Codex.
- Default the listing to sessions associated with the current opened directory/project.
- Provide a clear way to broaden the search to other directories or all discovered sessions.
- Show enough source and project information to distinguish harness, working directory, title, and last activity.
- Let users inspect compatible external session history without implying that OCode can resume execution in a different harness.
- Offer import or continue-in-OCode only when a supported conversion path exists and the user explicitly chooses it; otherwise expose the external session as read-only history.

## Directory Matching

Associate sessions with the current project using normalized/canonical directory identity and source-specific metadata where available. Handle worktrees, symlinks, and nested project paths deliberately; do not group unrelated sessions merely because their path strings share a prefix. Sessions with unknown directory or harness should appear under an explicit **Unknown** or **Other** category rather than being omitted silently.

## Acceptance Criteria

- Opening the resume flow from a project shows matching OCode, Claude Code, and Codex sessions grouped by harness when those sources are available.
- A user can identify each session's source and associated directory.
- The current-directory filter can be changed or cleared to find sessions elsewhere.
- External history can be opened without modifying its original files.
- Unsupported session formats are reported or skipped without breaking native session browsing.

## Related Work

- Local OpenCode data-root discovery is covered by [Feature 2](02-cross-installation-sessions.md).
- Resume/session list implementation: `packages/tui/src/component/dialog-session-list.tsx`.
- Each external harness should have an isolated discovery/reader adapter so its storage format does not leak into the native session model.

## Tests

- [ ] Group known OCode, Claude Code, and Codex fixture sessions under the correct harness.
- [ ] Filter by current project and broaden to other/all directories.
- [ ] Verify canonical paths, worktrees, nested projects, symlinks, and unknown paths do not create misleading matches.
- [ ] Confirm external transcript browsing is read-only and unsupported sources fail gracefully.
- [ ] Confirm native resume behavior is unchanged.
