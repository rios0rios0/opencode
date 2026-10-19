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
const MAX_PROJECT_DIRECTORIES = 500
/** Discovery reads only the head of each transcript: enough for the first real prompt. */
const HEAD_BYTES = 64 * 1024
/** A transcript read shows only the beginning of a long history. */
const TRANSCRIPT_BYTES = 4 * 1024 * 1024
const MAX_TITLE = 120

export interface ClaudeCodeRootInput {
  home?: string
  environment?: Readonly<Record<string, string | undefined>>
}

const ClaudeLineSchema = Schema.Struct({
  type: Schema.String,
  subtype: Schema.optional(Schema.String),
  isMeta: Schema.optional(Schema.Boolean),
  isSidechain: Schema.optional(Schema.Boolean),
  cwd: Schema.optional(Schema.String),
  timestamp: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  uuid: Schema.optional(Schema.String),
  message: Schema.optional(
    Schema.Struct({
      content: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.Unknown)])),
    }),
  ),
})
type ClaudeLine = Schema.Schema.Type<typeof ClaudeLineSchema>
const decodeClaudeLine = Schema.decodeUnknownOption(ClaudeLineSchema)

const decodeClaudePart = Schema.decodeUnknownOption(
  Schema.Struct({
    type: Schema.String,
    text: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
  }),
)

/** Resolves the Claude Code store: `CLAUDE_CONFIG_DIR` when set, the standard home otherwise. */
export function resolveClaudeCodeRoot(input: ClaudeCodeRootInput = {}) {
  const home = input.home ?? os.homedir()
  const environment = input.environment ?? process.env
  const configured = (environment.CLAUDE_CONFIG_DIR ?? "").trim()
  const root = configured ? path.resolve(configured) : path.join(home, ".claude")
  return {
    root,
    projects: path.join(root, "projects"),
    label: displayPath(root, home),
    configured: configured.length > 0,
  }
}

/** Lists Claude Code sessions from their JSONL transcripts without writing to any of them. */
export async function browseClaudeCodeSessions(input: ClaudeCodeRootInput = {}): Promise<ExternalBrowseResult> {
  const { projects, label, configured } = resolveClaudeCodeRoot(input)
  const warnings: string[] = []
  if (!isDirectory(projects)) {
    // A missing standard location is normal; a missing configured root is worth reporting.
    if (configured) warnings.push(`Claude Code sessions are not readable: ${projects}`)
    return { sessions: [], warnings }
  }

  const discovered = claudeSessionFiles(projects)
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
    const session = claudeSession(entry.file, entry.modified, projects, label)
    if (!session) {
      unreadable += 1
      continue
    }
    sessions.push(session)
  }

  if (entries.length > bounded.length)
    warnings.push(`Showing the ${MAX_SESSIONS} most recent of ${entries.length} Claude Code sessions in ${label}`)
  else if (discovered.truncated) warnings.push(`Scanned only part of the Claude Code sessions in ${label}`)
  if (unreadable > 0) warnings.push(`Skipped ${unreadable} unreadable Claude Code sessions in ${label}`)
  return { sessions, warnings }
}

/** Reads one discovered session's transcript without modifying its original files. */
export async function readClaudeCodeSession(session: ExternalSession): Promise<ExternalReadResult> {
  const { lines, truncated } = readJsonlHead(session.storePath, TRANSCRIPT_BYTES)
  const entries: ExternalTranscriptEntry[] = []
  let malformed = 0

  for (const line of lines) {
    if (entries.length >= MAX_TRANSCRIPT_ENTRIES) break
    if (!line.trim()) continue
    const record = decodeJsonRecord(line)
    const parsed = Option.isSome(record) ? decodeClaudeLine(record.value) : Option.none()
    if (Option.isNone(parsed)) {
      // Non-JSON lines occur while a harness is mid-write; they never break the readable parts.
      malformed += 1
      continue
    }
    entries.push(...claudeEntries(parsed.value))
  }
  entries.splice(MAX_TRANSCRIPT_ENTRIES)

  const warnings: string[] = []
  if (malformed > 0) warnings.push(`Skipped ${malformed} unreadable transcript entries in ${session.sourceLabel}`)
  if (truncated || entries.length >= MAX_TRANSCRIPT_ENTRIES)
    warnings.push(`Showing only the beginning of the transcript in ${session.sourceLabel}`)
  return { entries, warnings }
}

function claudeSessionFiles(projects: string) {
  const directories = readDirents(projects).filter((entry) => entry.isDirectory())
  const files: string[] = []
  const truncated = directories.length > MAX_PROJECT_DIRECTORIES

  for (const directory of directories.slice(0, MAX_PROJECT_DIRECTORIES)) {
    for (const entry of readDirents(path.join(projects, directory.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue
      if (files.length >= MAX_FILES) return { files, truncated: true }
      files.push(path.join(projects, directory.name, entry.name))
    }
  }

  return { files, truncated }
}

function claudeSession(
  file: string,
  modified: number,
  projects: string,
  label: string,
): ExternalSession | undefined {
  const { lines } = readJsonlHead(file, HEAD_BYTES)
  let directory: string | undefined
  let title: string | undefined
  let created: number | undefined
  let readable = false

  for (const line of lines) {
    if (!line.trim()) continue
    const record = decodeJsonRecord(line)
    if (Option.isNone(record)) continue
    const parsed = decodeClaudeLine(record.value)
    if (Option.isNone(parsed)) continue
    const entry = parsed.value
    if (entry.type === "user" || entry.type === "assistant" || entry.type === "system") readable = true
    directory ??= entry.cwd?.trim() || undefined
    created ??= parseTimestamp(entry.timestamp)
    if (!title && entry.type === "user" && !entry.isMeta && !entry.isSidechain) {
      const text = claudeUserText(entry.message?.content)
      if (text) title = titleFromPrompt(text, MAX_TITLE)
    }
  }
  if (!readable) return undefined

  const sessionID = path.basename(file, ".jsonl")
  return {
    key: `external:${file}:${sessionID}`,
    sessionID,
    harness: "claude-code",
    sourceID: `claude-code:${projects}`,
    sourceLabel: label,
    storePath: file,
    directory: directory ?? "",
    title,
    time: { created: created ?? modified, updated: modified },
  }
}

/** Maps one stored JSONL line to display entries; meta, sidechain, and tool output stay out. */
function claudeEntries(line: ClaudeLine): ExternalTranscriptEntry[] {
  const created = parseTimestamp(line.timestamp)
  if (created === undefined) return []
  const id = line.uuid ?? line.type
  const entry = (kind: ExternalTranscriptEntry["kind"], text: string, suffix = ""): ExternalTranscriptEntry => ({
    id: `${id}${suffix}`,
    kind,
    text: truncateEntryText(text),
    created,
  })

  if (line.type === "user") {
    if (line.isMeta || line.isSidechain) return []
    const content = line.message?.content
    if (typeof content === "string") return content.trim() ? [entry("user", content)] : []
    if (!Array.isArray(content)) return []
    return content.flatMap((part, index) => {
      const parsed = decodeClaudePart(part)
      if (Option.isNone(parsed) || parsed.value.type !== "text" || !parsed.value.text?.trim()) return []
      return [entry("user", parsed.value.text, index > 0 ? `#${index}` : "")]
    })
  }

  if (line.type === "assistant") {
    const content = line.message?.content
    if (!Array.isArray(content)) return []
    return content.flatMap((part, index) => {
      const parsed = decodeClaudePart(part)
      if (Option.isNone(parsed)) return []
      const suffix = index > 0 ? `#${index}` : ""
      if (parsed.value.type === "text" && parsed.value.text?.trim()) return [entry("assistant", parsed.value.text, suffix)]
      if (parsed.value.type === "tool_use" && parsed.value.name) return [entry("tool", parsed.value.name, suffix)]
      return []
    })
  }

  if (line.type === "system" && line.content?.trim()) return [entry("system", line.content)]
  if (line.type === "summary" && line.summary?.trim()) return [entry("system", `Summary: ${line.summary}`)]
  return []
}

/** Extracts prompt text from a stored user message, ignoring tool results and command output. */
function claudeUserText(content: string | readonly unknown[] | undefined) {
  if (typeof content === "string") return isPromptText(content) ? content : undefined
  if (!Array.isArray(content)) return undefined
  for (const part of content) {
    const parsed = decodeClaudePart(part)
    if (Option.isSome(parsed) && parsed.value.type === "text" && parsed.value.text && isPromptText(parsed.value.text))
      return parsed.value.text
  }
  return undefined
}

function readDirents(directory: string): Dirent[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
  } catch {
    return []
  }
}
