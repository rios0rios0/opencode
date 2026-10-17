/** @jsxImportSource @opentui/solid */
import { afterEach, beforeEach, expect, test } from "bun:test"
import { RGBA, TextRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSignal } from "solid-js"
import { footerBarLayout, PromptFooter } from "../../src/feature-plugins/prompt/footer"
import { localIdentity, parsePlanUsage } from "../../src/util/plan-usage"

const base = RGBA.fromInts(200, 200, 200)
const subdued = RGBA.fromInts(100, 100, 100)

/** The harness directory is not a git repository, so the email segment stays empty in tests. */
const workspace = "/workspace"

const previousConfigDir = process.env.CLAUDE_CONFIG_DIR
let configDir: string

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "opencode-plan-usage-"))
  process.env.CLAUDE_CONFIG_DIR = configDir
})

afterEach(async () => {
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  await rm(configDir, { recursive: true, force: true })
})

test("footer bar layout keeps higher priorities and skips segments that no longer fit", () => {
  const segments = [
    { id: "low", priority: 1, width: 10, spans: [] },
    { id: "high", priority: 2, width: 10, spans: [] },
  ]
  expect([...footerBarLayout(segments, 10).keys()]).toEqual(["high"])
  expect([...footerBarLayout(segments, 22).keys()]).toEqual(["high"])
  expect([...footerBarLayout(segments, 23).keys()]).toEqual(["high", "low"])

  const tail = [{ id: "detail", priority: 2, width: 4, spans: [], tail: [{ text: " tail", fg: base }] }]
  expect(footerBarLayout(tail, 3).get("detail")).toBeUndefined()
  expect(footerBarLayout(tail, 4).get("detail")).toBe("core")
  expect(footerBarLayout(tail, 8).get("detail")).toBe("core")
  expect(footerBarLayout(tail, 9).get("detail")).toBe("full")

  const cores = [
    { id: "big", priority: 2, width: 4, spans: [], tail: [{ text: " tail", fg: base }] },
    { id: "small", priority: 1, width: 4, spans: [] },
  ]
  expect([...footerBarLayout(cores, 11).entries()]).toEqual([
    ["big", "core"],
    ["small", "core"],
  ])
})

test("plan usage reads the status line cache", () => {
  const usage = parsePlanUsage(
    [
      "fetched=1700000000",
      "account=user@example.com",
      "five=20",
      "five_at=1700003600",
      "seven=83",
      "seven_at=1700604800",
      "scoped=Fable:43:1700007200|Opus:12:",
    ].join("\n"),
  )
  expect(usage).toEqual({
    fetched: 1700000000,
    account: "user@example.com",
    five: { percent: 20, resetsAt: 1700003600 },
    seven: { percent: 83, resetsAt: 1700604800 },
    scoped: [
      { name: "Fable", percent: 43, resetsAt: 1700007200 },
      { name: "Opus", percent: 12, resetsAt: undefined },
    ],
  })
  expect(parsePlanUsage("")).toBeUndefined()
  expect(parsePlanUsage("five=20")).toBeUndefined()
})

test("prompt footer draws identity, context, plan limits, cost, and live work", async () => {
  await writePlanUsage({ five: 20, seven: 83, scoped: { Fable: 43 } })
  const dispatched: string[] = []
  const app = await testRender(
    () => (
      <PromptFooter
        context={footerContext({
          current: { providerID: "provider", modelID: "model" },
          models: [modelInfo()],
          messages: [assistantMessage()],
          cost: 1,
          family: ["session", "child"],
          running: ["child"],
          shells: [{ metadata: { sessionID: "session" } }],
          shortcuts: {
            "session.child.first": ["ctrl+j"],
            "agent.cycle": ["shift+tab"],
            "command.palette.show": ["ctrl+p"],
          },
          dispatched,
        })}
        sessionID="session"
        mode="normal"
        showDetails
      />
    ),
    { width: 220, height: 2 },
  )

  try {
    const frame = await renderUntil(app, (value) => value.includes("Test Model") && value.includes("5h 20%"))
    const identity = localIdentity()
    if (identity) expect(frame).toContain(identity)
    expect(frame).toContain("Test Model")
    expect(frame).toContain("ctx 90% left (1.0K/10.0K)")
    expect(frame).toContain("5h 20%")
    expect(frame).toContain("7d 83%")
    expect(frame).toContain("Fable 43%")
    expect(frame).toContain("$1.00")
    expect(frame).toContain("ctrl+j 1 subagent · 1 shell")
    expect(frame).toContain("ctrl+p commands")

    const live = app.renderer.root.findDescendantById("prompt.footer.live") as TextRenderable
    await app.mockMouse.moveTo(live.x + 1, live.y)
    expect(live.fg.toInts()).toEqual(base.toInts())

    await app.mockMouse.click(live.x + 1, live.y)
    expect(dispatched).toEqual(["session.child.first"])
  } finally {
    app.renderer.destroy()
  }
})

test("prompt footer drops lower-priority segments on narrow terminals", async () => {
  await writePlanUsage({ five: 20, seven: 83 })
  const app = await testRender(
    () => (
      <PromptFooter
        context={footerContext({
          current: { providerID: "provider", modelID: "model" },
          models: [modelInfo()],
          messages: [assistantMessage()],
          cost: 1,
          family: ["session", "child"],
          running: ["child"],
          shells: [{ metadata: { sessionID: "session" } }],
          shortcuts: {
            "session.child.first": ["ctrl+j"],
            "agent.cycle": ["shift+tab"],
            "command.palette.show": ["ctrl+p"],
          },
        })}
        sessionID="session"
        mode="normal"
        showDetails
      />
    ),
    { width: 100, height: 2 },
  )

  try {
    const frame = await renderUntil(app, (value) => value.includes("Test Model") && value.includes("5h 20%"))
    expect(frame).toContain("ctx 90% left (1.0K/10.0K)")
    expect(frame).toContain("5h 20%")
    expect(frame).toContain("7d 83%")
    expect(frame).toContain("ctrl+p commands")
    expect(frame).not.toContain("7d 83% (")
    expect(frame).not.toContain("Fable 43%")
    expect(frame).not.toContain("$1.00")
    expect(frame).not.toContain("subagent")
  } finally {
    app.renderer.destroy()
  }
})

test("prompt footer hides details and keeps live work", async () => {
  const context = footerContext({
    current: { providerID: "provider", modelID: "model" },
    models: [modelInfo()],
    messages: [assistantMessage()],
    family: ["session", "child"],
    running: ["child"],
    shells: [{ metadata: { sessionID: "session" } }],
    shortcuts: {
      "session.child.first": ["ctrl+j"],
      "agent.cycle": ["shift+tab"],
      "command.palette.show": ["ctrl+p"],
    },
  })
  const [showDetails, setShowDetails] = createSignal(true)
  const [sessionID, setSessionID] = createSignal<string | undefined>("session")
  const app = await testRender(
    () => (
      <box width="100%" flexDirection="row" justifyContent="space-between" gap={2}>
        <PromptFooter context={context} sessionID={sessionID()} mode="normal" showDetails={showDetails()} />
      </box>
    ),
    { width: 80, height: 1 },
  )

  try {
    expect(await renderUntil(app, (value) => value.includes("Test Model"))).toContain("ctx 90% left")

    setShowDetails(false)
    await app.renderOnce()
    const details = app.captureCharFrame()
    expect(details).not.toContain("Test Model")
    expect(details).not.toContain("ctrl+p commands")
    expect(details).toContain("ctrl+j 1 subagent · 1 shell")

    setSessionID(undefined)
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("subagent")
  } finally {
    app.renderer.destroy()
  }
})

test("prompt footer shows the exit hint in shell mode", async () => {
  const app = await testRender(
    () => <PromptFooter context={footerContext({})} sessionID="session" mode="shell" showDetails />,
    { width: 80, height: 1 },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("exit shell mode")
  } finally {
    app.renderer.destroy()
  }
})

function modelInfo() {
  return {
    providerID: "provider",
    id: "model",
    modelID: "model",
    name: "Test Model",
    limit: { context: 10_000 },
  }
}

async function writePlanUsage(input: { five: number; seven: number; scoped?: Record<string, number> }) {
  const now = Math.floor(Date.now() / 1000)
  await writeFile(
    join(configDir, "statusline-usage.cache"),
    [
      `fetched=${now}`,
      "account=test@example.com",
      `five=${input.five}`,
      `five_at=${now + 3600}`,
      `seven=${input.seven}`,
      `seven_at=${now + 86400}`,
      ...Object.entries(input.scoped ?? {}).map(([name, percent]) => `scoped=${name}:${percent}:${now + 7200}`),
    ].join("\n"),
  )
}

function assistantMessage() {
  return {
    id: "message",
    type: "assistant",
    model: { providerID: "provider", id: "model" },
    tokens: { input: 1_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

function footerContext(input: {
  current?: { providerID: string; modelID: string }
  models?: unknown[]
  messages?: unknown[]
  cost?: number
  family?: string[]
  running?: string[]
  shells?: unknown[]
  shortcuts?: Record<string, string[]>
  dispatched?: string[]
}) {
  const shortcuts = input.shortcuts ?? {}
  return {
    location: { directory: workspace },
    theme: testTheme(),
    ui: { model: { current: () => input.current } },
    keymap: {
      shortcuts: (id: string) => shortcuts[id] ?? [],
      dispatch: (id: string) => input.dispatched?.push(id),
    },
    data: {
      session: {
        family: () => input.family ?? ["session"],
        status: (id: string) => ((input.running ?? []).includes(id) ? "running" : "idle"),
        get: () => ({ id: "session", location: { directory: workspace } }),
        cost: () => input.cost ?? 0,
        message: { list: () => input.messages ?? [] },
      },
      shell: { list: () => input.shells ?? [] },
      location: { model: { list: () => input.models ?? [] } },
    },
  } as unknown as Context
}

function testTheme() {
  const feedback = (color: RGBA) => ({ base: color, muted: color })
  return {
    text: {
      base,
      muted: subdued,
      faint: subdued,
      feedback: {
        success: feedback(RGBA.fromInts(110, 160, 220)),
        warning: feedback(RGBA.fromInts(230, 90, 90)),
        error: feedback(RGBA.fromInts(220, 120, 120)),
        info: feedback(RGBA.fromInts(90, 180, 190)),
      },
      action: { primary: { disabled: subdued } },
    },
    decrease: (color: RGBA) => color,
  }
}

type FooterApp = { renderOnce: () => Promise<void>; captureCharFrame: () => string }

async function renderUntil(app: FooterApp, predicate: (frame: string) => boolean) {
  const deadline = Date.now() + 1000
  let frame = app.captureCharFrame()
  while (Date.now() < deadline) {
    await app.renderOnce()
    frame = app.captureCharFrame()
    if (predicate(frame)) return frame
    await Bun.sleep(5)
  }
  return frame
}
