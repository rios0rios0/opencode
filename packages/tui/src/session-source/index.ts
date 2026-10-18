import path from "node:path"
import {
  browseOpenCodeSessions,
  readOpenCodeSession,
  resolveOpenCodeRoots,
  type OpenCodeRoot,
  type OpenCodeRootInput,
} from "./opencode"
import type { ExternalBrowseResult, ExternalReadResult, ExternalSession } from "./types"

export type {
  ExternalBrowseResult,
  ExternalReadResult,
  ExternalSession,
  ExternalTranscriptEntry,
  SessionHarness,
} from "./types"
export { browseOpenCodeSessions, readOpenCodeSession, resolveOpenCodeRoots, type OpenCodeRoot, type OpenCodeRootInput }

/**
 * Lists read-only sessions from every supported external source: other OpenCode installations
 * discovered through standard data locations and configured roots. Harness adapters are added
 * per source; their storage formats never leak into the native session model.
 */
export async function browseExternalSessions(input: OpenCodeRootInput = {}): Promise<ExternalBrowseResult> {
  return browseOpenCodeSessions(input)
}

/** Reads one discovered session's history from its own source, never from the active store. */
export async function readExternalSession(session: ExternalSession): Promise<ExternalReadResult> {
  if (session.harness === "opencode") return readOpenCodeSession(session)
  return { entries: [], warnings: [`Reading ${session.harness} sessions is not supported`] }
}

/**
 * Compares session directories across stores. Stored paths always use forward slashes; on
 * Windows the comparison is case-insensitive. Prefixes never match, so unrelated projects that
 * merely share a path prefix stay apart.
 */
export function sameDirectory(left: string, right: string) {
  const a = path.resolve(left.replaceAll("\\", "/"))
  const b = path.resolve(right.replaceAll("\\", "/"))
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
}
