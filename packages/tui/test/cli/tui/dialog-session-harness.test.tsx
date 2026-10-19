/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { testRender } from "@opentui/solid"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { onMount } from "solid-js"
import { DialogSessionList } from "../../../src/component/dialog-session-list"
import { ConfigProvider } from "../../../src/config"
import { ArgsProvider } from "../../../src/context/args"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocalProvider } from "../../../src/context/local"
import { LocationProvider } from "../../../src/context/location"
import { PermissionProvider } from "../../../src/context/permission"
import { RouteProvider } from "../../../src/context/route"
import { TuiAppProvider } from "../../../src/context/runtime"
import { SessionTabsProvider } from "../../../src/context/session-tabs"
import { StorageProvider } from "../../../src/context/storage"
import { ThemeProvider } from "../../../src/context/theme"
import { DialogProvider, useDialog } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { withoutDiscoveryOverrides } from "../../fixture/discovery-env"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

function createOpenCodeRoot(root: string, sessions: { id: string; title: string; directory: string }[]) {
  mkdirSync(root, { recursive: true })
  const database = new Database(path.join(root, "opencode.db"))
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
  sessions.forEach((session, index) => {
    database
      .query(
        `insert into session_v2 (id, project_id, parent_id, directory, path, title, time_created, time_updated, time_archived)
         values ($id, 'proj_other', null, $directory, null, $title, 1, $updated, null)`,
      )
      .run({ $id: session.id, $directory: session.directory, $title: session.title, $updated: 20 - index })
  })
  database.close()
}

function createClaudeSession(
  home: string,
  session: { id: string; directory?: string; prompt: string; reply: string },
) {
  const line = (record: Record<string, unknown>) => JSON.stringify(record)
  const file = path.join(
    home,
    ".claude",
    "projects",
    (session.directory ?? "/projects/unknown").replaceAll("/", "-"),
    `${session.id}.jsonl`,
  )
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(
    file,
    [
      line({
        type: "user",
        sessionId: session.id,
        cwd: session.directory,
        isSidechain: false,
        timestamp: "2026-01-02T03:04:05.000Z",
        uuid: `${session.id}-user`,
        message: { role: "user", content: session.prompt },
      }),
      line({
        type: "assistant",
        cwd: session.directory,
        isSidechain: false,
        timestamp: "2026-01-02T03:04:06.000Z",
        uuid: `${session.id}-assistant`,
        message: { role: "assistant", content: [{ type: "text", text: session.reply }] },
      }),
    ].join("\n") + "\n",
  )
}

function createCodexSession(home: string, session: { id: string; directory?: string; prompt: string; reply: string }) {
  const timestamp = "2026-01-02T03:04:05.000Z"
  const file = path.join(home, ".codex", "sessions", "2026", "01", "02", `rollout-2026-01-02T00-00-00-${session.id}.jsonl`)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(
    file,
    [
      JSON.stringify({
        timestamp,
        type: "session_meta",
        payload: { id: session.id, session_id: session.id, timestamp, cwd: session.directory },
      }),
      JSON.stringify({
        timestamp,
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: session.prompt }] },
      }),
      JSON.stringify({
        timestamp,
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: session.reply }] },
      }),
    ].join("\n") + "\n",
  )
}

async function setupDialog(configuredRoot: string, temporary: Awaited<ReturnType<typeof tmpdir>>) {
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/location")
      return json({
        directory: process.cwd(),
        project: { id: "proj_a", directory: process.cwd(), canonical: process.cwd() },
      })
    if (url.pathname !== "/api/session") return undefined
    if (url.searchParams.get("parentID") && url.searchParams.get("parentID") !== "null")
      return json({ data: [], cursor: {} })
    return json({
      data: [
        {
          id: "ses_native",
          projectID: "proj_a",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 30 },
          title: "Native session",
          location: { directory: process.cwd() },
        },
      ],
      cursor: {},
    })
  }, events)

  function Probe() {
    const dialog = useDialog()
    onMount(() => dialog.replace(() => <DialogSessionList />))
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts
        paths={{
          home: temporary.path,
          data: path.join(temporary.path, "data"),
          state: path.join(temporary.path, "state"),
        }}
      >
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ArgsProvider>
              <ConfigProvider config={createTuiResolvedConfig({ animations: false, session: { external_roots: [configuredRoot] } })}>
                <Keymap.Provider>
                  <ToastProvider>
                    <RouteProvider>
                      <ClientProvider api={createApi(calls.fetch)}>
                        <PermissionProvider>
                          <DataProvider directory={process.cwd()}>
                            <LocationProvider>
                              <SessionTabsProvider>
                                <ThemeProvider mode="dark" source={emptyThemeSource}>
                                  <LocalProvider>
                                    <DialogProvider>
                                      <Probe />
                                    </DialogProvider>
                                  </LocalProvider>
                                </ThemeProvider>
                              </SessionTabsProvider>
                            </LocationProvider>
                          </DataProvider>
                        </PermissionProvider>
                      </ClientProvider>
                    </RouteProvider>
                  </ToastProvider>
                </Keymap.Provider>
              </ConfigProvider>
            </ArgsProvider>
          </StorageProvider>
        </TuiAppProvider>
      </TestTuiContexts>
    ),
    { width: 110, height: 44, kittyKeyboard: true },
  )
  app.renderer.start()
  return { app }
}

test("groups harness sessions by source and scopes them to the current directory", async () => {
  await using temporary = await tmpdir()
  const home = temporary.path
  // The fixture home owns the stores; ambient overrides must not point discovery elsewhere.
  await withoutDiscoveryOverrides(async () => {
    createOpenCodeRoot(path.join(home, "profile"), [
      { id: "ses_staging", title: "Staging work", directory: process.cwd() },
      { id: "ses_remote", title: "Remote work", directory: "/projects/elsewhere" },
    ])
    createClaudeSession(home, {
      id: "11111111-1111-4111-8111-111111111111",
      directory: process.cwd(),
      prompt: "Claude login flow",
      reply: "Claude reply text",
    })
    createClaudeSession(home, {
      id: "22222222-2222-4222-8222-222222222222",
      directory: "/projects/elsewhere",
      prompt: "Claude remote",
      reply: "Remote reply",
    })
    createClaudeSession(home, {
      id: "33333333-3333-4333-8333-333333333333",
      prompt: "Unknown history",
      reply: "Unknown reply",
    })
    createCodexSession(home, {
      id: "01a09c38-a294-77c0-b1b3-e099a1752762",
      directory: process.cwd(),
      prompt: "Codex footer work",
      reply: "Codex reply",
    })
    createCodexSession(home, {
      id: "01a09c38-a294-77c0-b1b3-e099a1752763",
      directory: "/projects/elsewhere",
      prompt: "Codex remote",
      reply: "Remote reply",
    })

    const { app } = await setupDialog(path.join(home, "profile"), temporary)
    try {
      await app.waitForFrame((frame) => frame.includes("Staging work"))
      const frame = app.captureCharFrame()
      // Each harness gets its own section, and the native session stays where it was.
      expect(frame).toContain("Native session")
      expect(frame).toContain("OpenCode · ~/profile")
      expect(frame).toContain("Claude Code")
      expect(frame).toContain("Codex")
      expect(frame).toContain("Staging work")
      expect(frame).toContain("Claude login flow")
      expect(frame).toContain("Codex footer work")
      // Sessions from other directories stay hidden until the scope is broadened.
      expect(frame).not.toContain("Remote work")
      expect(frame).not.toContain("Claude remote")
      expect(frame).not.toContain("Codex remote")
      // A session with no recorded directory is listed under its explicit section, not dropped.
      expect(frame).toContain("Other")
      expect(frame).toContain("Unknown history")

      app.mockInput.pressKey("a", { ctrl: true })
      const broadened = await app.waitForFrame((value) => value.includes("Claude remote"))
      expect(broadened).toContain("Remote work")
      expect(broadened).toContain("Codex remote")

      const lines = app.captureCharFrame().split("\n")
      const row = lines.findIndex((line) => line.includes("Claude login flow"))
      await app.mockMouse.click(lines[row]!.indexOf("Claude login flow") + 2, row)
      const viewer = await app.waitForFrame((value) => value.includes("Read-only · ~/.claude"))
      expect(viewer).toContain("Claude Code ·")
      expect(viewer).toContain("Claude reply text")
    } finally {
      app.renderer.destroy()
    }
  })
})
