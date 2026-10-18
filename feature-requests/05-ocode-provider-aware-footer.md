# Feature Request: Render Provider-Aware Model Quotas in the OCode Footer

**Project:** OCode fork of OpenCode

**Area:** TUI footer / provider usage information

## Problem

The footer can show provider branding and limits such as 5 hours, 7 days, and 30 days, but those values must describe the provider, model, and account/plan actually in use. Showing OpenCode/Fable quota data for an OmniRoute route—or showing the same limits for all OmniRoute models—is misleading.

## Desired Behavior

- Identify the active provider and model.
- When using OmniRoute, fetch the selected model's quota data from the documented OmniRoute quota API in [Feature 4](04-omniroute-quota-api.md).
- Render available 5h, 7d, and 30d windows, plus usage/remaining/reset information when returned. Support additional windows without assuming every provider has them.
- When using OpenCode directly, show only the applicable OpenCode/Fable information. Do not reuse those values as OmniRoute quota data.
- Refresh or invalidate quota information when provider, model, account/route scope, or window changes. Do not briefly show the prior model's values as current after switching.
- Distinguish loading, stale, unavailable, and unsupported data. Missing values must not appear as unlimited usage.
- Do not display credentials or sensitive account identifiers.

## Relevant OCode Areas

- Mini footer/statusline: `packages/tui/src/mini/footer.view.tsx`
- Prompt footer/status bar: `packages/tui/src/feature-plugins/prompt/footer.tsx`
- Footer layout and sizing: `packages/tui/src/mini/footer.width.ts`
- Existing provider/model metadata is passed through the footer as `RunProvider[]` and `currentModel()`.

Use OmniRoute's documented API contract; do not infer quota values from model names or hard-code assumptions about free/paid providers.

## Acceptance Criteria

- Selecting an OpenAI model via OmniRoute displays the authoritative 5h/7d/30d values returned for that selected model and account/plan, when available.
- Changing model/provider updates the displayed quota; old model values are not shown as current.
- Unsupported or unavailable windows are omitted or labeled appropriately, never guessed or presented as unlimited.
- Direct OpenCode/Fable quotas are not attributed to OmniRoute.
- The footer handles slow/error/stale API responses without blocking the prompt or showing misleading data.
- No credentials or sensitive account identifiers are shown in UI or logs.

## Tests

- [ ] Fixture-backed footer tests render an OpenAI-via-OmniRoute quota response.
- [ ] Verify available 5h, 7d, 30d, and additional windows render correctly.
- [ ] Verify unsupported/unavailable/stale/loading states do not show invented limits.
- [ ] Switch providers and models; confirm stale prior values are cleared or replaced.
- [ ] Verify direct OpenCode/Fable display remains scoped to OpenCode.
- [ ] Check narrow terminal widths and sensitive-data redaction.
