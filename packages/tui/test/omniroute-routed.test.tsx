import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"
import { routedDetails, routedInfo, routedLabel } from "../src/util/omniroute-routed"

test("routedInfo reads only the fields the gateway reported", () => {
  expect(routedInfo(undefined)).toBeUndefined()
  expect(routedInfo({})).toBeUndefined()
  expect(routedInfo({ routed: "nonsense" })).toBeUndefined()
  expect(
    routedInfo({
      routed: {
        model: "glm-5.3",
        provider: "nvidia",
        connection: "Codex Work",
        decision: "strategy=cost-saver; provider=nvidia; latency_ms=812",
        tokensIn: 120,
        tokensOut: "not-a-number",
        cacheHit: false,
        fallbackAttempts: 2,
      },
    }),
  ).toEqual({
    model: "glm-5.3",
    provider: "nvidia",
    connection: "Codex Work",
    decision: "strategy=cost-saver; provider=nvidia; latency_ms=812",
    tokensIn: 120,
    cacheHit: false,
    fallbackAttempts: 2,
    tokensOut: undefined,
    cost: undefined,
    latencyMs: undefined,
    costSaved: undefined,
    requestID: undefined,
    version: undefined,
  })
})

test("routedLabel and routedDetails stay factual", () => {
  const routed = routedInfo({
    routed: {
      model: "z-ai/glm-5.3",
      provider: "nvidia",
      decision: "strategy=cost-saver; provider=nvidia; latency_ms=812",
      cost: "0.0042100000",
      cacheHit: true,
      costSaved: "0.0001",
      requestID: "req_abc",
      version: "v3.8.52",
    },
  })!
  expect(routedLabel(routed)).toBe("nvidia/z-ai/glm-5.3")
  expect(routedDetails(routed)).toEqual([
    "strategy=cost-saver; provider=nvidia; latency_ms=812",
    "cost 0.0042100000",
    "cache hit (saved 0.0001)",
    "request req_abc",
    "v3.8.52",
  ])
})

test("routedInfo omits empty or malformed connection labels", () => {
  expect(routedInfo({ routed: { connection: "  " } })).toBeUndefined()
  expect(routedInfo({ routed: { connection: 17 } })).toBeUndefined()
  expect(routedInfo({ routed: { connection: "  Codex Work  " } })?.connection).toBe("Codex Work")
})

const location = { directory, project: { id: "project", directory, canonical: directory } }

async function routedFixture(input: { messages: unknown[]; state: string; sessionID: string }) {
  const session = {
    id: input.sessionID,
    projectID: "project",
    title: "Routed fixture",
    agent: "build",
    model: { providerID: "demo", id: "first" },
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const setup = await createAppFixture({
    state: input.state,
    width: 160,
    args: { sessionID: input.sessionID },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: async (url) => {
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
      if (url.pathname === `/api/session/${input.sessionID}`) return json({ data: session })
      if (url.pathname === `/api/session/${input.sessionID}/message`) return json({ data: input.messages, cursor: {} })
      if (url.pathname === `/api/session/${input.sessionID}/inbox`) return json({ data: [] })
      if (url.pathname === `/api/session/${input.sessionID}/permission`) return json({ data: [] })
      return undefined
    },
  })
  await setup.ready
  return {
    ...setup,
    async [Symbol.asyncDispose]() {
      await setup[Symbol.asyncDispose]()
    },
  }
}

function assistant(input: {
  sessionID: string
  id: string
  created: number
  text: string
  native?: Record<string, unknown>
}) {
  return {
    id: input.id,
    sessionID: input.sessionID,
    type: "assistant",
    agent: "build",
    model: { providerID: "demo", id: "first" },
    time: { created: input.created, completed: input.created + 1 },
    finish: "stop",
    content: [{ type: "text", text: input.text }],
    ...(input.native === undefined ? {} : { native: input.native }),
  }
}

test("each step keeps its own routed model and the status bar shows the latest", async () => {
  await using state = await tmpdir()
  const sessionID = `ses_${crypto.randomUUID()}`
  await using fixture = await routedFixture({
    state: state.path,
    sessionID,
    // The server lists messages newest-first, like the real message endpoint.
    messages: [
      assistant({
        sessionID,
        id: "msg_second",
        created: 2,
        text: "second answer",
        native: { routed: { model: "deepseek-v4", provider: "openrouter", connection: "OpenAI Personal" } },
      }),
      assistant({
        sessionID,
        id: "msg_first",
        created: 1,
        text: "first answer",
        native: {
          routed: { model: "glm-5.3", provider: "nvidia", fallbackAttempts: 1, decision: "strategy=cost-saver" },
        },
      }),
    ],
  })
  await fixture.waitForFrame((frame) => frame.includes("first answer"))

  const frame = fixture.captureCharFrame()
  // The fallback step is visible as a fallback, never as a direct route.
  expect(frame).toContain("routed: nvidia/glm-5.3 (1 fallback)")
  // The newest step's routed result appears in its own footer and in the status bar, and the
  // first step's attribution never follows the second one.
  expect(frame).toContain("routed: openrouter/deepseek-v4")
  expect(frame).toContain("OpenAI Personal")
  expect(frame.split("routed: nvidia/glm-5.3").length - 1).toBe(1)
})

test("responses without OmniRoute headers show only the selected model", async () => {
  await using state = await tmpdir()
  const sessionID = `ses_${crypto.randomUUID()}`
  await using fixture = await routedFixture({
    state: state.path,
    sessionID,
    messages: [assistant({ sessionID, id: "msg_plain", created: 1, text: "plain answer" })],
  })
  await fixture.waitForFrame((frame) => frame.includes("plain answer"))
  expect(fixture.captureCharFrame()).not.toContain("routed:")
})

test("status bar hides routed metadata when it matches the selected model", async () => {
  await using state = await tmpdir()
  const sessionID = `ses_${crypto.randomUUID()}`
  await using fixture = await routedFixture({
    state: state.path,
    sessionID,
    messages: [
      assistant({
        sessionID,
        id: "msg_same",
        created: 1,
        text: "same model answer",
        native: { routed: { model: "first" } },
      }),
    ],
  })
  await fixture.waitForFrame((frame) => frame.includes("same model answer"))

  expect(fixture.captureCharFrame()).not.toContain("routed:")
})
