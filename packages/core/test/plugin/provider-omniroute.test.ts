import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { OmniRoutePlugin, make } from "@opencode/core/plugin/provider/omniroute"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { Provider } from "@opencode/core/provider"
import { Document, Event, Info } from "@opencode/schema/config"
import { describe, expect, test } from "bun:test"
import { Duration, Effect, Layer, Schema } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(Layer.merge(PluginTestLayer, Config.testLayer()))
const decode = Schema.decodeUnknownSync(Info)

const addPlugin = Effect.fn(function* (origin: string, interval: Duration.Input = "1 hour") {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* make(origin, interval).effect(host)
})

function eventually<A>(
  effect: Effect.Effect<A>,
  predicate: (value: A) => boolean,
  remaining = 3000,
): Effect.Effect<A, Error> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value)) return value
    if (remaining === 0) return yield* Effect.fail(new Error("Timed out waiting for value"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, predicate, remaining - 1)
  })
}

describe("OmniRoutePlugin", () => {
  test("is registered as a built-in provider plugin", () => {
    expect(OmniRoutePlugin.id).toBe("opencode.provider.omniroute")
    expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.omniroute")
  })

  it.live("discovers the gateway catalog with capabilities and effective context", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: () =>
            Response.json({
              data: [
                {
                  id: "auto/coding",
                  object: "model",
                  created: 1_792_120_231,
                  owned_by: "combo",
                  permission: [],
                  root: "auto/coding",
                  parent: null,
                  name: "Auto coding",
                  context_length: 1_048_576,
                  max_input_tokens: 1_048_576,
                  max_output_tokens: 384_000,
                  input_modalities: ["text", "image"],
                  output_modalities: ["text"],
                  capabilities: { tool_calling: true, reasoning: true, thinking: true, temperature: true },
                },
                {
                  id: "cx/deepseek-v4.1-flash",
                  object: "model",
                  owned_by: "openrouter",
                  api_format: "responses",
                  context_length: 1_000_000,
                  capabilities: { tool_calling: true, reasoning: true },
                },
                { id: "plain-model", object: "model" },
                {
                  id: "codex/gpt-5.6-luna-image",
                  object: "model",
                  owned_by: "codex",
                  type: "image",
                  supported_sizes: ["1024x1024"],
                },
              ],
            }),
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const providers = yield* Provider.Service
          const modelState = yield* Model.Service
          yield* addPlugin(server.url.origin)
          const providerID = Provider.ID.make("omniroute")
          const autoCoding = yield* eventually(
            modelState.get(providerID, Model.ID.make("auto/coding")),
            (model) => model !== undefined,
          )

          expect(yield* providers.get(providerID)).toEqual({
            id: providerID,
            name: "OmniRoute",
            activation: "enabled",
            package: "@opencode/ai/providers/openai-compatible",
            settings: { baseURL: `${server.url.origin}/v1`, provider: "omniroute", apiKey: "" },
          })
          expect((yield* providers.available()).map((provider) => provider.id)).toContain(providerID)
          expect(autoCoding).toMatchObject({
            name: "Auto coding",
            capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
            limit: { context: 1_048_576 },
          })
          expect(yield* modelState.get(providerID, Model.ID.make("cx/deepseek-v4.1-flash"))).toMatchObject({
            name: "cx/deepseek-v4.1-flash",
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            limit: { context: 1_000_000 },
          })
          expect(yield* modelState.get(providerID, Model.ID.make("plain-model"))).toMatchObject({
            capabilities: { tools: false, input: ["text"], output: ["text"] },
            limit: { context: 200_000 },
          })
          expect(yield* modelState.get(providerID, Model.ID.make("codex/gpt-5.6-luna-image"))).toBeUndefined()
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live("refreshes the catalog when OmniRoute models change", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const models: Array<Record<string, unknown>> = []
        return {
          models,
          server: Bun.serve({ port: 0, fetch: () => Response.json({ data: models }) }),
        }
      }),
      ({ models, server }) =>
        Effect.gen(function* () {
          const providers = yield* Provider.Service
          const modelState = yield* Model.Service
          const providerID = Provider.ID.make("omniroute")
          yield* addPlugin(server.url.origin, "5 millis")
          expect(yield* providers.get(providerID)).toBeUndefined()

          models.push({ id: "auto/coding", object: "model", context_length: 1_048_576 })
          expect(
            yield* eventually(
              modelState.get(providerID, Model.ID.make("auto/coding")),
              (model) => model !== undefined,
            ),
          ).toMatchObject({ name: "auto/coding" })

          models.splice(0)
          yield* eventually(providers.get(providerID), (provider) => provider === undefined)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.live(
    "discovers from the configured endpoint with bearer authentication",
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          const requests: Array<{ authorization: string | null; path: string }> = []
          const model = (id: string) => ({ id, object: "model", context_length: 32_768 })
          return {
            requests,
            initial: Bun.serve({ port: 0, fetch: () => Response.json({ data: [model("initial-model")] }) }),
            configured: Bun.serve({
              port: 0,
              fetch: (request) => {
                requests.push({
                  authorization: request.headers.get("authorization"),
                  path: new URL(request.url).pathname,
                })
                return Response.json({ data: [model("configured-model")] })
              },
            }),
          }
        }),
        ({ requests, initial, configured }) =>
          Effect.gen(function* () {
            const bus = yield* Bus.Service
            const providers = yield* Provider.Service
            const modelState = yield* Model.Service
            const config = yield* Config.Test
            const providerID = Provider.ID.make("omniroute")
            yield* addPlugin(initial.url.origin)
            yield* eventually(
              modelState.get(providerID, Model.ID.make("initial-model")),
              (model) => model !== undefined,
            )

            const baseURL = `${configured.url.origin}/proxy/v1`
            yield* config.setEntries([configuration(baseURL, "secret")])
            yield* bus.publish(Event.Updated, {})
            yield* eventually(
              modelState.get(providerID, Model.ID.make("configured-model")),
              (model) => model !== undefined,
            )

            expect(requests).toContainEqual({ authorization: "Bearer secret", path: "/proxy/v1/models" })
            expect(yield* modelState.get(providerID, Model.ID.make("initial-model"))).toBeUndefined()
            expect((yield* providers.get(providerID))?.settings).toEqual({
              baseURL,
              provider: "omniroute",
              apiKey: "secret",
            })
          }),
        ({ initial, configured }) =>
          Effect.promise(() => Promise.all([initial.stop(true), configured.stop(true)])),
      ),
    10_000,
  )

  it.live("shares discovery requests across plugin instances", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const requests = { count: 0 }
        return {
          requests,
          server: Bun.serve({
            port: 0,
            fetch: () => {
              requests.count++
              return Response.json({ data: [{ id: "shared-model", object: "model", context_length: 32_768 }] })
            },
          }),
        }
      }),
      ({ requests, server }) =>
        Effect.gen(function* () {
          const modelState = yield* Model.Service
          yield* addPlugin(server.url.origin)
          yield* addPlugin(server.url.origin)
          yield* eventually(
            modelState.get(Provider.ID.make("omniroute"), Model.ID.make("shared-model")),
            (model) => model !== undefined,
          )
          expect(requests.count).toBe(1)
        }),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )
})

function configuration(baseURL: string, apiKey: string | null) {
  return new Document({
    type: "document",
    info: decode({ providers: { omniroute: { settings: { baseURL, apiKey } } } }),
  })
}
