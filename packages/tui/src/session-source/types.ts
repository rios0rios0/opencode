/** A session discovered in a local store owned by another OpenCode installation or harness. */
export type SessionHarness = "opencode" | "claude-code" | "codex"

export type ExternalSession = Readonly<{
  /** Dialog option key. Distinct from native session IDs so external rows never alias them. */
  key: string
  sessionID: string
  harness: SessionHarness
  /** One source instance: a single data root and store file. */
  sourceID: string
  sourceLabel: string
  /** Absolute path of the source's store the session was read from. */
  storePath: string
  directory: string
  subpath?: string
  title?: string
  parentID?: string
  time: { created: number; updated: number }
}>

export type ExternalTranscriptEntry = Readonly<{
  id: string
  kind: "user" | "assistant" | "tool" | "system"
  text: string
  created: number
}>

export type ExternalBrowseResult = Readonly<{
  sessions: ExternalSession[]
  warnings: string[]
}>

export type ExternalReadResult = Readonly<{
  entries: ExternalTranscriptEntry[]
  warnings: string[]
}>
