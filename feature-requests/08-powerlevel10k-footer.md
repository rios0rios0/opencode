# Feature Request: Use a Two-Line, Powerlevel10k-Inspired Footer/Status Bar

**Project:** OCode fork of OpenCode

**Area:** TUI footer / status bar

## Problem

The OCode footer does not match the user's reference layout from Claude Code and Powerlevel10k. Location and Git branch are missing, incorrect, or difficult to read, while status information is compressed into an unsuitable layout and the colors do not match the provided reference. The user wants the status area to use two deliberate rows rather than squeezing all segments into a single bar or showing an incorrect working path.

## Desired Behavior

Render a stable, two-row status area, in addition to the prompt/composer itself:

1. **Location row:** Show the active session's working directory and Git branch, with clear separators. Use a readable shortened path that preserves the meaningful project/repository and final directory components. Show no branch when the location is not in a Git worktree.
2. **Status row:** Show the selected model/variant, context usage, applicable provider quota windows (such as 5h/7d/30d when authoritative data is available), and relevant account/work indicators without misleading source attribution.

Use segment colors, separators, and emphasis inspired by the user's Powerlevel10k reference screenshot/configuration. The local Powerlevel10k configuration uses directory and shortened-directory foreground `9`, bold anchor foreground `21`, and a custom Git formatter with clean `8`, modified `178`, untracked `39`, conflicted `196`, and metadata `244` (with VCS icon `9`). Use these configured palette roles as the reference, while mapping them through OCode's theme/style system rather than scattering raw colors through render components. The supplied screenshot is the visual acceptance reference; the status area should remain legible in color and monochrome modes.

## Correct Location Source

The displayed path and branch must describe the active session/worktree, not an unrelated process working directory or a stale global location. Resolve the session's location first and use the current application location only as a fallback when there is no active session. Derive the branch from the VCS information for that same location. Handle worktrees, non-Git directories, and missing VCS information.

The current code has related logic in:

- Prompt status segments and fitting: `packages/tui/src/feature-plugins/prompt/footer.tsx`
- Sidebar path/branch footer: `packages/tui/src/feature-plugins/sidebar/footer.tsx`
- Mini footer/status row sizing: `packages/tui/src/mini/footer.view.tsx` and `packages/tui/src/mini/footer.width.ts`
- Existing path formatting: `context.ui.format.path(...)`

In particular, audit the location used by the sidebar footer: its displayed path/branch should follow the active session's location when that differs from the global context location.

## Layout and Color Requirements

- Reserve and use two stable status rows; do not let an optional model, quota, or hint segment push the path/branch off-screen.
- Allocate width by semantic priority. Truncate long paths deliberately while preserving the repository and working-directory identity; do not silently replace the path with an unrelated directory.
- Keep branch and directory adjacent on the location row so their relationship is clear.
- Use the reference's Powerlevel10k-style color roles for path anchors, shortened path components, branch/Git states, separators, and usage status. Map these through OCode's theme/style system rather than scattering raw colors through render components.
- Allow optional lower-priority segments to compact or disappear at narrow terminal widths while keeping the location and most important usage state understandable.
- Resize and recalculate the two rows correctly when the terminal width changes.
- Keep the prompt/composer usable and do not count its own input row as one of the two status rows.

## Acceptance Criteria

- The status area consistently uses two rows at normal terminal widths, with location/branch on the first and model/context/usage information on the second.
- The directory and branch match the active session's actual working location/worktree.
- A non-Git directory shows its path without a stale branch.
- Long paths remain recognizable; the repository and final directory are not both lost to truncation.
- Colors and separators visibly follow the supplied Powerlevel10k reference, including distinct directory-anchor and Git-state styling.
- Narrow widths and resize events do not overlap, misplace, or permanently hide required status information.
- Provider quota information, when available, is shown with the correct provider/model scope; missing quota data is not fabricated.

## Tests

- [ ] Render location and branch for a session whose location differs from the global application location.
- [ ] Verify Git worktrees, non-Git folders, missing branch data, and long paths.
- [ ] Verify two-row ordering and width allocation with all status segments present.
- [ ] Exercise narrow widths and resize transitions; ensure prompt input remains usable.
- [ ] Verify style roles for path, anchor, branch/Git states, separators, and quota severity.
- [ ] Verify unavailable quota windows do not appear as unlimited usage.
