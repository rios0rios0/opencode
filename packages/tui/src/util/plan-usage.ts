import { hostname, homedir, userInfo } from "node:os"
import { join } from "node:path"

// The Claude Code status line in the user's dotfiles maintains this cache (see
// dot_claude/executable_statusline-command.sh): a flat key=value snapshot of
// the account's plan limits, refreshed by a detached background call whenever
// Claude Code renders. Reading it costs no network and no credentials, so the
// TUI status bar can show the same numbers the status line shows. Absent cache
// or a missing file means no plan limits are drawn.

export type PlanUsageLimit = {
  percent: number
  /** Unix seconds when the window resets. */
  resetsAt?: number
}

export type PlanUsageScopedLimit = PlanUsageLimit & { name: string }

export type PlanUsage = {
  /** Unix seconds when the status line last fetched this snapshot. */
  fetched: number
  account?: string
  five?: PlanUsageLimit
  seven?: PlanUsageLimit
  scoped: PlanUsageScopedLimit[]
}

export function planUsagePath() {
  const config = process.env.CLAUDE_CONFIG_DIR?.trim()
  return join(config ? config : join(homedir(), ".claude"), "statusline-usage.cache")
}

export async function readPlanUsage(path = planUsagePath()): Promise<PlanUsage | undefined> {
  const file = Bun.file(path)
  if (!(await file.exists())) return
  return parsePlanUsage(await file.text())
}

export function parsePlanUsage(input: string): PlanUsage | undefined {
  const values = new Map<string, string>()
  for (const line of input.split("\n")) {
    const index = line.indexOf("=")
    if (index <= 0) continue
    values.set(line.slice(0, index), line.slice(index + 1))
  }
  const fetched = Number(values.get("fetched"))
  if (!Number.isFinite(fetched) || fetched <= 0) return
  return {
    fetched,
    account: values.get("account") || undefined,
    five: window(values, "five"),
    seven: window(values, "seven"),
    scoped: (values.get("scoped") ?? "").split("|").flatMap(scopedWindow),
  }
}

function window(values: Map<string, string>, key: string): PlanUsageLimit | undefined {
  const percent = Number(values.get(key))
  if (!Number.isFinite(percent) || percent < 0) return
  const resetsAt = Number(values.get(`${key}_at`))
  return { percent, resetsAt: Number.isFinite(resetsAt) && resetsAt > 0 ? resetsAt : undefined }
}

function scopedWindow(entry: string): PlanUsageScopedLimit[] {
  // `<display name>:<percent>:<resets at>`; the status line replaces ":" and
  // "=" inside display names, so the first two separators are the only ones.
  const [name, percent, resetsAt] = entry.split(":")
  if (!name) return []
  const value = Number(percent)
  if (!Number.isFinite(value) || value < 0) return []
  const reset = Number(resetsAt)
  return [{ name, percent: value, resetsAt: Number.isFinite(reset) && reset > 0 ? reset : undefined }]
}

export function localIdentity() {
  try {
    const user = userInfo().username.trim()
    const host = hostname().trim()
    return user && host ? `${user}@${host}` : undefined
  } catch {
    return undefined
  }
}
