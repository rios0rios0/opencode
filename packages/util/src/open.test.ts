import { describe, expect, test } from "bun:test"
import { browserUrl, openUrl } from "./open.js"

describe("browserUrl", () => {
  test("normalizes http and https destinations", () => {
    expect(browserUrl("https://example.com")).toBe("https://example.com/")
    expect(browserUrl("http://example.com/docs?page=2#intro")).toBe("http://example.com/docs?page=2#intro")
  })

  test("returns undefined for anything a browser cannot open", () => {
    expect(browserUrl("not a url")).toBeUndefined()
    expect(browserUrl("")).toBeUndefined()
    expect(browserUrl("file:///etc/hosts")).toBeUndefined()
    expect(browserUrl("mailto:team@opencode.ai")).toBeUndefined()
    expect(browserUrl("javascript:alert(1)")).toBeUndefined()
  })
})

describe("openUrl", () => {
  test("rejects values that are not URLs", async () => {
    await expect(openUrl("not a url")).rejects.toThrow("Only http and https links")
    await expect(openUrl("")).rejects.toThrow("Only http and https links")
  })

  test("rejects non-http schemes", async () => {
    await expect(openUrl("file:///etc/hosts")).rejects.toThrow("Only http and https links")
    await expect(openUrl("javascript:alert(1)")).rejects.toThrow("Only http and https links")
    await expect(openUrl("ms-msdt:/id PCWDiagnostic")).rejects.toThrow("Only http and https links")
    await expect(openUrl("\\\\server\\share\\file.html")).rejects.toThrow("Only http and https links")
  })
})
