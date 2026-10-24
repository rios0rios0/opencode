import { truncateFilePath } from "../ui/file-path"
import { stringWidth } from "./string-width"

export type LocationLabelLayout = {
  /** Path up to the anchor component, including the trailing separator. */
  prefix: string
  /** Final path component, the Powerlevel10k-style anchor. */
  anchor: string
  branch?: string
  /** Ahead/behind metadata, e.g. "⇡1 ⇣2". */
  metadata?: string
}

/**
 * One-row layout for the location label, matching the Powerlevel10k reference:
 * preserve the full directory before showing optional branch metadata, and
 * preserve its root and final component when terminal width requires truncation.
 */
export function locationLabelLayout(input: {
  directory: string
  branch?: string
  ahead?: number
  behind?: number
  width: number
}): LocationLabelLayout | undefined {
  if (!input.directory) return undefined
  const metadata = [input.ahead ? `⇡${input.ahead}` : "", input.behind ? `⇣${input.behind}` : ""]
    .filter(Boolean)
    .join(" ")
  const suffix = input.branch ? ` ⎇ ${input.branch}${metadata ? ` ${metadata}` : ""}` : ""
  const showBranch = input.branch !== undefined && stringWidth(input.directory) + stringWidth(suffix) <= input.width
  const directory = truncateFilePath(input.directory, input.width)
  return {
    ...splitAnchor(directory),
    branch: showBranch ? input.branch : undefined,
    metadata: showBranch && metadata ? metadata : undefined,
  }
}

export function splitAnchor(value: string): { prefix: string; anchor: string } {
  const match = value.match(/^(.*[\\/])([^\\/]+)$/)
  if (!match) return { prefix: "", anchor: value }
  return { prefix: match[1]!, anchor: match[2]! }
}
