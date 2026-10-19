import { isRecord } from "./record"

/**
 * Client for the OmniRoute model-quota API (Feature 4 contract): the
 * authoritative 5h/7d/30d — plus provider-native — windows that apply to the
 * model the user selected, scoped to the account/plan behind it.
 *
 * The footer reads it directly from the gateway the model is served by, using
 * the same provider settings the server uses to reach it. Answers are treated
 * as untrusted input: every field is validated, an unreadable answer yields no
 * quota at all, and nothing here is ever inferred from the model id.
 */

/** Provider id of the fork's local OmniRoute plugin (packages/core/src/plugin/provider/omniroute.ts). */
export const MODEL_QUOTA_PROVIDER = "omniroute"

/** How often the reader re-reads the API; the API itself bounds live upstream refreshes. */
export const MODEL_QUOTA_REFRESH = 60_000

/** A quota read must never hold the refresh loop open; slow answers resolve as absent. */
const MODEL_QUOTA_TIMEOUT = 5_000

/** Rendered windows are bounded so a hostile or buggy answer cannot flood the bar. */
const MAX_QUOTA_WINDOWS = 32

export type ModelQuotaWindowStatus = "available" | "stale" | "unavailable" | "unsupported"
export type ModelQuotaStatus = "available" | "partial" | "stale" | "unavailable" | "unsupported"

export type ModelQuotaWindow = {
  /** Canonical bucket when the provider window maps to one (`5h`, `7d`, `30d`), else the provider's own key. */
  period: string
  windowName?: string
  displayName?: string
  status: ModelQuotaWindowStatus
  usedPercentage?: number
  remainingPercentage?: number
  limit?: number
  used?: number
  remaining?: number
  unlimited?: boolean
  resetsAt?: string
  observedAt?: string
  source?: string
}

export type ModelQuotaRoute = {
  providerID: string | null
  modelID: string | null
  status: ModelQuotaStatus
  windows: ModelQuotaWindow[]
}

export type ModelQuota = {
  status: ModelQuotaStatus
  plan?: string
  windows: ModelQuotaWindow[]
  routes?: ModelQuotaRoute[]
  updatedAt?: string
}

export type ModelQuotaTarget = {
  /** Provider base URL as configured, for example `http://127.0.0.1:20128/v1`. */
  baseURL: string
  apiKey?: string
  modelID: string
}

/** `http://host/v1` becomes `http://host/api/v1/quota?model=...`; anything not HTTP(S) yields nothing. */
export function modelQuotaUrl(baseURL: string, modelID: string) {
  if (!URL.canParse(baseURL)) return
  const url = new URL(baseURL)
  if (url.protocol !== "http:" && url.protocol !== "https:") return
  const prefix = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "")
  url.pathname = `${prefix}/api/v1/quota`
  url.search = ""
  url.hash = ""
  url.searchParams.set("model", modelID)
  return url.toString()
}

export function parseModelQuota(input: unknown): ModelQuota | undefined {
  if (!isRecord(input)) return
  const status = quotaStatus(input.status)
  if (!status) return
  return {
    status,
    plan: text(input.plan),
    windows: parseWindows(input.windows),
    routes: parseRoutes(input.routes),
    updatedAt: text(input.updatedAt),
  }
}

/**
 * The windows the footer shows for one answer. A single account/plan answers
 * with top-level windows; route-scoped answers (stored combos and `auto/*`)
 * carry per-candidate windows in `routes`, which collapse to the worst
 * (highest) utilization per period — and only while every contributing
 * candidate belongs to the same provider. A route mixing providers has no
 * single honest number to show, so it shows none.
 */
export function quotaWindows(quota: ModelQuota): readonly ModelQuotaWindow[] {
  if (quota.status === "unsupported") return []
  if (quota.windows.length > 0) return quota.windows
  const merged = new Map<string, { provider: string | null; mixed: boolean; windows: ModelQuotaWindow[] }>()
  for (const route of quota.routes ?? []) {
    for (const window of route.windows) {
      const entry = merged.get(window.period) ?? { provider: route.providerID, mixed: false, windows: [] }
      if (entry.provider !== route.providerID) entry.mixed = true
      entry.windows.push(window)
      merged.set(window.period, entry)
    }
  }
  const windows: ModelQuotaWindow[] = []
  for (const entry of merged.values()) {
    if (entry.mixed) continue
    const candidates = entry.windows.filter((window) => window.status !== "unavailable" && window.status !== "unsupported")
    if (candidates.length === 0) continue
    windows.push(candidates.reduce(worst))
  }
  return windows.slice(0, MAX_QUOTA_WINDOWS)
}

/** Utilization of a window as a percentage of its limit, when the answer supports one. */
export function windowPercent(window: ModelQuotaWindow) {
  if (Number.isFinite(window.usedPercentage)) return clamp(window.usedPercentage as number)
  if (window.limit !== undefined && window.used !== undefined && window.limit > 0)
    return clamp((window.used / window.limit) * 100)
  if (Number.isFinite(window.remainingPercentage)) return clamp(100 - (window.remainingPercentage as number))
  if (window.limit !== undefined && window.remaining !== undefined && window.limit > 0)
    return clamp(((window.limit - window.remaining) / window.limit) * 100)
  return undefined
}

/** Reads the quota for one target; every failure — network, status, or malformed body — reads as absent. */
export async function readModelQuota(target: ModelQuotaTarget, signal?: AbortSignal): Promise<ModelQuota | undefined> {
  const url = modelQuotaUrl(target.baseURL, target.modelID)
  if (!url) return
  const timeout = AbortSignal.timeout(MODEL_QUOTA_TIMEOUT)
  try {
    const response = await fetch(url, {
      headers: target.apiKey ? { authorization: `Bearer ${target.apiKey}` } : undefined,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (!response.ok) return
    return parseModelQuota(await response.json())
  } catch {
    return
  }
}

/** Highest utilization wins; a window without a reading never outranks one with a reading. */
function worst(a: ModelQuotaWindow, b: ModelQuotaWindow) {
  const left = windowPercent(a)
  const right = windowPercent(b)
  if (left === undefined) return right === undefined ? a : b
  if (right === undefined) return a
  return right > left ? b : a
}

function parseWindows(input: unknown): ModelQuotaWindow[] {
  if (!Array.isArray(input)) return []
  return input.flatMap(parseWindow).slice(0, MAX_QUOTA_WINDOWS)
}

function parseRoutes(input: unknown): ModelQuotaRoute[] | undefined {
  if (!Array.isArray(input)) return
  return input.flatMap((value): ModelQuotaRoute[] => {
    if (!isRecord(value)) return []
    const status = quotaStatus(value.status)
    if (!status) return []
    return [
      {
        providerID: text(value.providerID) ?? null,
        modelID: text(value.modelID) ?? null,
        status,
        windows: parseWindows(value.windows),
      },
    ]
  })
}

function parseWindow(input: unknown): ModelQuotaWindow[] {
  if (!isRecord(input)) return []
  const period = text(input.period)
  if (!period) return []
  return [
    {
      period,
      windowName: text(input.windowName),
      displayName: text(input.displayName),
      // An unrecognized status is not evidence of an available reading.
      status: windowStatus(input.status) ?? "unavailable",
      usedPercentage: percentage(input.usedPercentage),
      remainingPercentage: percentage(input.remainingPercentage),
      limit: amount(input.limit),
      used: amount(input.used),
      remaining: amount(input.remaining),
      unlimited: input.unlimited === true ? true : undefined,
      resetsAt: timestamp(input.resetsAt),
      observedAt: timestamp(input.observedAt),
      source: text(input.source),
    },
  ]
}

function quotaStatus(value: unknown): ModelQuotaStatus | undefined {
  return value === "available" || value === "partial" || value === "stale" || value === "unavailable" || value === "unsupported"
    ? value
    : undefined
}

function windowStatus(value: unknown): ModelQuotaWindowStatus | undefined {
  return value === "available" || value === "stale" || value === "unavailable" || value === "unsupported" ? value : undefined
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function amount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function percentage(value: unknown) {
  return amount(value)
}

function timestamp(value: unknown) {
  const comparable = text(value)
  return comparable && !Number.isNaN(Date.parse(comparable)) ? comparable : undefined
}

function clamp(value: number) {
  return Math.min(100, Math.max(0, value))
}
