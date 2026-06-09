# Sprintretro (Architecture)
> Sprintretro is the sprint-retrospective board tool of the Sprint Suite platform (live at **sprintretro.uk**). It provides a real-time Start/Stop/Continue (well/improve/continue) board with cards, voting, drag-and-drop, a shared facilitator-controlled timer, deliberate action-item capture, and a cross-board actions report. Retros are **disposable** (created per session, closed/wiped on retention) and **company-scoped** via the central Sprint Suite auth hub. Each board exposes an **anonymous share link** so guests can join a single open board without a hub account.

## Tech stack
- **Runtime:** Node.js (>=20 per the shared auth-client `engines`).
- **Language:** JavaScript (CommonJS), no TypeScript, no build step. Client is vanilla HTML/CSS/JS served statically.
- **Web framework:** Express `^4.19.2`.
- **Template engine:** None — static HTML files in `public/` are served via `res.sendFile` behind route guards (there is no server-side templating).
- **Real-time:** `ws` `^8.17.1` (a `WebSocketServer` in `noServer` mode wired to the HTTP server's `upgrade` event; `maxPayload` 256 KB).
- **Database:** SQLite via `better-sqlite3` `^12.6.2` (synchronous, prepared statements; the app wraps calls in node-style `(err)` callbacks anyway).
- **Auth:** `@suite/auth-client` (local file dependency `file:../suite/shared/auth-client`, Express `^5` internally). Provides launch-token exchange, per-app session store, `requireAuth`, `verifySession`, whoami, heartbeat, logout.
- **Input validation:** `zod` — HTTP body schemas (`schemas/api.js`) + WS message schemas (`schemas/ws.js`), invoked via inline `safeParse` guards (HTTP routes) and a `validateMessage` helper (WS boundary). Added 2026-06-09 as Tier-1 #2 of the suite tech-stack upgrade; CJS port of the hub reference implementation (`lib/validate.js`).
- **Config:** `dotenv` `^17.2.4` (loads `<repo>/.env`).
- **Client libs:** `dragula` (vendored in `public/vendor/dragula`) for card drag-and-drop; `public/js/oscilloscope.js` drives the animated header band.
- **Tests:** Node's built-in `node:test` runner (unit) + Playwright `@playwright/test` `^1.59.1` (e2e).

## Production deployment / services
| Item | Value | Source |
|---|---|---|
| systemd service | `retrospective.service` | `deploy/systemd/retrospective.service` |
| Run-as user/group | `retrospective` / `retrospective` | systemd unit |
| Working dir | `/var/www/retrospective` | systemd unit |
| Port | `3001` (env `PORT`, defaults to 3001) | server.js, `.env.example` |
| Public domain | `sprintretro.uk` | `.env.example` (`APP_BASE_URL`/`COOKIE_DOMAIN`) |
| Reverse proxy | Apache + Certbot on IONOS (suite convention). **Note:** `deploy/nginx/retrospective.conf` ships an *example* Nginx config (`retro.example.com`) and is NOT the live proxy — treat as a template only. | memory / suite convention; *inferred* |
| Env file | `/var/www/retrospective/.env` (loaded by dotenv and by systemd `EnvironmentFile`) | systemd unit, server.js |
| Writable data path | `/var/lib/retrospective` (systemd `ReadWritePaths`, `ProtectSystem=full`) | systemd unit |
| DB files (prod) | **TWO** SQLite DBs in `/var/lib/retrospective`: `retros.db` (board data, `RETRO_DB_PATH`) and `retro-sessions.db` (auth-client per-app sessions, `APP_SESSIONS_DB`) | memory + `.env.example`; *prod paths inferred — the dev checkout uses repo-relative `./retros.db` and `./data/retro-sessions.db`* |

Hardening in the unit: `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=full`, `Restart=always`.

> The current checkout is the build/dev machine (no `/var/lib/retrospective` present); prod paths are taken from `.env.example` + suite memory. The repo is also referred to historically as "retrospective2".

## Repository structure
```
/var/www/retrospective
├── server.js            # Main entry: Express app, WS upgrade/auth, routes, board logic, timer loop
├── db.js                # SQLite layer: schema (v7), normalize, upsert, load, retention, seed-from-JSON
├── lib/
│   ├── companyAccess.js # boardCompanyAllowed(retro, company) tenancy check (pure)
│   ├── upgradeAuth.js   # decideUpgrade(): dual-path WS auth (session OR open-board share token)
│   ├── contrast.js      # WCAG contrast helpers used only by theme tests
│   └── validate.js      # zod middleware helper: validate(schema) → Express middleware (coerce + strip unknown keys; JSON routes call next(err) with err.status=400 + err.fields)
├── schemas/
│   ├── api.js           # HTTP body schemas: createRetroSchema (POST /api/retros) + updateActionSchema (PUT /api/actions)
│   └── ws.js            # Per-message-type WS schemas + validateMessage(type, payload)
├── public/              # Static client (NOT served as raw .html — pages are route-gated)
│   ├── lobby.html / lobby.js          # Company-scoped retro list + create/close + name/role picker
│   ├── retrospective.html / client.js # Live board (cards, votes, drag, timer, actions, share link)
│   ├── actions.html / actions.js      # Cross-board actions kanban report
│   ├── join.html / join.js            # Anonymous share-link entry (validate token -> /shared)
│   ├── license.html                   # Licence page
│   ├── css/  (instrument-core.css, retro.css)   # Instrument design system + app styles
│   ├── js/oscilloscope.js             # Animated header band
│   ├── vendor/dragula/                # Drag-and-drop lib
│   ├── fonts/ illos/glyphs.svg sounds/timer-complete.wav
├── scripts/
│   ├── db-maintenance.js  # CLI: migrate | retention | vacuum
│   ├── sync-theme.sh + theme-manifest.txt  # Pull theme-core from Signal (canonical theme source)
├── tests/               # node:test unit suites + tests/e2e (Playwright) + helpers
├── deploy/systemd/retrospective.service   # Live service unit
├── deploy/nginx/retrospective.conf        # EXAMPLE proxy only (not live)
├── docs/                # deployment.md, session-log.md, handover-assets, superpowers
├── state.json / state.sample.json         # Legacy one-time JSON seed (see Operational notes)
├── .env / .env.example
└── package.json
```

## Data model
**Two separate SQLite databases:**

1. **`retros.db`** (board data, opened in `server.js`/`db.js`). Tables:
   - **`meta`** — `(key, value)`; holds `schema_version` (currently **7**).
   - **`retros`** — board header. Columns: `id` (PK, `retro-<ts>-<rand>`), `title`, `company_id` (NOT NULL — tenancy key), `created_at`, `closed` (0/1), `closed_at`, `share_token` (nullable; **unique index** where not null), timer fields (`timer_duration_seconds`, `timer_remaining_seconds`, `timer_running`, `timer_end_at`), `last_action_json`, `updated_at`.
   - **`cards`** — `id` (PK), `retro_id` (FK → `retros.id` **ON DELETE CASCADE**), `column_type` (`well`|`improve`|`continue`; legacy `action` mapped to `continue`), `text`, `details`, `votes`, `status`/`notes` (always persisted NULL for cards), `created_by`, `updated_at`. Indexed on `retro_id` and `(retro_id, column_type)`.
   - **`actions`** — `id` (PK), `retro_id` (FK → `retros.id` **ON DELETE CASCADE**), `source_card_id` (the card an action was derived from; enforces one-action-per-card in app logic), `text`, `details`, `owner`, `due_date`, `status` (`todo`|`in_progress`|`blocked`|`done`), `notes`, `created_at`, `created_by`, `updated_at`. Indexed on `retro_id` and `(retro_id, status)`.

   `foreign_keys = ON` is set per connection. Board columns are fixed: **well / improve / continue** (Start / Stop / Continue).

2. **`retro-sessions.db`** (auth-client). Owned/managed by `@suite/auth-client`'s `createSessionsStore`; stores per-app sessions minted from hub launch tokens (user id, central session id, `entitled`, `teams`, `company`, expiry). The app does not define this schema.

**Migration mechanism:** version-gated in `db.ensureSchema`. If `meta.schema_version < 7`, it runs a **destructive cut**: `dropLegacyBoardData()` drops `teams`, `actions`, `cards`, `retros`, recreates the normalized schema, and stamps version `7`. At/above v7 it only runs idempotent `CREATE TABLE IF NOT EXISTS` + `ensureCardCreatedByColumn` (adds `created_by` if missing). No incremental migration files — there is one current schema (v7); older data is wiped, not migrated. CLI entry: `npm run db:migrate` (`scripts/db-maintenance.js migrate`).

**Company-scoping:** every board carries `company_id`; `boardCompanyAllowed(retro, company)` requires the authed user's verified-session company id to match. Lobby listing/creation is filtered to `req.user.company.id`.

**Disposable boards:** boards are created ad hoc, explicitly closed (`closed=1`, `closed_at` set), and pruned by retention (`RETRO_RETENTION_DAYS`) — deleting closed retros and (via cascade / explicit deletes) their cards and actions.

**Board share link:** each retro gets a `share_token` (`crypto.randomBytes(24).hex`) at creation; the anonymous join surface resolves a board by this token (unique index).

## Real-time / board model
- **Transport:** WebSocket only (single endpoint `/ws`). No HTTP polling for live updates; the lobby and board both open a WS. Card/vote/move/action/timer/presence changes are pushed server→client as full or partial broadcasts.
- **Rooms:** `server.js` keeps in-memory `Map`s: `clients` (ws→metadata), `rooms` (retroId→Set of ws) for boards, and `lobbyRooms` (companyId→Set of ws) for the lobby. `broadcastToRetro` / `broadcastToLobby` fan out to a room.
- **Connection params** (`/ws?...`): `view` (`lobby` or board), `retroId`, `name` (≤80 chars, default "Anonymous"), `role` (`participant`|`facilitator`), and optional `token` (share token, for anonymous).
- **Lobby socket:** `view=lobby` requires an authed, company-bearing session (anonymous rejected). Server pushes `{type:"retros"}` (the company's board list) and re-broadcasts on create/close so all lobby members refresh live.
- **Board lifecycle:** facilitator creates a retro in the lobby (`POST /api/retros`) → opens `/retrospective?retroId=…` → WS `init` sends the full board → mutations broadcast `update`/`timer`/`presence`. Closing a board broadcasts `retroClosed`. Boards are **disposable**: once closed they are read-only and eventually retention-deleted (and any pre-v7 board data was wiped on the schema cut).
- **Self-declared roles:** roles are NOT from the hub — the user picks **name** + **participant/facilitator** in the lobby (persisted in `localStorage` as `retroUserName`/`retroUserRole`) and passes them as WS query params. Facilitator-only actions (timer control, move card, create action) are gated server-side on the connection's declared `role`. Anonymous share-link users are forced to `participant` and may only add cards / vote (no timer, move, or action creation), and only on the single open board their token maps to.
- **"Team-picker" lobby (Approach B):** the lobby is **company-scoped** (the "team"/room key is the user's `company.id`), not a free-text team key. There is no per-team key/login (that was the legacy pre-hub model described in the stale README). All members of a company see and act on the same shared retro list.
- **Shared timer:** a server-side `setInterval` (1s) recomputes `remainingSeconds` from `endAt` for running timers and broadcasts `timer`; only a facilitator connection may `set/start/stop/reset`. `timer-complete.wav` is played client-side on finish.

## Routes / surface area
**Authenticated app pages** (`auth.requireAuth` + `requireEntitled`; non-entitled users 302 → hub `/dashboard`):
- `GET /` → 302 `/lobby`
- `GET /lobby` → `lobby.html` (company retro list, create/close, name/role)
- `GET /retrospective` → `retrospective.html` (live board)
- `GET /retro` → 302 `/retrospective`
- `GET /actions` → `actions.html` (cross-board actions report)

**Auth-hub mounts** (from `@suite/auth-client`):
- `GET /auth/launch` (launch-token exchange → set session cookie → redirect)
- `GET /auth/logout`
- `GET /auth/whoami` (cheap local check; returns `{authed, dashboardUrl}` — powers Return-to-Suite, no redirect)
- `POST /api/heartbeat`
- `/auth-client/*` static assets (incl. `suite-return.js`, `heartbeat.js`)

**Public / anonymous (no auth):**
- `GET /license` → `license.html`
- `GET /health` → `{status:"ok", uptimeSeconds}`
- `GET /api/shared/:token` → board summary by share token (`404` invalid, `410` if board closed)
- `GET /join` → `join.html` (anonymous entry; validates token, collects name)
- `GET /shared` → `retrospective.html` (board view used by anonymous joiners)

**Authenticated JSON API** (`requireAuth` + `requireEntitled`, company-scoped):
- `GET /api/me` (`requireAuth` only) → `{user:{id}, company}`
- `GET /api/retros` → company's boards
- `POST /api/retros` → create board (company-scoped; mints share token)
- `GET /api/retros/:id` → load board (company-gated)
- `POST /api/retros/:id/close` → close board
- `GET /api/actions-report` → all actions across the company's boards
- `PUT /api/actions` → update action status/notes/owner/dueDate

**WebSocket:** `GET /ws` (HTTP upgrade only; any other upgrade path is destroyed). Auth via `decideUpgrade` (session cookie OR open-board share token).

> The stale README also lists `/admin`, `/api/login`, `/api/session`, `/api/admin/teams*`, `RETRO_AUTH_SECRET`, team keys, and login rate limiting. **None of those exist in the current code** — they describe the pre-auth-hub standalone version and should be ignored.

## Input validation (zod)
Added 2026-06-09 (Tier-1 #2 of the suite tech-stack upgrade). CJS port of the hub reference; Retro is Express 4 but the helper works identically. See also `hub.md` (reference) and `poker.md` (same WS treatment); suite-wide rollout documented in `README.md`.

### HTTP — inline `safeParse` structural guards
Two JSON routes use inline `safeParse` before their existing business-logic validators:

- **`POST /api/retros`** — `createRetroSchema` (coerce + trim `title`; `string min(1) max(140)`). On parse success `req.body` is replaced with the cleaned output; the existing `validateText` call and bespoke 400 response are preserved.
- **`PUT /api/actions`** — `updateActionSchema` (coerce + trim `retroId`, `actionId`, optional `status` / `notes` / `owner` / `dueDate`). Same pattern: `safeParse` runs first; on success `req.body` is replaced; existing field-level validators + bespoke 400 bodies continue unchanged.

**`dueDate` partial-update nuance.** `updateActionSchema.dueDate` is declared `.optional()` — an absent `dueDate` key parses to `undefined`. Because the route handler only calls `validateDueDate` when `dueDate !== undefined`, an absent field leaves the existing stored due date untouched. An explicit `""` (empty string) still passes validation (the `z.literal("")` union arm) and propagates to the handler, clearing the stored date. This preserves partial-update semantics: omit the field to keep the current value; send `""` to wipe it.

The `lib/validate.js` middleware helper (used by hub/signal/poker/raid) is available but these two routes use inline `safeParse` directly, keeping their pre-existing bespoke 400 response bodies (asserted by existing tests).

### WebSocket — per-message-type boundary check
At the `.on("message")` boundary in `server.js`, every inbound message is checked via `validateMessage(type, payload)` from `schemas/ws.js` before any handler logic runs:

1. Bad JSON → `JSON.parse` throws → `logger.warn` + `return` (drop; socket stays open; board state unchanged).
2. Invalid payload (unknown type or schema mismatch) → `validateMessage` returns `{ ok: false }` → `logger.warn` + `return` (same: drop without disconnect or board mutation).
3. Valid → `data` is replaced with the parsed (coerced, cleaned) output and handling continues.

All schemas use `.passthrough()`, so the `type` field and any other fields read by downstream handlers survive validation intact.

**Validated message types and what each enforces:**

| Type | Enforced fields |
|---|---|
| `hello` | No payload fields required; passes through (presence broadcast only). |
| `timer` | `action` required: enum `set\|start\|stop\|reset`; `minutes` optional finite number (business-logic sub-rules applied downstream). |
| `addCard` | `column` required: enum `well\|improve\|continue\|action`; `text` trimmed string min(1) max(500); `details` optional trimmed string max(2000). |
| `voteCard` | `cardId` required: alphanumeric/`./_:-` id string min(1) max(160). |
| `moveCard` | `cardId` + `targetColumn` (same COLUMN enum) required; `beforeCardId` optional: same id format or `null` (defaults to `null`). |
| `createAction` | `cardId` required (id format); `title` (max 500), `owner` (max 80), `dueDate` (`""` or `YYYY-MM-DD`), `notes` (max 4000) all optional with empty-string defaults. |

This closes the latent gap where a malformed WS message could throw inside a handler and leave the in-memory board state inconsistent.

## Suite-auth integration
Retro is a **satellite app** of the central hub (`sprintsuite.uk`); identity lives in the hub, never locally.

- **Client construction:** `createAuthClient({ appName: "retro", hubBaseUrl, hubApiKey, cookieName: "retro_session", cookieDomain, dbPath: retro-sessions.db })`.
- **Launch flow:** user lands from the hub on `GET /auth/launch?token=…`; the handler calls `hubApi.exchange(token)`, mints a local opaque session id, stores `{userId, centralSessionId, entitled, teams, company, expiresAt}` in `retro-sessions.db`, and sets the `retro_session` cookie (scoped to `COOKIE_DOMAIN`). Optional same-host `return_to` honored.
- **Session freshness:** `requireAuth`/`verifySession` serve from the local store within `cacheTtlMs` (60s); past that they heartbeat the hub (`hubApi.heartbeat`) with a grace window (`graceMs` 5min) before evicting. `verifySession` is the no-redirect variant used at the WS upgrade.
- **Entitlement:** app pages additionally require `req.user.entitled`; un-entitled authed users are redirected to the hub dashboard (`requireEntitled`).
- **Company scoping:** the verified session carries `company`; all board reads/writes go through `boardCompanyAllowed` (board `company_id` must equal session company id). The lobby room is keyed by company id.
- **Anonymous board share link:** `decideUpgrade` (lib/upgradeAuth.js) is dual-path: a valid entitled session OR a `token` query param resolving (via `lookupOpenBoardByToken`) to an **OPEN** board. Anonymous WS connections are flagged `ws.anonymous=true`, pinned to that one `boardId`, forced to `participant` role, and limited to add-card/vote. Closed boards reject anonymous joins (`410` on the HTTP summary, WS error/close).
- **Return-to-Suite:** every app shell (`lobby/retrospective/actions.html`) includes a hidden `<a data-suite-return hidden>` plus `<script src="/auth-client/suite-return.js">`. That script calls `GET /auth/whoami`; only if the caller has a valid suite session does it reveal the button and point it at `dashboardUrl` (hub `/dashboard`). Anonymous share-link users and error cases fail safe (button stays hidden). Sign-out goes to `/auth/logout`.

## Configuration & secrets
From `.env.example` (the live `.env` on this dev box only contains legacy `RETRO_AUTH_SECRET`/`RETRO_ADMIN_KEY`, which are unused by current code):

| Key | Purpose |
|---|---|
| `APP_NAME` | App identifier sent to the hub (`retro`). |
| `HUB_BASE_URL` | Hub origin (`https://sprintsuite.uk`) for token exchange / heartbeat / dashboard URL. |
| `HUB_API_KEY` | Per-app shared secret authenticating Retro to the hub API (the "RETRO" line from the suite app-keys file). **Secret.** |
| `COOKIE_DOMAIN` | Cookie scope for the `retro_session` cookie (`sprintretro.uk`). |
| `APP_BASE_URL` | Public base URL of this app. |
| `APP_SESSIONS_DB` | Path to the auth-client per-app sessions SQLite DB (prod: `/var/lib/retrospective/retro-sessions.db`; default `./data/retro-sessions.db`). |
| `PORT` | Listen port (default `3001`). |
| `NODE_ENV` | `production` in prod. |
| `RETRO_DB_PATH` | Board SQLite DB path (prod: `/var/lib/retrospective/retros.db`; default `./retros.db`). |
| `RETRO_ALLOWED_ORIGINS` | Comma-separated allowed browser origins for WS Origin checks (`*` allows all; empty falls back to same-host). |
| `RETRO_RETENTION_DAYS` | If set >0, deletes closed retros older than N days (24h interval job + on boot). Commented out by default. |

A strict Content-Security-Policy and standard hardening headers (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`, `frame-ancestors 'none'`) are set on every response. `x-powered-by` disabled. `.html` paths are explicitly 404'd from static serving so pages can only be reached through the route guards.

## Testing
- **Unit:** Node's built-in `node --test`. `npm test` runs **12 suites** (explicit file list in `package.json` — new suites must be added to that list): `theme-drift`, `theme-contrast`, `db-schema`, `upgrade-auth`, `company-access`, `return-to-suite`, `pino-logger`, `pino-request-logger`, `pino-error-handler`, `validate`, `ws-validation`, `api-schemas` — **75 unit test cases total**. Suites cover schema/migration shape, dual-path WS upgrade decision, company tenancy, Return-to-Suite contract, pino logging/error-handler behaviour, zod HTTP-body validation, WS message validation, and theme/contrast/drift guards.
- **e2e:** Playwright (`npm run test:e2e`, `playwright.config.js`). Specs in `tests/e2e`: `retro-smoke` (3), `retro-sharing` (4), `header-waves` (2) — **~9 e2e cases** (memory cites "8"; the extra is the header-waves visual band check). Helpers `tests/e2e/helpers/_auth.js` and `seed.js` set up auth/seed; e2e uses a separate `.playwright-retros.db`.
- **Other checks (per AGENTS.md):** `node --check` on touched files, `git diff --check`, `npm audit --omit=dev`, plus migration/vacuum checks for DB changes.

## Operational notes & gotchas
- **Schema v7 is a destructive cut.** First boot against any pre-v7 `retros.db` runs `dropLegacyBoardData()` → **all boards/cards/actions/teams wiped** and schema rebuilt. This already happened on the company-scoping deploy (2026-06-02, retros.db wiped per suite memory). There is no incremental migration path; deploying to an old DB will erase board history.
- **Two DB files, both under `/var/lib/retrospective`:** `retros.db` (board data) and `retro-sessions.db` (auth-client sessions). Both must be on the systemd `ReadWritePaths` (`/var/lib/retrospective`); `ProtectSystem=full` makes most of the FS read-only, so a misconfigured DB path will fail to open silently (the app warns and continues with empty state).
- **launch_tokens FK cascade history:** a prior hub-side bug — `launch_tokens` lacked an ON DELETE CASCADE on session delete — caused a 500 on Sign Out across suite apps; fixed hub-side (suite @052b6e6). Retro relies on the hub for session deletion via `/auth/logout`; if logout 500s again, suspect a hub FK regression, not Retro.
- **Stale README/deploy artifacts.** `README.md` (and the routes/auth sections), `deploy/nginx/retrospective.conf` (`retro.example.com`), `state.json`/`state.sample.json`, `RETRO_AUTH_SECRET`/`RETRO_ADMIN_KEY`, "team access keys", `/admin`, and `/api/login|session|admin/teams` all describe the **pre-auth-hub standalone app** and are no longer accurate. Live proxy is Apache+Certbot on IONOS. Trust `server.js` + `.env.example` + the systemd unit over the README.
- **JSON seed is one-shot legacy.** On an empty DB the server seeds from `state.json` if present (`seedFromJsonIfPresent`); `state.json` is gitignored. Don't drop a stray `state.json` into a fresh deploy unless intended.
- **In-memory state authority.** Live board state lives in the `state.retros` array (loaded once at boot) and the `rooms`/`lobbyRooms`/`clients` maps; SQLite is the persistence sink. A second process / horizontal scaling would desync — this app is **single-instance** (timer loop, presence, and broadcasts are all per-process).
- **Self-declared roles are trust-on-client.** Any authed company user can pick "facilitator" in the lobby; facilitator gating is by declared WS role, not a hub permission. Anonymous (share-link) users are hard-capped to participant + add/vote server-side regardless of params.
- **WS auth nuance.** Only `/ws` (or `/ws?...`) upgrades are accepted; everything else is destroyed. Origin is checked against `RETRO_ALLOWED_ORIGINS` (or same-host); an empty/missing Origin header is allowed (native WS clients).
- **Retention is opt-in.** Without `RETRO_RETENTION_DAYS`, closed boards persist indefinitely (suite-wide unbounded-retention follow-up is tracked in hub memory). `npm run db:retention <days>` / `db:vacuum` are the manual maintenance CLIs.
- **Theme is synced, not authored here.** `instrument-core.css` (Instrument design system) is pulled from Signal via `scripts/sync-theme.sh`; the `theme-drift`/`theme-contrast` tests guard against local edits drifting from the canonical source. App-specific styling lives in `public/css/retro.css`.
