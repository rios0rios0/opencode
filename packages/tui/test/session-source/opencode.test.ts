import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { browseOpenCodeSessions, readOpenCodeSession, resolveOpenCodeRoots } from "../../src/session-source/opencode"
import { sameDirectory } from "../../src/session-source"
import { tmpdir } from "../fixture/fixture"

function createDatabase(file: string, setup?: (database: Database) => void) {
  mkdirSync(path.dirname(file), { recursive: true })
  const database = new Database(file)
  database.run(`create table session_v2 (
    id text primary key,
    project_id text not null,
    parent_id text,
    directory text,
    path text,
    title text,
    time_created integer not null,
    time_updated integer not null,
    time_archived integer
  )`)
  database.run(`create table session_message (
    id text primary key,
    session_id text not null,
    type text not null,
    seq integer not null,
    data text not null,
    time_created integer not null
  )`)
  setup?.(database)
  database.close()
}

function insertSession(
  database: Database,
  row: {
    id: string
    title?: string | null
    directory?: string | null
    parentID?: string | null
    updated?: number
    archived?: number | null
  },
) {
  database
    .query(
      `insert into session_v2 (id, project_id, parent_id, directory, path, title, time_created, time_updated, time_archived)
       values ($id, 'proj_other', $parentID, $directory, null, $title, 1, $updated, $archived)`,
    )
    .run({
      $id: row.id,
      $parentID: row.parentID ?? null,
      $directory: row.directory === undefined ? "/projects/demo" : row.directory,
      $title: row.title === undefined ? "Other installation session" : row.title,
      $updated: row.updated ?? 10,
      $archived: row.archived ?? null,
    })
}

function insertMessage(database: Database, row: { id: string; sessionID: string; type: string; seq: number; data: unknown }) {
  database
    .query(
      `insert into session_message (id, session_id, type, seq, data, time_created)
       values ($id, $sessionID, $type, $seq, $data, $created)`,
    )
    .run({
      $id: row.id,
      $sessionID: row.sessionID,
      $type: row.type,
      $seq: row.seq,
      $data: typeof row.data === "string" ? row.data : JSON.stringify(row.data),
      $created: row.seq * 100,
    })
}

/** Matches the reader's `~`-rooted source labels for paths under the sandbox home. */
function label(directory: string, home: string) {
  return "~/" + path.relative(home, directory).split(path.sep).join("/")
}

test("lists and reads sessions from a configured data root", async () => {
  await using temporary = await tmpdir()
  const root = path.join(temporary.path, "other-profile")
  const file = path.join(root, "opencode.db")
  createDatabase(file, (database) => {
    insertSession(database, { id: "ses_other", title: "Other installation session" })
    insertMessage(database, { id: "msg_1", sessionID: "ses_other", type: "user", seq: 1, data: { text: "Hello from the other installation" } })
    insertMessage(database, {
      id: "msg_2",
      sessionID: "ses_other",
      type: "assistant",
      seq: 2,
      data: { content: [{ type: "text", text: "Hi there" }, { type: "tool", name: "read" }] },
    })
    insertMessage(database, { id: "msg_3", sessionID: "ses_other", type: "shell", seq: 3, data: { command: "ls -la" } })
    insertMessage(database, { id: "msg_4", sessionID: "ses_other", type: "agent-switched", seq: 4, data: { agent: "build" } })
  })

  const result = await browseOpenCodeSessions({ configured: [root], home: temporary.path, environment: {} })
  expect(result.warnings).toEqual([])
  expect(result.sessions).toHaveLength(1)
  const session = result.sessions[0]!
  expect(session).toMatchObject({
    sessionID: "ses_other",
    harness: "opencode",
    directory: "/projects/demo",
    title: "Other installation session",
    time: { created: 1, updated: 10 },
  })
  expect(session.sourceLabel).toBe(label(root, temporary.path))
  expect(session.key.startsWith("external:")).toBe(true)

  const transcript = await readOpenCodeSession(session)
  expect(transcript.warnings).toEqual([])
  expect(transcript.entries.map((entry) => [entry.kind, entry.text])).toEqual([
    ["user", "Hello from the other installation"],
    ["assistant", "Hi there"],
    ["tool", "read"],
    ["system", "$ ls -la"],
  ])
})

test("reads sessions from the standard platform data locations", async () => {
  await using temporary = await tmpdir()
  const home = path.join(temporary.path, "home")
  const xdg = path.join(temporary.path, "xdg")
  createDatabase(path.join(xdg, "opencode", "opencode.db"), (database) =>
    insertSession(database, { id: "ses_xdg" }),
  )

  const linux = await browseOpenCodeSessions({ home, environment: { XDG_DATA_HOME: xdg }, platform: "linux" })
  expect(linux.warnings).toEqual([])
  expect(linux.sessions.map((session) => session.sessionID)).toEqual(["ses_xdg"])

  // The same root configured explicitly is discovered once, not twice.
  const configured = await browseOpenCodeSessions({
    configured: [path.join(xdg, "opencode")],
    home,
    environment: { XDG_DATA_HOME: xdg },
    platform: "linux",
  })
  expect(configured.sessions).toHaveLength(1)
})

test("resolves the standard root for every supported platform", async () => {
  await using temporary = await tmpdir()
  const home = path.join(temporary.path, "home")
  const localAppData = path.join(temporary.path, "local-app-data")
  mkdirSync(path.join(home, ".local", "share", "opencode"), { recursive: true })
  mkdirSync(path.join(home, "Library", "Application Support", "opencode"), { recursive: true })
  mkdirSync(path.join(localAppData, "opencode"), { recursive: true })

  const linux = resolveOpenCodeRoots({ home, environment: {}, platform: "linux" })
  expect(linux.roots.map((root) => root.path)).toEqual([path.join(home, ".local", "share", "opencode")])

  const darwin = resolveOpenCodeRoots({ home, environment: {}, platform: "darwin" })
  expect(darwin.roots.map((root) => root.path)).toEqual([
    path.join(home, ".local", "share", "opencode"),
    path.join(home, "Library", "Application Support", "opencode"),
  ])

  const win32 = resolveOpenCodeRoots({ home, environment: { LOCALAPPDATA: localAppData }, platform: "win32" })
  expect(win32.roots.map((root) => root.path)).toEqual([
    path.join(home, ".local", "share", "opencode"),
    path.join(localAppData, "opencode"),
  ])
})

test("expands configured home paths and reports missing roots", async () => {
  await using temporary = await tmpdir()
  const home = path.join(temporary.path, "home")
  createDatabase(path.join(home, "profile", "opencode.db"), (database) => insertSession(database, { id: "ses_home" }))

  const found = await browseOpenCodeSessions({ configured: ["~/profile"], home, environment: {} })
  expect(found.warnings).toEqual([])
  expect(found.sessions.map((session) => session.sessionID)).toEqual(["ses_home"])
  expect(found.sessions[0]!.sourceLabel).toBe("~/profile")

  const missing = await browseOpenCodeSessions({ configured: [path.join(temporary.path, "nope")], home, environment: {} })
  expect(missing.sessions).toEqual([])
  expect(missing.warnings).toEqual([`Session root is not readable: ${path.join(temporary.path, "nope")}`])

  mkdirSync(path.join(home, "empty"), { recursive: true })
  const empty = await browseOpenCodeSessions({ configured: [path.join(home, "empty")], home, environment: {} })
  expect(empty.sessions).toEqual([])
  expect(empty.warnings).toEqual(["No OpenCode sessions database found in ~/empty"])
})

test("never lists the excluded active installation root", async () => {
  await using temporary = await tmpdir()
  const home = path.join(temporary.path, "home")
  const xdg = path.join(temporary.path, "xdg")
  createDatabase(path.join(xdg, "opencode", "opencode.db"), (database) => insertSession(database, { id: "ses_active" }))

  const result = await browseOpenCodeSessions({
    home,
    environment: { XDG_DATA_HOME: xdg },
    platform: "linux",
    exclude: [path.join(xdg, "opencode")],
  })
  expect(result.sessions).toEqual([])
  expect(result.warnings).toEqual([])
})

test("keeps duplicate session IDs from different stores recognizable", async () => {
  await using temporary = await tmpdir()
  const root = path.join(temporary.path, "profile")
  for (const file of ["opencode.db", "opencode-alt.db"]) {
    createDatabase(path.join(root, file), (database) => {
      insertSession(database, { id: "ses_dup", title: "Native copy" })
      insertSession(database, { id: "ses_child", parentID: "ses_dup" })
      insertSession(database, { id: "ses_archived", archived: 5 })
      insertSession(database, { id: "ses_malformed", directory: null })
    })
  }

  const result = await browseOpenCodeSessions({ configured: [root], home: temporary.path, environment: {} })
  expect(result.sessions.map((session) => session.sessionID).sort()).toEqual(["ses_dup", "ses_dup"])
  expect(new Set(result.sessions.map((session) => session.key)).size).toBe(2)
  expect(result.sessions.map((session) => session.sourceLabel).sort()).toEqual([
    `${label(root, temporary.path)} (opencode-alt.db)`,
    `${label(root, temporary.path)} (opencode.db)`,
  ])
  expect(result.warnings).toEqual([
    `Skipped 1 unreadable session records in ${label(root, temporary.path)} (opencode.db)`,
    `Skipped 1 unreadable session records in ${label(root, temporary.path)} (opencode-alt.db)`,
  ])
})

test("reports unsupported and unreadable stores without failing other sources", async () => {
  await using temporary = await tmpdir()
  const good = path.join(temporary.path, "good")
  const broken = path.join(temporary.path, "broken")
  const old = path.join(temporary.path, "old")
  createDatabase(path.join(good, "opencode.db"), (database) => insertSession(database, { id: "ses_good" }))
  mkdirSync(broken, { recursive: true })
  writeFileSync(path.join(broken, "opencode.db"), "not a database")
  mkdirSync(old, { recursive: true })
  const legacy = new Database(path.join(old, "opencode.db"))
  legacy.run("create table session (id text primary key)")
  legacy.close()

  const result = await browseOpenCodeSessions({
    configured: [good, broken, old],
    home: temporary.path,
    environment: {},
  })
  expect(result.sessions.map((session) => session.sessionID)).toEqual(["ses_good"])
  expect(result.warnings).toHaveLength(2)
  expect(result.warnings[0]).toStartWith(`Could not read sessions from ${label(broken, temporary.path)}`)
  expect(result.warnings[1]).toBe(`No OpenCode sessions table in ${label(old, temporary.path)}`)
})

test("leaves source records untouched after browsing and reading", async () => {
  await using temporary = await tmpdir()
  const root = path.join(temporary.path, "profile")
  const file = path.join(root, "opencode.db")
  createDatabase(file, (database) => {
    insertSession(database, { id: "ses_frozen" })
    insertMessage(database, { id: "msg_1", sessionID: "ses_frozen", type: "user", seq: 1, data: { text: "Do not touch" } })
  })
  const before = createHash("sha256").update(readFileSync(file)).digest("hex")

  const result = await browseOpenCodeSessions({ configured: [root], home: temporary.path, environment: {} })
  await readOpenCodeSession(result.sessions[0]!)
  await browseOpenCodeSessions({ configured: [root], home: temporary.path, environment: {} })

  expect(createHash("sha256").update(readFileSync(file)).digest("hex")).toBe(before)
})

test("reports malformed transcript records and unsupported message tables", async () => {
  await using temporary = await tmpdir()
  const root = path.join(temporary.path, "profile")
  createDatabase(path.join(root, "opencode.db"), (database) => {
    insertSession(database, { id: "ses_mixed" })
    insertMessage(database, { id: "msg_1", sessionID: "ses_mixed", type: "user", seq: 1, data: { text: "Readable" } })
    insertMessage(database, { id: "msg_2", sessionID: "ses_mixed", type: "user", seq: 2, data: "{not json" })
    insertMessage(database, { id: "msg_3", sessionID: "ses_mixed", type: "assistant", seq: 3, data: { content: "wrong shape" } })
  })
  const result = await browseOpenCodeSessions({ configured: [root], home: temporary.path, environment: {} })
  const session = result.sessions[0]!
  const transcript = await readOpenCodeSession(session)
  expect(transcript.entries.map((entry) => entry.text)).toEqual(["Readable"])
  expect(transcript.warnings).toEqual([`Skipped 2 unreadable transcript entries in ${label(root, temporary.path)}`])

  const unreadable = await readOpenCodeSession({ ...session, storePath: path.join(root, "nope.db") })
  expect(unreadable.entries).toEqual([])
  expect(unreadable.warnings[0]).toStartWith("Could not read the session history: ")
})

test("matches directories exactly, never by shared prefix", () => {
  expect(sameDirectory("/projects/demo", "/projects/demo")).toBe(true)
  expect(sameDirectory("/projects/demo/", "/projects/demo")).toBe(true)
  expect(sameDirectory("/projects/demo", "/projects/demo-other")).toBe(false)
  expect(sameDirectory("C:\\projects\\demo", "C:/projects/demo")).toBe(true)
})

test("scans only the configured root, never nested or unrelated directories", async () => {
  await using temporary = await tmpdir()
  const home = path.join(temporary.path, "home")
  const root = path.join(temporary.path, "profile")
  createDatabase(path.join(root, "opencode.db"), (database) => insertSession(database, { id: "ses_direct" }))
  createDatabase(path.join(root, "nested", "opencode.db"), (database) => insertSession(database, { id: "ses_nested" }))
  createDatabase(path.join(temporary.path, "unrelated", "opencode.db"), (database) =>
    insertSession(database, { id: "ses_unrelated" }),
  )

  const roots = resolveOpenCodeRoots({ configured: [root], home, environment: {}, platform: "linux" })
  expect(roots.roots.map((entry) => entry.path)).toEqual([root])

  const result = await browseOpenCodeSessions({ configured: [root], home, environment: {} })
  expect(result.sessions.map((session) => session.sessionID)).toEqual(["ses_direct"])
})
