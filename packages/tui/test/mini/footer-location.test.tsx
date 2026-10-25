/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import path from "node:path"
import { RGBA, TextRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { Keymap } from "../../src/context/keymap"
import { RunFooterView } from "../../src/mini/footer.view"
import { RUN_THEME_FALLBACK, RUN_THEME_FALLBACK_LIGHT, type RunTheme } from "../../src/mini/theme"
import { ansiToRgba } from "../../src/theme/color"
import { resolveMiniSettings } from "../../src/mini/runtime.boot"
import type { FooterState, FooterSubagentState, FooterView, MiniSettings, RunPrompt } from "../../src/mini/types"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { tmpdir } from "../fixture/fixture"

const tuiConfig = createTuiResolvedConfig()

async function renderFooter(input: { directory: string; width?: number; height?: number }) {
  const [state] = createSignal<FooterState>({
    phase: "idle",
    status: "",
    notice: "",
    model: "gpt-5",
    usage: undefined,
    first: false,
    interrupt: 0,
    exit: 0,
  })
  const [view] = createSignal<FooterView>({ type: "prompt" })
  const [subagents] = createSignal<FooterSubagentState>({ tabs: [], details: {}, permissions: [], forms: [] })
  const [miniSettings] = createSignal<MiniSettings>(resolveMiniSettings())
  const theme: () => RunTheme = () => RUN_THEME_FALLBACK
  const app = await testRender(
    () => (
      <Keymap.Provider config={tuiConfig}>
        <RunFooterView
          directory={() => input.directory}
          findFiles={async () => []}
          agents={() => []}
          references={() => []}
          commands={() => []}
          providers={() => []}
          currentAgent={() => "Build"}
          currentAgentID={() => "build"}
          currentModel={() => undefined}
          variants={() => []}
          currentVariant={() => undefined}
          state={state}
          view={view}
          subagent={subagents}
          queuedPrompts={() => []}
          theme={theme}
          tuiConfig={tuiConfig}
          mono={false}
          miniSettings={miniSettings}
          onSubmit={(prompt: RunPrompt) => Boolean(prompt.text.trim())}
          onPermissionReply={() => {}}
          onFormReply={() => {}}
          onFormCancel={() => {}}
          onCycle={() => {}}
          onInterrupt={() => false}
          onQueuedPromptAction={async () => {}}
          onEditorOpen={async () => undefined}
          onInputClear={() => {}}
          onExit={() => {}}
          onAgentSelect={() => {}}
          onModelSelect={() => {}}
          onVariantSelect={() => {}}
          onRows={() => {}}
          onLayout={() => {}}
          onStatus={() => {}}
          onMiniSettingChange={async () => {
            void resolveMiniSettings()
          }}
        />
      </Keymap.Provider>
    ),
    { width: input.width ?? 80, height: input.height ?? 8, kittyKeyboard: true },
  )
  return {
    ...app,
    cleanup() {
      app.renderer.currentFocusedRenderable?.blur()
      app.renderer.currentFocusedEditor?.blur()
      app.renderer.destroy()
    },
  }
}

async function gitRepo() {
  const state = await tmpdir()
  const run = async (args: string[]) => {
    const proc = Bun.spawn(["git", ...args], { cwd: state.path, stdout: "pipe", stderr: "pipe" })
    await new Response(proc.stdout).text()
    await new Response(proc.stderr).text()
    return proc.exited
  }
  await run(["init", "-q", "-b", "main"])
  await run(["config", "user.email", "test@test"])
  await run(["config", "user.name", "Test"])
  await Bun.write(`${state.path}/base.txt`, "base\n")
  await run(["add", "base.txt"])
  await run(["commit", "-q", "-m", "base"])
  return state
}

test("mini shows the directory and branch on their own row above the status line", async () => {
  await using repo = await gitRepo()
  const app = await renderFooter({ directory: repo.path, width: 80, height: 12 })
  try {
    await app.waitForFrame((frame) => frame.includes("⎇ main"))
    const frame = app.captureCharFrame()
    const lines = frame.split("\n")
    const locationLine = lines.findIndex((line) => line.includes("⎇ main"))
    const statusLine = lines.findIndex((line) => line.includes("gpt-5"))
    expect(locationLine).toBeGreaterThanOrEqual(0)
    expect(statusLine).toBeGreaterThan(locationLine)
    expect(lines[locationLine]).toContain(path.basename(repo.path))

    // The prompt stays usable with the extra row in place.
    app.mockInput.pressKey("H")
    await app.waitFor(() => app.renderer.currentFocusedEditor?.plainText === "H")
    expect(app.captureCharFrame()).toContain("⎇ main")
  } finally {
    app.cleanup()
  }
})

test("mini location and Git state use the local Powerlevel10k palette", async () => {
  await using repo = await gitRepo()
  const app = await renderFooter({ directory: repo.path, width: 100, height: 12 })
  try {
    await app.waitForFrame((frame) => frame.includes("⎇ main"))
    const location = app.renderer.root.findDescendantById("mini-location") as TextRenderable
    expect(location.fg.toInts()).toEqual((RUN_THEME_FALLBACK.footer.location as RGBA).toInts())
    expect((RUN_THEME_FALLBACK.footer.location as RGBA).toInts()).toEqual(ansiToRgba(9).toInts())
    expect((RUN_THEME_FALLBACK.footer.locationAnchor as RGBA).toInts()).toEqual(ansiToRgba(21).toInts())
    expect((RUN_THEME_FALLBACK.footer.gitClean as RGBA).toInts()).toEqual(ansiToRgba(8).toInts())
    expect((RUN_THEME_FALLBACK.footer.gitModified as RGBA).toInts()).toEqual(ansiToRgba(178).toInts())
    expect((RUN_THEME_FALLBACK.footer.gitUntracked as RGBA).toInts()).toEqual(ansiToRgba(39).toInts())
    expect((RUN_THEME_FALLBACK.footer.gitConflicted as RGBA).toInts()).toEqual(ansiToRgba(196).toInts())
    expect((RUN_THEME_FALLBACK.footer.contextHealthy as RGBA).toInts()).toEqual(ansiToRgba(70).toInts())
    expect((RUN_THEME_FALLBACK.footer.contextWarning as RGBA).toInts()).toEqual(ansiToRgba(178).toInts())
    expect((RUN_THEME_FALLBACK.footer.contextCritical as RGBA).toInts()).toEqual(ansiToRgba(160).toInts())
    expect(RUN_THEME_FALLBACK_LIGHT.footer.contextHealthy).toEqual(RUN_THEME_FALLBACK.footer.contextHealthy)
    expect(RUN_THEME_FALLBACK_LIGHT.footer.contextWarning).toEqual(RUN_THEME_FALLBACK.footer.contextWarning)
    expect(RUN_THEME_FALLBACK_LIGHT.footer.contextCritical).toEqual(RUN_THEME_FALLBACK.footer.contextCritical)
  } finally {
    app.cleanup()
  }
})

test("mini keeps the path but hides the branch outside a Git worktree", async () => {
  await using plain = await tmpdir()
  const app = await renderFooter({ directory: plain.path, width: 80, height: 12 })
  try {
    await app.waitForFrame((frame) => frame.includes("gpt-5"))
    const frame = app.captureCharFrame()
    expect(frame).toContain(path.basename(plain.path))
    expect(frame).not.toContain("⎇")
  } finally {
    app.cleanup()
  }
})
