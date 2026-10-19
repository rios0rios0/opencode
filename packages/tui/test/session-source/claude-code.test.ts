import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  browseClaudeCodeSessions,
  readClaudeCodeSession,
  resolveClaudeCodeRoot,
} from "../../src/session-source/claude-code"
import { tmpdir } from "../fixture/fixture"

const BASE = Date.UTC(2026, 0, 2, 3, 4, 5)
const JANUARY_FIRST = Date.UTC(2026, 0, 1)
const JANUARY_THIRD = Date.UTC(2026, 0, 3)

function at(minutes: number) {
  return new Date(BASE + minutes * 60_000).toISOString()
}

function userLine(text: string, options: { minute?: number; cwd?: string; extra?: Record<string, unknown> } = {}) {
  const line: Record<string, unknown> = {
    type: "user",
    sessionId: "11111111-1111-4111-8111-111111111111",
    cwd: options.cwd ?? "/projects/demo",
    parentUuid: null,
    isSidechain: false,
    timestamp: at(options.minute ?? 0),
    uuid: `user-${options.minute ?? 0}`,
    message: { role: "user", content: text },
  }
  if (options.cwd === "") delete line.cwd
  return { ...line, ...options.extra }
}

function assistantLine(parts: unknown[], minute: number) {
  return {
    type: "assistant",
    sessionId: "11111111-1111-4111-8111-111111111111",
    cwd: "/projects/demo",
    isSidechain: false,
    timestamp: at(minute),
    uuid: `assistant-${minute}`,
    message: { role: "assistant", content: parts },
  }
}

function writeClaudeSession(projects: string, session: { id: string; directory: string; lines: unknown[]; modified?: number }) {
  const encoded = session.directory.replaceAll("/", "-")
  const file = path.join(projects, encoded, `${session.id}.jsonl`)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(
    file,
    session.lines
      .map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
      .join("\n") + "\n",
  )
  if (session.modified !== undefined) utimesSync(file, new Date(session.modified), new Date(session.modified))
  return file
}

test("groups discovered sessions by harness, directory, title, and activity", async () => {
  await using temporary = await tmpdir()
  const home = temporary.path
  const projects = path.join(home, ".claude", "projects")
  writeClaudeSession(projects, {
    id: "11111111-1111-4111-8111-111111111111",
    directory: "/projects/demo",
    modified: JANUARY_THIRD,
    lines: [
      userLine("Caveat: ignored metadata", { extra: { isMeta: true } }),
      userLine("<command-name>/model</command-name>"),
      userLine("Fix the login flow"),
      assistantLine([{ type: "text", text: "On it" }], 1),
    ],
  })
  writeClaudeSession(projects, {
    id: "22222222-2222-4222-8222-222222222222",
    directory: "/projects/other",
    modified: JANUARY_FIRST,
    lines: [userLine("Old work", { cwd: "/projects/other" })],
  })

  const result = await browseClaudeCodeSessions({ home, environment: {} })
  expect(result.warnings).toEqual([])
  expect(result.sessions.map((session) => [session.sessionID, session.harness, session.directory, session.title])).toEqual([
    ["11111111-1111-4111-8111-111111111111", "claude-code", "/projects/demo", "Fix the login flow"],
    ["22222222-2222-4222-8222-222222222222", "claude-code", "/projects/other", "Old work"],
  ])
  const session = result.sessions[0]!
  expect(session.sourceLabel).toBe("~/.claude")
  expect(session.sourceID).toBe(`claude-code:${path.join(home, ".claude", "projects")}`)
  expect(session.time).toEqual({ created: BASE, updated: JANUARY_THIRD })
  expect(session.key).toContain("11111111-1111-4111-8111-111111111111")
})

test("reads a read-only transcript and leaves the originals untouched", async () => {
  await using temporary = await tmpdir()
  const home = temporary.path
  const file = writeClaudeSession(path.join(home, ".claude", "projects"), {
    id: "33333333-3333-4333-8333-333333333333",
    directory: "/projects/demo",
    modified: JANUARY_THIRD,
    lines: [
      userLine("Explain the flaky test", { minute: 0 }),
      assistantLine(
        [
          { type: "thinking", thinking: "hidden" },
          { type: "text", text: "The clock is shared." },
          { type: "tool_use", name: "Read", input: {} },
        ],
        1,
      ),
      { type: "system", subtype: "informational", timestamp: at(2), content: "Compacted" },
      { type: "summary", timestamp: at(3), summary: "Flaky test investigation", uuid: "summary-1" },
      "{not json",
      userLine("Follow-up", { minute: 4, extra: { isSidechain: true } }),
    ],
  })
  const before = createHash("sha256").update(readFileSync(file)).digest("hex")

  const result = await browseClaudeCodeSessions({ home, environment: {} })
  const transcript = await readClaudeCodeSession(result.sessions[0]!)
  expect(transcript.entries.map((entry) => [entry.kind, entry.text])).toEqual([
    ["user", "Explain the flaky test"],
    ["assistant", "The clock is shared."],
    ["tool", "Read"],
    ["system", "Compacted"],
    ["system", "Summary: Flaky test investigation"],
  ])
  expect(transcript.warnings).toEqual(["Skipped 1 unreadable transcript entries in ~/.claude"])
  expect(createHash("sha256").update(readFileSync(file)).digest("hex")).toBe(before)
})

test("keeps unreadable files out and lists unknown directories instead of dropping them", async () => {
  await using temporary = await tmpdir()
  const home = temporary.path
  const projects = path.join(home, ".claude", "projects")
  writeClaudeSession(projects, {
    id: "44444444-4444-4444-8444-444444444444",
    directory: "/projects/demo",
    modified: JANUARY_THIRD,
    lines: [userLine("No directory recorded", { cwd: "" })],
  })
  writeClaudeSession(projects, {
    id: "55555555-5555-4555-8555-555555555555",
    directory: "/projects/demo",
    modified: JANUARY_FIRST,
    lines: [{ hello: "world" }, "not json at all"],
  })

  const result = await browseClaudeCodeSessions({ home, environment: {} })
  expect(result.sessions.map((session) => [session.sessionID, session.directory])).toEqual([
    ["44444444-4444-4444-8444-444444444444", ""],
  ])
  expect(result.warnings).toEqual(["Skipped 1 unreadable Claude Code sessions in ~/.claude"])
})

test("resolves CLAUDE_CONFIG_DIR and reports a missing configured store", async () => {
  await using temporary = await tmpdir()
  const home = path.join(temporary.path, "home")
  const configured = path.join(temporary.path, "claude-config")
  mkdirSync(configured, { recursive: true })

  const root = resolveClaudeCodeRoot({ home, environment: { CLAUDE_CONFIG_DIR: configured } })
  expect(root.root).toBe(configured)
  expect(root.projects).toBe(path.join(configured, "projects"))
  expect(root.configured).toBe(true)

  writeClaudeSession(path.join(configured, "projects"), {
    id: "66666666-6666-4666-8666-666666666666",
    directory: "/projects/demo",
    modified: JANUARY_THIRD,
    lines: [userLine("Configured store")],
  })
  const result = await browseClaudeCodeSessions({ home, environment: { CLAUDE_CONFIG_DIR: configured } })
  expect(result.sessions.map((session) => session.title)).toEqual(["Configured store"])

  const missing = await browseClaudeCodeSessions({
    home,
    environment: { CLAUDE_CONFIG_DIR: path.join(temporary.path, "nope") },
  })
  expect(missing.sessions).toEqual([])
  expect(missing.warnings).toEqual([`Claude Code sessions are not readable: ${path.join(temporary.path, "nope", "projects")}`])
})
