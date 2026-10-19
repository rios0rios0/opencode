import { expect, test } from "bun:test"
import { mkdirSync, symlinkSync } from "node:fs"
import path from "node:path"
import { sameDirectory } from "../../src/session-source"
import { tmpdir } from "../fixture/fixture"

test("matches directories exactly, never by shared prefix", () => {
  expect(sameDirectory("/projects/demo", "/projects/demo")).toBe(true)
  expect(sameDirectory("/projects/demo/", "/projects/demo")).toBe(true)
  expect(sameDirectory("/projects/demo", "/projects/demo-other")).toBe(false)
  expect(sameDirectory("/projects/demo", "/projects/demo/nested")).toBe(false)
  expect(sameDirectory("C:\\projects\\demo", "C:/projects/demo")).toBe(true)
})

test.skipIf(process.platform === "win32")("matches symlinked spellings of one directory", async () => {
  await using temporary = await tmpdir()
  const real = path.join(temporary.path, "project")
  const link = path.join(temporary.path, "link")
  mkdirSync(real, { recursive: true })
  symlinkSync(real, link)

  expect(sameDirectory(link, real)).toBe(true)
  // A worktree next to the project stays a different directory instead of a prefix match.
  expect(sameDirectory(path.join(temporary.path, "project-worktree"), real)).toBe(false)
})
