# Sprintpoker (Architecture)

> Sprintpoker is the real-time planning-poker (story-point estimation) tool of the Sprint Suite platform. Authenticated suite users launch it from the hub, create/enter a company-scoped estimation room, and team members vote on Fibonacci card values that the facilitator reveals together; an anonymous per-room "share link" lets non-suite guests join a single room to vote without an account. All room state is held in server memory and synchronised over a single WebSocket connection. The repo lives at `/var/www/scrumpoker` (npm package name `websocket-server`).

## Tech stack

- **Runtime:** Node.js (CI pins Node 24; auth-client `engines` requires `>=20`). Pure JavaScript (CommonJS, no TypeScript, no build step).
- **HTTP framework:** Express `^5.1.0` (used only for static serving, auth-client routes, `/health`, `/api/me`, `/license`).
- **Real-time:** the [`ws`](https://github.com/websockets/ws) library `^8.18.2`, run in `noServer` mode and wired into the Node HTTP server's `upgrade` event. This is the core of the app — see [Real-time architecture](#real-time-architecture). `perMessageDeflate: false`, `maxPayload: 64 KiB`.
- **Validation:** `zod` — added 2026-06-09 (Tier-1 #2 of the tech-stack upgrade). `lib/validate.js` provides an Express middleware helper (`validate(schema)`) for HTTP body validation (CJS port of the hub reference pattern); `schemas/ws.js` provides the per-message-type schema registry and `validateMessage(type, payload)` used at the WS message boundary. Poker has no HTTP body routes at present so `validate()` is present for future use; the active validation is entirely on the WebSocket layer — see [Input validation (zod)](#input-validation-zod) below.
- **IDs:** `uuid` `^11.1.0` (`v4`) for per-connection participant IDs; `node:crypto` `randomBytes` for room share tokens.
- **Database / driver:** SQLite via `better-sqlite3` `^12.10.0`, used **only** for the app-side suite-auth session cache (`app_sessions` table). It comes transitively through the shared `@suite/auth-client` package (`file:../suite/shared/auth-client`, i.e. `/var/www/suite/shared/auth-client`). Poker has **no domain/business database of its own** — estimation rooms are entirely in-memory.
- **Test frameworks:** Node's built-in test runner (`node --test`) for unit tests; Playwright `@playwright/test` `^1.59.1` for e2e; `supertest` `^7.2.2` for HTTP-level assertions.
- **Frontend:** vanilla ES (no framework, no bundler) served as static files from `public/`. Strict CSP (`script-src 'self'`, no inline/eval). Shared "Instrument" design system CSS synced from Signal via `scripts/sync-theme.sh`.

**Real-time architecture in one line:** a single `/ws` WebSocket per browser tab; the server keeps the authoritative room/vote state in two in-memory `Map`/object structures (`rooms` and `participants`) and broadcasts the full room state to every member on each change.

## Production deployment / services

| Item | Value | Notes |
|---|---|---|
| systemd service | `scrumpoker.service` | Unit `Description=Scrum Poker dev server (Node, port 3000)` |
| Run-as user / group | `User=davidj`, `Group=www-data` | per the unit file |
| Working dir | `/var/www/scrumpoker` | `ExecStart=/usr/bin/node server.js` |
| Port | **3000** | set inline via `Environment=PORT=3000` in the unit (overrides the `server.js` default of `3005` and `.env.example`'s `3005`) |
| Restart | `on-failure`, `RestartSec=3` | |
| Public domain | `sprintpoker.uk` | per project memory + `.env.example` (`COOKIE_DOMAIN=sprintpoker.uk`, `APP_BASE_URL=https://sprintpoker.uk`). **DISCREPANCY (verify):** the only enabled Apache vhost found is `scrum-poker.conf` with `ServerName scrum-poker.uk` on **port 80, no TLS** — this looks like a stale/legacy vhost. The TLS vhost actually serving `sprintpoker.uk` was **not found** under `/etc/apache2/` (no `sprintpoker` reference, no poker cert visible — possibly permission-hidden or managed elsewhere). |
| Reverse proxy | Apache `mod_proxy` + `mod_proxy_wstunnel` | In the found vhost: `ProxyPass "/" "http://127.0.0.1:3000/"` plus a `<Location /ws>` block that proxies `ws://127.0.0.1:3000/ws` — this is the WebSocket upgrade proxying. (The repo README documents an *Nginx* example instead; the live edge is Apache.) |
| Env file | **Unknown / unconfirmed.** Memory says `/etc/scrumpoker.env`, but the systemd unit has **no `EnvironmentFile=`** and no drop-ins; only `PORT` is set inline. Where `HUB_BASE_URL` / `HUB_API_KEY` / `COOKIE_DOMAIN` / `APP_SESSIONS_DB` are sourced on prod could not be verified from this host. **Verify before relying on it.** |
| App session DB | `APP_SESSIONS_DB`, default `<repo>/data/poker-sessions.db` (WAL mode) | No `data/` dir is committed; created on first launch. This is the *only* persisted state. |
| App name (hub key) | `APP_NAME=poker` | identifies poker to the hub |

Inferred items above are explicitly flagged; treat the env-file location and the live TLS vhost as **unknown until verified on the prod box**.

## Repository structure

```
/var/www/scrumpoker
├── server.js                 # Entry point: builds auth client, HTTP app, WS server; starts room-expiry sweep
├── package.json              # name "websocket-server"; deps express/ws/uuid + @suite/auth-client (file:)
├── playwright.config.js      # e2e: serves app on :3066 with a stub hub (HUB_BASE_URL=127.0.0.1:9)
├── .env.example              # documents env keys (PORT default here is 3005)
├── lib/
│   ├── httpApp.js            # Express app: security headers/CSP, static serving, auth routes, /health, /api/me, /license
│   ├── wsServer.js           # WebSocketServer (noServer); upgrade auth, connection lifecycle, message router, broadcast helpers
│   ├── wsHandlers.js         # Pure-ish handlers per message type: login/vote/reveal/reset/nextRound/endSession/changeRole/exit
│   ├── roomState.js          # In-memory room model: create/join/leave/expire/touch, share-token lookup, facilitator assignment
│   ├── roles.js              # Role enum (Voter/Observer/Facilitator) + permission predicates
│   ├── upgradeAuth.js        # Pure decision: is this WS upgrade allowed for an authed session?
│   ├── validate.js           # zod HTTP body validation middleware helper (present for future use — no HTTP body routes yet)
│   ├── buildInfo.js          # version+commit for /health (from env, package.json, or `git rev-parse`)
│   └── contrast.js           # WCAG contrast helper (used by theme-contrast test)
├── schemas/
│   └── ws.js                 # zod per-message-type schema registry + validateMessage(type, payload) for inbound WS messages
├── middleware/
│   └── errorHandler.js       # Central error handler (JSON branch adds err.fields for validation errors)
├── public/
│   ├── index.html            # Main app shell (authed suite users) — login + poker-room sections, Instrument bands
│   ├── join.html             # Anonymous share-link join shell (token-based, no suite auth)
│   ├── license.html          # In-app licence page (/license, /licence)
│   ├── js/
│   │   ├── app.js            # Main client: WS connect, login (name/role/room), voting, facilitator controls, invite link, reconnection
│   │   ├── join.js           # Anonymous client: connect with ?token=, vote-only, no facilitation
│   │   ├── cardDeck.js       # Voting-card DOM factory + flip/deal animations (window.ScrumPokerCardDeck)
│   │   ├── clipboard.js      # copyText helper for invite link
│   │   └── oscilloscope.js   # Decorative header "waves" animation
│   ├── css/                  # poker.css, instrument-core.css (synced theme)
│   ├── fonts/, illos/, images/ (cardback.jpg), robots.txt, sitemap.xml
├── tests/
│   ├── *.test.js             # 18 node:test unit files (~120 tests)
│   └── e2e/                  # Playwright specs + helpers (seed.js, _auth.js) + .data/ (gitignored test DB)
├── scripts/
│   ├── sync-theme.sh         # Pull theme-core CSS/illos/fonts from /var/www/signal
│   └── theme-manifest.txt    # list of synced theme files
├── docs/                     # deployment.md, techstack-overview.md, session-log.md, handover notes
├── README.md                 # Security & production notes (Nginx example — note: live edge is Apache)
└── LICENSE                   # Custom free-use licence
```

(Note: `docs/deployment.md` and `.github/workflows/ci.yml` both reference a `manageKeys.js` at the repo root — **it does not exist** in the current tree; that check is stale.)

## Real-time architecture

**Transport.** One WebSocket endpoint, `/ws`. The client opens `wss://<host>/ws` (authed app) or `wss://<host>/ws?token=<shareToken>` (anonymous join). The HTTP server's `upgrade` event is handled manually (`ws` in `noServer` mode); any path other than `/ws`/`/ws?...` is rejected with `socket.destroy()`.

**Upgrade authentication (`decideUpgrade` in `lib/wsServer.js`).**
1. Try suite auth: `authenticateUpgrade(auth.verifySession, cookieHeader)` (`lib/upgradeAuth.js`) reads the `poker_session` cookie, validates against the local session store with cache/grace/hub-heartbeat freshness logic, and requires `entitled === true`. On success → `{ authed: true, hubUserId, teams, company }`.
2. Else fall back to anonymous: parse `?token=` and `findRoomByToken(rooms, token)`. If a live room has that `shareToken` → `{ authed: false, anonRoom }`.
3. Else `401` (socket gets `HTTP/1.1 401 Unauthorized` and is destroyed).
The decision is stamped onto the socket (`ws.authed`, `ws.hubUserId`, `ws.company`, or `ws.anonRoom`) before `connection` fires.

**Connection lifecycle.** On `connection` the server assigns a fresh `uuidv4()` `userId`, sends `{type:'yourId', payload:{id}}`, and routes inbound messages. On `close`/`error` it calls `handleParticipantExit` (leaves room, reassigns facilitator, deletes participant, rebroadcasts).

**Client → server message types** (`{type, payload}` JSON):
- `login` — `{name, role, room}` (authed) or `{name}` (anonymous; room comes from the share token). Joins/creates the room and registers the participant.
- `vote` — `{vote}` (must be one of `['0','1','2','3','5','8','13','?']`; rejected if votes already revealed or sender is an Observer).
- `revealVotes` — facilitator only; flips `room.votesRevealed = true`.
- `resetVotes` — facilitator only; clears all votes, hides them.
- `startNextRound` — facilitator only; requires votes were revealed first, then clears + reopens.
- `changeRole` — `{targetUserId, newRole}`; self-change always allowed, changing *others* requires facilitator. Anonymous players can never be made Facilitator; a facilitator stepping down hands off to another **authenticated** member or is blocked.
- `endSession` — facilitator only; broadcasts `sessionEnded` then deletes the room and all its participants.
- `logout` — leave/exit.

**Server → client message types:** `yourId` (`{id}`), `updateState` (`{participants[], votesRevealed, facilitatorId, shareToken}` — the full authoritative room snapshot, broadcast to every member on any change), `sessionEnded` (`{message}`), `error` (`{message}`).

**Room model & state location.** State is **entirely in process memory**, never persisted:
- `rooms`: `Map<internalRoomName, { users:Set<userId>, lastActive, votesRevealed, facilitatorId, shareToken }>`. `shareToken` = 16-byte hex generated at room creation, the anonymous-join secret.
- `participants`: plain object `{ [userId]: { id, ws, name, role, vote, roomName, authed } }`.
- `getRoomParticipants` strips `ws` and `authed` before broadcasting (so secrets/sockets never go over the wire).
- **Internal room naming:** an authed user's `room` input is namespaced as `` `${companyId}-${room}` `` so identical room names in different companies never collide. Anonymous joiners are placed directly into the resolved `anonRoom`.

**Room expiry & cleanup.** `server.js` runs `expireRooms` every 60 s; rooms idle longer than `DEFAULT_ROOM_EXPIRY_MS` (1 hour) are deleted along with their orphaned participants. Every broadcast calls `touchRoom`, so any active session keeps the room alive. A room is also deleted immediately when its last user leaves, or on `endSession`.

**Facilitator assignment.** `assignFacilitator` always picks an **authenticated** member; anonymous players are never eligible. If the facilitator leaves, `reassignFacilitatorIfLeaving` promotes another authed member (or leaves `facilitatorId = null` if none).

**Reconnection.** Client-side only. `app.js` persists the room/name/role in `sessionStorage` and, after a transient disconnect (`onclose` with `everOpened`), sets a reconnect-intent flag and auto-retries every 5 s, replaying the stored `login` to rejoin the same room. If the socket never opened (e.g. session expired) it shows "session expired — re-launch from the hub" and reloads. (There is no server-side session resumption — a reconnect is a brand-new participant with a new `userId`.)

## Input validation (zod)

Added 2026-06-09 as Tier-1 #2 of the suite tech-stack upgrade. The meaningful validation for poker is entirely on the WebSocket layer (poker has no HTTP body routes). See also `hub.md` and `retro.md` — Retro received the same WS-message validation treatment in the same rollout.

### WebSocket message boundary

In `lib/wsServer.js`, the `message` handler first `JSON.parse`s the raw frame inside a `try/catch`. A bad JSON frame is immediately dropped with `logger.warn` and the socket stays open — no crash, no disconnect, no room-state mutation. For a parseable frame, `validateMessage(type, payload)` is called against the schema registry in `schemas/ws.js` before the `switch` dispatches to any handler:

```js
const validation = validateMessage(type, payload);
if (!validation.ok && validation.error?.message !== 'unknown_message_type') {
  logger.warn({ err: validation.error, type }, 'invalid ws payload');
  return;
}
```

Behaviour on each outcome:

| Outcome | Action |
|---|---|
| Bad JSON | `logger.warn` + drop; socket stays open |
| Known type, invalid payload | `logger.warn` + drop; socket stays open |
| Unknown type | falls through to `default:` case, which replies with `{type:'error', payload:{message:'Unknown type: …'}}` |
| Valid payload | dispatched to the existing handler unchanged |

**This is a pure gate.** Valid messages reach their handlers with the original `parsed.payload` object — zod's unknown-key stripping is not applied downstream, so no gameplay field is ever dropped. The change closes the latent "malformed WS message throws inside a handler" gap without touching any handler logic.

### Validated message types (from `schemas/ws.js`)

| Type | Schema enforced |
|---|---|
| `login` | `name`: non-empty string, max 80 chars. `role`: optional enum (`Voter`/`Observer`/`Facilitator`). `room`: optional string, max 200 chars. (Anonymous users omit role/room; business rules are enforced in the handler.) |
| `vote` | `vote`: enum of the eight deck values (`"0"`, `"1"`, `"2"`, `"3"`, `"5"`, `"8"`, `"13"`, `"?"`) |
| `revealVotes` | no payload fields required (passthrough) |
| `resetVotes` | no payload fields required (passthrough) |
| `startNextRound` | no payload fields required (passthrough) |
| `endSession` | no payload fields required (passthrough) |
| `changeRole` | `targetUserId`: optional string (defaults to self in handler). `newRole`: required enum (`Voter`/`Observer`/`Facilitator`) |
| `logout` | no payload fields required (passthrough) |

`VOTE_VALUES` and `ROLE_VALUES` are exported from `schemas/ws.js` and kept in sync with `lib/wsHandlers.js` and `lib/roles.js`.

### HTTP body validation (`lib/validate.js`)

The `validate(schema, options)` Express middleware is present for completeness (CJS port of the hub pattern). On a valid parse it replaces `req.body` with zod's coerced, unknown-key-stripped output and calls `next()`. On failure it calls `next(err)` with `err.status = 400` and `err.fields` (flattened field errors), which the central error handler in `middleware/errorHandler.js` surfaces in the JSON response body as `{ error, reqId, fields }`. Poker has no HTTP body routes today, so `validate()` is currently unused.

## Data model

**No domain database.** Estimation rooms, participants, and votes exist only in server memory (see above) and are lost on restart by design.

**Sole persisted table — suite-auth session cache** (created/managed by `@suite/auth-client`'s `lib/sessions-db.js`, SQLite/WAL at `APP_SESSIONS_DB`):

```
app_sessions(
  id                 TEXT PRIMARY KEY,   -- random 32-byte hex; value of the poker_session cookie
  user_id            TEXT NOT NULL,      -- hub user id
  central_session_id TEXT NOT NULL,      -- hub session id (for heartbeat/consume)
  created_at         INTEGER NOT NULL,
  last_validated_at  INTEGER NOT NULL,   -- drives cache/grace freshness
  expires_at         INTEGER NOT NULL,   -- created_at + sessionMaxMs (default 30 days)
  entitled           INTEGER NOT NULL DEFAULT 0,   -- whether the user is entitled to poker
  teams              TEXT NOT NULL DEFAULT '[]',   -- JSON array, snapshotted at launch
  company            TEXT NOT NULL DEFAULT 'null'  -- JSON {id,name}, snapshotted at launch
)
INDEX idx_app_sessions_central ON (central_session_id)
```

**Migration mechanism:** no formal migrations. The store runs `CREATE TABLE IF NOT EXISTS` plus idempotent additive `ALTER TABLE ... ADD COLUMN` guards (for `entitled`/`teams`/`company`) on every boot. Schema changes are forward-only and additive.

**Relationships & scoping:**
- **Company-scoping:** the session's `company.id` is prepended to every authed room name (`${companyId}-${room}`), isolating each company's rooms.
- **Per-room anonymous share links:** each room carries a random `shareToken`; `/join?token=<token>` lets non-suite users join *that one room* (looked up via `findRoomByToken`). These users have no `app_sessions` row and no hub identity.

## Routes / surface area

**HTTP (Express, `lib/httpApp.js`):**
- `GET /` — main app shell; `requireAuth` + `requireEntitled` (non-entitled → 302 to `<hub>/dashboard`).
- `GET /join` — anonymous share-link join shell (`join.html`, served by static middleware with `extensions: ['html']`; no auth gate — access is gated by the WS token).
- `GET /license`, `GET /licence` — in-app licence page.
- `GET /api/me` — `requireAuth`; returns `{ userId, company }` (client uses `company.name` for the room header).
- `GET /health` — public; `{ status, version, commit, uptime, rooms }` (live room count).
- `GET /auth/launch` — hub launch-token exchange → creates `app_sessions` row + sets `poker_session` cookie → redirect.
- `GET /auth/logout` — clears session (client `logout()` navigates here).
- `GET /auth/whoami` — cheap local lookup; `{authed, dashboardUrl?}` for the Return-to-Suite reveal. Never redirects, no hub round-trip.
- `POST /api/heartbeat` — keeps the hub session alive (browser heartbeat).
- `/auth-client/*` — static assets from the auth-client (`suite-return.js`, heartbeat script).
- `GET /*` — static files from `public/` (security headers + no-store on everything; `index:false`, dotfiles ignored).

**WebSocket:**
- `GET /ws` (Upgrade) — authed suite users (cookie-based).
- `GET /ws?token=<shareToken>` (Upgrade) — anonymous share-link joiners.

## Suite-auth integration

Poker integrates with the central hub through the shared `@suite/auth-client` package (symlinked/`file:` dependency at `/var/www/suite/shared/auth-client`). `appName: 'poker'`, cookie `poker_session`, `cookieDomain` from `COOKIE_DOMAIN`.

- **Launch flow:** user clicks Poker in the hub → hub redirects to `/auth/launch?token=...` → `handleLaunch` calls `hubApi.exchange(token)`, then stores `{userId, centralSessionId, entitled, teams, company}` in `app_sessions` and sets the `poker_session` cookie. Crucially, **`teams` and `company` are snapshotted into the session row at launch** and never refreshed for the life of that session.
- **WS-auth redesign:** unlike the HTTP routes (which use `requireAuth` redirect middleware), the WebSocket upgrade can't redirect, so auth was redesigned around a dedicated `verifySession(cookieHeader)` that returns data (`{userId, entitled, teams, company}`) or `null`. The upgrade handler (`decideUpgrade`) calls it, requires `entitled`, and — only if that fails — falls back to anonymous share-token resolution. This dual path (authed cookie **or** room share token) is the heart of the redesign.
- **Company/team scoping:** the authed session's `company.id` namespaces the room (`${companyId}-${room}`); `company.name` is fetched client-side via `/api/me` for display. `teams` is carried on the session but poker does not currently gate rooms by team.
- **Room header "Company : Team":** the room shell shows `room-display` (`Room: <name>`) and `room-org` (`<company.name>` from `/api/me`). (The header surfaces the company; team labelling is part of the shared snapshot but the visible org line is driven by company name.)
- **Return-to-Suite:** `index.html` includes `/auth-client/suite-return.js` and a hidden `<a data-suite-return hidden>Return to Suite</a>` in the room toolbar. The script calls `/auth/whoami`; if the caller is an authed suite user it sets the link's `href` to the hub `dashboardUrl` and unhides it. **Fails safe** — anonymous users or any network error leave the button hidden. `join.html` has **no** Return-to-Suite button.
- **Anonymous share-link users are NOT suite users:** they authenticate only by possessing a valid room `shareToken`, have no `app_sessions` row, no hub identity, are forced to role `Voter` on login, can never become Facilitator, and never see Return-to-Suite. They lose access the instant the room is closed/expired or the token stops matching.

## Configuration & secrets

From `.env.example` and `server.js`:

| Key | Purpose |
|---|---|
| `PORT` | Listen port. `server.js` default `3005`; `.env.example` `3005`; **prod systemd forces `3000`**. e2e uses `3066`. |
| `APP_NAME` | App identifier sent to the hub (default `poker`). |
| `HUB_BASE_URL` | Base URL of the auth hub (`https://sprintsuite.uk`) — used for launch/heartbeat/exchange and `dashboardUrl`. |
| `HUB_API_KEY` | **Secret.** Per-app API key authenticating poker to the hub (the `POKER` line from `app-keys.txt`). |
| `COOKIE_DOMAIN` | Domain for the `poker_session` cookie (`sprintpoker.uk`). |
| `APP_BASE_URL` | Poker's own public base URL (`https://sprintpoker.uk`). |
| `APP_SESSIONS_DB` | Path to the SQLite session cache (default `<repo>/data/poker-sessions.db`). |
| `SCRUM_POKER_VERSION` / `SCRUM_POKER_COMMIT` / `GITHUB_SHA` | Optional overrides for `/health` build info (else read from `package.json` / `git rev-parse`). |

The hub cookie name is hard-coded `poker_session`. Auth-client tunables (`cacheTtlMs` 60 s, `graceMs` 5 min, `sessionMaxMs` 30 days) use defaults — not overridden by poker.

## Testing

- **Unit:** `npm test` → `node --test tests/*.test.js`. **18 files, ~120 tests:** `ws-handlers` (20), `room-state` (14), `roles` (7), `ws-operations` (6), `upgrade-auth` (5), `http-app` (4), `ws-server-upgrade` (4), `build-info` (3), `pino-error-handler` (varies), `pino-logger` (varies), `pino-request-logger` (varies), `carddeck` (2), `theme-contrast` (2), `return-to-suite` (2), `theme-drift` (1), `ws-schema` (zod schema registry), `ws-validation` (WS gate integration). The two new zod files added 2026-06-09: `tests/ws-schema.test.js` (schema registry + validateMessage contract) and `tests/ws-validation.test.js` (gate integration: bad JSON dropped, invalid payload dropped, valid message still dispatched). Covers the room state machine, role/permission predicates, WS upgrade auth (authed + anon token + reject), HTTP routes/headers, the Return-to-Suite reveal, and the new WS validation gate. (There is a known pre-existing flaky health-check race in the WS integration tests under full-suite load; a single failure that passes on re-run is that harness flake, not the validation.)
- **e2e:** `npm run test:e2e` → Playwright, **4 spec files, 9 tests**, server on `:3066` against a *stub* hub (`HUB_BASE_URL=http://127.0.0.1:9`) with sessions seeded directly into the test DB via `tests/e2e/helpers/seed.js` (`injectSession` sets the `poker_session` cookie). Scenarios: authed company room (vote/reveal), anonymous share-link join (votes, cannot facilitate, closed-link error), multi-user sync + transient-disconnect rejoin, no-session bounce, and Instrument header-band presence on the right shells.
  - (Project memory cites "~72 unit + 8 e2e"; the current tree measures ~120 unit + 9 e2e after the zod/pino additions — treat counts as approximate.)
- **CI:** `.github/workflows/ci.yml` (Node 24): `npm ci`, install Chromium, `node --check` on all JS, `npm test`, `npm run test:e2e`, `npm audit --omit=dev`. Note: CI/deploy docs still `node --check manageKeys.js`, a file that **no longer exists** — that step is stale.

## Operational notes & gotchas

- **Teams/company are snapshotted at launch.** A user's `company`/`teams` are frozen into the `app_sessions` row when they launch poker. If a user's company/team changes in the hub, **they must sign out and re-launch** to pick it up — until then the room header / namespacing reflect stale data (matches the suite-wide "blank/stale org header until a fresh login" gotcha).
- **Share-link users never see Return-to-Suite** and have no hub identity; the reveal fails safe (stays hidden) for anyone unauthenticated or on any `/auth/whoami` error.
- **All room state is volatile.** A service restart (deploy, crash, `RestartSec=3`) wipes every live room, vote, and facilitator assignment — there is no persistence or resume. Deploy during quiet periods.
- **Port mismatch is intentional but fragile:** prod runs on `3000` *only because* the systemd unit sets `Environment=PORT=3000`; the code default is `3005` and `.env.example` says `3005`. The Apache proxy targets `127.0.0.1:3000`. Keep these in sync.
- **Apache vhost / domain mismatch (verify on prod):** the only enabled poker vhost found is `scrum-poker.conf` (`ServerName scrum-poker.uk`, **plain HTTP :80**, legacy domain) — the live `sprintpoker.uk` TLS vhost was not locatable from this host. Confirm the real edge config (and that WebSocket `/ws` upgrade proxying — `mod_proxy_wstunnel`, `ProxyPass ws://...`) is present there before changing anything.
- **Env-file location unconfirmed:** systemd has no `EnvironmentFile`; how `HUB_API_KEY` etc. reach the prod process is unverified (memory says `/etc/scrumpoker.env`). Check before a redeploy — a missing `HUB_API_KEY`/`HUB_BASE_URL` will break launch.
- **Anonymous-join entitlement edge:** anonymous WS auth only succeeds while the target room still exists in memory; once it expires (1 h idle) or is ended, the share link returns "this room has closed or the link is invalid."
- **Facilitator hand-off safety:** the server refuses to leave a room facilitator-less and never lets an anonymous player inherit facilitation. A lone facilitator who tries to demote themselves with no other authed member present is blocked.
- **Theme drift:** poker's design CSS is *synced* from `/var/www/signal` via `scripts/sync-theme.sh`; the `theme-drift` test guards against divergence. Edit shared theme in Signal, re-sync, commit — do not hand-edit synced files.
- **README documents Nginx; production uses Apache.** Treat the README proxy block as illustrative only.
- **Build-info on `/health`** depends on `git` being available in the working dir (or the `SCRUM_POKER_COMMIT`/`GITHUB_SHA` env). In a deploy without a `.git` dir, `commit` reports `unknown`.
