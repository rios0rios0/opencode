# Feature Request: Display the OmniRoute-Routed Model Per Response

**Project:** OCode fork of OpenCode

**Area:** Provider integrations / TUI transcript and status

## Problem

When OmniRoute is selected, OCode displays the requested model id—`omniroute/auto/coding`, another `auto/*` combo, or a single model—as if it were the model that answered. OmniRoute routes each request (and re-routes on fallback) to a concrete upstream model and connection, and reports the outcome in `X-OmniRoute-*` response headers. Nothing in OCode reads response headers on successful provider responses, so the `x-omniroute-*` headers still aren't shown. A user cannot tell:

- which model actually served a step (`X-OmniRoute-Model`) and from which provider (`X-OmniRoute-Provider`);
- which strategy handled it, for example `strategy=cost-saver; provider=nvidia; latency_ms=812` (`X-OmniRoute-Decision`);
- what the step cost, how many tokens it used, whether a cache served it, or whether it fell back (`X-OmniRoute-Response-Cost`, `X-OmniRoute-Tokens-In`/`-Out`, `X-OmniRoute-Cache-Hit`, `X-OmniRoute-Fallback-Attempts`).

With `auto/*` combos this is the difference between "the gateway answered" and "which of my models answered", so output quality, quota use, and cost cannot be attributed to a model.

## The Header Contract

OmniRoute documents its response headers in `docs/reference/API_REFERENCE.md` (v3.8.52):

| Header                                                                                                   | Meaning                                                                                               | When present                       |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `X-OmniRoute-Decision`                                                                                   | Routing trace: `strategy=<name>; provider=<alias>; latency_ms=<n>` (`single` for a non-combo request) | Always on completion responses     |
| `X-OmniRoute-Model`, `X-OmniRoute-Provider`                                                              | Effective upstream model and provider that served the response                                        | Cost-telemetry set                 |
| `X-OmniRoute-Response-Cost`, `X-OmniRoute-Tokens-In`, `X-OmniRoute-Tokens-Out`, `X-OmniRoute-Latency-Ms` | Cost and usage of the response (USD with fixed decimals; `0.0000000000` for free/unpriced)            | Cost-telemetry set                 |
| `X-OmniRoute-Cache-Hit`, `X-OmniRoute-Cache`, `X-OmniRoute-Cost-Saved`                                   | Cache result and the avoided cost on a hit                                                            | Cost-telemetry set / non-streaming |
| `X-OmniRoute-Fallback-Attempts`                                                                          | Fallback count of the request                                                                         | Only when greater than zero        |
| `X-OmniRoute-Request-Id`, `X-OmniRoute-Version`                                                          | Correlation id and gateway build                                                                      | Cost-telemetry set / always        |
| `X-OmniRoute-Connection-Name`                                                                           | Privacy-safe configured display name of the connection used for this response                        | Proposed; requires an OmniRoute contract |

OmniRoute emits the cost-telemetry set on non-streaming success responses of `/v1/chat/completions`, `/v1/responses`, `/v1/messages`, and the media endpoints, and `X-OmniRoute-Decision` on completion responses. OCode streams by default, so treat every value as best-effort per response, as described below.

## Desired Behavior

- Capture the `X-OmniRoute-*` headers of each provider response in OCode and attach the routed result to the corresponding assistant step. Routing can differ per step, so the unit of display is the response, not the session.
- Display the routed model and provider in addition to the selected model, never replacing it: for example `routed: nvidia/z-ai/glm-5.3` next to `omniroute/auto/coding`, or the decision trace where there is room.
- Natural surfaces, in order of priority:
  1. the per-step assistant footer in the transcript (already shows agent, model, and duration);
  2. the message details for a step;
  3. the status bar (`routed:` segment) when a step is active or selected.
- Show what OmniRoute actually returned, one step at a time: the routed model of step N is never displayed as the routed model of step N+1, and a fallback is visible as a fallback rather than presented as a direct route.
- Distinguish absent data from zero or unlimited: a missing header renders as nothing, never as a guess or a default. Do not infer routing from the model id (`auto/coding` claims nothing about what served it).
- Works for streaming and non-streaming requests: response headers that arrive with the streamed response are used; values OmniRoute only exposes on non-streaming success are shown when present and omitted otherwise. If OmniRoute cannot expose a needed value for streaming requests, coordinate a completion signal with OmniRoute rather than fabricating one.
- Persist the routed result with the step so a reloaded transcript still shows which model served it.
- Do not display credentials, API keys, or account identifiers. The request id, model, provider, cost, tokens, latency, cache, fallback, and version are safe to show or log.
- When OmniRoute provides `X-OmniRoute-Connection-Name`, show that configured safe label as the selected account identity. Never infer it from provider/model names or substitute an email, raw connection ID, or API-key ID. OmniRoute must omit it when no safe configured label is available.
- Keep the local Git `user.email` visible in the location row; the connection label occupies its former status-row position.

## Relevant OCode Areas

- Fork's provider plugin: `packages/core/src/plugin/provider/omniroute.ts` (branch `feat/provider-omniroute`) declares the provider on `@opencode/ai/providers/openai-compatible`.
- Provider fetch boundary where a successful response (streaming included) and its headers are directly observable: `packages/core/src/aisdk.ts`—the `options.fetch` wrapper in `prepareOptions` and the HTTP hook middleware both hold the `Response`; `streamPartEvents` currently drops `response-metadata` stream parts. The `AIError` path already carries `responseHeaders` for failures; successful responses need the equivalent.
- Per-step display: `AssistantFooter` in `packages/tui/src/routes/session/index.tsx` renders `agent · model · duration` per step; message details live in `packages/tui/src/routes/session/dialog-message.tsx`.
- Status bar surfaces: `packages/tui/src/feature-plugins/prompt/footer.tsx`, and the mini footer `packages/tui/src/mini/footer.view.tsx` with `packages/tui/src/mini/footer.width.ts` (see [Feature 5](05-ocode-provider-aware-footer.md) and [Feature 8](08-powerlevel10k-footer.md)).
- Mini stream path, if mini mode should show the routed model: `packages/tui/src/mini/stream-v2.transport.ts`.

Use OmniRoute's documented header contract; do not predict routing, provider, or cost from alias names, and do not hard-code header values.

## Acceptance Criteria

- A step served through `omniroute/auto/coding` displays the effective routed model and provider exactly as OmniRoute reported them for that response, when returned.
- A response without `X-OmniRoute-*` headers shows only the selected model, with no routed claim and no error.
- Consecutive steps routed to different models keep their own values; switching models or reloading the transcript never shows a stale routed result as current.
- A fallback step is visible as such when `X-OmniRoute-Fallback-Attempts` is returned, and is not presented as a direct route.
- Cost, tokens, latency, cache, and version are shown only when returned; missing values render as absent, never as zero or unlimited.
- Streaming requests display the subset that actually arrived; non-streaming requests display the full returned set, including the decision trace.
- The selected model keeps its meaning and position; the routed model is presented as additional, clearly attributed information.
- No credentials, API keys, or account identifiers appear in the UI, logs, or stored metadata.

## Tests

- [ ] Fixture response with `X-OmniRoute-Model`, `-Provider`, and `-Decision` renders the routed model on the step and the status surface.
- [ ] Fixture response without the headers renders the selected model alone; nothing is invented.
- [ ] Two consecutive steps with different routed models keep their own values; reload and model switch clear stale attribution.
- [ ] Fallback (`X-OmniRoute-Fallback-Attempts: 1`), cache hit, and cost cases render only their returned fields.
- [ ] Streaming request with headers present at response start behaves per the honesty rule; non-streaming request shows the full telemetry set.
- [ ] Verify redaction and that a request id, not account identity, is what appears in logs.
