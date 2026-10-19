import { expect, test } from "bun:test"
import {
  modelQuotaUrl,
  parseModelQuota,
  quotaWindows,
  readModelQuota,
  windowPercent,
  type ModelQuota,
} from "../../src/util/model-quota"

test("modelQuotaUrl targets the documented endpoint and keeps the key out of the URL", () => {
  expect(modelQuotaUrl("http://127.0.0.1:20128/v1", "auto/coding")).toBe(
    "http://127.0.0.1:20128/api/v1/quota?model=auto%2Fcoding",
  )
  expect(modelQuotaUrl("http://127.0.0.1:20128/v1/", "gpt-5")).toBe("http://127.0.0.1:20128/api/v1/quota?model=gpt-5")
  expect(modelQuotaUrl("https://gateway.test:8443", "openai/gpt-5")).toBe(
    "https://gateway.test:8443/api/v1/quota?model=openai%2Fgpt-5",
  )
  expect(modelQuotaUrl("not a url", "m")).toBeUndefined()
  expect(modelQuotaUrl("ftp://gateway.test", "m")).toBeUndefined()
})

test("parseModelQuota keeps only readings the answer actually carries", () => {
  const quota = parseModelQuota({
    status: "partial",
    plan: "Max",
    windows: [
      {
        period: "5h",
        windowName: "session",
        status: "available",
        usedPercentage: 42,
        remainingPercentage: 58,
        resetsAt: "2026-10-19T17:00:00.000Z",
        source: "provider-limits",
      },
      { period: "30d", status: "unsupported" },
      { windowName: "weekly", status: "available" },
      { period: "7d", status: "invented", usedPercentage: Number.POSITIVE_INFINITY as unknown as number },
      "nope",
    ],
    routes: [
      {
        providerID: "claude",
        modelID: "claude-sonnet-4-5",
        status: "available",
        windows: [{ period: "7d", status: "available", remainingPercentage: 88 }],
      },
    ],
    updatedAt: "2026-10-19T12:00:00.000Z",
  })

  expect(quota?.status).toBe("partial")
  expect(quota?.plan).toBe("Max")
  expect(quota?.windows.map((window) => window.period)).toEqual(["5h", "30d", "7d"])
  expect(quota?.windows[0].usedPercentage).toBe(42)
  expect(quota?.windows[0].resetsAt).toBe("2026-10-19T17:00:00.000Z")
  // An unrecognized window status is not evidence of a reading.
  expect(quota?.windows[2].status).toBe("unavailable")
  expect(quota?.windows[2].usedPercentage).toBeUndefined()
  expect(quota?.routes?.[0].providerID).toBe("claude")
  expect(quota?.routes?.[0].windows[0].remainingPercentage).toBe(88)

  expect(parseModelQuota({ status: "nonsense" })).toBeUndefined()
  expect(parseModelQuota(null)).toBeUndefined()
  expect(parseModelQuota("{}")).toBeUndefined()
})

test("quotaWindows reports a single account directly and collapses same-provider routes to the worst reading", () => {
  const direct = quotaWindows({
    status: "available",
    windows: [{ period: "5h", status: "available", usedPercentage: 42 }],
  })
  expect(direct.map((window) => window.period)).toEqual(["5h"])

  const merged = quotaWindows({
    status: "partial",
    windows: [],
    routes: [
      {
        providerID: "claude",
        modelID: "claude-sonnet-4-5",
        status: "available",
        windows: [{ period: "5h", status: "available", usedPercentage: 10 }],
      },
      {
        providerID: "claude",
        modelID: "claude-opus-4-6",
        status: "available",
        windows: [
          { period: "5h", status: "available", usedPercentage: 62 },
          { period: "7d", status: "unavailable" },
        ],
      },
    ],
  })
  expect(merged.length).toBe(1)
  expect(windowPercent(merged[0])).toBe(62)

  // A route that mixes providers has no single honest number to show.
  expect(
    quotaWindows({
      status: "partial",
      windows: [],
      routes: [
        { providerID: "claude", modelID: null, status: "available", windows: [{ period: "5h", status: "available", usedPercentage: 10 }] },
        { providerID: "openai", modelID: null, status: "available", windows: [{ period: "5h", status: "available", usedPercentage: 20 }] },
      ],
    }),
  ).toEqual([])

  expect(quotaWindows({ status: "unsupported", windows: [] })).toEqual([])
})

test("windowPercent reads percentages only from the reported values", () => {
  expect(windowPercent({ period: "5h", status: "available", usedPercentage: 42 })).toBe(42)
  expect(windowPercent({ period: "5h", status: "available", used: 1, limit: 4 })).toBe(25)
  expect(windowPercent({ period: "5h", status: "available", remainingPercentage: 12 })).toBe(88)
  expect(windowPercent({ period: "5h", status: "available", remaining: 3, limit: 4 })).toBe(25)
  // A window without a reading is absent, never zero or unlimited.
  expect(windowPercent({ period: "5h", status: "available" })).toBeUndefined()
  expect(windowPercent({ period: "5h", status: "available", used: 5 })).toBeUndefined()
  expect(windowPercent({ period: "5h", status: "available", limit: 0, used: 0 })).toBeUndefined()
})

test("readModelQuota sends the key as a header, never in the URL", async () => {
  const seen: { url?: string; authorization?: string } = {}
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url)
      seen.url = `${url.pathname}${url.search}`
      seen.authorization = request.headers.get("authorization") ?? undefined
      return Response.json({
        status: "available",
        plan: "Max",
        windows: [{ period: "5h", status: "available", usedPercentage: 42 }],
        updatedAt: "2026-10-19T12:00:00.000Z",
      })
    },
  })
  try {
    const quota = await readModelQuota({ baseURL: `${server.url}v1`, apiKey: "sekret-key", modelID: "openai/gpt-5" })
    expect(seen.url).toBe("/api/v1/quota?model=openai%2Fgpt-5")
    expect(seen.authorization).toBe("Bearer sekret-key")
    expect(quota?.windows[0].usedPercentage).toBe(42)
  } finally {
    server.stop(true)
  }
})

test("readModelQuota treats a failing or malformed answer as absent", async () => {
  const failing = Bun.serve({ port: 0, fetch: () => new Response("nope", { status: 500 }) })
  const malformed = Bun.serve({ port: 0, fetch: () => new Response("<html></html>", { status: 200 }) })
  try {
    expect(await readModelQuota({ baseURL: `${failing.url}v1`, modelID: "m" })).toBeUndefined()
    expect(await readModelQuota({ baseURL: `${malformed.url}v1`, modelID: "m" })).toBeUndefined()
    expect(await readModelQuota({ baseURL: "not a url", modelID: "m" })).toBeUndefined()
    expect(await readModelQuota({ baseURL: "http://127.0.0.1:1/v1", modelID: "m" })).toBeUndefined()
  } finally {
    failing.stop(true)
    malformed.stop(true)
  }
})

test("quotaWindows keeps at most one window per period", () => {
  const quota: ModelQuota = {
    status: "partial",
    windows: [],
    routes: [
      { providerID: "codex", modelID: "gpt-5", status: "partial", windows: [{ period: "5h", status: "stale", usedPercentage: 90 }] },
      { providerID: "codex", modelID: "gpt-5-mini", status: "available", windows: [{ period: "5h", status: "available", usedPercentage: 30 }] },
    ],
  }
  const windows = quotaWindows(quota)
  expect(windows.length).toBe(1)
  expect(windows[0].period).toBe("5h")
  expect(windowPercent(windows[0])).toBe(90)
})
