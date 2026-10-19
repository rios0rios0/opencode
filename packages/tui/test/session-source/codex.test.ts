import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import path from "node:path"
import { browseCodexSessions, readCodexSession, resolveCodexRoot } from "../../src/session-source/codex"
import { tmpdir } from "../fixture/fixture"

const BASE = Date.UTC(2026, 0, 2, 3, 4, 5)
const JANUARY_FIRST = Date.UTC(2026, 0, 1)
const JANUARY_THIRD = Date.UTC(2026, 0, 3)

function at(minutes: number) {
  return new Date(BASE + minutes * 60_000).toISOString()
}

function metaLine(id: string, cwd: string | undefined, minute = 0) {
  const timestamp = at(minute)
  return {
    timestamp,
    type: "session_meta",
    payload: { id, session_id: id, timestamp, cwd, originator: "codex-tui", cli_version: "0.0.0" },
  }
}

function userMessage(text: string, minute: number) {
  return {
    timestamp: at(minute),
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
  }
}

function assistantMessage(text: string, minute: number) {
  return {
    timestamp: at(minute),
    type: "response_item",
    payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
  }
}

function toolCall(name: string, minute: number) {
  return {
    timestamp: at(minute),
    type: "response_item",
    payload: { type: "custom_tool_call", name, call_id: `call-${minute}` },
  }
}

function writeCodexSession(
  sessions: string,
  session: { id: string; date?: [string, string, string]; lines: unknown[]; modified?: number },
) {
  const [year, month, day] = session.date ?? ["2026", "09", "13"]
  const file = path.join(sessions, year, month, day, `rollout-${year}-${month}-${day}T00-00-00-${session.id}.jsonl`)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(
    file,
    session.lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n") + "\n",
  )
  if (session.modified !== undefined) utimesSync(file, new Date(session.modified), new Date(session.modified))
  return file
}

test("groups discovered rollouts by harness, directory, title, and activity", async () => {
  await using temporary = await tmpdir()
  const home = temporary.path
  const sessions = path.join(home, ".codex", "sessions")
  writeCodexSession(sessions, {
    id: "01a09c38-a294-77c0-b1b3-e099a1752762",
    date: ["2026", "09", "13"],
    modified: JANUARY_THIRD,
    lines: [
      metaLine("01a09c38-a294-77c0-b1b3-e099a1752762", "/projects/demo", 0),
      userMessage("<environment_context>\n  <cwd>/projects/demo</cwd>\n</environment_context>", 1),
      userMessage("Make the footer two rows", 2),
      assistantMessage("Done", 3),
    ],
  })
  writeCodexSession(sessions, {
    id: "01a09c38-a294-77c0-b1b3-e099a1752763",
    date: ["2026", "09", "12"],
    modified: JANUARY_FIRST,
    lines: [metaLine("01a09c38-a294-77c0-b1b3-e099a1752763", "/projects/other", 0), userMessage("Older work", 1)],
  })

  const result = await browseCodexSessions({ home, environment: {} })
  expect(result.warnings).toEqual([])
  expect(result.sessions.map((session) => [session.sessionID, session.harness, session.directory, session.title])).toEqual([
    ["01a09c38-a294-77c0-b1b3-e099a1752762", "codex", "/projects/demo", "Make the footer two rows"],
    ["01a09c38-a294-77c0-b1b3-e099a1752763", "codex", "/projects/other", "Older work"],
  ])
  const session = result.sessions[0]!
  expect(session.sourceLabel).toBe("~/.codex")
  expect(session.sourceID).toBe(`codex:${sessions}`)
  expect(session.time).toEqual({ created: BASE, updated: JANUARY_THIRD })
})

test("reads a read-only transcript and leaves the originals untouched", async () => {
  await using temporary = await tmpdir()
  const home = temporary.path
  const file = writeCodexSession(path.join(home, ".codex", "sessions"), {
    id: "01a09c38-a294-77c0-b1b3-e099a1752764",
    modified: JANUARY_THIRD,
    lines: [
      metaLine("01a09c38-a294-77c0-b1b3-e099a1752764", "/projects/demo", 0),
      { timestamp: at(1), type: "event_msg", payload: { type: "task_started", turn_id: "turn-1" } },
      userMessage("Explain the flaky test", 2),
      {
        timestamp: at(3),
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "The clock is shared." },
            { type: "output_text", text: "Second paragraph." },
          ],
        },
      },
      toolCall("shell", 4),
      { timestamp: at(5), type: "token_usage_record", payload: { total_tokens: 10 } },
      "{not json",
      { timestamp: at(6), type: "response_item", payload: { type: "reasoning", summary: [] } },
    ],
  })
  const before = createHash("sha256").update(readFileSync(file)).digest("hex")

  const result = await browseCodexSessions({ home, environment: {} })
  const transcript = await readCodexSession(result.sessions[0]!)
  expect(transcript.entries.map((entry) => [entry.kind, entry.text])).toEqual([
    ["user", "Explain the flaky test"],
    ["assistant", "The clock is shared."],
    ["assistant", "Second paragraph."],
    ["tool", "shell"],
  ])
  expect(transcript.warnings).toEqual(["Skipped 1 unreadable transcript entries in ~/.codex"])
  expect(createHash("sha256").update(readFileSync(file)).digest("hex")).toBe(before)
})

test("keeps unsupported rollouts out and lists unknown directories instead of dropping them", async () => {
  await using temporary = await tmpdir()
  const home = temporary.path
  const sessions = path.join(home, ".codex", "sessions")
  writeCodexSession(sessions, {
    id: "01a09c38-a294-77c0-b1b3-e099a1752765",
    modified: JANUARY_THIRD,
    lines: [metaLine("01a09c38-a294-77c0-b1b3-e099a1752765", undefined, 0), userMessage("No directory recorded", 1)],
  })
  writeCodexSession(sessions, {
    id: "01a09c38-a294-77c0-b1b3-e099a1752766",
    date: ["2026", "09", "12"],
    modified: JANUARY_FIRST,
    lines: [{ hello: "world" }],
  })

  const result = await browseCodexSessions({ home, environment: {} })
  expect(result.sessions.map((session) => [session.sessionID, session.directory])).toEqual([
    ["01a09c38-a294-77c0-b1b3-e099a1752765", ""],
  ])
  expect(result.warnings).toEqual(["Skipped 1 unreadable Codex sessions in ~/.codex"])
})

test("resolves CODEX_HOME and reports a missing configured store", async () => {
  await using temporary = await tmpdir()
  const home = path.join(temporary.path, "home")
  const configured = path.join(temporary.path, "codex-home")
  mkdirSync(configured, { recursive: true })

  const root = resolveCodexRoot({ home, environment: { CODEX_HOME: configured } })
  expect(root.root).toBe(configured)
  expect(root.sessions).toBe(path.join(configured, "sessions"))
  expect(root.configured).toBe(true)

  writeCodexSession(path.join(configured, "sessions"), {
    id: "01a09c38-a294-77c0-b1b3-e099a1752767",
    modified: JANUARY_THIRD,
    lines: [metaLine("01a09c38-a294-77c0-b1b3-e099a1752767", "/projects/demo", 0), userMessage("Configured store", 1)],
  })
  const result = await browseCodexSessions({ home, environment: { CODEX_HOME: configured } })
  expect(result.sessions.map((session) => session.title)).toEqual(["Configured store"])

  const missing = await browseCodexSessions({ home, environment: { CODEX_HOME: path.join(temporary.path, "nope") } })
  expect(missing.sessions).toEqual([])
  expect(missing.warnings).toEqual([`Codex sessions are not readable: ${path.join(temporary.path, "nope", "sessions")}`])
})
