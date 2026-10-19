import { expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { forgetGitWorkingTree, readGitWorkingTree } from "../src/util/git-status"
import { tmpdir } from "./fixture/fixture"

async function git(directory: string, args: string[]) {
  const proc = Bun.spawn(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}

async function repo() {
  const state = await tmpdir()
  const run = (args: string[]) => git(state.path, args)
  expect((await run(["init", "-q", "-b", "main"])).code).toBe(0)
  await run(["config", "user.email", "test@test"])
  await run(["config", "user.name", "Test"])
  await writeFile(path.join(state.path, "base.txt"), "base\n")
  await run(["add", "base.txt"])
  await run(["commit", "-q", "-m", "base"])
  return Object.assign(state, { run })
}

test("readGitWorkingTree reports a clean repository with its branch", async () => {
  await using first = await repo()
  expect(await readGitWorkingTree(first.path)).toEqual({ state: "clean", branch: "main" })
})

test("readGitWorkingTree detects modified, untracked and conflicted states", async () => {
  await using first = await repo()
  const state = first
  const run = first.run

  await writeFile(path.join(state.path, "base.txt"), "edited\n")
  expect(await forgetRead(state.path)).toMatchObject({ state: "modified" })

  await run(["checkout", "-q", "base.txt"])
  await writeFile(path.join(state.path, "new.txt"), "new\n")
  expect(await forgetRead(state.path)).toMatchObject({ state: "untracked" })

  // An edit outranks untracked files, like the Powerlevel10k reference.
  await writeFile(path.join(state.path, "base.txt"), "edited again\n")
  expect(await forgetRead(state.path)).toMatchObject({ state: "modified" })
  await run(["checkout", "-q", "base.txt"])
  await run(["rm", "-q", "new.txt"])

  // A merge conflict outranks everything else.
  await run(["checkout", "-q", "-b", "feature"])
  await writeFile(path.join(state.path, "base.txt"), "feature\n")
  await run(["add", "base.txt"])
  await run(["commit", "-q", "-m", "feature"])
  await run(["checkout", "-q", "main"])
  await writeFile(path.join(state.path, "base.txt"), "main\n")
  await run(["add", "base.txt"])
  await run(["commit", "-q", "-m", "main"])
  await run(["merge", "feature"])
  expect(await forgetRead(state.path)).toMatchObject({ state: "conflicted", branch: "main" })
})

test("readGitWorkingTree reports ahead and behind counts from the upstream", async () => {
  await using second = await repo()
  await second.run(["checkout", "-q", "-b", "other"])
  await second.run(["commit", "-q", "--allow-empty", "-m", "one"])
  await second.run(["commit", "-q", "--allow-empty", "-m", "two"])
  await second.run(["branch", "--set-upstream-to=other", "main"])
  await second.run(["checkout", "-q", "main"])
  expect(await forgetRead(second.path)).toEqual({ state: "clean", branch: "main", ahead: 0, behind: 2 })
})

test("readGitWorkingTree resolves undefined for non-Git directories and detached heads", async () => {
  await using plain = await tmpdir()
  expect(await readGitWorkingTree(plain.path)).toBeUndefined()

  await using third = await repo()
  await third.run(["checkout", "-q", "--detach"])
  const detached = await forgetRead(third.path)
  expect(detached).toMatchObject({ state: "clean" })
  expect(detached?.branch).toBeUndefined()
})

test("forgetGitWorkingTree invalidates the cached reading", async () => {
  await using fourth = await repo()
  const cached = fourth.path
  expect((await readGitWorkingTree(cached))?.state).toBe("clean")
  await writeFile(path.join(cached, "new.txt"), "new\n")
  // The TTL cache still answers with the clean reading.
  expect((await readGitWorkingTree(cached))?.state).toBe("clean")
  forgetGitWorkingTree(cached)
  expect((await readGitWorkingTree(cached))?.state).toBe("untracked")
})

/** Reads after bypassing the TTL cache, the way the statusline refresh does. */
async function forgetRead(directory: string) {
  forgetGitWorkingTree(directory)
  return readGitWorkingTree(directory)
}
