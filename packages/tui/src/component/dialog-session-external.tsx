import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createResource, For, Show } from "solid-js"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { readExternalSession, HARNESS_LABELS, type ExternalSession, type ExternalTranscriptEntry } from "../session-source"
import { Locale } from "../util/locale"
import { DialogFooter, DialogHeader, DialogLayout, useDialog, type DialogContext } from "../ui/dialog"

const KIND_LABELS: Record<ExternalTranscriptEntry["kind"], string> = {
  user: "you",
  assistant: "assistant",
  tool: "tool",
  system: "system",
}

/** Read-only browser for a session stored by another local harness or OpenCode installation. */
export function DialogExternalSession(props: { session: ExternalSession }) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const dimensions = useTerminalDimensions()
  const [transcript] = createResource(() => props.session, readExternalSession)
  const height = () => Math.max(3, Math.floor(dimensions().height * 0.6) - 8)
  const entries = () => transcript()?.entries ?? []
  let scroll: ScrollBoxRenderable | undefined

  dialog.setSize("xlarge")
  dialog.setCentered(true)

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "up", title: "Scroll transcript up", group: "External session", run: () => scroll?.scrollBy(-1) },
      { bind: "down", title: "Scroll transcript down", group: "External session", run: () => scroll?.scrollBy(1) },
      {
        bind: "pageup",
        title: "Previous transcript page",
        group: "External session",
        run: () => scroll?.scrollBy(-height()),
      },
      {
        bind: "pagedown",
        title: "Next transcript page",
        group: "External session",
        run: () => scroll?.scrollBy(height()),
      },
      { bind: "home", title: "First transcript entry", group: "External session", run: () => scroll?.scrollTo(0) },
      { bind: "end", title: "Last transcript entry", group: "External session", run: () => scroll?.scrollTo(Infinity) },
    ],
  }))

  return (
    <DialogLayout
      header={
        <DialogHeader
          gap={dimensions().width < 60 ? 1 : 2}
          titleView={
            <text fg={theme.text.base} attributes={TextAttributes.BOLD} flexGrow={1}>
              {Locale.truncate(withTimestampedFallback(props.session), 52)}
            </text>
          }
        >
          <text fg={theme.text.muted}>{`Read-only · ${props.session.sourceLabel}`}</text>
        </DialogHeader>
      }
      legacyFooter={
        <DialogFooter
          actions={{
            secondary: [
              { title: "scroll", key: "↑/↓" },
              { title: "back", key: "esc" },
            ],
          }}
        />
      }
    >
      <box gap={1}>
        <text fg={theme.text.muted} wrapMode="word">
          {`${HARNESS_LABELS[props.session.harness]} · ${props.session.directory || "Unknown directory"} · updated ${Locale.datetime(props.session.time.updated)}`}
        </text>
        <Show when={transcript.loading}>
          <text fg={theme.text.muted}>Loading transcript…</text>
        </Show>
        <For each={transcript()?.warnings ?? []}>
          {(warning) => (
            <text fg={theme.text.feedback.warning.base} wrapMode="word">
              {warning}
            </text>
          )}
        </For>
        <Show when={!transcript.loading && entries().length === 0}>
          <text fg={theme.text.muted}>No readable transcript entries in this session.</text>
        </Show>
        <scrollbox
          ref={(value: ScrollBoxRenderable) => (scroll = value)}
          height={height()}
          scrollbarOptions={{ visible: false }}
        >
          <box flexDirection="column" gap={1}>
            <For each={entries()}>
              {(entry) => (
                <box flexDirection="column">
                  <text fg={theme.text.muted}>{`${KIND_LABELS[entry.kind]} · ${Locale.datetime(entry.created)}`}</text>
                  <text fg={theme.text.base} wrapMode="word">
                    {entry.text}
                  </text>
                </box>
              )}
            </For>
          </box>
        </scrollbox>
      </box>
    </DialogLayout>
  )
}

DialogExternalSession.show = (dialog: DialogContext, session: ExternalSession) =>
  dialog.replace(() => <DialogExternalSession session={session} />)
