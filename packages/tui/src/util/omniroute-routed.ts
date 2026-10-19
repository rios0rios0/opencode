export type RoutedInfo = {
  model?: string
  provider?: string
  decision?: string
  cost?: string
  tokensIn?: number
  tokensOut?: number
  latencyMs?: number
  cacheHit?: boolean
  costSaved?: string
  fallbackAttempts?: number
  requestID?: string
  version?: string
}

/**
 * The routed gateway result stored on an assistant message's provider state by the provider
 * route. Values are read defensively: anything a provider did not report stays absent, never
 * zero or unlimited.
 */
export function routedInfo(state: Record<string, unknown> | undefined): RoutedInfo | undefined {
  const value = state?.routed
  if (typeof value !== "object" || value === null) return undefined
  const record = value as Record<string, unknown>
  const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : undefined)
  const number = (key: string) => (typeof record[key] === "number" ? (record[key] as number) : undefined)
  const boolean = (key: string) => (typeof record[key] === "boolean" ? (record[key] as boolean) : undefined)
  const info: RoutedInfo = {
    model: text("model"),
    provider: text("provider"),
    decision: text("decision"),
    cost: text("cost"),
    tokensIn: number("tokensIn"),
    tokensOut: number("tokensOut"),
    latencyMs: number("latencyMs"),
    cacheHit: boolean("cacheHit"),
    costSaved: text("costSaved"),
    fallbackAttempts: number("fallbackAttempts"),
    requestID: text("requestID"),
    version: text("version"),
  }
  if (info.model === undefined && info.provider === undefined && info.decision === undefined) return undefined
  return info
}

/** `provider/model` when either half is known, e.g. `nvidia/z-ai/glm-5.3`. */
export function routedLabel(routed: RoutedInfo) {
  return [routed.provider, routed.model].filter((value): value is string => Boolean(value)).join("/")
}

/** Factual telemetry lines for the message details; only what the gateway reported appears. */
export function routedDetails(routed: RoutedInfo) {
  const details: string[] = []
  if (routed.decision) details.push(routed.decision)
  const tokens = [
    routed.tokensIn !== undefined ? `in ${routed.tokensIn}` : "",
    routed.tokensOut !== undefined ? `out ${routed.tokensOut}` : "",
  ]
    .filter(Boolean)
    .join(" ")
  if (tokens) details.push(`${tokens} tokens`)
  if (routed.cost !== undefined) details.push(`cost ${routed.cost}`)
  if (routed.latencyMs !== undefined) details.push(`latency ${routed.latencyMs} ms`)
  if (routed.cacheHit !== undefined)
    details.push(routed.cacheHit ? `cache hit${routed.costSaved ? ` (saved ${routed.costSaved})` : ""}` : "cache miss")
  if (routed.fallbackAttempts !== undefined)
    details.push(`${routed.fallbackAttempts} fallback${routed.fallbackAttempts === 1 ? "" : "s"}`)
  if (routed.requestID) details.push(`request ${routed.requestID}`)
  if (routed.version) details.push(routed.version)
  return details
}
