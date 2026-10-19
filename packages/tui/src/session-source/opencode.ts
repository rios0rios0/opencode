import { Database } from "#zed-sqlite"
import { readdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Option, Schema } from "effect"
import { errorMessage } from "../util/error"
import { decodeJsonRecord, MAX_TRANSCRIPT_ENTRIES, truncateEntryText } from "./jsonl"
import { canonicalPath, displayPath, expandHome, isDirectory } from "./paths"
import type { ExternalBrowseResult, ExternalReadResult, ExternalSession, ExternalTranscriptEntry } from "./types"

/** Bounds discovery so listing sessions from a foreign store never grows with its whole history. */
const MAX_SESSIONS_PER_DATABASE = 200

const REQUIRED_SESSION_COLUMNS = ["id", "project_id", "parent_id", "directory", "title", "time_created", "time_updated"]
const REQUIRED_MESSAGE_COLUMNS = ["id", "type", "seq", "data", "time_created"]

export interface OpenCodeRootInput {
  /** Additional data directories from configuration; `~` expands to the provided home. */
  configured?: readonly string[]
  home?: string
  environment?: Readonly<Record<string, string | undefined>>
  platform?: NodeJS.Platform
  /** Roots that must not be listed again, typically the active installation's data root. */
  exclude?: readonly string[]
}

export type OpenCodeRoot = Readonly<{
  path: string
  canonical: string
  label: string
  configured: boolean
}>

const decodeColumnName = Schema.decodeUnknownOption(Schema.Struct({ name: Schema.String }))
const decodeSessionRow = Schema.decodeUnknownOption(
  Schema.Struct({
    id: Schema.String,
    project_id: Schema.String,
    parent_id: Schema.NullOr(Schema.String),
    directory: Schema.String,
    path: Schema.NullOr(Schema.String),
    title: Schema.NullOr(Schema.String),
    time_created: Schema.Number,
    time_updated: Schema.Number,
  }),
)
const MessageRowSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  seq: Schema.Number,
  data: Schema.String,
  time_created: Schema.Number,
})
const decodeMessageRow = Schema.decodeUnknownOption(MessageRowSchema)
const decodeTextPayload = Schema.decodeUnknownOption(Schema.Struct({ text: Schema.String }))
const decodeAssistantPayload = Schema.decodeUnknownOption(
  Schema.Struct({
    content: Schema.Array(
      Schema.Struct({
        type: Schema.String,
        text: Schema.optional(Schema.String),
        name: Schema.optional(Schema.String),
      }),
    ),
  }),
)
const decodeShellPayload = Schema.decodeUnknownOption(Schema.Struct({ command: Schema.String }))
const decodeCompactionPayload = Schema.decodeUnknownOption(Schema.Struct({ status: Schema.String }))

/**
 * Resolves the OpenCode data roots to browse read-only: the standard platform locations plus
 * configured directories. Discovery is a single non-recursive listing per root and never walks
 * the home directory.
 */
export function resolveOpenCodeRoots(input: OpenCodeRootInput = {}): {
  roots: OpenCodeRoot[]
  warnings: string[]
} {
  const home = input.home ?? os.homedir()
  const environment = input.environment ?? process.env
  const platform = input.platform ?? process.platform
  const warnings: string[] = []
  const candidates = [
    ...standardDataRoots(platform, environment, home).map((candidate) => ({ path: candidate, configured: false })),
    ...(input.configured ?? [])
      .filter((candidate) => candidate.trim().length > 0)
      .map((candidate) => ({ path: expandHome(candidate.trim(), home), configured: true })),
  ]
  const excluded = new Set((input.exclude ?? []).map((candidate) => canonicalPath(path.resolve(candidate))))
  const seen = new Set<string>()
  const roots: OpenCodeRoot[] = []

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate.path)
    if (!isDirectory(resolved)) {
      // Missing standard locations are normal; a missing configured root is worth reporting.
      if (candidate.configured) warnings.push(`Session root is not readable: ${resolved}`)
      continue
    }
    const canonical = canonicalPath(resolved)
    if (excluded.has(canonical) || seen.has(canonical)) continue
    seen.add(canonical)
    roots.push({ path: resolved, canonical, label: displayPath(resolved, home), configured: candidate.configured })
  }

  return { roots, warnings }
}

/** Lists sessions from every discoverable OpenCode data root without writing to any of them. */
export async function browseOpenCodeSessions(input: OpenCodeRootInput = {}): Promise<ExternalBrowseResult> {
  const { roots, warnings } = resolveOpenCodeRoots(input)
  const sessions: ExternalSession[] = []

  for (const root of roots) {
    const databases = databaseFiles(root.path)
    if (databases.length === 0) {
      if (root.configured) warnings.push(`No OpenCode sessions database found in ${root.label}`)
      continue
    }
    for (const databasePath of databases) {
      // Several databases in one root are separate profiles; keep them tellable apart.
      const label = databases.length > 1 ? `${root.label} (${path.basename(databasePath)})` : root.label
      const listed = listDatabaseSessions(databasePath, label)
      sessions.push(...listed.sessions)
      warnings.push(...listed.warnings)
    }
  }

  sessions.sort((left, right) => right.time.updated - left.time.updated || left.key.localeCompare(right.key))
  return { sessions, warnings }
}

/** Reads one discovered session's transcript without modifying the source database. */
export async function readOpenCodeSession(session: ExternalSession): Promise<ExternalReadResult> {
  const warnings: string[] = []
  let database: Database | undefined
  try {
    database = new Database(session.storePath, { readonly: true })
    const columns = tableColumns(database, "session_message")
    if (!columns.includes("id")) {
      return { entries: [], warnings: [`No message history table in ${session.sourceLabel}`] }
    }
    const missing = REQUIRED_MESSAGE_COLUMNS.filter((column) => !columns.includes(column))
    if (missing.length > 0) {
      return {
        entries: [],
        warnings: [`Unsupported OpenCode storage version in ${session.sourceLabel}: missing ${missing.join(", ")}`],
      }
    }

    const total = countMessages(database, session.sessionID)
    const rows = database
      .query(
        `select id, type, seq, data, time_created
          from session_message
          where session_id = $sessionID
          order by seq asc
          limit ${MAX_TRANSCRIPT_ENTRIES}`,
      )
      .all({ $sessionID: session.sessionID })

    const entries: ExternalTranscriptEntry[] = []
    let malformed = 0
    for (const row of rows) {
      const parsed = decodeMessageRow(row)
      if (Option.isNone(parsed)) {
        malformed += 1
        continue
      }
      const mapped = messageEntries(parsed.value)
      if (mapped === "malformed") {
        malformed += 1
        continue
      }
      entries.push(...mapped)
    }

    if (malformed > 0) warnings.push(`Skipped ${malformed} unreadable transcript entries in ${session.sourceLabel}`)
    if (total !== undefined && total > rows.length) {
      warnings.push(`Showing the first ${rows.length} of ${total} messages in ${session.sourceLabel}`)
    }
    return { entries, warnings }
  } catch (error) {
    return { entries: [], warnings: [`Could not read the session history: ${errorMessage(error)}`] }
  } finally {
    database?.close()
  }
}

function standardDataRoots(
  platform: NodeJS.Platform,
  environment: Readonly<Record<string, string | undefined>>,
  home: string,
) {
  const roots = [path.join(environment.XDG_DATA_HOME || path.join(home, ".local", "share"), "opencode")]
  if (platform === "darwin") roots.push(path.join(home, "Library", "Application Support", "opencode"))
  if (platform === "win32") {
    roots.push(path.join(environment.LOCALAPPDATA || path.join(home, "AppData", "Local"), "opencode"))
  }
  return roots
}

function databaseFiles(directory: string) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith("opencode") && entry.name.endsWith(".db"))
      .map((entry) => path.join(directory, entry.name))
      .sort((left, right) => path.basename(left).length - path.basename(right).length || left.localeCompare(right))
  } catch {
    return []
  }
}

function listDatabaseSessions(
  databasePath: string,
  label: string,
): { sessions: ExternalSession[]; warnings: string[] } {
  const warnings: string[] = []
  let database: Database | undefined
  try {
    database = new Database(databasePath, { readonly: true })
    const columns = tableColumns(database, "session_v2")
    if (!columns.includes("id")) {
      return { sessions: [], warnings: [`No OpenCode sessions table in ${label}`] }
    }
    const missing = REQUIRED_SESSION_COLUMNS.filter((column) => !columns.includes(column))
    if (missing.length > 0) {
      return {
        sessions: [],
        warnings: [`Unsupported OpenCode storage version in ${label}: missing ${missing.join(", ")}`],
      }
    }

    const archivedFilter = columns.includes("time_archived") ? " and time_archived is null" : ""
    const rows = database
      .query(
        `select id, project_id, parent_id, directory, path, title, time_created, time_updated
          from session_v2
          where parent_id is null${archivedFilter}
          order by time_updated desc
          limit ${MAX_SESSIONS_PER_DATABASE}`,
      )
      .all()

    const sessions: ExternalSession[] = []
    let malformed = 0
    for (const row of rows) {
      const parsed = decodeSessionRow(row)
      if (Option.isNone(parsed)) {
        malformed += 1
        continue
      }
      sessions.push({
        key: `external:${databasePath}:${parsed.value.id}`,
        sessionID: parsed.value.id,
        harness: "opencode",
        sourceID: `opencode:${databasePath}`,
        sourceLabel: label,
        storePath: databasePath,
        directory: parsed.value.directory,
        subpath: parsed.value.path ?? undefined,
        title: parsed.value.title ?? undefined,
        time: { created: parsed.value.time_created, updated: parsed.value.time_updated },
      })
    }

    if (malformed > 0) warnings.push(`Skipped ${malformed} unreadable session records in ${label}`)
    return { sessions, warnings }
  } catch (error) {
    return { sessions: [], warnings: [`Could not read sessions from ${label}: ${errorMessage(error)}`] }
  } finally {
    database?.close()
  }
}

function tableColumns(database: Database, table: string) {
  return database
    .query(`pragma table_info(${table})`)
    .all()
    .flatMap((row) => {
      const parsed = decodeColumnName(row)
      return Option.isSome(parsed) ? [parsed.value.name] : []
    })
}

function countMessages(database: Database, sessionID: string) {
  try {
    const parsed = Schema.decodeUnknownOption(Schema.Struct({ count: Schema.Number }))(
      database.query(`select count(*) as count from session_message where session_id = $sessionID`).get({
        $sessionID: sessionID,
      }),
    )
    return Option.isSome(parsed) ? parsed.value.count : undefined
  } catch {
    return undefined
  }
}

type MessageRow = Schema.Schema.Type<typeof MessageRowSchema>

/** Maps one stored message to display entries; control messages map to nothing. */
function messageEntries(row: MessageRow): ExternalTranscriptEntry[] | "malformed" {
  const payload = decodeJsonRecord(row.data)
  if (Option.isNone(payload)) return row.type === "assistant" || row.type === "user" ? "malformed" : []

  const entry = (kind: ExternalTranscriptEntry["kind"], text: string): ExternalTranscriptEntry => ({
    id: row.id,
    kind,
    text: truncateEntryText(text),
    created: row.time_created,
  })

  if (row.type === "user") {
    const parsed = decodeTextPayload(payload.value)
    if (Option.isNone(parsed)) return "malformed"
    return parsed.value.text.trim() ? [entry("user", parsed.value.text)] : []
  }

  if (row.type === "assistant") {
    const parsed = decodeAssistantPayload(payload.value)
    if (Option.isNone(parsed)) return "malformed"
    return parsed.value.content.flatMap((part) => {
      if (part.type === "text" && part.text?.trim()) return [entry("assistant", part.text)]
      if (part.type === "tool" && part.name) return [entry("tool", part.name)]
      return []
    })
  }

  if (row.type === "synthetic" || row.type === "system") {
    const parsed = decodeTextPayload(payload.value)
    if (Option.isNone(parsed)) return "malformed"
    return parsed.value.text.trim() ? [entry("system", parsed.value.text)] : []
  }

  if (row.type === "shell") {
    const parsed = decodeShellPayload(payload.value)
    if (Option.isNone(parsed)) return "malformed"
    return [entry("system", `$ ${parsed.value.command}`)]
  }

  if (row.type === "compaction") {
    const parsed = decodeCompactionPayload(payload.value)
    if (Option.isNone(parsed)) return "malformed"
    return parsed.value.status === "completed" ? [entry("system", "Context compacted")] : []
  }

  return []
}
