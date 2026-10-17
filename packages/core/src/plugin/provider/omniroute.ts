import { Effect, Schema } from "effect"
import { createLocalProviderPlugin } from "./local.js"

const RemoteModel = Schema.Struct({
  id: Schema.String,
  name: Schema.String.pipe(Schema.optional),
  object: Schema.String.pipe(Schema.optional),
  type: Schema.String.pipe(Schema.optional),
  context_length: Schema.Number.pipe(Schema.optional),
  input_modalities: Schema.Array(Schema.String).pipe(Schema.optional),
  capabilities: Schema.Struct({
    tool_calling: Schema.Boolean.pipe(Schema.optional),
    reasoning: Schema.Boolean.pipe(Schema.optional),
  }).pipe(Schema.optional),
})

const Response = Schema.Struct({ data: Schema.Array(RemoteModel) })

export const make = createLocalProviderPlugin({
  id: "opencode.provider.omniroute",
  providerID: "omniroute",
  name: "OmniRoute",
  origin: "http://127.0.0.1:20128",
  discover: (client) =>
    Effect.gen(function* () {
      const response = yield* client.getJson("/v1/models", Response)
      return response.data
        .filter(
          (model) =>
            model.id.length > 0 &&
            (model.object === undefined || model.object === "model") &&
            (model.type === undefined || model.type === "chat"),
        )
        .toSorted((a, b) => a.id.localeCompare(b.id))
    }),
  model: (item) => ({
    id: item.id,
    name: item.name || item.id,
    tools: item.capabilities?.tool_calling ?? false,
    vision: (item.input_modalities ?? []).includes("image"),
    context: item.context_length ?? null,
  }),
})

export const OmniRoutePlugin = make()
