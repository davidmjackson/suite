# Retro team-rooms — design (2026-05-31)

Wire the **retro** app (`/var/www/retrospective`) onto the self-hosted auth hub +
identity-v2 teams model. This replaces retro's per-team **shared join-key** auth with
hub email-identity + per-company entitlement, and makes identity-v2 **teams** the tenant
boundary for boards. This is **Layer 4 Thread B, part 2** — it mirrors the poker
team-rooms work shipped 2026-05-30, reusing the shared contract poker's Phase A already
delivered.

Related: poker design (`docs/superpowers/specs/2026-05-30-poker-team-rooms-design.md`)
and plan (`docs/superpowers/plans/2026-05-30-poker-team-rooms.md`); identity-v2 design
(`docs/superpowers/specs/2026-05-29-hub-identity-entitlements-design.md`).

## Summary of approved decisions

1. **Single-repo change.** No hub or auth-client changes. Poker's Phase A already shipped
   everything retro needs: `auth.verifySession(cookieHeader)` → `{userId, entitled, teams}`,
   `teams` persisted on the app session, entitlement surfacing, the `retro` dashboard tile
   (`hub/routes/dashboard.js`, entitlement-gated), and the `HUB_API_KEY_RETRO` required env
   (`hub/config.js`). Retro consumes the contract as-is.
2. **Disposable boards.** Retro is live on prod (old shared-key auth) but existing boards
   do not need to survive. We deploy the new schema clean — no board-content migration.
3. **Self-declared roles (mirror poker).** Keep `participant`/`facilitator` as a
   self-declared choice at join time, orthogonal to the hub team `lead`/`member` role.
   **Delete the entire admin plane**: the "Admin" team, `RETRO_ADMIN_KEY`, key rotation,
   `/api/admin/*`, and `admin.html`/`admin.js` — they existed only to manage the shared
   join-keys, which no longer exist.
4. **Team-picker lobby (server-derived team — Approach B).** A board belongs to a hub team.
   The lobby has a team dropdown (from the user's teams); selecting a team lists/creates
   boards owned by that team. Joining an existing board derives its team from the stored
   `team_id` and checks membership server-side — the client does **not** assert a board's
   team. A client-supplied `teamId` is trusted only at board **creation**.
5. **Free per-company entitlement.** `retro` entitlement is granted per company, no quota
   (retro is free; no `consume()` calls), mirroring poker.

## Architecture

Retro becomes an `@suite/auth-client` consumer like poker/raid/signal. Two authorization
layers:

- **Identity layer** (auth-client + hub): a valid hub session + `retro` entitlement gates
  loading the app and opening a WebSocket. Enforced by `requireAuth` on pages/APIs and by
  the WS upgrade gate.
- **Tenancy layer** (retro, in-process): a board belongs to a hub **team**; a user may only
  view/join/mutate it when that team is in their `ws.teams`. Enforced server-side on every
  board join and on board creation.

Identity is hub-owned (email). There is no per-person retro account and no shared key. The
ephemeral display `name` + self-declared `role` chosen at join time are unchanged in spirit;
they no longer carry any authorization.

## Data model

`retros` gains:

```
team_id TEXT NOT NULL    -- owning hub team id (identity-v2 teams.id)
```

- `cards` and `actions` are unchanged — they FK to `retros(id)` and inherit team scoping
  transitively.
- The shared-key **`teams` table is dropped** (`key_hash`, `key_salt`, `weak` — no join-keys
  anymore).
- `meta` (retention settings) is unchanged.

**Migration (one-way; boards disposable):** drop the `teams` table; drop existing
`retros`/`cards`/`actions` rows (they are keyed by team *name* and cannot be safely remapped
to hub team ids) so we start clean on the new schema; (re)create `retros` with `team_id NOT
NULL`. Idempotent where practical. This is destructive of board content by design and is
accepted per decision (2). It is **not** reversible in-place, but the deploy is reversible
by checking out the `pre-suite-auth` tag + restoring the `.env` and DB backup.

## WebSocket auth (the core change)

Today: WS is served on the default HTTP server (`new WebSocketServer({ server })`); each
connection is authenticated by parsing the signed `retro_auth` JWT from the cookie or a
Bearer header (`getAuthFromHeaders` → `verifyToken`). This is replaced wholesale, mirroring
poker's `lib/upgradeAuth.js` + `wsServer.js`:

- **Upgrade gate.** Switch to `new WebSocketServer({ noServer: true })` and add
  `server.on('upgrade', …)`. The gate:
  1. Optionally enforces `RETRO_ALLOWED_ORIGINS` (kept — defence-in-depth, unrelated to
     identity).
  2. Calls `auth.verifySession(req.headers.cookie)` → `{userId, entitled, teams} | null`.
  3. On `null` or `entitled === false`: respond `401` and `socket.destroy()`.
  4. On success: complete the upgrade, attach `ws.hubUserId = userId` and
     `ws.teams = teams`, then emit `connection`.
  The allow/deny logic is extracted into a pure, unit-testable function (poker's
  `authenticateUpgrade(verifySession, cookieHeader, origin)` shape).
- **Join authorization (Approach B).** The client join message carries `{ boardId, name,
  role }` — **no teamId**. The server loads the board, reads its `team_id`, and asserts
  `team_id ∈ ws.teams.map(t => t.id)`. On failure: reject the join (do not attach to the
  room). The WS room key is simply `boardId` (already globally unique). Self-declared `role`
  (`participant`/`facilitator`) is taken from the payload as today.
- **Board creation.** The lobby's create action carries `{ teamId, title }`. The server
  validates `teamId ∈ ws.teams` and stamps the new `retros` row's `team_id`. This is the
  only place a client-supplied team id is trusted, and it is the legitimate source of truth.

## HTTP layer

- **Mount auth-client:** `/auth/launch`, `/auth/logout`, `/api/heartbeat`, and the
  `/auth-client` static assets.
- **Guards:** `auth.requireAuth` on the page routes (`/`, `/lobby`, `/retrospective`,
  `/actions`) and on the `/api/*` board/retro endpoints, **plus a separate entitled gate**.
  The auth-client only *surfaces* entitlement (`req.user.entitled`) — it does not enforce it
  — so retro adds its own check that bounces/denies when `req.user.entitled !== true`, the
  same way poker added an entitled gate on `/` and `/api/me`. `/` → 302 `/lobby`.
- **New `GET /api/me`** → `{ user: { id }, teams: [{ id, name, role }] }`, driving the lobby
  team picker (mirrors poker).
- **Restrict static** serving to real assets (css/js/fonts/sounds/vendor) so no unguarded
  `*.html` is reachable (the signal lesson).
- **Delete:** `POST /api/login`, `POST /api/logout`; `getAuthFromRequest`,
  `getAuthFromHeaders`, `signToken`, `verifyToken`, the inline `requireAuth`; the login
  rate-limiter; all `/api/admin/*` routes and team-key rotation.

## Frontend

- `login.html` / `login.js` → **deleted**. Sign-in is the hub launch flow (dashboard tile →
  SSO). Sign-out → `/auth/logout`.
- `lobby.js`: call `/api/me`, render a **team dropdown** from `teams`; selecting a team lists
  that team's boards and scopes "create board" to it. **Remove the team-key field.**
- `admin.html` / `admin.js` → **deleted**.
- `client.js` (board): open the WS without a JWT; send `{ boardId, name, role }` on join and
  `{ teamId, title }` on create; on an unauthorized close (e.g. WS close code `4401`) →
  `location.reload()` to re-bounce through the hub; load `/auth-client/heartbeat.js`.

## Environment

**Add:** `APP_NAME=retro`, `HUB_BASE_URL`, `HUB_API_KEY` (prod value from the `RETRO` line of
`~/suite-app-keys.txt`, i.e. the `HUB_API_KEY_RETRO` the hub holds), `COOKIE_DOMAIN=sprintretro.uk`,
`APP_BASE_URL=https://sprintretro.uk`, `APP_SESSIONS_DB` (e.g. `./data/retro-sessions.db` in
dev; a real path under `/var/lib/retro` on prod). Cookie name `retro_session`.

**Keep:** `RETRO_DB_PATH`, `RETRO_ALLOWED_ORIGINS`, `RETRO_RETENTION_DAYS`, `PORT=3001`,
`NODE_ENV`.

**Drop:** `RETRO_AUTH_SECRET`, `RETRO_AUTH_TTL_HOURS`, `RETRO_ADMIN_KEY`,
`RETRO_LOGIN_RATE_LIMIT_WINDOW_MS`, `RETRO_LOGIN_RATE_LIMIT_MAX`.

Install the dep: `npm install file:../suite/shared/auth-client` (symlinked `@suite/auth-client`).

## Testing

Mirror poker/signal:

- **Unit:** the pure upgrade-auth decision (allow/deny over the `verifySession` result +
  origin); `handleJoin` team-scoping (`team_id ∈ ws.teams` → allow; foreign team → reject);
  `handleCreate` validates `teamId ∈ ws.teams`. Refactor the relevant `server.js` logic into
  injectable, HTTP-free units (poker's `upgradeAuth.js` / handler-extraction pattern) so they
  test without a live socket.
- **WS-operations tests:** rewrite to seed an auth-client session directly in the store
  (`auth._ctx.store.create({…, entitled:true, teams:[…]})`) and inject the `retro_session`
  cookie — a fresh session is admitted from cache with no hub call.
- **Playwright e2e (cookie-injection):** seed a session + a board owned by the seed team;
  assert (a) unauth page → 302 to the hub login; (b) joining a board in your team works and
  syncs a card; (c) a board owned by a team you are not in is rejected. Drop the old
  login/admin specs.

## Deploy & provisioning

App-only deploy to IONOS `/var/www/retrospective` (port 3001, `User=` per the existing
systemd unit). Reuse the conventions in `reference-ionos-deploy` and the step-by-step /
no-heredocs / `---`-fenced shell rules.

- **Prereqs already satisfied** by prior deploys: prod `/var/www/suite` ≥ `b396f3e`
  (auth-client express-as-dependency fix), auth-client deps installed, the hub holds
  `HUB_API_KEY_RETRO`, the `retro` tile exists and is entitlement-gated.
- **Hub provisioning:** one operator CLI call — `grant-entitlement` for app `retro`,
  principal = company `sprint-suite`, no quota. The company `sprint-suite` and team
  `Sprint Team` already exist (provisioned during the poker deploy); both prod users are
  already members.
- **App deploy:** push `feat/suite-auth`; on prod fetch/checkout, `npm install --omit=dev`
  (adds the `@suite/auth-client` symlink), rewrite `.env` per above (back up
  `.env.pre-suite-auth`), run the schema migration (back up the retro DB first), restart the
  retro systemd service. Verify `/health` 200 and a real SSO click-through: tile → lobby →
  team picker → create/join a board → add a card.
- **Rollback (app-only):** `git checkout pre-suite-auth` + restore `.env.pre-suite-auth` +
  restore the DB backup + restart. (Hub grant is additive, harmless to leave.)
- **Tags:** `pre-suite-auth` before, `post-suite-auth-dev` on the merged dev build,
  `post-suite-auth` after prod click-through. Branch `feat/suite-auth` (retro repo default
  branch is `main`).

## Out of scope

- Board-content migration (boards are disposable).
- Tying facilitator powers to the hub team role (self-declared, per decision 3).
- Any hub or auth-client code change (the contract is complete from poker's Phase A).
- Quota/`consume()` for retro (free app).
- Thread C (signal team-scoping), still deferred.
