# RAID Quota Enforcement — Design (Layer 4, Thread A)

**Date:** 2026-05-29
**Status:** Approved (ready for implementation plan)
**Layer:** 4 (per-app enforcement) — the first of several independent Layer 4 sub-projects.

## Summary

Identity/entitlements Layers 1+2 are live on prod: companies/teams/memberships, per-principal `app_entitlements` with quota, an atomic hub `consume` endpoint, dashboard gating, and the `auth-client` `consume()` helper. Both prod users are already granted **RAID at 25 extracts/user/month**. But **nothing calls `consume()` yet**, so RAID's paid Anthropic call in `/extract` runs uncapped — the quota is granted but inert.

This spec activates that quota by enforcing it in RAID's `/extract` hot path. **No hub schema or endpoint changes** — everything server-side already shipped in Layers 1+2. The work is confined to the RAID app (backend gate + frontend messaging + tests) plus a RAID redeploy.

## Scope

**In scope:**
- Gate `/extract` on a hub `consume` call before the paid `extract()` runs.
- Branch on the consume result: proceed / quota exceeded / not entitled / hub unreachable.
- Surface the remaining count to the user reactively (after each extract, and on limit-reached).
- Tests for the new branches.

**Out of scope (documented future hardening, not built here):**
- Refund endpoint (`POST /api/apps/:app/refund`) + decrement-on-failure.
- Idempotency keys on consume for retry safety.
- Proactive on-page-load quota display (needs launch-time entitlement plumbing or a new `/api/me` endpoint).
- Team-/company-principal quotas (only per-user grants are seeded today; resolution already supports all three principal types, so no code change is needed when those are later granted).
- The other Layer 4 sub-projects: poker team-rooms, retro team-boards, signal team-scoping.

## Background: the existing contract (already shipped, unchanged)

- `/extract` runs behind `auth.requireAuth`, which sets `req.user = { id }` and `req.centralSessionId`.
- `auth.consume(centralSessionId)` (auth-client) POSTs to the hub `/api/apps/raid/consume` with the API key and returns one of:
  - `{ ok: true, remaining }` — quota unit atomically consumed (`remaining` is `null` for an unlimited grant).
  - `{ ok: false, reason: "quota_exceeded" }` — at limit (HTTP 402 from hub).
  - `{ ok: false, reason: "not_entitled" }` — no active entitlement (HTTP 403 from hub).
  - `{ ok: false, reason: "unreachable" }` — network/hub failure, or any other non-2xx (e.g. `session_not_found` → mapped to `"error"`).
- The hub `consume` is an atomic check-and-increment inside a single transaction (hub is one systemd process). This is why it must be called **before** the paid call: it is the gate, not a post-hoc tally.

## Design

### Architectural choice

Two options were considered:

1. **Count after a successful extract** — call consume (or a plain increment) only once `extract()` returns. Rejected: the paid Anthropic call has already run by the time we check, so an over-quota user still incurs cost. This defeats the cost gate.
2. **Atomic gate before the paid call (chosen)** — call `consume` first; only proceed to `extract()` if it returns `ok`. The atomic check-and-increment both authorises and reserves the unit before any spend.

### 1. Server — `raid/server.js`, `/extract` handler

Insert the gate between the existing input validation and the `extract()` call:

```
// after text + API_KEY validation, before extract():
const gate = await auth.consume(req.centralSessionId);
if (!gate.ok) {
  if (gate.reason === "quota_exceeded")
    return res.status(402).json({ error: "<limit message>", remaining: 0 });
  if (gate.reason === "not_entitled")
    return res.status(403).json({ error: "<no-access message>" });
  // unreachable, error, or anything else → fail-closed
  return res.status(503).json({ error: "<temporarily-unavailable message>" });
}

const raid = await extract(text, { apiKey: API_KEY, model: MODEL });
res.json({ ...raid, remaining: gate.remaining });
```

Key behaviours:
- **consume runs before `extract()`** — the paid call never fires unless a unit was successfully consumed.
- **Fail-closed on unreachable/error** — `503`, the paid call is skipped. This couples RAID's `/extract` availability to the hub, which is acceptable: RAID already depends on the hub to authenticate every request (SSO), so this adds no new coupling.
- **No refund** — if `extract()` later throws (the existing `502 "extract failed twice"` path), the consumed unit is **not** returned. Accepted: `extract()` already retries twice internally so hard failures are rare, and at a 25/month cap one occasionally-burned unit is negligible. Refund is documented future hardening.
- **`remaining` passthrough** — the success response includes `remaining` (a number, or `null` for an unlimited grant) so the frontend can show a running count.

### 2. Frontend — `raid/public/js/app.js`, `sendExtract`

The function already maps status codes to user messages (401 redirect, 502, 400, 429, generic `!res.ok`). Add:
- **402** → `"You've used all 25 extracts this month. Your quota resets on the 1st."` (treated as an error-card message, not a retryable failure).
- **403** → `"You don't have access to RAID. Request access from the Sprint Suite dashboard."` with a link back to the hub base URL.
- **503** → `"Service temporarily unavailable. Please try again in a moment."`
- **On success** → read `remaining` from the response; when it is a number, show a quiet "`N left this month`" indicator near the result (no indicator when `remaining` is `null`/unlimited).

Wording for the limit message says "resets on the 1st" because the quota period is calendar-month in UTC (`periodKey` uses `YYYY-MM`).

### 3. Tests

- **RAID server test** (mock `auth.consume`):
  - `ok:true` → `extract()` is called, response is `200` and includes `remaining`.
  - `quota_exceeded` → `402`, and `extract()` is **not** called (proves the gate stops the paid call).
  - `not_entitled` → `403`, `extract()` not called.
  - `unreachable` / `error` → `503`, `extract()` not called.
- **Frontend test** — extend the existing status-code mapping coverage for `402`/`403`/`503` and the `remaining` indicator on success.
- **Hub** — no new tests; `consume` is already covered (hub 94/94, auth-client 24/24).

## Deploy notes

- **RAID app redeploy required** — first RAID code change since tag `post-suite-auth`. Hub is untouched (no migration, no restart).
- **The cap becomes real the instant this ships.** Both prod users already have `raid` granted at 25/month; the moment enforcement deploys, the 26th extract in a UTC month returns 402. This is the intended effect — flag it at deploy so it's not a surprise.
- Tag `pre-raid-quota` before deploy, `post-raid-quota` after end-to-end verification (consume a unit, observe `remaining` decrement; force a 402 via a temporary low grant or by exhausting in a test account).
- Follow the IONOS deploy conventions and step-by-step shell rules (one command per block, no `&&`, no heredocs).

## Known limitation (recorded, not fixed here)

If a central session sits in auth-client's grace window (`graceMs`, default 5 min) but has already been pruned hub-side, `consume` returns `session_not_found` → auth-client maps it to `reason:"error"` → RAID fails closed with the generic 503 message. The user re-launches from the hub and continues. This is the same session-freshness gap already noted in the Layers 1+2 follow-ups; it is acceptable for this thread and not in scope to fix.

## References

- Identity/entitlements design: `docs/superpowers/specs/2026-05-29-hub-identity-entitlements-design.md`
- Hub consume endpoint: `hub/routes/api-apps.js`; resolution/atomic consume: `hub/lib/entitlements.js`
- auth-client consume: `shared/auth-client/lib/hub-api.js`, exposed via `shared/auth-client/lib/factory.js`
- RAID extract path: `raid/server.js` (`/extract`), `raid/public/js/app.js` (`sendExtract`)
