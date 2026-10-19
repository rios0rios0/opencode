import { expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../src/index.js"
import { LLMClient } from "../src/route/client.js"
import * as OpenAICompatibleChat from "../src/protocols/openai-compatible-chat.js"
import { fixedResponse } from "./lib/http.js"
import { sseEvents } from "./lib/sse.js"
import { testEffect } from "./lib/effect.js"

const route = OpenAICompatibleChat.route.with({
  provider: "omniroute",
  endpoint: { baseURL: "https://provider.test/v1" },
})

const chunks = sseEvents(
  {
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    model: "auto/coding",
    choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
  },
  {
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    model: "auto/coding",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
  },
)

testEffect(fixedResponse(chunks, { headers: { "content-type": "text/event-stream" } })).live(
  "route leaves provider metadata alone when the response has no OmniRoute headers",
  () =>
    Effect.gen(function* () {
      const request = LLM.request({ model: route.model({ id: "auto/coding" }), prompt: "Hi" })
      const response = yield* LLMClient.generate(request)
      for (const event of response.events) {
        if (!("providerMetadata" in event) || event.providerMetadata === undefined) continue
        expect(event.providerMetadata["omniroute"]).toBeUndefined()
      }
    }),
)

testEffect(
  fixedResponse(chunks, {
    headers: {
      "content-type": "text/event-stream",
      "x-omniroute-model": "glm-5.3",
      "x-omniroute-provider": "nvidia",
      "x-omniroute-decision": "strategy=cost-saver; provider=nvidia; latency_ms=812",
      "x-omniroute-response-cost": "0.0042100000",
      "x-omniroute-tokens-in": "120",
      "x-omniroute-tokens-out": "30",
      "x-omniroute-cache-hit": "false",
      "x-omniroute-fallback-attempts": "2",
      "x-omniroute-request-id": "req_abc",
    },
  }),
).live("route attaches the routed OmniRoute result to the events of that response", () =>
  Effect.gen(function* () {
    const request = LLM.request({ model: route.model({ id: "auto/coding" }), prompt: "Hi" })
    const response = yield* LLMClient.generate(request)
    const routed = {
      model: "glm-5.3",
      provider: "nvidia",
      decision: "strategy=cost-saver; provider=nvidia; latency_ms=812",
      cost: "0.0042100000",
      tokensIn: 120,
      tokensOut: 30,
      cacheHit: false,
      fallbackAttempts: 2,
      requestID: "req_abc",
    }
    for (const end of response.events.filter((event) => event.type === "text-end")) {
      expect(end.providerMetadata).toEqual({ omniroute: { routed } })
    }
    const finish = response.events.find((event) => event.type === "step-finish")
    expect(finish?.providerMetadata).toEqual({ omniroute: { routed } })
  }),
)
