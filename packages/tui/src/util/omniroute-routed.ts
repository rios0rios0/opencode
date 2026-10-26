import { Locale } from "./locale"

export type RoutedInfo = {
  model?: string
  provider?: string
  connection?: string
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
 * The routed gateway result stored in an assistant message's native provider data by the
 * provider route. Values are read defensively: anything a provider did not report stays absent,
 * never zero or unlimited.
 */
export function routedInfo(state: Record<string, unknown> | undefined): RoutedInfo | undefined {
  const value = state?.routed
  if (typeof value !== "object" || value === null) return undefined
  const record = value as Record<string, unknown>
  const text = (key: string) => (typeof record[key] === "string" && record[key].trim() ? record[key].trim() : undefined)
  const number = (key: string) => (typeof record[key] === "number" ? (record[key] as number) : undefined)
  const boolean = (key: string) => (typeof record[key] === "boolean" ? (record[key] as boolean) : undefined)
  const info: RoutedInfo = {
    model: text("model"),
    provider: text("provider"),
    connection: text("connection"),
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
  if (
    info.model === undefined &&
    info.provider === undefined &&
    info.connection === undefined &&
    info.decision === undefined
  )
    return undefined
  return info
}

/** `provider/model` when either half is known, e.g. `nvidia/z-ai/glm-5.3`. */
export function routedLabel(routed: RoutedInfo) {
  return [routed.provider, routed.model].filter((value): value is string => Boolean(value)).join("/")
}

/**
 * Whether the routed result points at the same model the user selected/requested.
 *
 * The gateway reports the served model split into `provider` + `model`, while the
 * client may store the chosen model either split (`providerID` + `id`) or as a
 * single combined id (`provider/model`, common for OmniRoute model aliases).
 * Compare across both representations so the routed tag only appears when the
 * gateway actually chose a different model.
 */
export function routedMatchesModel(
  routed: RoutedInfo,
  chosen: { providerID?: string | null; id?: string | null } | null | undefined,
) {
  if (!chosen) return false
  const routedKey = routedLabel(routed)
  const chosenID = typeof chosen.id === "string" ? chosen.id.trim() : ""
  const chosenProvider = typeof chosen.providerID === "string" ? chosen.providerID.trim() : ""
  if (!chosenID && !chosenProvider) return false
  if (chosenID && routedKey === chosenID) return true
  if (chosenProvider && chosenID && `${chosenProvider}/${chosenID}` === routedKey) return true
  if (
    routed.model !== undefined &&
    routed.model === chosenID &&
    (routed.provider === undefined || routed.provider === chosenProvider || !chosenProvider)
  )
    return true
  if (routed.provider !== undefined && routed.provider === chosenProvider && routed.model === chosenID) return true
  return false
}

export const routedMatchesSelected = routedMatchesModel
export const routedSameModel = routedMatchesModel
export const isRoutedSameModel = routedMatchesModel
export const sameRoutedModel = routedMatchesModel
export const routedEqualsModel = routedMatchesModel

/**
 * Character budget for the account label in the status bar. The label can carry a masked
 * email (asterisks preserve length), so the raw value easily dwarfs every other segment;
 * the full label stays available in the message details.
 */
const ACCOUNT_LABEL_MAX = 16

/** The connection label as the status bar shows it: short enough to leave room for the rest. */
export function routedAccountLabel(routed: RoutedInfo) {
  return Locale.truncate(routed.connection ?? "", ACCOUNT_LABEL_MAX)
}

/** Factual telemetry lines for the message details; only what the gateway reported appears. */
export function routedDetails(routed: RoutedInfo) {
  const details: string[] = []
  if (routed.decision) details.push(routed.decision)
  if (routed.connection) details.push(routed.connection)
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
