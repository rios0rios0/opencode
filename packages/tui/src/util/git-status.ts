import type { RGBA } from "@opentui/core"

export type GitWorkingTreeState = "clean" | "modified" | "untracked" | "conflicted"

export type GitWorkingTree = {
  state: GitWorkingTreeState
  /** Current branch name; absent when HEAD is detached or the command failed to report one. */
  branch?: string
  ahead?: number
  behind?: number
}

/** Cached results stay fresh for one statusline refresh; in-flight reads are shared. */
const GIT_STATUS_TTL = 30_000
const fresh = new Map<string, { value: GitWorkingTree | undefined; at: number }>()
const pending = new Map<string, Promise<GitWorkingTree | undefined>>()

/**
 * Working-tree state of a directory, from `git status --porcelain=v2 --branch`.
 * Non-Git directories and failed spawns resolve `undefined`.
 */
export function readGitWorkingTree(directory: string): Promise<GitWorkingTree | undefined> {
  const cached = fresh.get(directory)
  if (cached && Date.now() - cached.at < GIT_STATUS_TTL) return Promise.resolve(cached.value)
  const inflight = pending.get(directory)
  if (inflight) return inflight
  const probe = statusProbe(directory).then((value) => {
    fresh.set(directory, { value, at: Date.now() })
    pending.delete(directory)
    return value
  })
  pending.set(directory, probe)
  return probe
}

/** @internal Only tests need to clear the cache; real users rely on the TTL. */
export function forgetGitWorkingTree(directory?: string) {
  if (directory === undefined) {
    fresh.clear()
    return
  }
  fresh.delete(directory)
}

async function statusProbe(directory: string): Promise<GitWorkingTree | undefined> {
  let proc
  try {
    proc = Bun.spawn(["git", "status", "--porcelain=v2", "--branch", "-unormal"], {
      cwd: directory,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    })
  } catch {
    return undefined
  }
  const [output, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  if (code !== 0) return undefined
  const tree: GitWorkingTree = { state: "clean" }
  for (const line of output.split("\n")) {
    if (line.startsWith("# branch.head ")) {
      const name = line.slice("# branch.head ".length)
      if (name !== "(detached)") tree.branch = name
      continue
    }
    if (line.startsWith("# branch.ab ")) {
      const match = line.match(/^# branch\.ab \+(\d+) -(\d+)$/)
      if (match) {
        tree.ahead = Number(match[1])
        tree.behind = Number(match[2])
      }
      continue
    }
    if (line.startsWith("u ")) {
      tree.state = "conflicted"
      continue
    }
    if ((line.startsWith("1 ") || line.startsWith("2 ")) && tree.state !== "conflicted") {
      tree.state = "modified"
      continue
    }
    if (line.startsWith("? ") && tree.state === "clean") tree.state = "untracked"
  }
  return tree
}

export type GitBranchColor = "plain" | GitWorkingTreeState

/** The branch state drives its color: conflicts outrank edits, which outrank untracked files. */
export function gitBranchColor(git: GitWorkingTree | undefined): GitBranchColor {
  if (!git) return "plain"
  return git.state
}

export type GitBranchColors = Record<GitBranchColor, RGBA>
