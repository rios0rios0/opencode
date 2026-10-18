# Feature Request: Expose Selected-Model Quotas Through the OmniRoute API

**Project:** OmniRoute

**Area:** API / provider integrations

## Problem

Clients using OmniRoute as a proxy cannot reliably determine the applicable usage limits from a model ID alone. For example, a user selecting an OpenAI model through OmniRoute needs the 5-hour, 7-day, and 30-day quota information for the effective OmniRoute account/plan and route. Upstream providers may have different quota windows, plans, and sources of truth.

## Desired Behavior

Provide an authenticated endpoint that returns quota information for the selected OmniRoute model and the authenticated account/plan. The API should:

- Return applicable 5-hour, 7-day, and 30-day windows when available, with an extensible representation for other window lengths.
- Include limit and, when available, used/remaining amounts and reset time.
- Identify the selected model and the quota source/scope (for example upstream account/plan, provider/model, or an OmniRoute policy).
- Describe automatic/fallback routing honestly: report a resolved provider/model only when known; otherwise identify route-level or aggregate scope without claiming a single upstream destination.
- Distinguish available, unsupported, unavailable, and stale information. Never guess a limit or treat missing data as unlimited.
- Include a fetched/updated timestamp so clients can display freshness and apply bounded caching.

## Illustrative Response Shape

The final schema and endpoint path are for OmniRoute to define. Example values below are placeholders, not actual quota limits.

```json
{
  "model": { "providerID": "omniroute", "modelID": "openai/example-model" },
  "scope": { "type": "upstream-account-plan", "providerID": "openai" },
  "windows": [
    { "period": "5h", "status": "available", "limit": 100, "used": 42, "resetsAt": "2026-10-17T15:00:00Z" },
    { "period": "7d", "status": "available", "limit": 500, "used": 120, "resetsAt": "2026-10-23T12:00:00Z" },
    { "period": "30d", "status": "unsupported" }
  ],
  "updatedAt": "2026-10-17T14:30:00Z"
}
```

## Provider Coverage and Security

- Implement provider-specific adapters for upstream providers and account/plan types supported by OmniRoute, using authoritative quota/usage sources where available.
- Normalize provider responses while preserving their source and scope.
- Return explicit unsupported/unavailable status when the upstream provider does not expose a quota or configured credentials cannot access it.
- Scope every request to the authenticated user/account and selected model. Never expose credentials, tokens, or another account's quota data.

## Acceptance Criteria

- An authenticated client can request quota data for a selected OmniRoute model.
- Supported windows and plan-specific values are returned with source/scope and freshness metadata.
- Partial, unsupported, unavailable, and stale data are distinguishable.
- Automatic/fallback routes do not misrepresent unknown upstream details.
- Cross-account requests cannot reveal another account's quota or credentials.

## Tests

- [ ] Contract tests cover 5h, 7d, 30d, and a provider-specific additional window.
- [ ] Provider adapter tests validate normalized values and their source/scope.
- [ ] Test partial data and unsupported, unavailable, stale, and refresh/error cases.
- [ ] Test automatic/fallback routing with known and unknown effective upstream routes.
- [ ] Verify authentication, account isolation, and secret redaction.
