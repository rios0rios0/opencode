import { expect, test } from "bun:test"
import { locationLabelLayout, splitAnchor } from "../src/util/footer-location"

test("locationLabelLayout keeps the directory and branch adjacent when they fit", () => {
  expect(
    locationLabelLayout({ directory: "~/dev/opencode", branch: "main", width: 80 }),
  ).toEqual({
    prefix: "~/dev/",
    anchor: "opencode",
    branch: "main",
    metadata: undefined,
  })
})

test("locationLabelLayout appends ahead/behind metadata to the branch", () => {
  expect(
    locationLabelLayout({ directory: "~/dev/opencode", branch: "main", ahead: 2, behind: 1, width: 80 }),
  ).toEqual({
    prefix: "~/dev/",
    anchor: "opencode",
    branch: "main",
    metadata: "⇡2 ⇣1",
  })
})

test("locationLabelLayout preserves the full directory and drops branch metadata when both do not fit", () => {
  expect(locationLabelLayout({ directory: "/home/user/dev/opencode", branch: "main", width: 24 })).toEqual({
    prefix: "/home/user/dev/",
    anchor: "opencode",
    branch: undefined,
    metadata: undefined,
  })
})

test("a narrow width preserves the directory and drops the branch", () => {
  const layout = locationLabelLayout({ directory: "/home/user/dev/opencode", branch: "feature/sidebar", width: 20 })
  expect(layout?.branch).toBeUndefined()
  expect(layout?.metadata).toBeUndefined()
  expect(layout?.prefix).toBe("/home/user/dev/")
  expect(layout?.anchor).toBe("opencode")
})

test("the full directory is preserved", () => {
  const layout = locationLabelLayout({
    directory: "/home/user/dev/opencode/packages/tui",
    width: 14,
  })
  expect(layout).not.toBeUndefined()
  expect(layout!.anchor).toBe("tui")
  expect(`${layout!.prefix}${layout!.anchor}`).toBe("/home/user/dev/opencode/packages/tui")
})

test("a non-Git directory shows only its path", () => {
  expect(locationLabelLayout({ directory: "/home/user/notes", width: 80 })).toEqual({
    prefix: "/home/user/",
    anchor: "notes",
    branch: undefined,
    metadata: undefined,
  })
})

test("splitAnchor separates the final component from its parent path", () => {
  expect(splitAnchor("/home/user/dev/opencode")).toEqual({ prefix: "/home/user/dev/", anchor: "opencode" })
  expect(splitAnchor("/")).toEqual({ prefix: "", anchor: "/" })
  expect(splitAnchor("C:\\Users\\dev\\repo")).toEqual({ prefix: "C:\\Users\\dev\\", anchor: "repo" })
  expect(splitAnchor("plain")).toEqual({ prefix: "", anchor: "plain" })
})
