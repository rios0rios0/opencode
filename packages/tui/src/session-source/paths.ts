import { realpathSync, statSync } from "node:fs"
import path from "node:path"

/** Expands a leading `~` in a configured directory using the provided home. */
export function expandHome(input: string, home: string) {
  if (input === "~") return home
  if (input.startsWith("~/") || input.startsWith("~\\")) return path.join(home, input.slice(2))
  return input
}

/** Shortens a store path under the home directory to a `~/...` label. */
export function displayPath(directory: string, home: string) {
  const relative = path.relative(home, directory)
  if (relative === "") return "~"
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return `~/${relative.split(path.sep).join("/")}`
  return directory
}

/** Resolves symlinks when the path exists, so identity comparisons survive them. */
export function canonicalPath(directory: string) {
  const resolved = path.resolve(directory)
  try {
    return realpathSync(resolved)
  } catch {
    return resolved
  }
}

export function isDirectory(directory: string) {
  try {
    return statSync(directory).isDirectory()
  } catch {
    return false
  }
}

/**
 * Compares session directories across stores. Stored paths always use forward slashes; on
 * Windows the comparison is case-insensitive. Symlinked spellings of one directory match,
 * while prefixes never do, so unrelated projects that merely share a path prefix stay apart.
 */
export function sameDirectory(left: string, right: string) {
  const a = canonicalPath(left.replaceAll("\\", "/"))
  const b = canonicalPath(right.replaceAll("\\", "/"))
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
}
