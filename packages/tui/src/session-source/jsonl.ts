import { closeSync, openSync, readSync, statSync } from "node:fs"
import { Schema } from "effect"

/** Bounds a single transcript read; readers report when they truncate. */
export const MAX_TRANSCRIPT_ENTRIES = 1000
/** Bounds one rendered entry; full tool payloads and pastes stay out of the read-only viewer. */
export const MAX_ENTRY_TEXT = 8000

export const decodeJsonRecord = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
)

/**
 * Reads complete JSONL lines from the head of a file instead of loading a foreign session's
 * whole history. Only the final partial line of a capped read is dropped, never a complete one.
 */
export function readJsonlHead(file: string, maxBytes: number): { lines: string[]; truncated: boolean } {
  let handle: number | undefined
  try {
    const truncated = statSync(file).size > maxBytes
    const buffer = Buffer.allocUnsafe(maxBytes)
    handle = openSync(file, "r")
    const bytesRead = readSync(handle, buffer, 0, maxBytes, 0)
    const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n")
    if (truncated) lines.pop()
    return { lines, truncated }
  } catch {
    return { lines: [], truncated: false }
  } finally {
    if (handle !== undefined) closeSync(handle)
  }
}

export function truncateEntryText(text: string) {
  if (text.length <= MAX_ENTRY_TEXT) return text
  return text.slice(0, MAX_ENTRY_TEXT) + "\n… (truncated)"
}

export function parseTimestamp(value: string | undefined) {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Distinguishes a typed prompt from text the harness injected into a user-shaped message,
 * such as local command output or `<environment_context>` blocks.
 */
export function isPromptText(text: string) {
  const trimmed = text.trim()
  return trimmed.length > 0 && !trimmed.startsWith("<") && !trimmed.startsWith("Caveat:")
}

export function titleFromPrompt(text: string, maxLength: number) {
  const collapsed = text.replace(/\s+/g, " ").trim()
  if (collapsed.length <= maxLength) return collapsed
  return collapsed.slice(0, maxLength - 1) + "…"
}
