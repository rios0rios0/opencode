/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { testRender } from "@opentui/solid"
import { mkdirSync } from "node:fs"
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

function createExternalRoot(root: string, sessions: { id: string; title: string; directory: string }[]) {
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
  database.run(`create table session_message (
    id text primary key,
    session_id text not null,
    type text not null,
    seq integer not null,
    data text not null,
    time_created integer not null
  )`)
  sessions.forEach((session, index) => {
    database
      .query(
        `insert into session_v2 (id, project_id, parent_id, directory, path, title, time_created, time_updated, time_archived)
         values ($id, 'proj_other', null, $directory, null, $title, 1, $updated, null)`,
      )
      .run({ $id: session.id, $directory: session.directory, $title: session.title, $updated: 20 - index })
  })
  database
    .query(
      `insert into session_message (id, session_id, type, seq, data, time_created)
       values ('msg_staging', 'ses_staging', 'user', 1, $data, 1)`,
    )
    .run({ $data: JSON.stringify({ text: "Hello from the staging installation" }) })
  database.close()
}

async function setupDialog(root: string, temporary: Awaited<ReturnType<typeof tmpdir>>) {
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/location")
      return json({ directory: process.cwd(), project: { id: "proj_a", directory: process.cwd(), canonical: process.cwd() } })
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
          home: path.join(temporary.path, "home"),
          data: path.join(temporary.path, "data"),
          state: path.join(temporary.path, "state"),
        }}
      >
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ArgsProvider>
              <ConfigProvider config={createTuiResolvedConfig({ animations: false, session: { external_roots: [root] } })}>
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
    { width: 110, height: 30, kittyKeyboard: true },
  )
  app.renderer.start()
  return { app }
}

test("lists external sessions and opens their history read-only", async () => {
  await using temporary = await tmpdir()
  const root = path.join(temporary.path, "home", "profile")
  createExternalRoot(root, [
    { id: "ses_staging", title: "Staging work", directory: process.cwd() },
    { id: "ses_elsewhere", title: "Remote work", directory: "/projects/elsewhere" },
  ])
  await withoutDiscoveryOverrides(async () => {
    const { app } = await setupDialog(root, temporary)

    try {
      await app.waitForFrame((frame) => frame.includes("Staging work"))
      const frame = app.captureCharFrame()
      expect(frame).toContain("Native session")
      expect(frame).toContain("OpenCode · ~/profile")
      // The current-directory scope hides sessions from other directories until ctrl+a.
      expect(frame).not.toContain("Remote work")

      app.mockInput.pressKey("a", { ctrl: true })
      await app.waitForFrame((value) => value.includes("Remote work"))

      const lines = app.captureCharFrame().split("\n")
      const row = lines.findIndex((line) => line.includes("Staging work"))
      await app.mockMouse.click(lines[row]!.indexOf("Staging work") + 2, row)
      const viewer = await app.waitForFrame((value) => value.includes("Read-only · ~/profile"))
      expect(viewer).toContain("Hello from the staging installation")
    } finally {
      app.renderer.destroy()
    }
  })
})

test("external sessions refuse destructive actions while native sessions keep them", async () => {
  await using temporary = await tmpdir()
  const root = path.join(temporary.path, "home", "profile")
  createExternalRoot(root, [{ id: "ses_staging", title: "Staging work", directory: process.cwd() }])
  await withoutDiscoveryOverrides(async () => {
    const { app } = await setupDialog(root, temporary)

    try {
      await app.waitForFrame((frame) => frame.includes("Staging work"))
      await app.waitForVisualIdle({ quietFrames: 3 })

      // The selected row starts on the native session; move down to the external one.
      app.mockInput.pressKey("ARROW_DOWN")
      await app.waitForVisualIdle({ quietFrames: 3 })
      app.mockInput.pressKey("d", { ctrl: true })
      await app.waitForVisualIdle({ quietFrames: 3 })
      expect(app.captureCharFrame()).not.toContain("again to confirm")

      app.mockInput.pressKey("ARROW_UP")
      await app.waitForVisualIdle({ quietFrames: 3 })
      app.mockInput.pressKey("d", { ctrl: true })
      await app.waitForFrame((frame) => frame.includes("again to confirm"))
      expect(app.captureCharFrame()).not.toContain("Hello from the staging installation")
    } finally {
      app.renderer.destroy()
    }
  })
})
