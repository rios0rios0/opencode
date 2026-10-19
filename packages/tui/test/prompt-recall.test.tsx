import { expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

const location = { directory, project: { id: "project", directory, canonical: directory } }

// Every test mounts its own session: the composer stash keeps one draft per session ID across mounts.
function recallSession() {
  return {
    id: `ses_${crypto.randomUUID()}`,
    projectID: "project",
    title: "Prompt recall fixture",
    agent: "build",
    model: { providerID: "demo", id: "first" },
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
}

type PendingPayload = { text: string; files?: unknown[]; agents?: unknown[] }

function pending(
  sessionID: string,
  input: { id: string; created: number; payload: PendingPayload; delivery?: "steer" | "queue" },
) {
  return {
    id: input.id,
    sessionID,
    type: "user",
    time: { created: input.created },
    payload: input.payload,
    delivery: input.delivery ?? "queue",
  }
}

async function recallFixture(input: {
  state: string
  session: ReturnType<typeof recallSession>
  pending: ReturnType<typeof pending>[]
  /** Answers the cancel request instead of acknowledging it; delivery/cancel races answer with an error. */
  cancel?: (inboxID: string) => Response
}) {
  const sessionID = input.session.id
  const cancellations: string[] = []
  const prompts: Record<string, unknown>[] = []
  const setup = await createAppFixture({
    state: input.state,
    args: { sessionID },
    config: { animations: false },
    fetch: async (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: [
            {
              id: "first",
              providerID: "demo",
              name: "first model",
              variants: [],
              cost: [],
              time: { released: 0 },
            },
          ],
        })
      if (url.pathname === `/api/session/${sessionID}`) return json({ data: input.session })
      if (url.pathname === "/api/fs/find") return json({ location, data: [] })
      if (url.pathname === `/api/session/${sessionID}/inbox`) return json({ data: input.pending })
      if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${sessionID}/permission`) return json({ data: [] })
      const inboxID = url.pathname.match(new RegExp(`^/api/session/${sessionID}/inbox/(.+)$`))?.[1]
      if (inboxID && request.method === "DELETE") {
        cancellations.push(inboxID)
        if (input.cancel) return input.cancel(inboxID)
        // The durable cancellation event retracts the local row, exactly as the server would.
        setup.events.emit({
          id: `evt_inbox_cancelled_${cancellations.length}`,
          created: 100 + cancellations.length,
          type: "session.inbox.cancelled",
          durable: { aggregateID: sessionID, seq: cancellations.length, version: 1 },
          data: { sessionID, inboxID },
        })
        return new Response(null, { status: 204 })
      }
      if (url.pathname === `/api/session/${sessionID}/prompt`) {
        const body = (await request.json()) as Record<string, unknown>
        prompts.push(body)
        return json({
          data: {
            id: body.id,
            sessionID,
            type: "user",
            time: { created: 200 },
            payload: { text: body.text },
            delivery: "steer",
          },
        })
      }
      return undefined
    },
  })
  await setup.ready
  return {
    ...setup,
    cancellations,
    prompts,
    async [Symbol.asyncDispose]() {
      await setup[Symbol.asyncDispose]()
    },
  }
}

async function seedHistory(state: string, texts: string[]) {
  await writeFile(
    path.join(state, "prompt-history.jsonl"),
    texts.map((text) => JSON.stringify({ text, files: [], agents: [], skills: [], pasted: [] })).join("\n") + "\n",
    "utf8",
  )
}

test("Up recalls undelivered prompts newest-first and falls back to history", async () => {
  await using state = await tmpdir()
  // Prompt text stays under the draft-retention limit so clearing it does not pollute history.
  await seedHistory(state.path, ["history recall"])
  const session = recallSession()
  await using fixture = await recallFixture({
    state: state.path,
    session,
    pending: [
      pending(session.id, { id: "msg_pending_old", created: 1, payload: { text: "queued one" } }),
      pending(session.id, { id: "msg_pending_new", created: 2, payload: { text: "queued two" } }),
    ],
  })
  await fixture.waitForFrame((frame) => frame.includes("2 queued"))

  fixture.mockInput.pressArrow("up")
  await fixture.waitForFrame((frame) => frame.includes("1 queued"))
  expect(fixture.renderer.currentFocusedEditor?.plainText).toBe("queued two")
  expect(fixture.cancellations).toEqual(["msg_pending_new"])

  fixture.mockInput.pressCtrlC()
  await fixture.waitFor(() => fixture.renderer.currentFocusedEditor?.plainText === "")

  fixture.mockInput.pressArrow("up")
  await fixture.waitFor(() => fixture.renderer.currentFocusedEditor?.plainText === "queued one")
  expect(fixture.cancellations).toEqual(["msg_pending_new", "msg_pending_old"])
  // The queue is empty again, so the dock is gone while the composer keeps the recalled prompt.
  await fixture.waitForFrame((frame) => !frame.includes("1 queued"))

  fixture.mockInput.pressCtrlC()
  await fixture.waitFor(() => fixture.renderer.currentFocusedEditor?.plainText === "")

  // Nothing is pending anymore, so Up walks history again.
  fixture.mockInput.pressArrow("up")
  await fixture.waitFor(() => fixture.renderer.currentFocusedEditor?.plainText === "history recall")
  expect(fixture.cancellations).toEqual(["msg_pending_new", "msg_pending_old"])
})

test("Up restores the full prompt payload of a recalled prompt", async () => {
  await using state = await tmpdir()
  const session = recallSession()
  const text = "review @notes.txt and use @build"
  await using fixture = await recallFixture({
    state: state.path,
    session,
    pending: [
      pending(session.id, {
        id: "msg_pending_files",
        created: 1,
        payload: {
          text,
          files: [
            {
              data: "",
              mime: "text/plain",
              source: { type: "uri", uri: "file:///tmp/opencode/notes.txt" },
              name: "notes.txt",
              mention: { start: 7, end: 17, text: "@notes.txt" },
            },
          ],
          agents: [{ name: "build", mention: { start: 26, end: 32, text: "@build" } }],
        },
      }),
    ],
  })
  await fixture.waitForFrame((frame) => frame.includes("1 queued"))

  fixture.mockInput.pressArrow("up")
  await fixture.waitFor(() => fixture.renderer.currentFocusedEditor?.plainText === text)
  expect(fixture.cancellations).toEqual(["msg_pending_files"])

  // Restoring mentions opens the file completion, exactly as the queued-prompt undo does; close it so
  // Enter submits the restored prompt instead of accepting a completion.
  fixture.mockInput.pressEscape()
  await fixture.waitForFrame((frame) => !frame.includes("Searching"))
  fixture.mockInput.pressEnter()
  await fixture.waitFor(() => fixture.prompts.length === 1)
  const body = fixture.prompts[0]!
  expect(body.text).toBe(text)
  expect(body.files).toMatchObject([
    {
      uri: "file:///tmp/opencode/notes.txt",
      name: "notes.txt",
      mention: { start: 7, end: 17, text: "@notes.txt" },
    },
  ])
  expect(body.agents).toEqual([{ name: "build", mention: { start: 26, end: 32, text: "@build" } }])
})

test("Up recalls a steered prompt that has not reached the model yet", async () => {
  await using state = await tmpdir()
  const session = recallSession()
  await using fixture = await recallFixture({
    state: state.path,
    session,
    pending: [
      pending(session.id, {
        id: "msg_pending_steer",
        created: 1,
        payload: { text: "steer me back" },
        delivery: "steer",
      }),
    ],
  })
  await fixture.waitForFrame((frame) => frame.includes("steer me back"))

  fixture.mockInput.pressArrow("up")
  await fixture.waitFor(() => fixture.renderer.currentFocusedEditor?.plainText === "steer me back")
  expect(fixture.cancellations).toEqual(["msg_pending_steer"])
  // The optimistic transcript row is retracted, leaving the text only in the composer.
  await fixture.waitForFrame(
    (frame) => frame.split("steer me back").length - 1 === 1 && frame.includes("Build · first model"),
  )
})

test("a failed cancellation keeps the prompt pending and restores nothing", async () => {
  await using state = await tmpdir()
  await seedHistory(state.path, ["history recall"])
  const session = recallSession()
  await using fixture = await recallFixture({
    state: state.path,
    session,
    pending: [pending(session.id, { id: "msg_pending_race", created: 1, payload: { text: "racy prompt" } })],
    cancel: () => json({ error: { message: "already delivered" } }, { status: 404 }),
  })
  await fixture.waitForFrame((frame) => frame.includes("1 queued"))

  fixture.mockInput.pressArrow("up")
  await fixture.waitForFrame((frame) => frame.includes("Failed to recall pending prompt"))
  expect(fixture.cancellations).toEqual(["msg_pending_race"])
  expect(fixture.renderer.currentFocusedEditor?.plainText).toBe("")

  // The prompt is still pending, so Up retries the cancellation instead of recalling history.
  fixture.mockInput.pressArrow("up")
  await fixture.waitFor(() => fixture.cancellations.length === 2)
  expect(fixture.renderer.currentFocusedEditor?.plainText).toBe("")
  expect(fixture.captureCharFrame()).toContain("1 queued")
})

test("Up keeps navigating a non-empty draft instead of recalling a prompt", async () => {
  await using state = await tmpdir()
  const session = recallSession()
  await using fixture = await recallFixture({
    state: state.path,
    session,
    pending: [pending(session.id, { id: "msg_pending_draft", created: 1, payload: { text: "queued prompt" } })],
  })
  await fixture.waitForFrame((frame) => frame.includes("1 queued"))

  await fixture.mockInput.typeText("first line")
  fixture.mockInput.pressEnter({ shift: true })
  await fixture.mockInput.typeText("second line")
  await fixture.waitFor(() => fixture.renderer.currentFocusedEditor?.plainText === "first line\nsecond line")
  const before = fixture.renderer.currentFocusedEditor?.cursorOffset ?? 0
  expect(before).toBeGreaterThan(0)

  fixture.mockInput.pressArrow("up")
  await fixture.waitFor(() => (fixture.renderer.currentFocusedEditor?.cursorOffset ?? before) < before)
  expect(fixture.cancellations).toEqual([])
  expect(fixture.renderer.currentFocusedEditor?.plainText).toBe("first line\nsecond line")
  expect(fixture.captureCharFrame()).toContain("1 queued")
})
