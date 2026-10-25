import { Plugin } from "@opencode/plugin/tui"
import { TextAttributes, type BoxRenderable, type RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useInteractivity } from "../../context/interactivity"
import { Locale } from "../../util/locale"
import {
  MODEL_QUOTA_PROVIDER,
  MODEL_QUOTA_REFRESH,
  quotaWindows,
  readModelQuota,
  readProviderLimits,
  currentQuotaRemainingPercent,
  windowPercent,
  type ModelQuota,
  type ModelQuotaWindow,
} from "../../util/model-quota"
import { localIdentity, readPlanUsage, type PlanUsage } from "../../util/plan-usage"
import { routedInfo, routedLabel } from "../../util/omniroute-routed"
import { contextUsage } from "../../util/session"
import { stringWidth } from "../../util/string-width"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

const SEPARATOR = " · "
const SEPARATOR_WIDTH = stringWidth(SEPARATOR)

/** OmniRoute quota-severity thresholds: remaining >50 green, 21-50 yellow, ≤20 red, NaN red. */
const QUOTA_STATUS_HEALTHY_ABOVE = 50
const QUOTA_STATUS_CRITICAL_AT_OR_BELOW = 20

function quotaSeverityColor(theme: Plugin.Context["theme"], percent?: number): RGBA {
  if (percent === undefined || !Number.isFinite(percent)) return theme.text.feedback.error.base
  if (percent <= QUOTA_STATUS_CRITICAL_AT_OR_BELOW) return theme.text.feedback.error.base
  if (percent <= QUOTA_STATUS_HEALTHY_ABOVE) return theme.text.feedback.warning.base
  return theme.text.feedback.success.base
}

/** Cached plan limits older than an hour are drawn dimmed; the status line cache refreshes itself. */
const PLAN_USAGE_STALE = 3600
const PLAN_USAGE_REFRESH = 60_000

type FooterBarSpan = {
  text: string
  fg: RGBA
}

export type FooterBarSegment = {
  id: string
  /** Higher priorities survive longer; the fitter skips a segment once it no longer fits. */
  priority: number
  /** Core width, excluding the optional tail. */
  width: number
  spans: FooterBarSpan[]
  /** Dropped before the core when the bar runs out of room. */
  tail?: FooterBarSpan[]
}

export function PromptFooter(props: {
  context: Plugin.Context
  sessionID?: string
  mode: "normal" | "shell"
  showDetails: boolean
}) {
  const dimensions = useTerminalDimensions()
  const [liveHovered, setLiveHovered] = createSignal(false)
  const [barWidth, setBarWidth] = createSignal<number>()
  const [plan, setPlan] = createSignal<PlanUsage>()
  const [quota, setQuota] = createSignal<ModelQuotaState>({ state: "idle" })
  const sessionLocation = createMemo(() => {
    if (!props.sessionID) return props.context.location
    return props.context.data.session.get(props.sessionID)?.location ?? props.context.location
  })
  const subagents = createMemo(() => {
    if (!props.sessionID) return 0
    const count = props.context.data.session
      .family(props.sessionID)
      .filter((id) => id !== props.sessionID && props.context.data.session.status(id) === "running").length
    return count ? `${count} subagent${count === 1 ? "" : "s"}` : undefined
  })
  const shells = createMemo(() => {
    if (!props.sessionID) return 0
    const count = props.context.data.shell
      .list(props.context.location)
      .filter((shell) => shell.metadata.sessionID === props.sessionID).length
    return count ? `${count} shell${count === 1 ? "" : "s"}` : undefined
  })
  const live = createMemo(() => [subagents(), shells()].filter((value): value is string => Boolean(value)))
  // Prompt hints read as disabled while the session does not own input, e.g. while a side panel is focused.
  const interactive = useInteractivity()
  const shortcut = (id: string) => props.context.keymap.shortcuts(id)[0]

  onMount(() => {
    let cancelled = false
    const load = async () => {
      const usage = await readPlanUsage()
      if (cancelled) return
      setPlan(usage)
    }
    void load()
    const timer = setInterval(() => void load(), PLAN_USAGE_REFRESH)
    onCleanup(() => {
      cancelled = true
      clearInterval(timer)
    })
  })

  const activeModel = createMemo(() => {
    const current = props.context.ui.model.current()
    if (current) return { providerID: current.providerID, id: current.modelID }
    if (!props.sessionID) return
    return props.context.data.session.get(props.sessionID)?.model
  })

  const modelLabel = createMemo(() => {
    const ref = activeModel()
    if (!ref) return
    const models = props.context.data.location.model.list(sessionLocation())
    const model = models?.find(
      (item) => item.providerID === ref.providerID && (item.modelID === ref.id || item.id === ref.id),
    )
    return model?.name ?? ref.id
  })

  /** The gateway result of the most recent assistant step, shown next to the selected model. */
  const lastRouted = createMemo(() => {
    if (!props.sessionID) return
    const last = props.context.data.session.message
      .list(props.sessionID)
      .findLast((message) => message.type === "assistant")
    return routedInfo(last?.native)
  })
  const accountLabel = createMemo(() => lastRouted()?.connection)

  /**
   * Where the selected model's quota can be read: only a selection served by
   * OmniRoute whose provider settings name an origin. The key covers the model
   * too, so changing the selection immediately invalidates the last reading.
   */
  const quotaTarget = createMemo(() => {
    const ref = activeModel()
    if (!ref || ref.providerID !== MODEL_QUOTA_PROVIDER) return
    const provider = props.context.data.location.provider
      .list(sessionLocation())
      ?.find((item) => item.id === ref.providerID)
    const settings = provider?.settings
    if (!settings) return
    const baseURL = typeof settings.baseURL === "string" ? settings.baseURL : undefined
    if (!baseURL) return
    return {
      key: `${baseURL}\u0000${ref.id}`,
      baseURL,
      apiKey: typeof settings.apiKey === "string" && settings.apiKey ? settings.apiKey : undefined,
      modelID: ref.id,
    }
  })

  const applyQuota = (key: string, result?: ModelQuota) => {
    if (quotaTarget()?.key !== key) return
    setQuota({ state: "ready", key, quota: result })
  }

  createEffect(() => {
    const target = quotaTarget()
    if (!target) {
      setQuota({ state: "idle" })
      return
    }
    // The previous model's windows are dropped as soon as the selection
    // changes, so they are never briefly shown as the new model's quota.
    setQuota({ state: "loading", key: target.key })
    const controller = new AbortController()
    void Promise.all([readModelQuota(target, controller.signal), readProviderLimits(target)])
      .then(([quotaResult, currentResult]) =>
        applyQuota(target.key, quotaResult),
      )
      .catch(() => undefined)
    onCleanup(() => controller.abort())
  })

  onMount(() => {
    const timer = setInterval(() => {
      const target = quotaTarget()
      if (!target) return
      void Promise.all([readModelQuota(target), readProviderLimits(target)]).then(([quotaResult, currentResult]) =>
        applyQuota(target.key, quotaResult),
      )
    }, MODEL_QUOTA_REFRESH)
    onCleanup(() => clearInterval(timer))
  })

  const liveText = createMemo(() => {
    if (!live().length) return
    const binding = shortcut("session.child.first")
    return binding ? `${binding} ${live().join(SEPARATOR)}` : live().join(SEPARATOR)
  })

  const segments = createMemo<FooterBarSegment[]>(() => {
    const theme = props.context.theme
    const list: FooterBarSegment[] = []
    const identity = localIdentity()
    if (identity) list.push(segment("identity", 90, [{ text: identity, fg: theme.text.muted }]))
    const account = accountLabel()
    if (account) list.push(segment("account", 99, [{ text: account, fg: theme.text.faint }]))
    const model = modelLabel()
    if (model) list.push(segment("model", 95, [{ text: model, fg: theme.text.base }]))
    const routed = lastRouted()
    const selected = activeModel()
    if (routed && (routed.provider !== selected?.providerID || routed.model !== selected?.id)) {
      list.push(segment("routed", 90, [{ text: `routed: ${routedLabel(routed)}`, fg: theme.text.muted }]))
    }
    if (props.sessionID) {
      const session = props.context.data.session.get(props.sessionID)
      const usage = session
        ? contextUsage(
            props.context.data.session.message.list(props.sessionID),
            props.context.data.location.model.list(session.location),
            session.revert?.messageID,
          )
        : undefined
      if (usage) {
        const left = usage.percent === undefined ? undefined : Math.max(0, 100 - usage.percent)
        const spans: FooterBarSpan[] = [
          {
            text: left === undefined ? `ctx ${Locale.number(usage.tokens)}` : `ctx ${left}% left`,
            fg: usage.percent === undefined ? theme.text.base : quotaSeverityColor(theme, usage.percent),
          },
        ]
        if (usage.limit) {
          spans.push({ text: ` (${Locale.number(usage.tokens)}/${Locale.number(usage.limit)})`, fg: theme.text.faint })
        }
        list.push(segment("ctx", 100, spans))
      }
    }
    if (activeModel()?.providerID === MODEL_QUOTA_PROVIDER) {
      // Direct OpenCode/Fable plan limits describe the local account, not the
      // route the gateway picked, so an OmniRoute model only shows the quota
      // the gateway reports for that model.
      list.push(...quotaSegments(quota(), theme))
    } else {
      const limits = plan()
      if (limits) list.push(...planSegments(limits, theme))
    }
    if (props.sessionID) {
      const cost = props.context.data.session.cost(props.sessionID)
      if (cost > 0) list.push(segment("cost", 50, [{ text: money.format(cost), fg: theme.text.muted }]))
    }
    const live = liveText()
    if (live) list.push(segment("live", 60, [{ text: live, fg: theme.text.muted }]))
    return list
  })

  const agentHint = createMemo(() => {
    if (!props.showDetails || props.mode !== "normal" || dimensions().width < 44) return
    // The agent hint only owns the footer while no usage or live work is shown,
    // so a populated status bar never loses a segment to it.
    const idle = !liveText() && !segments().some((item) => item.id === "ctx" || item.id === "cost")
    return idle ? shortcut("agent.cycle") : undefined
  })
  const commandHint = createMemo(() => {
    if (!props.showDetails || props.mode !== "normal" || dimensions().width < 44) return
    return shortcut("command.palette.show")
  })
  const hintParts = createMemo(() =>
    [agentHint() ? `${agentHint()} agents` : undefined, commandHint() ? `${commandHint()} commands` : undefined].filter(
      (part): part is string => Boolean(part),
    ),
  )
  const hintWidth = createMemo(() =>
    hintParts().reduce((total, part, index) => total + (index ? 1 : 0) + stringWidth(part), 0),
  )
  const visible = createMemo(() => {
    if (!props.showDetails) {
      const only = new Map<string, "full" | "core">()
      if (liveText()) only.set("live", "full")
      return only
    }
    // Prompt hints are part of the ready prompt, so the bar fits into whatever
    // they leave; the fitter then drops bar segments from the end.
    const reserved = hintWidth() ? hintWidth() + 2 : 0
    return footerBarLayout(segments(), Math.max(0, (barWidth() ?? dimensions().width) - reserved))
  })
  const textSegments = createMemo(() => segments().filter((item) => item.id !== "live" && visible().has(item.id)))
  const textSpans = createMemo(() => {
    const spans: FooterBarSpan[] = []
    for (const item of textSegments()) {
      if (spans.length) spans.push({ text: SEPARATOR, fg: props.context.theme.text.faint })
      spans.push(...item.spans)
      if (visible().get(item.id) === "full" && item.tail) spans.push(...item.tail)
    }
    return spans
  })

  return (
    <Switch>
      <Match when={props.mode === "normal"}>
        <box
          width="100%"
          minWidth={0}
          flexShrink={0}
          flexDirection="row"
          justifyContent="space-between"
          gap={2}
          onSizeChange={function (this: BoxRenderable) {
            const width = this.width
            queueMicrotask(() => setBarWidth(width))
          }}
        >
          <box flexDirection="row" flexShrink={1} minWidth={0}>
            <Show when={props.showDetails && textSpans().length > 0}>
              <text wrapMode="none" flexShrink={1} minWidth={0}>
                <For each={textSpans()}>{(span) => <span style={{ fg: span.fg }}>{span.text}</span>}</For>
              </text>
            </Show>
            <Show when={liveText() && visible().has("live")}>
              <text
                id="prompt.footer.live"
                fg={liveHovered() ? props.context.theme.text.base : props.context.theme.text.muted}
                wrapMode="none"
                flexShrink={0}
                onMouseOver={() => setLiveHovered(true)}
                onMouseOut={() => setLiveHovered(false)}
                onMouseUp={() => props.context.keymap.dispatch("session.child.first")}
              >
                <Show when={textSpans().length > 0}>{SEPARATOR}</Show>
                <Show when={shortcut("session.child.first")}>
                  {(value) => <span style={{ fg: props.context.theme.text.base }}>{value()} </span>}
                </Show>
                {live().join(SEPARATOR)}
              </text>
            </Show>
          </box>
          <Show when={hintParts().length > 0}>
            <box flexDirection="row" flexShrink={0} gap={1}>
              <Show when={agentHint()}>
                {(value) => (
                  <text
                    fg={
                      interactive() ? props.context.theme.text.base : props.context.theme.text.action.primary.disabled
                    }
                    attributes={interactive() ? 0 : TextAttributes.DIM}
                    wrapMode="none"
                  >
                    {value()} <span style={interactive() ? { fg: props.context.theme.text.muted } : {}}>agents</span>
                  </text>
                )}
              </Show>
              <Show when={commandHint()}>
                {(value) => (
                  <text
                    fg={
                      interactive() ? props.context.theme.text.base : props.context.theme.text.action.primary.disabled
                    }
                    attributes={interactive() ? 0 : TextAttributes.DIM}
                    wrapMode="none"
                  >
                    {value()} <span style={interactive() ? { fg: props.context.theme.text.muted } : {}}>commands</span>
                  </text>
                )}
              </Show>
            </box>
          </Show>
        </box>
      </Match>
      <Match when={props.mode === "shell"}>
        <box width="100%" minWidth={0} flexShrink={0} justifyContent="flex-end">
          <text fg={props.context.theme.text.base} flexShrink={0}>
            esc{" "}
            <span style={{ fg: props.context.theme.text.muted }}>
              {dimensions().width < 44 ? "shell" : "exit shell mode"}
            </span>
          </text>
        </box>
      </Match>
    </Switch>
  )
}

export default Plugin.define({
  id: "opencode.prompt.footer",
  setup(context) {
    context.ui.slot({
      append: "prompt.footer",
      render: (props) => (
        <PromptFooter context={context} sessionID={props.sessionID} mode={props.mode} showDetails={props.showDetails} />
      ),
    })
    context.ui.slot({
      append: "prompt.footer.status",
      render: (props) => <GitEmail context={context} sessionID={props.sessionID} />,
    })
  },
})

function GitEmail(props: { context: Plugin.Context; sessionID?: string }) {
  const location = createMemo(() => {
    if (!props.sessionID) return props.context.location
    return props.context.data.session.get(props.sessionID)?.location ?? props.context.location
  })
  const [email, setEmail] = createSignal<string>()
  createEffect(() => {
    const directory = location()?.directory
    if (!directory) return
    void gitEmail(directory).then((value) => {
      if (location()?.directory === directory) setEmail(value)
    })
  })
  return (
    <Show when={email()}>
      {(value) => (
        <text id="prompt.footer.git-email" fg={props.context.theme.text.faint} wrapMode="none" truncate>
          {value()}
        </text>
      )}
    </Show>
  )
}

/**
 * Greedy status bar fit: cores are kept in priority order, and one that no
 * longer fits is skipped so shorter, lower-priority segments can still render.
 * Optional tails — reset times, for example — only take space that is left
 * after every core, so percentages outlive the details they carry. A visible
 * segment pays one separator except the first.
 */
export function footerBarLayout(segments: readonly FooterBarSegment[], width: number) {
  const ordered = [...segments].sort((a, b) => b.priority - a.priority)
  const visible = new Map<string, "full" | "core">()
  let used = 0
  for (const item of ordered) {
    const separator = visible.size > 0 ? SEPARATOR_WIDTH : 0
    if (used + separator + item.width > width) continue
    used += separator + item.width
    visible.set(item.id, "core")
  }
  for (const item of ordered) {
    if (!item.tail || visible.get(item.id) !== "core") continue
    const tail = item.tail.reduce((total, span) => total + stringWidth(span.text), 0)
    if (used + tail > width) continue
    used += tail
    visible.set(item.id, "full")
  }
  return visible
}

function segment(id: string, priority: number, spans: FooterBarSpan[], tail: FooterBarSpan[] = []): FooterBarSegment {
  return {
    id,
    priority,
    width: spans.reduce((total, span) => total + stringWidth(span.text), 0),
    spans,
    tail: tail.length ? tail : undefined,
  }
}

export type ModelQuotaState =
  | { state: "idle" }
  | { state: "loading"; key: string }
  | { state: "ready"; key: string; quota?: ModelQuota }

const QUOTA_CANONICAL_PERIOD = /^(5h|7d|30d)$/

/**
 * Quota windows for the selected model. Only what the gateway reported is
 * drawn: a pending read shows a placeholder instead of the previous model's
 * numbers, stale windows are dimmed, and unavailable or unsupported windows
 * are omitted rather than shown as unlimited. Window counts, percentages and
 * reset times come from the answer; nothing is inferred from the model id, and
 * no account identifier or credential ever reaches the bar.
 */
export function quotaSegments(quota: ModelQuotaState, theme: Plugin.Context["theme"]): FooterBarSegment[] {
  if (quota.state === "loading") return [segment("quota:loading", 86, [{ text: "quota …", fg: theme.text.faint }])]
  if (quota.state !== "ready" || !quota.quota) return []
  const segments = [] as FooterBarSegment[]
  // Current window if available (omniroute provider-limits)
  const currentPercent = currentQuotaRemainingPercent(quota.quota)
  if (currentPercent !== undefined) {
    segments.push(
      segment(
        "quota:current",
        90,
        [
          {
            text: `curr ${Math.round(currentPercent)}%`,
            fg: quotaSeverityColor(theme, currentPercent),
          },
        ],
        [],
      ),
    )
  }
  // Periodic windows (5h, 7d, 30d)
  return segments.concat(
    quotaWindows(quota.quota).flatMap((window, index) => quotaSegment(window, index, theme)),
  )
}

function quotaSegment(window: ModelQuotaWindow, index: number, theme: Plugin.Context["theme"]): FooterBarSegment[] {
  const priority = 85 - Math.min(index, 30)
  const label = QUOTA_CANONICAL_PERIOD.test(window.period) ? window.period : (window.displayName ?? window.period)
  const percent = windowPercent(window)
  if (percent === undefined) {
    if (window.unlimited !== true) return []
    return [segment(`quota:${index}`, priority, [{ text: `${label} unlimited`, fg: theme.text.muted }])]
  }
  const fg = window.status === "stale" ? theme.decrease(quotaSeverityColor(theme, percent)) : quotaSeverityColor(theme, percent)
  const reset = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN
  const tail = Number.isNaN(reset)
    ? []
    : [{ text: ` (${resetLabel(reset / 1000, window.period !== "5h")})`, fg: theme.text.faint }]
  return [segment(`quota:${index}`, priority, [{ text: `${label} ${Math.round(percent)}%`, fg }], tail)]
}

function planSegments(plan: PlanUsage, theme: Plugin.Context["theme"]) {
  const list: FooterBarSegment[] = []
  const stale = Math.floor(Date.now() / 1000) - plan.fetched >= PLAN_USAGE_STALE
  const color = (percent: number) => (stale ? theme.decrease(quotaSeverityColor(theme, percent)) : quotaSeverityColor(theme, percent))
  const reset = (at: number | undefined, weekday: boolean): FooterBarSpan[] =>
    at ? [{ text: ` (${resetLabel(at, weekday)})`, fg: theme.text.faint }] : []
  if (plan.five) {
    list.push(
      segment(
        "five",
        85,
        [{ text: `5h ${plan.five.percent}%`, fg: color(plan.five.percent) }],
        reset(plan.five.resetsAt, false),
      ),
    )
  }
  if (plan.seven) {
    list.push(
      segment(
        "seven",
        84,
        [{ text: `7d ${plan.seven.percent}%`, fg: color(plan.seven.percent) }],
        reset(plan.seven.resetsAt, true),
      ),
    )
  }
  plan.scoped.forEach((limit, index) => {
    list.push(segment(`scoped:${index}`, 70, [{ text: `${limit.name} ${limit.percent}%`, fg: color(limit.percent) }]))
  })
  return list
}

function resetLabel(at: number, weekday: boolean) {
  const time = Locale.time(at * 1000)
  if (!weekday) return time
  return `${new Date(at * 1000).toLocaleDateString(undefined, { weekday: "short" })} ${time}`
}

const emailCache = new Map<string, Promise<string | undefined>>()

function gitEmail(directory: string) {
  const cached = emailCache.get(directory)
  if (cached) return cached
  const pending = readGitEmail(directory)
  emailCache.set(directory, pending)
  return pending
}

async function readGitEmail(directory: string) {
  try {
    const proc = Bun.spawn(["git", "config", "--get", "user.email"], {
      cwd: directory,
      stdout: "pipe",
      stderr: "ignore",
    })
    const [output, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    const value = output.trim()
    return code === 0 && value ? value : undefined
  } catch {
    return undefined
  }
}
