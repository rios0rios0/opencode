# Feature Request: Read Sessions from Other Local OpenCode Installations

**Project:** OCode fork of OpenCode

**Area:** Session storage / local interoperability

## Problem

Users may have more than one OpenCode installation or data profile on the same machine. OCode currently needs a way to discover and read prior sessions stored outside its active data directory, so users can find the work they did in another local OpenCode instance.

## Desired Behavior

- Discover sessions in other local OpenCode data roots, not merely other executable installation paths.
- Support standard platform data locations and allow users to configure additional session roots.
- Read session metadata and conversation history without changing the source installation's data.
- Keep source identity visible so users can tell which installation/profile a session came from.
- Handle storage-version differences, missing files, partial writes, and unreadable roots without crashing or corrupting the active store.
- Avoid recursively scanning the entire home directory; discovery should be bounded to known locations and user-configured roots.

## Scope and Safety

External sessions should be treated as read-only by default. If OCode offers an import or continue-in-OCode action, it should be explicit, preserve the original source, and only convert sessions when the format is understood. Duplicate sessions should be recognizable and should not silently overwrite native OCode sessions.

## Acceptance Criteria

- OCode can list and read a session from at least one separately configured local OpenCode data root.
- A user can add or remove additional roots without copying or rewriting their contents.
- Session metadata and transcript are associated with the correct project/directory and source installation.
- Unsupported or malformed session records are skipped or reported clearly without preventing access to other sessions.
- Discovery is bounded and does not access paths outside the configured/known roots.

## Relevant Areas

- Resume/session list: `packages/tui/src/component/dialog-session-list.tsx`
- Session and message data abstractions: `packages/tui/src/context/data.tsx` and the session data modules
- Local data paths and configuration: existing OpenCode runtime/configuration path services

The implementation should inspect the actual supported OpenCode storage format and configured data-directory behavior. Do not assume that sessions are stored in a `sessions.json` file.

## Tests

- [ ] Read sessions from an additional local OpenCode data root.
- [ ] Verify source records remain unchanged after browsing and importing.
- [ ] Exercise duplicate IDs, unsupported versions, malformed records, missing roots, and permission errors.
- [ ] Verify unrelated home-directory content is not scanned.
- [ ] Confirm current-installation sessions continue to work as before.
