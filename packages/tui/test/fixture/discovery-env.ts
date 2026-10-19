/** Clears ambient store-location overrides so external-session tests own their fixture roots. */
export async function withoutDiscoveryOverrides<T>(run: () => Promise<T>): Promise<T> {
  const keys = ["XDG_DATA_HOME", "LOCALAPPDATA", "CLAUDE_CONFIG_DIR", "CODEX_HOME"]
  const saved = new Map(keys.map((key) => [key, process.env[key]]))
  for (const key of keys) delete process.env[key]
  try {
    return await run()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
