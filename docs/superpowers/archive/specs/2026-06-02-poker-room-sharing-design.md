# Poker Room Sharing (Slice 3, Part 1: Poker) — Design

**Date:** 2026-06-02
**Status:** Approved (brainstorm complete; ready for implementation plan)
**Branch:** `feat/poker-room-sharing` (suite repo, Phase A); poker repo gets its own branch for Phase B.

## Goal

Move Sprint Poker from **team-scoped, fully account-gated** rooms to **company-scoped** rooms that can be joined by **anonymous Players** via a per-room share link. This is the first half of suite "slice 3" (the Poker/Retro room-sharing model resolved in the 2026-06-01 brainstorm). Retro is a separate, later spec that reuses the hub contract this one introduces.

## Background / current state (verified 2026-06-02)

Poker (`/var/www/scrumpoker`, branch `main`, live on sprintpoker.uk) today:
- **HTTP** (`lib/httpApp.js`): `/` is gated by `auth.requireAuth` + `requireEntitled`; `/api/me` returns `{ userId, teams }`; `public/*.html` is served by `express.static` **without** auth (only `/` and `/api/me` are gated); `/health` is public.
- **WS** (`lib/wsServer.js`): `server.on('upgrade')` for URLs `'/ws'` / `'/ws?…'` calls `authenticateUpgrade(auth.verifySession, cookie)`; on success attaches `ws.hubUserId` + `ws.teams`. Rooms live only in an in-memory `rooms` Map.
- **Login** (`lib/wsHandlers.js` `handleLogin`): requires `{ name, role, room, teamId }`, checks `teamId ∈ ws.teams`, room key = `${teamId}-${room}`.
- **Roles** (`lib/roles.js`): `Voter` / `Observer` / `Facilitator`. First user is auto-promoted to Facilitator (`assignFacilitator`); requesting Facilitator when one exists downgrades to Voter. Facilitator-gated actions: reveal, reset, start-next-round, end-session, change-role.
- **Hub exchange** (`/var/www/suite/hub/routes/api-sessions.js`): returns `{ user, central_session_id, entitlement, teams }`. Each team carries its company **name** but there is **no top-level company id**, and a CR/CTM on no team gets `teams: []`.

The resolved slice-3 decisions (from `project-suite-product-vision`): rooms become **company-scoped** (team tier collapses, no rosters; all CR+CTM see all company rooms), each room mints a **per-room share link** for **anonymous, self-named Players** (one room only, never the console), and the **Poker link dies with the disposable room**.

## Approved decisions (from brainstorm)

1. **Scope = company, join-by-name** — no active-room browser. Room key becomes `${companyId}-${roomName}`; no cross-company collision or access.
2. **Anonymous Player = possession of the unguessable link** — no hub account, no entitlement check, one room only.
3. **Players vote only; cannot facilitate** — facilitator actions are reserved for authenticated CR/CTM connections (server-enforced, not UI-only).
4. **Share link auto-minted, Copy button for any authed member** — one token per room for its lifetime, in-memory, dies with the room. No rotation, no persistence.
5. **Two-phase build** — Phase A (additive hub/auth-client contract: surface company on the session) then Phase B (the Poker app). Phase A also unblocks Retro slice 3.

## Design

### Phase A — surface company identity on the session (suite repo, additive, back-compatible)

- **Hub exchange** (`hub/routes/api-sessions.js`): add top-level `company: { id, name } | null` to the JSON, derived from the `companyId` it already computes. `teams` unchanged.
- **auth-client** (`shared/auth-client`): persist `company` on the app session record (idempotent `ALTER`, mirroring the existing `teams`/`entitled` columns; back-compatible with existing rows); expose `req.user.company`; include `company` in `verifySession(cookieHeader)` → `{ userId, entitled, teams, company }`.
- **Untouched:** raid, signal, retro ignore the new field; their existing test suites must stay green.

### Phase B — Poker app (poker repo)

**(a) Company-scoping.** WS upgrade attaches `ws.company` and `ws.authed`. `handleLogin` drops the `teamId` requirement and team check; room key = `${ws.company.id}-${room}`. `/api/me` returns `{ userId, company }`. Frontend removes the team dropdown (name + room name only); room header shows the company.

**(b) Anonymous Player + share link.**
- **Token:** each room mints one unguessable `shareToken` (crypto random ≥128-bit) when created in `joinRoom`; stored on the in-memory room; deleted when the room is deleted (empty via `leaveRoom`, swept by `expireRooms`, or `endSession`). Token→room resolution is a **linear scan** of the rooms map (few rooms per instance) — no separate index to keep in sync.
- **Dual-path WS gate:** the upgrade handler tries the session first (authed → `ws.authed=true`, `ws.hubUserId`, `ws.company`); on failure it reads `?token=` and, if it matches a live room's `shareToken`, admits an **anonymous** connection (`ws.authed=false`, room bound from the token). Otherwise 401. `authenticateUpgrade` stays pure for the session path; the token branch lives in the `wsServer` upgrade handler (it holds the `rooms` map).
- **Anonymous login:** payload `{ name }` only; role forced to **Voter**; room forced to the token's room; no entitlement, no account.
- **Share button:** room state carries `shareToken` to authed clients; UI shows **"Copy invite link"**, with the URL built client-side from the page origin → `${window.location.origin}/join?token=<shareToken>` (no hardcoded domain / server config).
- **Anonymous join page:** new public static `public/join.html` + `public/join.js` (served by existing static middleware — no new route). Reads `?token=`, prompts for a name, opens WS `/ws?token=…`, sends `login {name}`.

**(c) Facilitator enforcement.** Track `authed` on each participant record. **Only authed participants can ever hold Facilitator** — enforced in `assignFacilitator` (skips anon when auto-promoting), at login (anon clamped to Voter), and in `handleChangeRole` (cannot promote an anon). Centralised via a `canBeFacilitator(participant)` check.

## Data flow

**Authenticated CR/CTM:** hub launch → SSO → `/` (auth+entitled) → name + room name → WS `/ws` (cookie) → upgrade admits authed → `login {name, role, room}` → joins `${companyId}-${room}`, first authed user auto-Facilitator → vote/reveal/reset; sees Copy invite link.

**Anonymous Player:** open `/join?token=…` (public, link built from the host origin) → enter name → WS `/ws?token=…` → upgrade scans rooms, matches `shareToken` → admits anonymous → `login {name}` → joins as Voter → can vote; cannot reveal/reset/end/promote; no account created.

## Edge cases

- **Bad/expired token** (room gone) → upgrade 401; join page shows "This room has closed or the link is invalid."
- **Anon-only room** (all authed members left) → `facilitatorId` goes null; voting still works, reveal/reset unavailable until an authed member (re)joins. Intended; no path lets an anon facilitate.
- **Anon crafts a facilitator WS message** → rejected by the `authed`-gated handler checks (server-side).
- **Token guessing** → ≥128-bit random, validated only against live rooms, nothing persisted.
- **Back-compat** → Phase A additive; raid/signal/retro untouched, suites stay green.

## Testing

- **Phase A (hub/auth-client):** exchange + `verifySession` return `company`; persisted-session column back-compatible; existing hub/auth-client suites green.
- **Poker unit (`node:test`):** company-scoped room key; anon clamped to Voter; `assignFacilitator` skips anon; facilitator-gated handlers reject anon; token mint/lookup/cleanup on teardown; bad-token rejection.
- **Poker e2e (Playwright):** authed create→vote→reveal (company-scoped); anonymous join-via-token→vote→reveal refused/absent; closed-room link → friendly error.

## Out of scope (YAGNI)

- Active-room browser / room registry.
- Link rotation/revocation; durable (DB-persisted) rooms or tokens.
- Promoting an anonymous player to facilitator.
- Retro (separate later spec) and Signal/RAID (account-gated, never link-shared).

## Affected files (indicative; confirmed at plan time)

- **Suite (Phase A):** `hub/routes/api-sessions.js`; `shared/auth-client/*` (session-db schema + `verifySession` + `req.user`); related hub/auth-client tests.
- **Poker (Phase B):** `lib/upgradeAuth.js`, `lib/wsServer.js`, `lib/wsHandlers.js`, `lib/roomState.js`, `lib/roles.js`, `lib/httpApp.js` (`/api/me`); `public/join.html` + `public/join.js`; frontend room UI (`public/app.js`/`index.html`); unit + e2e tests.
