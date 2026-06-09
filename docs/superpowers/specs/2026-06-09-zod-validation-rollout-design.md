# zod validation rollout — design (Tier-1 #2)

**Date:** 2026-06-09
**Status:** Design — approved, pending implementation plan
**Roadmap:** Tech-stack upgrade Tier-1 #2 (follows #1 pino, now LIVE across hub + 4 apps)
**Shape:** Hub pilot (reviewed reference) → parallel swarm to the 4 apps (raid / signal / poker / retro)

## Problem

Input validation across the suite is ad-hoc and manual: routes destructure `req.body`,
sprinkle `.trim() || null`, hand-roll an email regex, and `if (!x) return 400`. There is
no single source of truth for "what shape is valid," normalization is duplicated and
inconsistent, and the WebSocket apps (Poker, Retro) have a latent crash: a malformed
socket message can throw inside a handler that no Express error handler catches.

zod gives us declarative, typed, coercing schemas as the single source of truth, and a
uniform failure path that preserves existing UX.

## Decisions (from brainstorm)

1. **Scope:** full Tier-1 #2 — hub pilot then swarm all 4 apps.
2. **Form-failure UX:** **parity**. Re-render the same view with the user's `values`
   preserved + ONE friendly summary message, exactly as today. No per-field inline errors
   (captured as a future polish item, not this slice). No `.eta` view changes.
3. **WebSocket-failure behavior:** **drop + log, socket stays open.** A malformed/hostile
   message is logged via the app's pino logger and ignored; the connection and room state
   are untouched.
4. **Code sharing:** **copy-per-repo (Option A).** Each repo gets its own tiny
   `lib/validate.js` + `schemas/` dir + zod as a local npm dep. No shared runtime package,
   so **no deploy-ordering coupling** (unlike `@suite/auth-client`). Matches the pino shape
   that made the swarm clean.

## The pattern (copied into each repo)

### `lib/validate.js` — Express middleware factory (~25 lines)

```
validate(schema, { source = "body", onInvalid } = {})  →  (req, res, next)
```

- **Success:** `req[source]` is **replaced** with zod's parsed output, so coercion (trim,
  lowercase, empty→null, array filtering) and unknown-key stripping flow downstream.
  Handlers stop doing manual normalization and read already-clean values.
- **Failure:**
  - if `onInvalid` is supplied → call `onInvalid(req, res, error)` (form routes re-render
    with values + friendly message — **parity**).
  - else → `next(err)` with `err.status = 400` and
    `err.fields = error.flatten().fieldErrors` → central error handler.

Uses `schema.safeParse` (no throw in the hot path). Schemas use `z.object` (default behavior
strips unknown keys — friendly for browser-sent CSRF/honeypot/extra fields).

### `schemas/*.js` — zod schemas, one file per route-group, mirroring `routes/`

The messy normalization moves INTO the schema as transforms:
- email: `.trim().toLowerCase()` + the existing email regex / `z.string().email()`.
- optional text (job_title, team_size, message): empty string → `null`.
- `apps`: coerce string→`[string]`, filter to known keys `["poker","retro","signal","raid"]`.
- flags (`is_admin "1"`): map to the existing normalized form.

Schemas are the single source of truth for valid shape + normalization.

### Central error handler tweak (one small change)

`middleware/errorHandler.js` already forks JSON vs HTML and already keys off `err.status`.
Add: when `err.fields` is present, include it in the JSON body →
`res.json({ error, fields, reqId })`. HTML branch unchanged (form routes never reach the
handler — they use `onInvalid`).

## Hub reference routes

- **Form routes** (`/request`, `/login`, `/company/*`, `/admin/*`):
  `validate(schema, { onInvalid })` where `onInvalid` re-renders the same view with `values`
  + the existing message. Pre-steps that must precede validation stay ahead of the validate
  middleware — specifically `/request`'s **honeypot** (hidden `website` field → fake-success
  render) and **rate-limit** (429), which run before `validate`.
- **JSON API routes** (`/api/sessions`, `/api/apps`): `validate(schema)` with no `onInvalid`
  → 400 JSON `{ error, fields, reqId }` via the error handler.

Hub routes with input today (from grep): `request.js`, `login.js`, `magic.js`, `admin.js`,
`company.js`, `api-sessions.js`, `api-apps.js`. Each gets a schema; exact field inventory
enumerated during planning.

## WebSocket validation (Poker & Retro)

At the socket message boundary:
1. Wrap `JSON.parse(raw)` in try/catch (drop on parse error).
2. Look up a per-message-type schema from a registry, e.g. `{ vote: voteSchema, reveal: ... }`.
3. `safeParse` the message/payload.
4. On any failure (bad JSON, unknown type, bad payload): `log.warn({ err, type }, "invalid
   ws payload")` via the app's existing pino `lib/logger.js`, then **drop — socket stays open.**

A small `validateMessage(type, payload)` helper backed by the registry keeps handlers clean.
This also closes the latent "malformed message throws inside the handler" crash.

## Per-app swarm deltas

Each agent copies the reviewed hub reference and applies its app's surfaces:

- **raid** (`/var/www/raid`, :3003) — HTTP only. Schema the `/extract` payload + auth/quota
  POSTs. Already has the pino central error handler.
- **signal** (`/var/www/signal`, :3002, branch `feat/suite-auth`) — HTTP. Anonymous
  survey-submit is the untrusted surface → tight schema; facilitator routes too.
- **scrumpoker** (`/var/www/scrumpoker`, :3000, pkg `websocket-server`) — HTTP + **WS**.
  WS vote/reveal/room payloads (section above) + any HTTP room-create/join POSTs.
- **retrospective** (`/var/www/retrospective`, :3001) — HTTP + **WS**. Board/sticky/column
  edits over WS + share-link join / board-create over HTTP.

Every app already has its own pino `lib/logger.js` for the WS warn-logging. Exact route/
message inventory per app is enumerated during planning (inspect each repo then).

## Testing (TDD throughout)

- **Hub:** unit tests per schema (valid / invalid / coercion-correctness — email lowercased,
  empty→null, `apps` filtered); route tests proving a bad form POST returns 400 AND
  re-renders with `values` preserved, and a bad `/api` POST returns 400 JSON with `fields`.
  **All 240 existing hub tests must stay green** (manual checks replaced, behavior preserved).
- **Apps:** per-app schema unit tests + a WS test that a malformed payload is dropped
  (logged, socket survives, room state untouched). Each app's existing suite stays green.

Write the schema test → schema; write the "bad input → 400 / drop" test → wire the middleware.

## Rollout & deploy

No deploy-ordering constraint (copy-per-repo, zero runtime coupling):

1. **Hub pilot** — full TDD + two-stage review, local `--no-ff` merge to `main`, push branch
   as off-machine backup.
2. **Swarm** — parallel agents (raid / signal / poker / retro), each copying the reviewed hub
   reference + its deltas, each on its own branch in its own repo.
3. **Deploy** — per app, independently, one command at a time: pull → `npm install` (zod is a
   new dep) → restart service → health-check 200. Any order.

## Out of scope (YAGNI)

- Per-field inline form errors (parity only this slice).
- Error-event WS responses (drop + log only).
- Validating trusted internal/admin-only payloads beyond what's cheap.
- CSRF / auth changes.
