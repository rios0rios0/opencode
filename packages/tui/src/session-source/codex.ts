import { readdirSync, statSync, type Dirent } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Option, Schema } from "effect"
import {
  decodeJsonRecord,
  isPromptText,
  MAX_TRANSCRIPT_ENTRIES,
  parseTimestamp,
  readJsonlHead,
  titleFromPrompt,
  truncateEntryText,
} from "./jsonl"
import { displayPath, isDirectory } from "./paths"
import type { ExternalBrowseResult, ExternalReadResult, ExternalSession, ExternalTranscriptEntry } from "./types"

/** Bounds discovery so a large external store never makes the picker grow without limit. */
const MAX_SESSIONS = 200
const MAX_FILES = 2000
const MAX_FILES_PER_DAY = 200
const MAX_YEARS = 6
const MAX_MONTHS = 12
const MAX_DAYS = 31
/** Discovery reads only the head of each rollout: enough for the first real prompt. */
const HEAD_BYTES = 64 * 1024
/** A transcript read shows only the beginning of a long history. */
const TRANSCRIPT_BYTES = 4 * 1024 * 1024
const MAX_TITLE = 120

export interface CodexRootInput {
  home?: string
  environment?: Readonly<Record<string, string | undefined>>
}

const SessionMetaSchema = Schema.Struct({
  type: Schema.Literal("session_meta"),
  payload: Schema.Struct({
    id: Schema.optional(Schema.String),
    session_id: Schema.optional(Schema.String),
    cwd: Schema.optional(Schema.String),
    timestamp: Schema.optional(Schema.String),
  }),
})
const decodeSessionMeta = Schema.decodeUnknownOption(SessionMetaSchema)

const CodexLineSchema = Schema.Struct({
  type: Schema.String,
  timestamp: Schema.optional(Schema.String),
  payload: Schema.optional(
    Schema.Struct({
      type: Schema.optional(Schema.String),
      role: Schema.optional(Schema.String),
      content: Schema.optional(Schema.Array(Schema.Unknown)),
      name: Schema.optional(Schema.String),
      id: Schema.optional(Schema.String),
      call_id: Schema.optional(Schema.String),
    }),
  ),
})
type CodexLine = Schema.Schema.Type<typeof CodexLineSchema>
const decodeCodexLine = Schema.decodeUnknownOption(CodexLineSchema)

const decodeCodexPart = Schema.decodeUnknownOption(
  Schema.Struct({
    type: Schema.String,
    text: Schema.optional(Schema.String),
  }),
)

/** Resolves the Codex store: `CODEX_HOME` when set, the standard home otherwise. */
export function resolveCodexRoot(input: CodexRootInput = {}) {
  const home = input.home ?? os.homedir()
  const environment = input.environment ?? process.env
  const configured = (environment.CODEX_HOME ?? "").trim()
  const root = configured ? path.resolve(configured) : path.join(home, ".codex")
  return { root, sessions: path.join(root, "sessions"), label: displayPath(root, home), configured: configured.length > 0 }
}

/** Lists Codex rollout sessions without writing to any of them. */
export async function browseCodexSessions(input: CodexRootInput = {}): Promise<ExternalBrowseResult> {
  const { sessions: directory, label, configured } = resolveCodexRoot(input)
  const warnings: string[] = []
  if (!isDirectory(directory)) {
    // A missing standard location is normal; a missing configured root is worth reporting.
    if (configured) warnings.push(`Codex sessions are not readable: ${directory}`)
    return { sessions: [], warnings }
  }

  const discovered = codexSessionFiles(directory)
  const entries = discovered.files
    .flatMap((file) => {
      try {
        return [{ file, modified: statSync(file).mtimeMs }]
      } catch {
        return []
      }
    })
    .sort((left, right) => right.modified - left.modified)
  const bounded = entries.slice(0, MAX_SESSIONS)

  const sessions: ExternalSession[] = []
  let unreadable = 0
  for (const entry of bounded) {
    const session = codexSession(entry.file, entry.modified, directory, label)
    if (!session) {
      unreadable += 1
      continue
    }
    sessions.push(session)
  }

  if (entries.length > bounded.length)
    warnings.push(`Showing the ${MAX_SESSIONS} most recent of ${entries.length} Codex sessions in ${label}`)
  else if (discovered.truncated) warnings.push(`Scanned only part of the Codex sessions in ${label}`)
  if (unreadable > 0) warnings.push(`Skipped ${unreadable} unreadable Codex sessions in ${label}`)
  return { sessions, warnings }
}

/** Reads one discovered rollout's transcript without modifying its original files. */
export async function readCodexSession(session: ExternalSession): Promise<ExternalReadResult> {
  const { lines, truncated } = readJsonlHead(session.storePath, TRANSCRIPT_BYTES)
  const entries: ExternalTranscriptEntry[] = []
  let malformed = 0

  for (const line of lines) {
    if (entries.length >= MAX_TRANSCRIPT_ENTRIES) break
    if (!line.trim()) continue
    const record = decodeJsonRecord(line)
    const parsed = Option.isSome(record) ? decodeCodexLine(record.value) : Option.none()
    if (Option.isNone(parsed)) {
      // Non-JSON lines occur while a rollout is mid-write; they never break the readable parts.
      malformed += 1
      continue
    }
    entries.push(...codexEntries(parsed.value))
  }
  entries.splice(MAX_TRANSCRIPT_ENTRIES)

  const warnings: string[] = []
  if (malformed > 0) warnings.push(`Skipped ${malformed} unreadable transcript entries in ${session.sourceLabel}`)
  if (truncated || entries.length >= MAX_TRANSCRIPT_ENTRIES)
    warnings.push(`Showing only the beginning of the transcript in ${session.sourceLabel}`)
  return { entries, warnings }
}

/** Walks the dated rollout tree newest-first and stops at a bounded number of files. */
function codexSessionFiles(sessions: string) {
  const candidates = numericDirectories(sessions)
    .slice(-MAX_YEARS)
    .reverse()
    .flatMap((year) =>
      numericDirectories(path.join(sessions, year))
        .slice(-MAX_MONTHS)
        .reverse()
        .flatMap((month) =>
          numericDirectories(path.join(sessions, year, month))
            .slice(-MAX_DAYS)
            .reverse()
            .flatMap((day) => {
              const directory = path.join(sessions, year, month, day)
              return readDirents(directory)
                .filter((entry) => entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl"))
                .map((entry) => entry.name)
                .sort()
                .reverse()
                .slice(0, MAX_FILES_PER_DAY)
                .map((name) => path.join(directory, name))
            }),
        ),
    )

  return { files: candidates.slice(0, MAX_FILES), truncated: candidates.length > MAX_FILES }
}

function codexSession(
  file: string,
  modified: number,
  sessions: string,
  label: string,
): ExternalSession | undefined {
  const { lines } = readJsonlHead(file, HEAD_BYTES)
  const first = lines[0]?.trim() ? decodeJsonRecord(lines[0]!) : Option.none()
  const meta = Option.isSome(first) ? decodeSessionMeta(first.value) : Option.none()
  if (Option.isNone(meta)) return undefined

  let title: string | undefined
  for (const line of lines.slice(1)) {
    if (title) break
    if (!line.trim()) continue
    const record = decodeJsonRecord(line)
    if (Option.isNone(record)) continue
    const parsed = decodeCodexLine(record.value)
    if (Option.isNone(parsed)) continue
    const payload = parsed.value.payload
    if (parsed.value.type !== "response_item" || payload?.type !== "message" || payload.role !== "user") continue
    const text = codexText(payload.content)
    if (text) title = titleFromPrompt(text, MAX_TITLE)
  }

  const sessionID = meta.value.payload.id ?? meta.value.payload.session_id ?? path.basename(file, ".jsonl")
  return {
    key: `external:${file}:${sessionID}`,
    sessionID,
    harness: "codex",
    sourceID: `codex:${sessions}`,
    sourceLabel: label,
    storePath: file,
    directory: meta.value.payload.cwd?.trim() ?? "",
    title,
    time: { created: parseTimestamp(meta.value.payload.timestamp) ?? modified, updated: modified },
  }
}

/** Maps one rollout line to display entries; event duplicates and model context stay out. */
function codexEntries(line: CodexLine): ExternalTranscriptEntry[] {
  if (line.type !== "response_item") return []
  const payload = line.payload
  if (!payload?.type) return []
  const created = parseTimestamp(line.timestamp)
  if (created === undefined) return []
  const id = payload.id ?? payload.call_id ?? payload.type
  const entry = (kind: ExternalTranscriptEntry["kind"], text: string, suffix = ""): ExternalTranscriptEntry => ({
    id: `${id}${suffix}`,
    kind,
    text: truncateEntryText(text),
    created,
  })

  if (payload.type === "message" && payload.role === "user") {
    if (!Array.isArray(payload.content)) return []
    return payload.content.flatMap((part, index) => {
      const parsed = decodeCodexPart(part)
      if (Option.isNone(parsed) || !parsed.value.text?.trim()) return []
      return [entry("user", parsed.value.text, index > 0 ? `#${index}` : "")]
    })
  }

  if (payload.type === "message" && payload.role === "assistant") {
    if (!Array.isArray(payload.content)) return []
    return payload.content.flatMap((part, index) => {
      const parsed = decodeCodexPart(part)
      if (Option.isNone(parsed) || !parsed.value.text?.trim()) return []
      return [entry("assistant", parsed.value.text, index > 0 ? `#${index}` : "")]
    })
  }

  if ((payload.type === "function_call" || payload.type === "custom_tool_call") && payload.name)
    return [entry("tool", payload.name)]
  return []
}

/** Extracts the first typed prompt from message content, ignoring injected context blocks. */
function codexText(content: readonly unknown[] | undefined) {
  if (!Array.isArray(content)) return undefined
  for (const part of content) {
    const parsed = decodeCodexPart(part)
    if (Option.isSome(parsed) && parsed.value.text && isPromptText(parsed.value.text)) return parsed.value.text
  }
  return undefined
}

function numericDirectories(directory: string) {
  return readDirents(directory)
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
}

function readDirents(directory: string): Dirent[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
  } catch {
    return []
  }
}
