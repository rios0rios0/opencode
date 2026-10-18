import { expect, test } from "bun:test"
import { SPINNER_FRAMES } from "../../src/component/spinner-frames"
import { terminalTitle, terminalTitleMarker, type TerminalTitleActivity } from "../../src/util/terminal-title"

const idle: TerminalTitleActivity = { attention: false, busy: false, animations: true, frame: 0 }

test("idle titles keep the bare session title", () => {
  expect(terminalTitle("Demo session", idle)).toBe("OC | Demo session")
  expect(terminalTitle(undefined, idle)).toBe("OpenCode")
})

test("busy titles animate the shared tab spinner", () => {
  expect(terminalTitleMarker({ ...idle, busy: true })).toBe(SPINNER_FRAMES[0])
  expect(terminalTitleMarker({ ...idle, busy: true, frame: 1 })).toBe(SPINNER_FRAMES[1])
  expect(terminalTitleMarker({ ...idle, busy: true, frame: SPINNER_FRAMES.length })).toBe(SPINNER_FRAMES[0])
  expect(terminalTitle("Demo session", { ...idle, busy: true, frame: 1 })).toBe(`⠙ OC | Demo session`)
})

test("disabled animations keep a static activity marker", () => {
  expect(terminalTitleMarker({ ...idle, busy: true, animations: false, frame: 4 })).toBe(SPINNER_FRAMES[0])
})

test("attention markers replace the spinner and never claim active work", () => {
  expect(terminalTitle("Demo session", { ...idle, busy: true, attention: "permission" })).toBe("! OC | Demo session")
  expect(terminalTitle("Demo session", { ...idle, busy: true, attention: "question" })).toBe("? OC | Demo session")
  expect(terminalTitleMarker({ ...idle, attention: "permission" })).toBe("!")
  expect(terminalTitleMarker({ ...idle, attention: "question" })).toBe("?")
})

test("long titles keep the existing clamp", () => {
  expect(terminalTitle("a".repeat(60), idle)).toBe(`OC | ${"a".repeat(37)}…`)
  expect(terminalTitle("a".repeat(40), idle)).toBe(`OC | ${"a".repeat(40)}`)
})
