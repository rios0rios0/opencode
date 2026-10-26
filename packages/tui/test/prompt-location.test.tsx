import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { json } from "./fixture/tui-client"

const project = "/home/rios0rios0/Development/github.com/rios0rios0/opencode"
const location = { directory: project, project: { id: "project", directory: project, canonical: project } }

/**
 * The location row is laid out before the VCS probe answers, so its first measurement has no
 * branch. Gating the branch on the label box's own width made that first measurement permanent:
 * the box never grew to admit a branch that arrived later.
 */
test("the prompt location keeps the branch when VCS info arrives after the first layout", async () => {
  await using state = await tmpdir()
  const session = {
    id: `ses_${crypto.randomUUID()}`,
    projectID: "project",
    title: "Prompt location fixture",
    agent: "build",
    model: { providerID: "demo", id: "first" },
    location: { directory: project },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  let releaseBranch = () => {}
  const branchReply = new Promise<void>((resolve) => (releaseBranch = resolve))
  await using setup = await createAppFixture({
    width: 120,
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
            { id: "first", providerID: "demo", name: "first model", variants: [], cost: [], time: { released: 0 } },
          ],
        })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`) return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
      if (url.pathname === "/api/vcs") {
        await branchReply
        return json({ location, data: { branch: { current: "reworked", default: "dev" } } })
      }
      return undefined
    },
  })
  await setup.ready
  await waitForFrame(setup, (frame) => frame.includes("opencode"))
  releaseBranch()

  await waitForFrame(setup, (frame) => frame.includes("\u2387 reworked"))
  const line = setup
    .captureSpans()
    .lines.find((item) => item.spans.some((span) => span.text.includes("opencode")))
  const text = line?.spans.map((span) => span.text).join("") ?? ""
  expect(text).toContain(project)
  expect(text).toContain("\u2387 reworked")
})

async function waitForFrame(setup: Awaited<ReturnType<typeof createAppFixture>>, matches: (frame: string) => boolean) {
  const started = Date.now()
  while (!matches(setup.captureCharFrame())) {
    if (Date.now() - started > 2_000) throw new Error("Timed out waiting for the prompt location frame")
    await Bun.sleep(10)
  }
}
