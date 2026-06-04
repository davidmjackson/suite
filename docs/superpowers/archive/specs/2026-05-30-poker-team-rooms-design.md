# Sprintpoker Team-Rooms — Hub Auth Redesign (Layer 4, Thread B)

**Date:** 2026-05-30
**Status:** Design approved, ready for implementation plan
**Builds on:** identity-v2 Layers 1+2 (companies/teams/entitlements), `@suite/auth-client` (CJS), the RAID/signal hub-wiring pattern.
**Supersedes:** poker's per-team shared-access-key WebSocket auth model.

## Problem

Poker (`/var/www/scrumpoker`, hub app key **`poker`**, brand **Sprintpoker**, `sprintpoker.uk`) is the last suite app on the legacy auth model. Its team **access key** does double duty: it both *authorizes* a WebSocket login and *namespaces the room* (`internalRoom = ${room}-${accessKey}`), so the key is the tenant boundary. There is no individual identity — `name` is free text, the participant id is a per-connection UUID, role is self-declared. Rooms are ephemeral, in-memory; poker has no database. A separate env admin key (`SCRUM_POKER_ADMIN_KEY`) gates `/admin` key-management — an operator plane that exists only to manage the access keys.

We are replacing the access-key model with hub identity, consistent with raid/signal, but with one mechanism neither of them has: a **WebSocket upgrade auth gate**. identity-v2 was explicitly built so that poker's team-rooms map onto hub **teams**.

## Approved decisions

1. **Tenancy model = identity-v2 teams.** A room belongs to a hub **team**; only members of that team can join. The team replaces the access key as the tenant boundary.
2. **Rooms stay ephemeral.** In-memory, swept after idle, as today. No poker domain DB. (Poker gains only the auth-client's session SQLite store, like raid/signal.)
3. **Room roles stay self-declared.** Facilitator/Voter/Observer chosen at login, first-to-claim Facilitator, live hand-off — orthogonal to the team `lead`/`member` role. Team membership governs *access to the room*, not *who runs the round*.
4. **Entitlement is per-company, no quota.** Poker is free (no paid API) → no `consume`, no quota. The `poker` entitlement is a boolean gate granted to a **company**; every member team/user under it can launch. This is enforced (deny-on-not-entitled) — poker is Layer 4.
5. **Remove the whole access-key + operator-admin subsystem** (mirrors RAID): `keys.json`, `lib/accessKeys.js`, `manageKeys.js`, `lib/loginRateLimiter.js`, `lib/adminActivity.js`, all `/api/admin/*` routes + `requireAdminKey`, the `/admin` page, `public/admin.html`, `public/js/admin.js`, the "Admin" login role, and `SCRUM_POKER_ADMIN_KEY` / `SCRUM_POKER_KEYS_FILE`.
6. **Login UX = team dropdown + room name.** The login form loses the access-key field and gains a team dropdown populated from the hub session; single-team users see it auto-selected/collapsed. Display **name stays free-text** (cosmetic label; the session + team membership is what authorizes).
7. **WS auth = session-validated on upgrade (Approach 1), teams ride along with the session.** The hub `exchange` is extended to return the user's teams within the entitled company; the auth-client persists them on the session record; the WS upgrade validates the cookie locally and attaches `{userId, entitled, teams}` to the socket — **no per-join hub calls**.

## Architecture — two authorization layers

1. **Identity layer (auth-client + hub):** *Who are you, and may you use poker?* A logged-in hub user with the per-company `poker` entitlement. Gates the HTTP page **and** the WS upgrade.
2. **Tenancy layer (poker, in-process):** *Which room may you enter?* The chosen `teamId` must be one of the user's teams (re-validated server-side); the room is namespaced `${teamId}-${roomName}`.

Membership and entitlement are snapshotted at launch and ride along with the session, refreshed whenever the user re-launches from the hub.

## Contract changes (hub + auth-client)

Today `POST /api/sessions/exchange` returns `{ user, central_session_id, entitlement }`, and the auth-client **drops `entitlement`** after launch — it persists only `{id, userId, centralSessionId, expiresAt}` and `req.user` is just `{ id }`. Both `entitled` and `teams` must be persisted for the connection-layer gate to work without a hub call.

**Hub:**
- `routes/api-sessions.js` (exchange): after `resolveEntitlement(userId, app)`, derive the entitled **company** from the returned `principal` and add `teams: org.teamsForUser(userId, companyId)` → `[{id, name, role}]`. If not entitled or the principal isn't a company, return `teams: []`.
- `lib/org.js`: new **`teamsForUser(userId, companyId)`** — join `team_members` + `teams` filtered to that user and company. (Complements the existing `listTeams(companyId)`.)

**auth-client (`/var/www/suite/shared/auth-client`):**
- `lib/hub-api.js` `exchange()` — surface `teams` from the response (it already receives `entitlement`).
- `lib/sessions-db.js` — add columns `entitled` (int/bool) and `teams` (JSON text); additive, idempotent column-add on open.
- `handlers/launch.js` — `store.create({ …, entitled: info.entitlement?.entitled === true, teams: info.teams || [] })`.
- `middleware.js` `attachUser` — `req.user = { id, entitled, teams }` (was `{ id }`). Additive; raid/signal ignore the new fields.
- New exported helper **`auth.verifySession(cookieHeader)`** → async, resolving `{ userId, entitled, teams } | null`, reusing the `requireAuth` store + cache/grace freshness logic minus the HTTP redirect. The `server.on('upgrade')` handler `await`s it (cache-fresh path is effectively synchronous via `store.get`; a stale session may trigger the same heartbeat revalidation as `requireAuth`). This is what the WS upgrade calls.

All changes are additive to the shared auth-client and the hub exchange; raid/signal keep working untouched (their existing 24 auth-client tests stay green).

## Poker server-side changes

- **`server.js`:** build `auth = createAuthClient({ appName: 'poker', hubBaseUrl, hubApiKey, cookieName: 'poker_session', cookieDomain, dbPath: APP_SESSIONS_DB })`; drop `KEYS_FILE`/`ADMIN_KEY`/`ACTIVITY_FILE`; pass `auth` into `createHttpApp` and `createWsServer`. Rooms `Map` + idle-sweep interval unchanged.
- **`lib/httpApp.js`:** mount `/auth/launch`, `/auth/logout`, `/api/heartbeat`, `/auth-client` static; `requireAuth` + an **entitled** check on `/` (not entitled → bounce to hub dashboard); new `GET /api/me` (`requireAuth`) → `{ userId, teams }` for the dropdown. Delete all `/api/admin/*`, `requireAdminKey`, the access-key error mapper, admin-activity calls. Keep security headers, `/health`, restricted static (minus `admin.html`).
- **`lib/wsServer.js` — the upgrade gate (new mechanism):** switch `WebSocketServer` to `{ noServer: true }`; add `server.on('upgrade', …)` for path `/ws` → `auth.verifySession(req.headers.cookie)`; `null` or `!entitled` → write `401` + `socket.destroy()`; else `wss.handleUpgrade(...)` and attach `ws.hubUserId` + `ws.teams` before emitting `connection`. Remove `loginRateLimiter`. The per-connection `uuidv4()` participant id stays (multi-tab seats).
- **`lib/wsHandlers.js` `handleLogin`:** required payload `{ name, role, room, teamId }` (drop `accessKey`); remove `loadKeys`/`isValidAccessKey`; validate `teamId ∈ ws.teams` (else error "You're not a member of that team."); `internalRoom = ${teamId}-${room}`. Downstream (joinRoom, facilitator assignment, voting) unchanged.
- **Deletions:** `lib/accessKeys.js`, `lib/loginRateLimiter.js`, `lib/adminActivity.js`, `manageKeys.js`, `keys.json`, `public/admin.html`, `public/js/admin.js`, plus their unit tests and dead imports.

## Frontend changes (`index.html` / `app.js`)

- **`index.html`:** remove the access-key field, the "Admin" role option, and the admin room link; add a **team dropdown** (`team-select`); add the `/auth-client/heartbeat.js` script.
- **`app.js`:** on load `fetch('/api/me')` → populate `team-select`; single team → auto-select and collapse. Delete all access-key/admin logic (the admin-verify flow, `isAdminRole`, accessKey placeholder toggling, the `/admin` redirect). Login submit sends `{ type: 'login', payload: { name, role, room, teamId } }`. On WS upgrade rejection (failed/closed socket from a `401`) show "Your session expired — re-launch poker from the hub" and `location.reload()` to bounce through `requireAuth` → hub (do **not** loop the 5s auto-reconnect against a persistent 401). Sign-out → `/auth/logout`. Inside-room UI (voting, reveal, hand-off) visually unchanged.

## Error handling & edge cases

- **No/invalid/expired session at upgrade** → `401`, socket destroyed; client shows re-launch message + reload; the auto-reconnect must not loop against a persistent 401.
- **Logged in but not entitled** → page bounces to hub dashboard; upgrade refused (server-side backstop; tile won't show anyway).
- **`teamId` not in `ws.teams`** → `login` rejected; client only offers your teams but the server re-validates so a tampered payload can't cross-tenant.
- **User in the entitled company but on zero teams** → `/api/me` returns `teams: []`, empty dropdown, no joinable room; show "You're not on a team yet — ask your admin to add you."
- **Membership staleness (Approach-1 trade-off):** teams snapshotted at launch; removed-from-team keeps room access until re-launch, added-to-team doesn't appear until re-launch. Accepted for ephemeral, low-stakes rooms.
- **Hub unreachable:** upgrade reads `entitled`/`teams` from the local session store on the cache-fresh path (no hub call), so active joins survive blips; heartbeat revalidation keeps the existing grace window; a brand-new launch still fails if the hub is down.
- **Multiple poker-entitled companies (known limitation):** `resolveEntitlement` returns a single principal, so teams scope to the company precedence resolves to. Rare; flagged, not solved now.
- **Room-name collisions across teams** → eliminated by `teamId` namespacing. Facilitator hand-off / empty-room reassignment / idle sweep unchanged.

## Testing

- **Poker unit (`node --test`):** `handleLogin` team-membership accept/reject, missing `teamId`, `internalRoom` composition; WS upgrade gate (valid session → handshake + attached `teams`/`hubUserId`; missing/invalid cookie → 401; valid-but-not-entitled → 401) via fake `req`/`socket` + stubbed `auth.verifySession`; `roles.js` + voting tests unchanged.
- **auth-client unit (keep the 24 green):** `exchange()` surfaces `teams`; `sessions-db` persists/reads `entitled`+`teams`, idempotent column-add; `verifySession` returns context for fresh / `null` for missing-expired / honours cache+grace; `attachUser` → `{id, entitled, teams}`.
- **Hub unit:** exchange returns `teams` scoped to the entitled company and `teams: []` when not entitled / non-company principal; `org.teamsForUser` returns the user's teams with roles, excluding other companies' and non-member teams.
- **httpApp:** `requireAuth` gates `/`; not-entitled bounces; deleted `/api/admin/*` → 404; `/api/me` returns teams for an authed session; `/health` 200.
- **e2e (Playwright, cookie-injection — signal's pattern):** seed an auth-client session (known `userId`, `teams`, `entitled: true`) + inject `poker_session`; drive dropdown → pick team → join → vote → reveal; negative spec (no cookie → bounce/refused); drop old access-key/admin e2e.

## Deploy & provisioning

**Resolved operational facts:**
- App key **`poker`**, brand **Sprintpoker**. Hub already registers `apiKeys.poker` (env `HUB_API_KEY_POKER`, a `required()` var → already set on the running prod hub); app-side value is the `POKER` line in `~/suite-app-keys.txt`.
- **Dashboard tile already exists** (`dashboard.js APPS` key `poker`, gated by `resolveEntitlement(userId, "poker")`) — **no hub dashboard change needed**; the tile becomes launchable once the user's company holds the `poker` entitlement.
- **Port `3005`** (sequence: 3001 retro, 3002 signal, 3003 raid, 3004 hub, 3005 poker). `COOKIE_DOMAIN=sprintpoker.uk`, `APP_BASE_URL=https://sprintpoker.uk`, `HUB_BASE_URL=https://sprintsuite.uk`.

**Hub provisioning (prerequisite — additive, reversible; the first real use of the companies/teams CLIs on prod):**
1. `create-company` (one company to start).
2. `add-company-member` (both prod users).
3. `create-team` (one team to start).
4. `add-team-member` (users onto the team).
5. `grant-entitlement` — `poker`, principal = **company**, no quota.

Company/team structure (counts) is a deploy-time decision.

**Poker app deploy (IONOS, per reference-ionos-deploy):** branch + `npm install file:../suite/shared/auth-client`; `.env` = `APP_NAME=poker`, `HUB_BASE_URL`, `HUB_API_KEY` (POKER line), `COOKIE_DOMAIN=sprintpoker.uk`, `APP_BASE_URL`, `APP_SESSIONS_DB`, `PORT=3005`; **remove** `SCRUM_POKER_ADMIN_KEY`/`SCRUM_POKER_KEYS_FILE`; `data/` writable by the poker service user; Apache vhost + cert already exist (untouched). Prereqs (auth-client ≥ `b396f3e`, deps installed) already satisfied since raid/signal are live.

**Safe ordering:** build+merge on dev (tests green) → hub provisioning on prod (additive) → deploy poker code → verify (tile → launch → SSO → team dropdown → join → vote; plus the zero-team message). **Rollback** is app-only (checkout pre-tag + restart); hub provisioning is additive and harmless to leave. Detailed runbook deferred to the careful prod deploy session (as with the RAID quota).

## Out of scope

Persistent/named rooms and room history (ephemeral only); tying facilitation to team role; per-team or per-user poker entitlement; refund/quota (poker is free); always-fresh per-join membership (Approach 2); multi-company entitlement disambiguation; retro (Thread B continues with retro afterward — same shared-key→teams shape).
