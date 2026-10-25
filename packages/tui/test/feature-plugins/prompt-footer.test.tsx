/** @jsxImportSource @opentui/solid */
import { afterEach, beforeEach, expect, test } from "bun:test"
import { RGBA, TextRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSignal } from "solid-js"
import { footerBarLayout, PromptFooter, quotaSegments } from "../../src/feature-plugins/prompt/footer"
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

test("prompt footer renders the selected OmniRoute model's quota instead of the local plan", async () => {
  await writePlanUsage({ five: 20, seven: 83 })
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      Response.json({
        model: { providerID: "omniroute", modelID: "openai/gpt-5.6" },
        resolved: { providerID: "openai", modelID: "gpt-5.6" },
        scope: { type: "upstream-account-plan", providerID: "openai", route: null },
        status: "available",
        plan: "Max",
        windows: [
          { period: "5h", windowName: "session", status: "available", usedPercentage: 42, remainingPercentage: 58 },
          { period: "7d", windowName: "weekly", status: "available", usedPercentage: 12 },
          { period: "30d", windowName: "monthly", status: "available", usedPercentage: 3 },
          { period: "fable", windowName: "fable", displayName: "Fable", status: "available", usedPercentage: 43 },
        ],
        updatedAt: "2026-10-19T12:00:00.000Z",
      }),
  })
  const app = await testRender(
    () => (
      <PromptFooter
        context={footerContext({
          current: { providerID: "omniroute", modelID: "openai/gpt-5.6" },
          models: [modelInfo({ providerID: "omniroute", id: "openai/gpt-5.6", name: "GPT-5.6" })],
          providers: [quotaProvider(server.url.toString())],
          messages: [assistantMessage()],
        })}
        sessionID="session"
        mode="normal"
        showDetails
      />
    ),
    { width: 200, height: 1 },
  )

  try {
    const frame = await renderUntil(app, (value) => value.includes("5h 42%"))
    expect(frame).toContain("7d 12%")
    expect(frame).toContain("30d 3%")
    expect(frame).toContain("Fable 43%")
    // The local Claude/Fable plan cache describes the direct account, not the
    // gateway route, so it is never shown as this model's limits.
    await Bun.sleep(25)
    await app.renderOnce()
    const settled = app.captureCharFrame()
    expect(settled).not.toContain("5h 20%")
    expect(settled).not.toContain("7d 83%")
    expect(settled).not.toContain("sekret-key")
  } finally {
    app.renderer.destroy()
    server.stop(true)
  }
})

test("prompt footer shows loading instead of the previous reading and omits unreadable windows", async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const server = Bun.serve({
    port: 0,
    fetch: async () => {
      await gate
      return Response.json({
        status: "partial",
        windows: [
          {
            period: "5h",
            windowName: "session",
            status: "stale",
            usedPercentage: 42,
            resetsAt: "2026-10-19T17:00:00.000Z",
          },
          { period: "7d", windowName: "weekly", status: "available", usedPercentage: 12 },
          { period: "30d", windowName: "monthly", status: "unavailable" },
        ],
        updatedAt: "2026-10-19T12:00:00.000Z",
      })
    },
  })
  const app = await testRender(
    () => (
      <PromptFooter
        context={footerContext({
          current: { providerID: "omniroute", modelID: "openai/gpt-5.6" },
          models: [modelInfo({ providerID: "omniroute", id: "openai/gpt-5.6", name: "GPT-5.6" })],
          providers: [quotaProvider(server.url.toString())],
          messages: [assistantMessage()],
        })}
        sessionID="session"
        mode="normal"
        showDetails
      />
    ),
    { width: 200, height: 1 },
  )

  try {
    const loading = await renderUntil(app, (value) => value.includes("quota …"))
    expect(loading).not.toContain("5h 42%")
    release()
    const frame = await renderUntil(app, (value) => value.includes("5h 42%"))
    expect(frame).toContain("7d 12%")
    expect(frame).not.toContain("quota …")
    // The gateway reported no reading for the 30d window; nothing is drawn for it.
    expect(frame).not.toContain("30d")
  } finally {
    app.renderer.destroy()
    server.stop(true)
  }
})

test("prompt footer drops the previous model's quota as soon as the selection changes", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const model = new URL(request.url).searchParams.get("model")
      return Response.json({
        status: "available",
        windows: [
          { period: "5h", windowName: "session", status: "available", usedPercentage: model === "first" ? 11 : 22 },
        ],
        updatedAt: "2026-10-19T12:00:00.000Z",
      })
    },
  })
  const [current, setCurrent] = createSignal({ providerID: "omniroute", modelID: "first" })
  const app = await testRender(
    () => (
      <PromptFooter
        context={footerContext({
          current: () => current(),
          models: [
            modelInfo({ providerID: "omniroute", id: "first", name: "First" }),
            modelInfo({ providerID: "omniroute", id: "second", name: "Second" }),
          ],
          providers: [quotaProvider(server.url.toString())],
          messages: [assistantMessage()],
        })}
        sessionID="session"
        mode="normal"
        showDetails
      />
    ),
    { width: 200, height: 1 },
  )

  try {
    expect(await renderUntil(app, (value) => value.includes("5h 11%"))).toContain("5h 11%")
    setCurrent({ providerID: "omniroute", modelID: "second" })
    // The old reading is gone before the new one arrives.
    expect(await renderUntil(app, (value) => !value.includes("5h 11%"))).not.toContain("5h 11%")
    const next = await renderUntil(app, (value) => value.includes("5h 22%"))
    expect(next).not.toContain("quota …")
  } finally {
    app.renderer.destroy()
    server.stop(true)
  }
})

test("quota segments dim stale readings and never label missing data", () => {
  const active = RGBA.fromInts(10, 200, 10)
  const dimmed = RGBA.fromInts(80, 80, 80)
  const feedback = (color: RGBA) => ({ base: color, muted: color })
  const success = active
  const warning = RGBA.fromInts(220, 180, 10)
  const error = RGBA.fromInts(220, 20, 20)
  const theme = {
    text: {
      base,
      muted: subdued,
      faint: subdued,
      feedback: { success: feedback(success), warning: feedback(warning), error: feedback(error) },
    },
    decrease: () => dimmed,
  } as unknown as Context["theme"]

  const segments = quotaSegments(
    {
      state: "ready",
      key: "k",
      quota: {
        status: "partial",
        windows: [
          { period: "5h", status: "available", usedPercentage: 42 },
          { period: "7d", status: "stale", usedPercentage: 83 },
          { period: "weekly", status: "available", usedPercentage: 65 },
          { period: "30d", status: "available", usedPercentage: 80 },
          { period: "bonus", windowName: "bonus", status: "available" },
        ],
      },
    },
    theme,
  )
  expect(segments.map((segment) => segment.spans[0].text)).toEqual(["5h 42%", "7d 83%", "weekly 65%", "30d 80%"])
  // OmniRoute uses remaining capacity: >50 green, 21–50 yellow, ≤20 red.
  expect(segments[0].spans[0].fg).toBe(success)
  expect(segments[1].spans[0].fg).toBe(dimmed)
  expect(segments[2].spans[0].fg).toBe(warning)
  expect(segments[3].spans[0].fg).toBe(error)
  expect(quotaSegments({ state: "loading", key: "k" }, theme)[0].spans[0].text).toBe("quota …")
  expect(quotaSegments({ state: "idle" }, theme)).toEqual([])
  const unlimited = quotaSegments(
    {
      state: "ready",
      key: "k",
      quota: { status: "available", windows: [{ period: "5h", status: "available", unlimited: true }] },
    },
    theme,
  )
  expect(unlimited[0].spans[0].text).toBe("5h unlimited")
})

function quotaProvider(url: string) {
  return { id: "omniroute", name: "OmniRoute", settings: { baseURL: `${url}v1`, apiKey: "sekret-key" } }
}

function modelInfo(input?: { providerID?: string; id?: string; name?: string }) {
  const id = input?.id ?? "model"
  return {
    providerID: input?.providerID ?? "provider",
    id,
    modelID: id,
    name: input?.name ?? "Test Model",
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
  current?: { providerID: string; modelID: string } | (() => { providerID: string; modelID: string } | undefined)
  models?: unknown[]
  providers?: unknown[]
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
    ui: { model: { current: () => (typeof input.current === "function" ? input.current() : input.current) } },
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
      location: {
        model: { list: () => input.models ?? [] },
        provider: { list: () => input.providers ?? [] },
      },
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
