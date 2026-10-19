import open from "open"

/**
 * The normalized href a browser can open, or undefined for anything else such as mailto:, file:, a custom scheme,
 * or a relative path.
 */
export function browserUrl(input: string) {
  const url = URL.canParse(input) ? new URL(input) : undefined
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return
  return url.href
}

export function openUrl(input: string) {
  const url = browserUrl(input)
  if (!url) return Promise.reject(new Error(`Only http and https links can be opened in the browser: ${input}`))
  return open(url)
}

export function openPath(path: string) {
  return open(path)
}
