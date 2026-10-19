/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { SyntaxStyle } from "@opentui/core"
import { ManualClock } from "@opentui/core/testing"
import { testRender, useRenderer } from "@opentui/solid"
import { createSignal, onCleanup } from "solid-js"
import { clickedLink, streamingLinkClick } from "../../src/ui/link"

const url = "https://example.com/catalog/moparts,2004,dodge,ram+1500,4.7l+v8,1432463,brake+pad"

test("plain clicks on any row of a wrapped Markdown link resolve the full URL", async () => {
  const opened: string[] = []
  function Transcript() {
    const renderer = useRenderer()
    const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } }, renderer.nativeScene)
    onCleanup(() => syntaxStyle.destroy())
    return (
      <box
        onMouseUp={(event) => {
          const link = clickedLink(renderer, event)
          if (link) opened.push(link)
        }}
      >
        <box height={1} />
        <markdown syntaxStyle={syntaxStyle} content={`See ${url} now.`} />
      </box>
    )
  }
  const app = await testRender(() => <Transcript />, { width: 32, height: 6, clock: new ManualClock() })

  try {
    for (let attempt = 0; attempt < 50 && !app.captureCharFrame().replace(/\s/g, "").includes(url); attempt++) {
      await app.renderOnce()
      await Bun.sleep(10)
    }
    const rows = app.captureCharFrame().split("\n")
    const head = rows.findIndex((row) => row.includes("https"))
    const tail = rows.findIndex((row) => row.includes("brake+pad"))
    const x = rows[head]!.indexOf("https")
    expect(tail).toBeGreaterThan(head)

    await app.mockMouse.click(x, head)
    await app.mockMouse.click(rows[tail]!.indexOf("brake"), tail)
    expect(opened).toEqual([url, url])

    await app.mockMouse.click(0, head)
    await app.mockMouse.click(x, head, 0, { modifiers: { ctrl: true } })
    await app.mockMouse.click(x, head, 0, { modifiers: { shift: true } })
    await app.mockMouse.click(x, head, 2)
    await app.mockMouse.drag(0, head, x + 2, head)
    await app.mockMouse.drag(0, 0, x + 2, head)
    expect(opened).toEqual([url, url])

    await app.mockMouse.click(rows[tail]!.indexOf("brake"), tail)
    await app.mockMouse.click(rows[tail]!.indexOf("brake"), tail)
    expect(opened).toEqual([url, url, url])
  } finally {
    app.renderer.destroy()
  }
})

test("clicks open Markdown link labels, including wrapped rows, in either Markdown mode", async () => {
  for (const conceal of [true, false]) {
    const opened: string[] = []
    function Transcript() {
      const renderer = useRenderer()
      const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } }, renderer.nativeScene)
      onCleanup(() => syntaxStyle.destroy())
      return (
        <box
          onMouseUp={(event) => {
            const link = clickedLink(renderer, event)
            if (link) opened.push(link)
          }}
        >
          <markdown syntaxStyle={syntaxStyle} conceal={conceal} content={`[OpenCode docs](${url})`} />
        </box>
      )
    }
    const app = await testRender(() => <Transcript />, { width: 32, height: 8, clock: new ManualClock() })

    try {
      for (let attempt = 0; attempt < 50 && !app.captureCharFrame().includes("OpenCode"); attempt++) {
        await app.renderOnce()
        await Bun.sleep(10)
      }
      const rows = app.captureCharFrame().split("\n")
      const label = rows.findIndex((row) => row.includes("OpenCode"))
      expect(label).toBeGreaterThanOrEqual(0)
      await app.mockMouse.click(rows[label]!.indexOf("OpenCode"), label)

      // Rendered mode shows only the label; raw mode also shows the destination, wrapped over several rows.
      if (!conceal) {
        const head = rows.findIndex((row) => row.includes("https"))
        const tail = rows.findIndex((row) => row.includes("brake+pad"))
        expect(head).toBeGreaterThanOrEqual(0)
        expect(tail).toBeGreaterThan(head)
        await app.mockMouse.click(rows[head]!.indexOf("https"), head)
        await app.mockMouse.click(rows[tail]!.indexOf("brake"), tail)
      }
      expect(opened).toEqual(conceal ? [url] : [url, url, url])
    } finally {
      app.renderer.destroy()
    }
  }
})

test("non-http(s) destinations stay inert while http links still open", async () => {
  const opened: string[] = []
  const content = [
    "[hosts](file:///etc/hosts)",
    "[mailbox](mailto:team@opencode.ai)",
    "[scriptlet](javascript:alert(1))",
    "[target](https://example.com/target)",
  ].join(" ")
  function Transcript() {
    const renderer = useRenderer()
    const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } }, renderer.nativeScene)
    onCleanup(() => syntaxStyle.destroy())
    return (
      <box
        onMouseUp={(event) => {
          const link = clickedLink(renderer, event)
          if (link) opened.push(link)
        }}
      >
        <markdown syntaxStyle={syntaxStyle} content={content} />
      </box>
    )
  }
  const app = await testRender(() => <Transcript />, { width: 120, height: 8, clock: new ManualClock() })

  try {
    for (let attempt = 0; attempt < 50 && !app.captureCharFrame().includes("scriptlet"); attempt++) {
      await app.renderOnce()
      await Bun.sleep(10)
    }
    const rows = app.captureCharFrame().split("\n")
    const clickLabel = async (label: string) => {
      const row = rows.findIndex((line) => line.includes(label))
      expect(row).toBeGreaterThanOrEqual(0)
      await app.mockMouse.click(rows[row]!.indexOf(label), row)
    }

    await clickLabel("hosts")
    await clickLabel("mailbox")
    await clickLabel("scriptlet")
    expect(opened).toEqual([])

    await clickLabel("target")
    expect(opened).toEqual(["https://example.com/target"])
  } finally {
    app.renderer.destroy()
  }
})

test("links in a still-streaming part stay inert until it completes", async () => {
  const [streaming, setStreaming] = createSignal(true)
  const opened: string[] = []
  function Transcript() {
    const renderer = useRenderer()
    const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } }, renderer.nativeScene)
    onCleanup(() => syntaxStyle.destroy())
    return (
      <box
        onMouseUp={(event) => {
          const link = clickedLink(renderer, event)
          if (link) opened.push(link)
        }}
      >
        {/* Mirrors the gate TextPart puts around a streaming assistant part. */}
        <box
          onMouseUp={(event) => {
            if (streamingLinkClick(renderer, event, streaming())) event.stopPropagation()
          }}
        >
          <markdown syntaxStyle={syntaxStyle} streaming={streaming()} content={`See ${url} now.`} />
        </box>
      </box>
    )
  }
  const app = await testRender(() => <Transcript />, { width: 32, height: 6, clock: new ManualClock() })

  try {
    for (let attempt = 0; attempt < 50 && !app.captureCharFrame().replace(/\s/g, "").includes(url); attempt++) {
      await app.renderOnce()
      await Bun.sleep(10)
    }
    const rows = app.captureCharFrame().split("\n")
    const head = rows.findIndex((row) => row.includes("https"))
    const tail = rows.findIndex((row) => row.includes("brake+pad"))
    expect(tail).toBeGreaterThan(head)

    await app.mockMouse.click(rows[head]!.indexOf("https"), head)
    expect(opened).toEqual([])

    setStreaming(false)
    await app.renderOnce()
    await app.renderOnce()

    await app.mockMouse.click(rows[tail]!.indexOf("brake"), tail)
    expect(opened).toEqual([url])
  } finally {
    app.renderer.destroy()
  }
})
