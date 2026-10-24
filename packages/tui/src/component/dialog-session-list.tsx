import { createEffect, createMemo, createResource, createSignal, onMount, Show, type JSX } from "solid-js"
import path from "path"
import type { SessionInfo } from "@opencode/client"
import { Project } from "@opencode/schema/project"
import { TextAttributes, type RGBA } from "@opentui/core"
import { DIALOG_LIST_INSET, useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useRoute } from "../context/route"
import { useArgs } from "../context/args"
import { useData } from "../context/data"
import { Keymap } from "../context/keymap"
import { Locale } from "../util/locale"
import { useTheme } from "../context/theme"
import { useClient } from "../context/client"
import { useLocal } from "../context/local"
import { createDebouncedSignal } from "../util/signal"
import { useToast } from "../ui/toast"
import { DialogSessionRename } from "./dialog-session-rename"
import { browseExternalSessions, readExternalSession, HARNESS_LABELS, HARNESS_ORDER, sameDirectory, type ExternalSession } from "../session-source"
import { Spinner } from "./spinner"
import { errorMessage } from "../util/error"
import { useSessionTabs } from "../context/session-tabs"
import { useStorage } from "../context/storage"
import { useConfig, useNewDesigns } from "../config"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"
import { projectName } from "../util/project"
import { useLocation } from "../context/location"
import { useTuiPaths } from "../context/runtime"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Project as ProjectSchema } from "@opencode/schema/project"
import { Money } from "@opencode/schema/money"
import { DateTime, Schema } from "effect"
import { AbsolutePath } from "@opencode/schema/schema"

export function DialogSessionList() {
  const dialog = useDialog()
  const route = useRoute()
  const data = useData()
  const theme = useTheme().surface("dialog")
  const client = useClient()
  const local = useLocal()
  const sessionTabs = useSessionTabs()
  const config = useConfig().data
  const newDesigns = useNewDesigns()
  const toast = useToast()
  const activeLocation = useLocation()
  const paths = useTuiPaths()
  const [filter, setFilter] = createSignal("")
  const args = useArgs()
  const shortcuts = Keymap.useShortcuts()
  const [search, setSearch] = createDebouncedSignal("", 150)
  const [toDelete, setToDelete] = createSignal<string>()
  const [prefs, updatePrefs] = useStorage().store("session-list", {
    initial: { allProjects: config.tabs?.scope !== "cwd" },
  })
  const allProjects = () => prefs.allProjects
  const pickerLocation = () =>
    (route.data.type === "session" ? data.session.get(route.data.sessionID)?.location : undefined) ??
    activeLocation.ref ??
    data.location.default()

  const [searchResults, { mutate: setSearchResults }] = createResource(
    () => ({
      query: search().trim(),
      allProjects: allProjects(),
      location: pickerLocation(),
    }),
    async ({ query, allProjects, location }) => {
      try {
        if (!data.location.info(location)) await data.location.sync(location)
        const current = data.location.info(location)
        if (!current) throw new Error("Location unavailable")
        const response = await client.api.session.list({
          ...(allProjects
            ? {}
            : current.project.id === Project.ID.global
              ? { directory: current.directory }
              : {
                  project: current.project.id,
                  subpath: path.relative(current.project.directory, current.directory).replaceAll("\\", "/"),
                }),
          ...(query ? { search: query } : {}),
          limit: 50,
          order: "desc",
          parentID: null,
        })
        return { query, allProjects, sessions: response.data, error: undefined }
      } catch (error) {
        // A transient transport failure must degrade search, not crash the TUI
        // through the root ErrorBoundary when the errored resource is read.
        return { query, allProjects, sessions: [] as SessionInfo[], error }
      }
    },
  )

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const localSessions = createMemo(() => {
    const query = filter().trim().toLowerCase()
    const current = data.location.info(pickerLocation())
    const sessions = data.session
      .list()
      .filter(
        (session) =>
          allProjects() ||
          (session.projectID === current?.project.id && session.location.directory === current.directory),
      )
    if (!query) return sessions
    return sessions.filter(
      (session) => !session.parentID && withTimestampedFallback(session).toLowerCase().includes(query),
    )
  })
  const sessions = createMemo(() => {
    const query = filter().trim()
    const local = localSessions()
    if (query !== search().trim()) return searchResults.latest?.sessions ?? local
    if (searchResults.loading) return searchResults.latest?.sessions ?? []
    const result = searchResults()
    if (result?.query !== query || result.allProjects !== allProjects() || result.error) return local
    return result.sessions
  })
  const searchState = createMemo(() => {
    const query = filter().trim()
    if (query !== search().trim() || searchResults.loading)
      return { message: query ? "Searching sessions…" : "Loading sessions…", error: false }
    const result = searchResults()
    if (result?.query === query && result.error)
      return {
        message: query ? "Could not search sessions. Change the search to try again." : "Could not load sessions.",
        error: true,
      }
    return { message: query ? "No sessions found" : "No sessions available", error: false }
  })

  // Sessions from other harnesses and installations are read-only history: they are discovered
  // once per configuration and never fetched, resumed, or deleted through the active store.
  const [externalSessions] = createResource(
    () => ({ configured: config.session.external_roots ?? [], home: paths.home, exclude: [paths.data] }),
    (input) => browseExternalSessions(input),
  )
  const externalByKey = createMemo(
    () => new Map((externalSessions()?.sessions ?? []).map((session) => [session.key, session])),
  )
  const externalOptions = createMemo(() => {
    const query = filter().trim().toLowerCase()
    const current = allProjects() ? undefined : data.location.info(pickerLocation())
    return (externalSessions()?.sessions ?? [])
      // A session with no readable directory is listed under its explicit Other section
      // instead of silently disappearing; known directories must match the active one.
      .filter((session) => !session.directory || !current || sameDirectory(session.directory, current.directory))
      .filter(
        (session) =>
          !query ||
          withTimestampedFallback(session).toLowerCase().includes(query) ||
          session.directory.toLowerCase().includes(query) ||
          session.sourceLabel.toLowerCase().includes(query) ||
          HARNESS_LABELS[session.harness].toLowerCase().includes(query),
      )
      .sort((left, right) => externalRank(left) - externalRank(right) || right.time.updated - left.time.updated)
  })
  createEffect(() => {
    const warnings = externalSessions()?.warnings
    if (!warnings?.length) return
    toast.show({
      message: warnings.length === 1 ? warnings[0] : `${warnings[0]} (+${warnings.length - 1} more)`,
      variant: "warning",
      duration: 8000,
    })
  })

  const quickSwitchHint = createMemo(() => {
    if (sessionTabs.enabled()) return
    const first = shortcuts.get("session.quick_switch.1")
    const last = shortcuts.get("session.quick_switch.9")
    if (!first || !last) return
    return quickSwitchRange(first, last)
  })
  const quickSwitchFooterHints = createMemo(() => {
    const hint = quickSwitchHint()
    return hint && local.session.slots().length > 0 ? [{ title: "switch", label: hint }] : []
  })
  const currentProjectName = createMemo(() => {
    const current = data.location.info(pickerLocation())
    if (!current) return ""
    const project = data.project.get(current.project.id)
    return projectName(project) ?? ""
  })

  const options = createMemo(() => {
    const today = new Date().toDateString()
    const sessionMap = new Map(
      sessions()
        .filter((session) => !session.parentID)
        .map((session) => [session.id, session]),
    )
    const pinned = sessionTabs.enabled() ? [] : local.session.pinned().filter((sessionID) => sessionMap.has(sessionID))
    const pinnedSet = new Set(pinned)
    const slotByID = new Map(local.session.slots().map((sessionID, index) => [sessionID, index + 1]))

    const option = (session: SessionInfo, category: string) => {
      const directory = session.location.directory
      const project = data.project.get(session.projectID)
      const root = session.subpath ? path.resolve(directory, ...session.subpath.split("/").map(() => "..")) : directory
      const relative = path.relative(project?.canonical ?? root, root)
      const footer =
        relative.startsWith("..") || path.isAbsolute(relative)
          ? Locale.truncate(path.basename(relative), 25)
          : undefined
      const slot = sessionTabs.enabled() ? undefined : slotByID.get(session.id)
      const deleting = toDelete() === session.id
      const attention = sessionTabs.status(session.id).attention
      return {
        title: deleting
          ? `Press ${shortcuts.get("session.delete")} again to confirm`
          : withTimestampedFallback(session),
        value: session.id,
        category,
        footer,
        bg: deleting ? theme.background.action.destructive.focused : undefined,
        fg: deleting ? theme.text.action.destructive.focused : undefined,
        gutter: sessionStatusGutter(
          theme,
          attention,
          !attention &&
            (data.session.status(session.id) === "running" ||
              data.session.family(session.id).some((id) => data.session.status(id) === "running")),
          slot === undefined ? undefined : () => <text fg={theme.hue.accent[200]}>{slot}</text>,
        ),
      }
    }

    const remaining = sessions()
      .filter((session) => !session.parentID && !pinnedSet.has(session.id))
      .map((session) => {
        const date = new Date(session.time.updated).toDateString()
        return option(session, date === today ? "Today" : date)
      })

    const external = externalOptions().map((session) => ({
      title: withTimestampedFallback(session),
      value: session.key,
      category: externalCategory(session),
      footer: session.directory
        ? `${Locale.truncateMiddle(session.directory, 24)} · ${Locale.time(session.time.updated)}`
        : `unknown directory · ${Locale.time(session.time.updated)}`,
    }))

    return [...pinned.map((sessionID) => option(sessionMap.get(sessionID)!, "Pinned")), ...remaining, ...external]
  })

  onMount(() => dialog.setSize("large"))
  onMount(() => {
    if (!args.resumeQuery) return
    setFilter(args.resumeQuery)
    setSearch(args.resumeQuery)
  })

  return (
    <DialogSelect
      title="Sessions"
      titleView={
        <box flexDirection="row">
          <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
            Sessions
          </text>
          <Show when={!allProjects() && currentProjectName()}>
            <text fg={theme.text.muted}> for {currentProjectName()}</text>
          </Show>
        </box>
      }
      searchInTitle
      titlePlaceholder={
        !allProjects() && currentProjectName() ? `Search sessions in ${currentProjectName()}` : "Search sessions"
      }
      options={options()}
      skipFilter={true}
      current={currentSessionID()}
      onFilter={(query) => {
        setFilter(query)
        setSearch(query)
      }}
      bindings={[
        {
          bind: "ctrl+a",
          title: allProjects() ? "Show current directory sessions" : "Show all project sessions",
          group: "Dialog",
          run: () => {
            void updatePrefs((draft) => {
              draft.allProjects = !draft.allProjects
            }).catch(() => {})
          },
        },
      ]}
      emptyView={
        <box paddingLeft={DIALOG_LIST_INSET} paddingRight={DIALOG_LIST_INSET}>
          <text fg={searchState().error ? theme.text.feedback.error.base : theme.text.muted}>
            {searchState().message}
          </text>
        </box>
      }
      noMatchView={
        <box paddingLeft={DIALOG_LIST_INSET} paddingRight={DIALOG_LIST_INSET}>
          <text fg={searchState().error ? theme.text.feedback.error.base : theme.text.muted}>
            {searchState().message}
          </text>
        </box>
      }
      onMove={() => setToDelete(undefined)}
      onSelect={(option) => {
        const session = externalByKey().get(option.value)
        if (session) {
          void readExternalSession(session)
            .then(async (transcript) => {
              const now = Date.now()
              const id = Session.ID.create()
              const location = await client.api.location.get({ location: { directory: session.directory || process.cwd() } })
              const created = (value: number) => DateTime.makeUnsafe(value)
              const messages: SessionMessage.Info[] = transcript.entries.flatMap((entry): SessionMessage.Info[] => {
                if (entry.kind === "user")
                  return [SessionMessage.User.make({ id: SessionMessage.ID.create(), type: "user", text: entry.text, files: [], agents: [], skills: [], time: { created: created(entry.created) } })]
                if (entry.kind === "assistant")
                  return [SessionMessage.User.make({ id: SessionMessage.ID.create(), type: "user", text: `[Imported ${HARNESS_LABELS[session.harness]} assistant response]\n${entry.text}`, files: [], agents: [], skills: [], time: { created: created(entry.created) } })]
                return []
              })
              const info = Session.Info.make({
                id,
                projectID: ProjectSchema.ID.make(location.project.id),
                cost: Money.USD.zero,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                time: { created: created(now), updated: created(now) },
                title: withTimestampedFallback(session),
                location: { directory: AbsolutePath.make(location.directory) },
              })
              const imported = await client.api.session.import({
                info: Schema.encodeSync(Session.Info)(info) as never,
                messages: messages.map((message) => Schema.encodeSync(SessionMessage.Info)(message)) as never,
              })
              route.navigate({ type: "session", sessionID: imported.id })
              dialog.clear()
            })
            .catch((error) => toast.show({ message: `Could not resume session: ${errorMessage(error)}`, variant: "error" }))
          return
        }
        route.navigate({ type: "session", sessionID: option.value })
        dialog.clear()
      }}
      actions={[
        {
          command: "session.pin.toggle",
          title: "pin/unpin",
          hidden: sessionTabs.enabled(),
          disabled: readOnlyOption(externalByKey),
          onTrigger: (option) => local.session.togglePin(option.value),
        },
        {
          command: "session.delete",
          title: "delete",
          disabled: readOnlyOption(externalByKey),
          onTrigger: (option: { value: string }) => {
            if (toDelete() !== option.value) {
              setToDelete(option.value)
              return
            }
            void client.api.session
              .remove({ sessionID: option.value })
              .then(() => {
                setSearchResults((result) =>
                  result
                    ? { ...result, sessions: result.sessions.filter((session) => session.id !== option.value) }
                    : result,
                )
              })
              .catch((error) => {
                setToDelete(undefined)
                toast.show({
                  message: `Failed to delete session: ${errorMessage(error)}`,
                  variant: "error",
                  duration: 5000,
                })
              })
          },
        },
        {
          command: "session.rename",
          title: "rename",
          disabled: readOnlyOption(externalByKey),
          onTrigger: (option: { value: string; title: string }) =>
            DialogSessionRename.show(dialog, option.value, option.title),
        },
      ]}
      footerHints={[
        ...(newDesigns() ? [] : quickSwitchFooterHints()),
        { title: allProjects() ? "current directory" : "all projects", label: "ctrl+a", side: "right" },
      ]}
    />
  )
}

function quickSwitchRange(first: string, last: string) {
  const prefix = first.slice(0, -1)
  if (first.endsWith("1") && last === `${prefix}9`) return `${prefix}1-9`
  return `${first} through ${last}`
}

/** Groups external sessions by harness; unknown directories fall under an explicit Other section. */
function externalCategory(session: ExternalSession) {
  if (!session.directory) return "Other"
  // OpenCode has multiple discoverable installations, so each section names its own store.
  const label = HARNESS_LABELS[session.harness]
  return session.harness === "opencode" ? `${label} · ${Locale.truncateMiddle(session.sourceLabel, 40)}` : label
}

/** Unknown-directory sessions sort after every harness while harness order stays fixed. */
function externalRank(session: ExternalSession) {
  if (!session.directory) return HARNESS_ORDER.length
  return HARNESS_ORDER.indexOf(session.harness)
}

/** External sessions are read-only history: destructive actions never target their keys. */
function readOnlyOption(sessions: () => Map<string, ExternalSession>) {
  return (option: { value: string } | undefined) => Boolean(option && sessions().has(option.value))
}

export function sessionStatusGutter(
  theme: ReturnType<ReturnType<typeof useTheme>["surface"]>,
  attention: "permission" | "question" | false,
  running: boolean,
  fallback?: () => JSX.Element,
) {
  if (attention) {
    return (color: RGBA) => (
      <text
        fg={color === theme.text.action.primary.focused ? color : theme.text.feedback.warning.base}
        attributes={TextAttributes.BOLD}
      >
        {attention === "permission" ? "!" : "?"}
      </text>
    )
  }
  if (running) return (color: RGBA) => <Spinner color={color} />
  return fallback
}
