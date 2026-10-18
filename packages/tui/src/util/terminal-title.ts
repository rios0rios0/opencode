import { SPINNER_FRAMES } from "../component/spinner-frames"

// The outer terminal title mirrors the status the in-app session tab renders: attention markers
// are static, active work animates the tab spinner, and idle restores the bare session title.
export type TerminalTitleActivity = {
  attention: "permission" | "question" | false
  busy: boolean
  animations: boolean
  frame: number
}

export const TERMINAL_TITLE_LIMIT = 40

export function terminalTitleMarker(activity: TerminalTitleActivity) {
  if (activity.attention === "permission") return "!"
  if (activity.attention === "question") return "?"
  if (!activity.busy) return ""
  return activity.animations ? SPINNER_FRAMES[activity.frame % SPINNER_FRAMES.length]! : SPINNER_FRAMES[0]!
}

export function terminalTitle(title: string | undefined, activity: TerminalTitleActivity) {
  if (!title) return "OpenCode"
  const label = title.length > TERMINAL_TITLE_LIMIT ? title.slice(0, TERMINAL_TITLE_LIMIT - 3) + "…" : title
  const marker = terminalTitleMarker(activity)
  return marker ? `${marker} OC | ${label}` : `OC | ${label}`
}
