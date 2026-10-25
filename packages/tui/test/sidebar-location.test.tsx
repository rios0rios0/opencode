import { expect, test } from "bun:test"
import { ansiToRgba } from "../src/theme/color"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const sessionDirectory = "/srv/projects/alpha"

test("sidebar footer shows the active session's location and branch over the global location", async () => {
  await using state = await tmpdir()
  const session = {
    id: `ses_${crypto.randomUUID()}`,
    projectID: "project",
    title: "Sidebar location fixture",
    agent: "build",
    model: { providerID: "demo", id: "first" },
    location: { directory: sessionDirectory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  await using setup = await createAppFixture({
    width: 160,
    state: state.path,
    config: { animations: false, tabs: { mode: "off" } },
    args: { sessionID: session.id },
    fetch: async (url) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: [
            {
              id: "first",
              providerID: "demo",
              name: "first model",
              variants: [],
              cost: [],
              time: { released: 0 },
            },
          ],
        })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`) return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
      if (url.pathname === "/api/vcs") {
        const queried = url.searchParams.get("location[directory]") ?? ""
        return json({
          location: { directory: queried },
          data: {
            branch: { current: queried === sessionDirectory ? "feature/session" : "context-branch", default: "main" },
          },
        })
      }
      return undefined
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("feature/session"))

  const footer = setup.renderer.root.findDescendantById("sidebar.footer.location")
  if (!footer) throw new Error("sidebar footer location was not rendered")
  const row = setup.captureSpans().lines[footer.y]
  const text = row?.spans.map((span) => span.text).join("") ?? ""
  expect(text).toContain("alpha")
  expect(text).toContain("feature/session")
  expect(text).not.toContain("context-branch")
})

test("standard prompt location uses the Powerlevel10k directory and Git colors", async () => {
  await using setup = await createAppFixture({ width: 160, config: { animations: false, tabs: { mode: "off" } } })
  await setup.ready
  const location = setup.renderer.root.findDescendantById("prompt.footer.location")
  if (!location) throw new Error("prompt location footer was not rendered")
  const spans = setup.captureSpans().lines[location.y]?.spans ?? []
  const directory = spans.find((span) => span.text.includes("/"))
  const anchor = spans.find((span) => span.text === "tui")
  const gitIcon = spans.find((span) => span.text.includes("⎇"))
  expect(directory?.fg.toInts()).toEqual(ansiToRgba(9).toInts())
  expect(anchor?.fg.toInts()).toEqual(ansiToRgba(21).toInts())
  expect(gitIcon?.fg.toInts()).toEqual(ansiToRgba(9).toInts())
})
