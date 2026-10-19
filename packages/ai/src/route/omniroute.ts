export type OmniRouteRouted = Record<string, string | number | boolean>

const OMNIROUTE_HEADERS = {
  model: "x-omniroute-model",
  provider: "x-omniroute-provider",
  decision: "x-omniroute-decision",
  cost: "x-omniroute-response-cost",
  tokensIn: "x-omniroute-tokens-in",
  tokensOut: "x-omniroute-tokens-out",
  latencyMs: "x-omniroute-latency-ms",
  cacheHit: "x-omniroute-cache-hit",
  costSaved: "x-omniroute-cost-saved",
  fallbackAttempts: "x-omniroute-fallback-attempts",
  requestID: "x-omniroute-request-id",
  version: "x-omniroute-version",
} as const

/**
 * The routed result of one OmniRoute gateway response, read from the documented `X-OmniRoute-*`
 * response headers. Only the safe-to-display set is kept, and values that do not parse are
 * omitted rather than invented: a missing header never renders as zero or unlimited.
 */
export function omniRouteRouted(headers: Record<string, string> | undefined): OmniRouteRouted | undefined {
  if (headers === undefined) return undefined
  const values = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]))
  let present = false
  const routed: OmniRouteRouted = {}
  for (const [key, name] of Object.entries(OMNIROUTE_HEADERS)) {
    const value = values.get(name)
    if (value === undefined || value === "") continue
    present = true
    if (key === "tokensIn" || key === "tokensOut" || key === "latencyMs" || key === "fallbackAttempts") {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) routed[key] = parsed
    } else if (key === "cacheHit") {
      if (value === "true") routed[key] = true
      else if (value === "false") routed[key] = false
    } else {
      routed[key] = value
    }
  }
  return present ? routed : undefined
}
