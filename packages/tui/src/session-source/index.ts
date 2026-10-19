import {
  browseClaudeCodeSessions,
  readClaudeCodeSession,
  resolveClaudeCodeRoot,
  type ClaudeCodeRootInput,
} from "./claude-code"
import { browseCodexSessions, readCodexSession, resolveCodexRoot, type CodexRootInput } from "./codex"
import {
  browseOpenCodeSessions,
  readOpenCodeSession,
  resolveOpenCodeRoots,
  type OpenCodeRoot,
  type OpenCodeRootInput,
} from "./opencode"
import { sameDirectory } from "./paths"
import type { ExternalBrowseResult, ExternalReadResult, ExternalSession } from "./types"

export type {
  ExternalBrowseResult,
  ExternalReadResult,
  ExternalSession,
  ExternalTranscriptEntry,
  SessionHarness,
} from "./types"
export { HARNESS_LABELS, HARNESS_ORDER } from "./types"
export {
  browseClaudeCodeSessions,
  browseOpenCodeSessions,
  browseCodexSessions,
  readClaudeCodeSession,
  readCodexSession,
  readOpenCodeSession,
  resolveClaudeCodeRoot,
  resolveCodexRoot,
  resolveOpenCodeRoots,
  sameDirectory,
  type ClaudeCodeRootInput,
  type CodexRootInput,
  type OpenCodeRoot,
  type OpenCodeRootInput,
}

/** Discovery input shared by every harness adapter: OpenCode roots plus the common home. */
export type ExternalBrowseInput = OpenCodeRootInput

/**
 * Lists read-only sessions from every supported external source: other OpenCode installations
 * discovered through standard data locations and configured roots, plus the local Claude Code
 * and Codex stores. Harness adapters are isolated per source; their storage formats never leak
 * into the native session model.
 */
export async function browseExternalSessions(input: ExternalBrowseInput = {}): Promise<ExternalBrowseResult> {
  const [opencode, claude, codex] = await Promise.all([
    browseOpenCodeSessions(input),
    browseClaudeCodeSessions(input),
    browseCodexSessions(input),
  ])
  return {
    sessions: [...opencode.sessions, ...claude.sessions, ...codex.sessions].sort(
      (left, right) => right.time.updated - left.time.updated || left.key.localeCompare(right.key),
    ),
    warnings: [...opencode.warnings, ...claude.warnings, ...codex.warnings],
  }
}

/** Reads one discovered session's history from its own source, never from the active store. */
export async function readExternalSession(session: ExternalSession): Promise<ExternalReadResult> {
  switch (session.harness) {
    case "opencode":
      return readOpenCodeSession(session)
    case "claude-code":
      return readClaudeCodeSession(session)
    case "codex":
      return readCodexSession(session)
  }
}
