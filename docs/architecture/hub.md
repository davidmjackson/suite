# Sprint Suite — Hub (Architecture)

> The Hub (`@suite/hub`) is the central auth, identity, entitlement, admin, and public-marketing service for the Sprint Suite platform. It is the only service that owns user identity: it issues passwordless magic-link sign-ins, holds the canonical "central session", and mints short-lived launch tokens that the four satellite apps (Sprintraid, Sprintsignal, Sprintretro, Sprintpoker) exchange for their own local sessions. It also serves the public landing page at `/`, the self-service onboarding request form at `/request`, an operator admin console (`/admin/*`), a self-service company console (`/company/:slug`), and the legal pages. Live at https://sprintsuite.uk behind Apache.

## Tech stack

- **Runtime:** Node.js `>=20` (ESM, `"type": "module"`).
- **Language:** Plain JavaScript (no TypeScript, no build step).
- **Framework:** Express `^5.1.0`.
- **Template engine:** Eta `^3.5.0` (`.eta` templates), wired as a custom Express view engine in `server.js`. Templates are cached only when `NODE_ENV === "production"`. (Memory hint said "EJS/Eta" — it is Eta only; no EJS.)
- **Database:** SQLite via `better-sqlite3` `^12.10.0` (synchronous driver). WAL journal mode, `foreign_keys = ON`.
- **Email:** Resend `^4.0.0` (`lib/email.js`), emails are themselves rendered from Eta templates under `views/emails/`.
- **Rate limiting:** Hand-rolled in-memory sliding-window limiter (`lib/rate-limit.js`) — no external dependency, **per-process** (state lost on restart, not shared across workers).
- **Auth tokens / IDs:** `node:crypto` `randomBytes` (`lib/tokens.js`) — `randomToken()` = 32 bytes hex (sessions, magic-link, launch), `randomId()` = 16 bytes hex (row IDs).
- **Test framework:** Node's built-in test runner (`node --test`) + `supertest` `^7.0.0` (devDependency) for HTTP-level route tests.
- **Input validation:** **zod** `^4.4.x` (`lib/validate.js` + `schemas/*.js`), added 2026-06-09 (Tier-1 #2). See *Input validation* below.
- **Logging / observability:** **pino** `^10.x` + **pino-http** `^11.x` (`lib/logger.js`, `middleware/requestLogger.js`) — structured JSON logs (dev-pretty off in prod), per-request id, plus a central content-negotiated error handler (`middleware/errorHandler.js`). Custom pino-http serializers log only `req:{id,method,url}` / `res:{statusCode}` (no headers) so `Set-Cookie`/auth never leak into logs.
- Notable: **no cookie-parser, no helmet, no csurf, no express-session** — cookies are parsed/written by hand (`lib/cookies.js`), there is no CSRF protection layer, and sessions are a bespoke DB-backed scheme.

## Production deployment / services

- **systemd service:** `suite-hub` (`deploy/systemd/suite-hub.service`). `Type=simple`, `ExecStart=/usr/bin/node server.js`, `Restart=always`, `WorkingDirectory=/var/www/suite/hub`.
- **Run-as user:** dedicated unprivileged `suite-hub:suite-hub` system user. Hardened unit: `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full`, `ProtectHome`, `ReadWritePaths=/var/www/suite/hub`.
- **Port:** **3000 on prod** per `/var/www/suite/hub/.env` (`PORT=3000`). NOTE the discrepancy: `config.js` defaults to `3000`, but `.env.example`, the Apache config, and the systemd comments all reference **3004**. Apache `ProxyPass` in `deploy/apache/sprintsuite.conf` forwards to `127.0.0.1:3004`. **The committed Apache config and the live `.env` disagree on the port** — treat the live `.env` (`3000`) as authoritative for what the process binds, and verify the running Apache vhost on the box, which may have been edited post-checkout (the deploy README/certbot rewrites it). (Inferred: live Apache must point at whatever port the service actually listens on.)
- **Public domain(s):** `sprintsuite.uk` (+ `www.sprintsuite.uk`). `BASE_URL=https://sprintsuite.uk`.
- **Reverse proxy:** Apache (`mod_proxy`, `mod_proxy_http`, `mod_headers`, `mod_ssl`, `mod_rewrite`), TLS via certbot. Apache terminates TLS and proxies to the hub on loopback. `LimitRequestBody 262144` (256KB). The committed vhost has the HTTPS block commented out (certbot is expected to generate/rewrite it).
- **Env file (prod):** `/var/www/suite/hub/.env` (loaded by systemd `EnvironmentFile`; the app itself does **not** use dotenv — env must be present in the process environment).
- **Data/DB file (prod):** `/var/www/suite/hub/data/suite.db` (`DB_PATH=./data/suite.db`, relative to `WorkingDirectory`). SQLite WAL means `suite.db-wal`/`suite.db-shm` siblings also live there.
- **ADMIN_EMAIL** is set on prod (per memory, `nirvanadesign@msn.com`) so new access requests trigger an operator notification email.

## Repository structure

```
/var/www/suite/                     # umbrella repo (4 apps live in their own /var/www/* dirs)
├── README.md                       # suite overview, app→domain map, Clerk-cancellation history
├── docs/architecture/hub.md        # this file
├── shared/auth-client/             # @suite/auth-client — npm pkg the 4 apps embed (CommonJS)
│   ├── index.js, lib/, handlers/, middleware.js, public/
│   └── (handlers: launch / whoami / heartbeat / logout)
└── hub/                            # @suite/hub — THIS service
    ├── server.js                   # Express entry: view engine, static, DB open, mounts all routes, /healthz
    ├── config.js                   # env→config (throws on missing required vars); TTLs & quotas
    ├── .env / .env.example         # runtime secrets / template
    ├── package.json                # deps + scripts (start, test, create-admin, prune)
    ├── db/
    │   ├── index.js                # openDb(): opens sqlite, sets pragmas, runs ALL migrations on boot
    │   └── migrations/             # 001-initial → 004-ctm-role-gating (.sql, idempotent)
    ├── lib/                        # domain logic (factory functions taking db)
    │   ├── tokens.js               # randomToken/randomId/now
    │   ├── cookies.js              # parse/set/clear session cookie by hand
    │   ├── audit.js                # append-only audit_events logger
    │   ├── rate-limit.js           # in-memory sliding-window limiter
    │   ├── sessions.js             # deleteCentralSession(s) — FK-safe cascade for launch_tokens
    │   ├── email.js                # Resend sender + Eta email rendering
    │   ├── org.js                  # companies/teams/members CRUD + role rules (last-owner guard)
    │   ├── entitlements.js         # grant/revoke/resolve/consume + quota period accounting
    │   ├── access-requests.js      # onboarding request CRUD
    │   ├── provisioning.js         # approve(): tx that creates company+owner+entitlements+invite token
    │   ├── validate.js             # zod request-body validation middleware (coerce+strip / onInvalid / next(err))
    │   └── logger.js               # pino logger (header-free serializers, prod JSON / dev pretty)
    ├── schemas/                    # zod schemas, one file per route group + _patterns.js (shared EMAIL_RE)
    │   ├── request.js login.js magic.js   # form-route bodies
    │   ├── company.js admin.js     # form-route bodies (console)
    │   └── api.js                  # JSON API bodies (inline safeParse, bespoke error bodies kept)
    ├── middleware/
    │   ├── requireSession.js       # cookie→central session lookup, idle/expiry check, req.user
    │   ├── requireAdmin.js         # req.user.isAdmin gate
    │   ├── requireCompanyRole.js   # slug→company membership/role gate (sets req.company)
    │   ├── requireApiKey.js        # Bearer per-app API key → req.callingApp
    │   ├── requestLogger.js        # pino-http per-request logger (mounted after static, before routes)
    │   └── errorHandler.js         # central error handler (mounted LAST; JSON gets {error, fields, reqId})
    ├── routes/                     # one mount* fn per file, called from server.js
    │   ├── landing.js  legal.js    # public marketing + legal pages
    │   ├── request.js              # onboarding form (honeypot + rate limit)
    │   ├── login.js  magic.js      # magic-link request + confirm/consume
    │   ├── dashboard.js launch.js  # authed app grid + launch-token mint+redirect
    │   ├── logout.js               # hub session destroy
    │   ├── admin.js                # operator console (users/sessions/audit/companies/requests)
    │   ├── company.js              # self-service company console
    │   └── api-sessions.js api-apps.js  # JSON APIs consumed by the 4 apps (API-key auth)
    ├── views/                      # .eta templates (+ partials/, admin/, company/, emails/)
    ├── public/                     # static: instrument-core.css, landing.css, hub.css, js/, img/, fonts/
    ├── scripts/                    # operator CLIs (create-admin, prune, company/entitlement mgmt…)
    ├── deploy/{systemd,apache}/    # suite-hub.service + sprintsuite.conf
    └── tests/                      # node --test suite (~204 test() calls across 36 files) + helpers.js
```

## Data model

Single SQLite DB. **Migrations run automatically on every boot** (`db/index.js` reads every `*.sql` in `db/migrations/`, sorted by filename, and `db.exec`s each). There is no "applied migration" tracking that *skips* files — every file is re-executed on each start, so **every statement must be idempotent** (`CREATE TABLE IF NOT EXISTS`, `INSERT … ON CONFLICT DO NOTHING`, `INSERT OR IGNORE`). The `schema_version` table is informational only (records highest version seen), not a gate. Migration `004` performs idempotent data backfills (role collapse + entitlement re-homing), which is the riskiest pattern here — it relies on its `UPDATE`s becoming no-ops on later boots.

Tables:

- **users** (`001`) — canonical identity. `id`, unique `email`, `display_name`, `is_admin`, `created_at`, `disabled_at` (soft-disable). Disabling deletes all the user's central sessions.
- **central_sessions** (`001`) — the hub's own browser sessions. `id` (cookie value), `user_id`, `created_at`, `last_heartbeat_at` (drives idle timeout), `expires_at` (absolute max), `user_agent`, `ip`.
- **magic_link_tokens** (`001`) — one-time sign-in tokens. `token`, `email`, `return_to`, `created_at`, `expires_at`, `consumed_at`. Also reused for **approval invites** (provisioning issues one with a 7-day TTL).
- **launch_tokens** (`001`) — short-lived (30s) tokens handed to an app on launch. `token`, `central_session_id` (FK → central_sessions, **no ON DELETE CASCADE**), `target_app`, `expires_at`, `consumed_at`. The missing cascade is the reason all session deletes must go through `lib/sessions.js`.
- **audit_events** (`001`) — append-only event log. `id` (autoinc), `user_id` (nullable), `event_type`, `app`, `metadata` (JSON text), `created_at`, `ip`. Event types include `magic_link_sent`, `session_created`, `app_launched`, `session_exchanged`, `app_consume`, `logged_out`, `hub_logout`, `session_killed`, `user_created/disabled/deleted`, `access_requested/_approved/_rejected`, `company_member_*`, `team_*`, `member_app_granted/revoked`.
- **schema_version** (`001`) — informational version markers.
- **companies** (`002`) — `id`, `name`, unique `slug`, `status` (active/suspended), `created_at`.
- **teams** (`002`) — `id`, `company_id` (FK), `name`, `UNIQUE(company_id,name)`.
- **company_members** (`002`) — PK `(user_id, company_id)`, `role`. Role model **collapsed to `owner | member`** by migration `004` (was owner/admin/member).
- **team_members** (`002`) — PK `(user_id, team_id)`, `role` (`lead | member`).
- **app_entitlements** (`002`) — who may use which app. `id`, `app`, `principal_type` (`company|team|user`), `principal_id`, `status` (`active|suspended`), `quota_limit` (null = unlimited), `quota_period` (`month|day`), `granted_by`, `granted_at`, `UNIQUE(app, principal_type, principal_id)`.
- **app_usage** (`002`) — quota counters. PK `(app, principal_type, principal_id, period_key)`, `count`. `period_key` is `YYYY-MM` (month) or `YYYY-MM-DD` (day), UTC.
- **access_requests** (`003`) — onboarding submissions. `id`, `company_name`, `contact_name`, `email`, `job_title`, `team_size`, `apps_interest` (JSON), `message`, `status` (`pending|approved|rejected`), `created_at`, `reviewed_by/_at/_note`, `company_id` (set on approval).

Key relationships: a **user** belongs to ≥0 **companies** (company_members) and ≥0 **teams** (team_members); teams belong to a company. Entitlement resolution walks all three principal scopes a user belongs to (user, each team, each company) — see Auth model below. An approved `access_request` links to the `company` it provisioned.

## Routes / surface area

**Public (no auth):**
- `GET /` — landing page; if a valid live session cookie is present, redirects to `/dashboard`.
- `GET /request` / `POST /request` — onboarding form; POST has a `website` honeypot + IP rate limit (5/hr), records an `access_requests` row, best-effort operator email.
- `GET /license` — renders the Free Use Licence (`views/license.eta`).
- `GET /privacy`, `GET /terms` — "coming soon" stubs (`views/legal.eta`).
- `GET /healthz` — `{ ok: true }`.

**Auth (magic-link):**
- `GET /login` / `POST /login` — request a magic link. POST: validate email, IP limiter (5/min) + email limiter (10/hr); only sends if the email matches an existing, non-disabled user (silent no-op otherwise — no account enumeration). Always renders the same "check your email" page.
- `GET /auth/magic?token=…` — **side-effect-free** confirmation page (does NOT consume the token; defends against mailbox link-scanners that GET every URL). Renders a form that POSTs back.
- `POST /auth/magic` — atomically consumes the token, creates a central session, sets the `hub_session` cookie, redirects to `/launch/:app` (if `return_to` matches a known app domain) or `/dashboard`.
- `GET /logout` — destroys the session (FK-safe) and clears the cookie.

**Authed UI:**
- `GET /dashboard` — app grid with per-app `entitled` flags + list of companies the user owns/can manage.
- `GET|POST /launch/:app` — mints a 30s `launch_token` for the session and 302-redirects to `https://<appdomain>/auth/launch?token=…` (and validated `return_to`).
- `GET /company/:slug` — company console (members + per-member Signal/RAID toggles + teams). `requireCompanyRole(["owner"])`.
- `GET /company/:slug/teams/:teamId` and several `POST`s — manage members, roles, teams, team membership, and per-member app grants. All owner-gated, all audited, with last-owner protection.

**Admin (operator, `is_admin`):** `GET /admin` (users), `POST /admin/users` (+`/:id/disable|enable|delete`), `GET /admin/sessions` (+`/:id/kill`), `GET /admin/audit` (last 200 events), `GET /admin/companies` (companies + their apps + pending requests, with duplicate-request flagging), `POST /admin/requests/:id/approve|reject` (approve runs the provisioner + sends the invite email).

**JSON API (per-app `Authorization: Bearer <app key>`):**
- `POST /api/sessions/exchange` — app trades a `launch_token` for `{ user, central_session_id, entitlement, teams, company }`. Validates the token's `target_app` matches the calling app.
- `POST /api/sessions/:id/heartbeat` — refresh `last_heartbeat_at` (idle keep-alive); 404 if expired/idle.
- `DELETE /api/sessions/:id` — app-initiated logout (destroys central session).
- `POST /api/apps/:app/consume` — decrement quota for the session's user; `200 {ok,remaining}`, `402 quota_exceeded`, `403 not_entitled`.

## Input validation (zod)

Added 2026-06-09 (Tier-1 #2 of the tech-stack upgrade). The manual `.trim()`/regex/`if (!x) return 400` checks that used to live inline in routes are now declarative **zod** schemas, one file per route group under `schemas/` (the messy normalization — trim, lowercase, empty→null, `apps`-array filtering — moved *into* the schemas as transforms; `EMAIL_RE` is shared in `schemas/_patterns.js`).

- **`lib/validate.js`** exports `validate(schema, { source = "body", onInvalid })` Express middleware. On success it **replaces `req.body`** with zod's parsed (coerced, unknown-key-stripped) output, so handlers read already-clean values. On failure: form routes pass an `onInvalid` callback that **re-renders the same view with the original friendly message + the user's values** (behavior parity — no per-field inline errors); JSON routes omit `onInvalid`, so `validate` calls `next(err)` with `err.status = 400` and `err.fields = error.flatten().fieldErrors`, which the central `errorHandler` surfaces as `400 { error, fields, reqId }`.
- **Form routes** (`/request`, `/login`, `/auth/magic`, `/company/*`, `/admin/*`) use `validate(schema, { onInvalid })`. Pre-steps that must precede validation stay ahead of it — notably `/request`'s honeypot (hidden `website` → fake-success) and rate-limit (429).
- **JSON API routes** (`/api/sessions/exchange`, `/api/apps/:app/consume`) deliberately use **inline `schema.safeParse`** rather than the middleware, to preserve their existing bespoke error bodies (`{error:"missing_launch_token"}`, `{ok:false,reason:"missing_central_session_id"}`) that existing tests assert — zod here tightens types without changing the wire contract.
- **Express 5 caveat:** `validate` only reassigns `req.body` (`req.query`/`req.params` are getter-only in Express 5); the `/auth/magic` **GET** keeps an inline `req.query.token` check for that reason.
- This is the hub *pilot* of a suite-wide rollout; the same `lib/validate.js` + `schemas/` pattern was copied into all four apps (Poker & Retro additionally validate WebSocket payloads). See the per-app docs.

## Auth & identity model

**Sign-in is passwordless magic-link.** Flow: user enters email at `/login` → if a matching, enabled `users` row exists, a `magic_link_tokens` row (15-min TTL) is created and a Resend email is sent (silent otherwise). The email link is `GET /auth/magic?token=…`, which only *shows* a confirm page; the human clicks a button that `POST`s, which **atomically consumes** the token (`UPDATE … WHERE consumed_at IS NULL AND expires_at > now`) and creates a **central session**. There is **no public self-signup** — accounts come into existence only via admin user-creation, company-member invites, or onboarding approval. This is the core abuse defense (links only ever go to existing users).

**Sessions:** server-side rows in `central_sessions`; the browser holds an opaque `hub_session` cookie (`HttpOnly`, `Path=/`, `SameSite=Lax`, `Secure` in prod, 30-day Max-Age). Two timeouts enforced in `requireSession`: **idle** = 30 min since `last_heartbeat_at` (config `sessionIdleMs`), **absolute** = 30 days `expires_at` (config `sessionMaxMs`). Every authed request `touch`es the heartbeat. The cookie is **not signed** (`COOKIE_SECRET` is reserved/unused) — security relies on the token being 256 bits of CSPRNG randomness.

**Roles:**
- Platform-level: `users.is_admin` → operator (the `/admin` console). Set via `scripts/create-admin.js`.
- Company-level: `owner | member` (collapsed from owner/admin/member by migration 004). Owners can manage the company console; the system enforces **at least one owner** (last-owner guard throws on the final owner's removal/demotion). Owners implicitly have every app; members get per-app grants.
- Team-level: `lead | member` (used for context/labeling; not a permission gate in the hub).

**Companies / teams / entitlements:** entitlements attach to a `principal` that is a `user`, `team`, or `company`. `resolveEntitlement(userId, app)` collects all principals the user belongs to (self + their teams + their companies), finds active matching grants, and picks the most generous (an unlimited grant wins; otherwise the one with most remaining quota). `consume()` does the same selection inside a transaction and increments `app_usage` for the chosen principal's current period. Default provisioning grants **Poker + Retro at the company level** (all members inherit) and **Signal (unlimited) + RAID (25/month) to the owner at the user level**; the company console lets owners toggle Signal/RAID per member (`TOGGLABLE_APPS`).

**How other apps integrate:** after the hub mints a `launch_token` and redirects to `https://<app>/auth/launch?token=…`, the app calls back `POST /api/sessions/exchange` (server-to-server, Bearer key) to learn who the user is, their entitlement, teams, and company; it then mints its *own* local session. The app periodically calls `heartbeat` to keep the central session alive, calls `consume` for quota'd actions, and `DELETE`s the central session on logout. **Return-to-Suite:** apps embed `@suite/auth-client`'s `GET /auth/whoami` (a cheap local lookup, no hub round-trip) to decide whether to show a "Return to Suite" button linking to `hubBaseUrl + /dashboard`.

## Inter-app integration

The four satellite apps — **Sprintraid** (sprintraid.uk), **Sprintsignal** (sprintsignal.uk), **Sprintretro** (sprintretro.uk), **Sprintpoker** (sprintpoker.uk) — each embed the shared **`@suite/auth-client`** package (`/var/www/suite/shared/auth-client`, CommonJS; on prod each app symlinks it rather than npm-installing). The auth-client provides Express handlers (`handlers/launch.js`, `whoami.js`, `heartbeat.js`, `logout.js`), a `hubApi` HTTP client (`lib/hub-api.js`), a local session store, cookie helpers, a `requireAuth` middleware, and the hub's static assets.

End-to-end launch flow:
1. User clicks an app in the hub `/dashboard` (or arrives at an app's `return_to`). Hub `GET /launch/:app` mints a 30s `launch_token` bound to the central session + target app, and 302s to `https://<app>/auth/launch?token=…`.
2. The app's `handleLaunch` calls hub `POST /api/sessions/exchange` (Bearer `HUB_API_KEY_<APP>`). The hub validates the token (single-use, unexpired, `target_app` matches the calling app, user not disabled) and returns `{ user, central_session_id, entitlement, teams, company }`.
3. The app creates a **local** session (storing `centralSessionId`, entitlement, teams, company) and sets its own cookie.
4. Ongoing: the app uses `central_session_id` for `heartbeat` (keep-alive), `consume` (quota), and `deleteSession` (logout). The hub is the single source of truth for identity and entitlement; apps cache the snapshot taken at launch.

**Per-app entitlement defaults:** Poker/Retro are company-scoped (anyone in the company); Signal/RAID are account-gated per user (RAID 25/month). Anonymous "share-link" users in Poker/Retro never get a suite session, so they never see the Return-to-Suite button (`whoami` returns `authed:false`).

## Configuration & secrets

All read in `config.js`; **required vars throw at startup if missing** (no dotenv — env must be injected by systemd).

| Key (env) | Config field | Purpose |
|---|---|---|
| `PORT` | `port` | Listen port (default 3000). |
| `NODE_ENV` | `nodeEnv` | Enables Eta view caching + `Secure` cookie when `production`. |
| `BASE_URL` *(required)* | `baseUrl` | Public origin; used to build magic-link/invite/review URLs. |
| `DB_PATH` *(required)* | `dbPath` | SQLite file path. |
| `RESEND_API_KEY` *(required)* | `resendApiKey` | Resend API key for outbound email. |
| `FROM_EMAIL` *(required)* | `fromEmail` | Sender address (e.g. `login@sprintsuite.uk`). |
| `ADMIN_EMAIL` *(optional)* | `adminEmail` | Operator notification target for new access requests; unset = no notification. |
| `COOKIE_SECRET` *(required)* | `cookieSecret` | **Reserved/unused** — required to exist but signs nothing in v1. |
| `ALLOWED_APP_DOMAINS` *(required)* | `allowedAppDomains[]` | Comma-separated allowlist for validating `return_to`. |
| `HUB_API_KEY_{RAID,SIGNAL,RETRO,POKER}` *(required)* | `apiKeys.*` | Per-app shared secrets for the JSON API; must match each app's `HUB_API_KEY`. |

Hardcoded TTLs/limits in `config.js`: `sessionIdleMs` 30 min, `sessionMaxMs` 30 days, `magicLinkTtlMs` 15 min, `inviteTtlMs` 7 days, `launchTokenTtlMs` 30 s. RAID default quota (25/month) and the company/owner default app sets live in `lib/provisioning.js`; rate-limit thresholds are inline in `routes/login.js` and `routes/request.js`.

## Testing

- **Framework:** `node --test` (built-in), with `supertest` for HTTP route assertions. Run with `npm test` (`node --test tests/`). Tests build an in-memory app via `tests/helpers.js` (`DB_PATH=:memory:`, dummy secrets, `trust proxy` mirrored from server.js).
- **Size:** **node reports 247 tests** (as of 2026-06-09) across ~39 `*.test.js` files — the 2026-06-09 zod work added `validate.test.js`, `api-validate-fields.test.js`, plus schema/coercion + 400-path cases folded into the existing route suites. Each migrated route's pre-existing test file is the regression guard that proves behavior parity held.
- **Coverage areas:** every route group (landing, login, magic, launch, dashboard, logout, request, legal, admin-users/sessions/companies, company console, api-sessions exchange/heartbeat, api-apps consume); every lib module (entitlements — 17, org — 24, provisioning, access-requests, audit, cookies, rate-limit, tokens, email, prune, sessions); middleware (requireSession, requireCompanyRole); the migrations (`db`, `db-002`, `db-004`); config validation; the **trust-proxy** fix; and visual/CSS guards (`theme-drift`, `instrument-chrome`, `landing-assets`). Largest suites: `company` (33), `org` (24), `entitlements` (17), `landing`/`request` (13).

## Operational notes & gotchas

- **trust proxy = "loopback".** Set in `server.js` (and mirrored in `tests/helpers.js`) so `req.ip` reflects the real client via `X-Forwarded-For` behind Apache. This is load-bearing: without it the per-IP login limiter collapses into one global bucket (self-DoS) and audit IPs are all `127.0.0.1`. **Open follow-up (per memory):** verify after a real sign-in that `/admin/sessions` shows the public IP, not `127.0.0.1`; if not, add `mod_remoteip`/`RemoteIPHeader` to the Apache vhost. (Apache must actually forward `X-Forwarded-For` — `mod_proxy_http` does this by default.)
- **Migrations re-run on every boot.** No skip-tracking. Any new migration **must** be fully idempotent; non-idempotent data mutations (like `004`'s) will re-fire on every restart and must be written to no-op safely.
- **Always delete central sessions via `lib/sessions.js`.** `launch_tokens.central_session_id` FKs `central_sessions` with **no ON DELETE CASCADE** and FKs are enforced, so a bare `DELETE FROM central_sessions` throws once the user has launched an app. The helpers (and `prune.js`) delete child `launch_tokens` first. (A past Sign-Out 500 came from this exact trap.)
- **Rate limiting is in-memory and per-process.** Counters reset on restart and are not shared if ever run multi-instance. Login: 5/min per IP + 10/hr per email. Request: 5/hr per IP. The hub is single-instance today, so this is acceptable.
- **No CSRF protection.** State-changing endpoints are plain form POSTs with no token; mitigations are `SameSite=Lax` cookies and Apache's 256KB body cap. A maintainer adding sensitive POSTs should weigh this.
- **zod validation has parity constraints (see *Input validation*).** When adding/altering a route: keep request-specific pre-steps (honeypot, rate-limit) *ahead* of `validate`; on a form route supply an `onInvalid` that re-renders with the route's existing message (don't let it fall through to the generic error page); for a JSON route whose error body is asserted by tests, use inline `safeParse` not the middleware. `validate` strips unknown keys — a handler must only read fields its schema declares, or they'll be silently `undefined`.
- **No account enumeration on `/login`** (always shows "check your email"); `/request` uses a honeypot + rate limit. The magic-link GET is deliberately side-effect-free to survive mailbox link-scanners — keep it that way.
- **Unbounded retention is an open risk.** `scripts/prune.js` (run via `npm run prune` / cron, **not** scheduled in-app) removes expired sessions/tokens and audit events older than 90 days, but `access_requests` and `audit_events` (within window) and app-side data grow unbounded. A prune job/policy is a prerequisite before any privacy-note retention promise.
- **Multi-tenancy assumption.** Several places (api-sessions exchange company resolution, company-console app toggles) assume **every user belongs to exactly one company**. Per-user Signal/RAID grants carry no company scope, so company context is derived from an arbitrary membership. Marked `TODO(multi-tenancy)` in code — correct only while users are single-company.
- **Port discrepancy (see Deployment).** `.env` says 3000; committed Apache/`.env.example`/systemd comments say 3004. Confirm against the live vhost + running process before assuming.
- **Operator bootstrapping** is CLI-only: `scripts/create-admin.js <email>`. Other operator CLIs exist (`create-company`, `create-team`, `add-company-member`, `add-team-member`, `grant-entitlement`, `seed-default-entitlements`, `set-company-member-role`, `delete-company`); note hub scripts read `config.js` which needs env present (no dotenv), and `delete-company.js` takes an explicit dbPath arg.
- **`/privacy` and `/terms` are stubs.** The live `/license` (Free Use Licence v1.0) is interim/unreviewed and its §8 links to `/privacy`, which is still "coming soon" — both flagged for a solicitor/content pass.
