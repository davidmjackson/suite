# Sprint Suite — Centralised Auth Hub Design

> **Date:** 2026-05-28
> **Status:** Design (pre-implementation)
> **Author:** Brainstormed between David and Claude
> **Replaces:** The cancelled Clerk integration (see `~/clerk-archive/` for that effort's docs)

---

## 1. Summary

Build a small Node.js + Express auth hub at `sprintsuite.uk` that holds the single source of truth for user identity and active sessions across the four Sprint apps. Users sign in once via magic link (no passwords), land on a dashboard, and launch any of the four apps in a single click. Each app validates its session by heartbeat-pinging the hub. The hub also serves as the SEO landing page for the Sprint Suite brand.

The hub uses SQLite. Each app keeps its own data DB unchanged. Cost: £0. Effort estimate: ~3-4 focused days.

## 2. Goals

1. **Unified login experience** across all four apps — same flow, same UX, one shared library.
2. **Single sign-on** — log in once at `sprintsuite.uk`, access all four apps without re-authenticating.
3. **Passwordless** — magic links via email (Resend).
4. **Centralised session control** — hub holds authoritative session state; revocation is instant (delete session → all apps lose access on next heartbeat).
5. **SEO landing page** at `sprintsuite.uk` apex — public marketing for the suite.
6. **Admin panel** at `sprintsuite.uk/admin` — list/disable/delete users, view active sessions, view audit log.
7. **Zero ongoing cost.** No paid third-party auth services.

## 3. Non-goals (v1)

| Feature | Why deferred |
|---|---|
| Password fallback | Defeats the passwordless goal; if Resend is down we wait it out |
| Social login (Google / GitHub / Microsoft) | Future iteration via same shared library |
| Passkeys (WebAuthn) | Magic links cover the passwordless goal for v1 |
| Multi-factor auth | Invite-only signup is the main attack mitigation |
| Per-app permissions / roles | All authed users have access to all four apps |
| User self-service profile editing | Admin-only for v1; users can ask admin to change their email |
| Welcome emails, onboarding flows | YAGNI for a 1-5 user system |
| Multi-tenancy / organisations | Single tenant |
| Internationalisation | English only |
| Mobile-app considerations | Web only |
| Account recovery flow | Admin manually changes email if user loses access |
| App data migrations beyond users | Only the user table is centralised; apps keep all their other data |

## 4. Architecture

### 4.1 Topology

```
┌──────────────────────────────────────────────────────────────────┐
│  Production server (Apache + PM2, IP 194.164.124.172)            │
│                                                                  │
│  ┌─────────────────────┐                                         │
│  │ sprintsuite.uk      │ ◄─── Apache vhost ─── port 3000         │
│  │  (Auth Hub + SEO)   │                                         │
│  │  • Landing page (/) │                                         │
│  │  • /login           │                                         │
│  │  • /dashboard       │                                         │
│  │  • /auth/magic      │                                         │
│  │  • /api/sessions/*  │                                         │
│  │  • /admin           │                                         │
│  │  • User DB (SQLite) │                                         │
│  └─────────────────────┘                                         │
│                                                                  │
│  ┌──────────────────┐ ┌──────────────────┐                       │
│  │ sprintraid.uk    │ │ sprintsignal.uk  │ ◄─── existing apps    │
│  │ (port 3004)      │ │ (port 3003)      │     unchanged URLs    │
│  └──────────────────┘ └──────────────────┘                       │
│  ┌──────────────────┐ ┌──────────────────┐                       │
│  │ sprintretro.uk   │ │ sprintpoker.uk   │                       │
│  │ (port 3002)      │ │ (port 3001)      │                       │
│  └──────────────────┘ └──────────────────┘                       │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 Data topology

```
┌──────────────────────────────────────────────────────────────────┐
│  Hub SQLite (/var/www/suite/hub/data/suite.db)                   │
│  • users           — id, email, name, is_admin, disabled_at      │
│  • central_sessions— id, user_id, last_heartbeat_at              │
│  • magic_link_tokens                                             │
│  • launch_tokens                                                 │
│  • audit_events                                                  │
│                                                                  │
│  THE ONLY PLACE USER IDENTITY LIVES.                             │
└─────────────────┬────────────────────────────────────────────────┘
                  │ apps reference users by hub user_id only
       ┌──────────┼──────────────────┬────────────────┐
       ▼          ▼                  ▼                ▼
┌────────────┐ ┌───────────────┐ ┌────────────┐ ┌──────────────┐
│ raid       │ │ signal        │ │ retro      │ │ scrumpoker   │
│ (no app DB │ │ data/signal.db│ │ retros.db  │ │ (no app DB,  │
│  beyond    │ │ (existing)    │ │ (existing) │ │  ephemeral)  │
│  ephemeral │ │               │ │            │ │              │
│  process)  │ │  • signals    │ │  • retros  │ │              │
│            │ │  • teams      │ │  • items   │ │              │
│  +         │ │  + app_sess.  │ │  + app_s.  │ │  + app_sess. │
│  app_sess. │ │               │ │            │ │              │
└────────────┘ └───────────────┘ └────────────┘ └──────────────┘
```

Each app gains a single small `app_sessions` table (3 columns: `id` for cookie value, `user_id` from hub, `central_session_id` from hub). No other schema impact.

### 4.3 Tech stack

| Layer | Choice | Why |
|---|---|---|
| Hub framework | Node.js + Express 5.x | Same as apps; uniform |
| Hub DB | `better-sqlite3` | Zero-config, file-based, already used by signal + retrospective |
| Templates | Server-rendered HTML (no SPA) | Hub is mostly forms + lists; SPA overhead unjustified |
| Email | Resend (3,000/month free, no branding in emails) | Modern, simple SDK, fits "no major 3rd party" intent |
| Process management | PM2 (existing) | Already in use for the four apps |
| Reverse proxy | Apache (existing) | New vhost mirrors existing app vhosts |
| TLS | Let's Encrypt via Certbot | Already configured for app domains |
| Session/token crypto | `crypto.randomBytes(32).toString('hex')` for opaque tokens | No JWTs needed; opaque tokens validated by DB lookup |

## 5. Auth flow

Three scenarios cover the full flow.

### 5.1 Scenario A — Cold login

User has no sessions anywhere.

1. User visits `sprintraid.uk/some-page` (logged out).
2. App's `requireAuth` middleware sees no `raid_session` cookie → 302 to `sprintsuite.uk/login?return_to=https://sprintraid.uk/some-page`.
3. Hub renders the login form. User enters email, submits POST `/login`.
4. Hub:
   - Validates email format.
   - **Invite-only enforcement:** looks up email in `users`. If not found, render "check your email" anyway (no email enumeration leak) and skip sending.
   - If found and not disabled: generate magic link token (`crypto.randomBytes(32).toString('hex')`), store in `magic_link_tokens` with 15-min expiry and the `return_to` URL.
   - Send email via Resend.
   - Render "check your email" page.
5. User opens email, clicks the magic link → `sprintsuite.uk/auth/magic?token=<random>`.
6. Hub's `/auth/magic`:
   - Atomic consume: `UPDATE magic_link_tokens SET consumed_at = now() WHERE token = ? AND consumed_at IS NULL AND expires_at > now()`.
   - If 0 rows affected → render "link expired or already used" page.
   - Otherwise upsert `users` row (existing), create `central_sessions` row, drop `hub_session` cookie (HttpOnly, Secure, SameSite=Lax, 30-day max lifetime).
   - 302 to dashboard, or directly to the return-to app if `return_to` was set (see 5.4).
7. Dashboard → user clicks app tile (or `return_to` triggers auto-launch).
8. Hub generates a `launch_token` (`crypto.randomBytes(32).toString('hex')`, 30-sec expiry, single-use, scoped to `central_session_id` + target app) → 302 to `sprintraid.uk/auth/launch?token=<launch_token>`.
9. App's `/auth/launch` handler:
   - Server-to-server POST `sprintsuite.uk/api/sessions/exchange` with the launch_token and the app's API key.
   - Hub validates token (atomic consume), returns `{user_id, email, name, central_session_id}`.
   - App inserts a row into its local `app_sessions` table (random `raid_session` cookie value, user_id, central_session_id).
   - App drops `raid_session` cookie (HttpOnly, Secure, SameSite=Lax, 30-day max lifetime).
   - 302 to the original `return_to` path (validated against `sprintraid.uk` only).

### 5.2 Scenario B — User visits a second app while already authenticated (SSO win)

1. User (already logged into hub) visits `sprintpoker.uk/room/123` (no `poker_session` yet).
2. App middleware: no session → 302 to `sprintsuite.uk/login?return_to=https://sprintpoker.uk/room/123`.
3. Hub sees `hub_session` cookie is valid → no login form shown; immediately generates a `launch_token` for `sprintpoker.uk` and 302s.
4. App `/auth/launch` exchanges, drops cookie, 302s to `/room/123`.

Net: two silent redirects, ~200ms, no user interaction. **This is the SSO.**

### 5.3 Scenario C — Logout

1. User clicks "Sign out" on any app.
2. App clears local cookie, sends server-to-server `DELETE sprintsuite.uk/api/sessions/<central_session_id>` with API key.
3. Hub deletes the `central_sessions` row.
4. App 302s the user to `sprintsuite.uk/` (apex landing).
5. **Global logout follows automatically**: on the next heartbeat from any other app the user has open, the hub returns 404 → that app clears its cookie and forces re-login.

### 5.4 Heartbeat / session lifetime

| Component | Behaviour |
|---|---|
| **Frontend (browser)** | `heartbeat.js` runs `setInterval(() => fetch('/api/heartbeat', {method: 'POST'}), 60_000)` on every authenticated page. On 401 response, forces a full page reload to trigger re-login. |
| **App backend** | `/api/heartbeat` route: reads local cookie → looks up `app_sessions` → checks `last_validated_at`. If < 60s ago, return 200 immediately. Otherwise call hub `POST /api/sessions/:id/heartbeat`. If hub returns 200, update `last_validated_at`. If 404, delete the app session, return 401. If network error, allow up to 5 min of stale validation (grace period). |
| **Hub backend** | `/api/sessions/:id/heartbeat`: `UPDATE central_sessions SET last_heartbeat_at = now() WHERE id = ? AND last_heartbeat_at > now() - 30_minutes` → if 0 rows affected, return 404; else return 200. |
| **Idle expiry** | Central sessions expire 30 min after last heartbeat. Cron job (every 5 min) deletes expired rows. |
| **Max lifetime** | Central sessions expire 30 days after creation regardless of heartbeats. Hardcoded cap. |

### 5.5 Token and cookie reference

| Thing | Format | Lifetime | Where it lives | Single-use? |
|---|---|---|---|---|
| Magic link token | 32-byte random hex | 15 min | DB row + email URL | Yes |
| Launch token | 32-byte random hex | 30 sec | DB row + redirect URL | Yes |
| `hub_session` cookie | 32-byte random hex (session ID) → DB lookup | 30 days max, 30 min idle | `sprintsuite.uk` only | N/A — reusable |
| `raid_session` / `signal_session` / `retro_session` / `poker_session` cookies | Per-app random IDs → app DB lookup | 30 days max, 30 min idle (synced to central) | Each app's own TLD only | N/A — reusable |
| Hub-to-app API key | UUID per app | Long-lived (rotate manually) | `.env` on both sides | N/A — Bearer token in headers |

## 6. Components

### 6.1 SprintSuite Hub — `/var/www/suite/hub/`

New Node.js + Express app, port 3000.

| Sub-component | Purpose | Approx LOC |
|---|---|---|
| **SEO landing** (`/`) | Public marketing page when not logged in. Hero, four app cards, "Sign in" CTA. | ~150 HTML/CSS + 30 route |
| **Login flow** (`/login`, `/login/check-email`, `/auth/magic`) | Email form, "check your email" confirmation, magic link consumption + session creation. | ~200 LOC + 1 email template |
| **Dashboard** (`/dashboard`) | Authenticated landing — grid of four app tiles. Click → generates launch_token → 302 to chosen app. | ~120 LOC + HTML/CSS |
| **Session API** (`/api/sessions/exchange`, `/api/sessions/:id/heartbeat`, `/api/sessions/:id` DELETE) | Server-to-server endpoints. Bearer API key per app. | ~150 LOC |
| **Admin panel** (`/admin`) | Three tabs: Users, Active sessions, Audit log. Routed behind `is_admin` check. | ~250 LOC + HTML |
| **Resend integration** | One module wrapping Resend SDK + magic link template. | ~50 LOC |
| **DB migrations** | `.sql` files run at boot via `better-sqlite3-migrate` or hand-rolled. | ~80 LOC |
| **CLI: create-admin** | `node scripts/create-admin.js <email>` — bootstrap the first admin user (since admin panel requires an existing admin). | ~30 LOC |

**Total hub: ~1,000 LOC of fresh code + ~300 lines of HTML/CSS.**

### 6.2 Shared auth client — `/var/www/suite/shared/auth-client/`

npm package installed via local file reference: `"@suite/auth-client": "file:../suite/shared/auth-client"`.

| Export | Purpose | LOC |
|---|---|---|
| `requireAuth(options)` Express middleware | Checks app session cookie, validates via heartbeat (cached 60s), 302s to hub login if missing. | ~120 |
| `handleLaunch(req, res)` route handler | For `/auth/launch?token=...`: exchanges token, creates local app session, redirects. | ~60 |
| `handleLogout(req, res)` route handler | For `/auth/logout`: clears local cookie, deletes central session via hub API, 302 to hub. | ~30 |
| `getCurrentUser(req)` helper | Returns `{userId, email, name}` from request's local session, for use in app code. | ~20 |
| Frontend `heartbeat.js` (browser script) | `setInterval` POSTs to `/api/heartbeat` every 60s while authenticated page is open. | ~40 |
| Config | App identifier, hub URL, hub API key, cookie name, app DB connection. | ~30 |

**Total shared library: ~300 LOC.**

### 6.3 Per-app integration

For each of `raid`, `signal`, `retrospective`, `scrumpoker`:

1. `npm install file:../suite/shared/auth-client`
2. Add three routes: `/auth/launch`, `/auth/logout`, `/api/heartbeat`.
3. Replace existing session middleware with `requireAuth` on protected routes.
4. Replace existing user-identity lookups with `getCurrentUser()`.
5. Add the heartbeat script to authenticated page templates (single `<script src="/heartbeat.js"></script>`).
6. Remove old auth code:
   - `lib/session.js`, `lib/loginRateLimiter.js`, `lib/auth.js`, `lib/authRoutes.js`
   - `public/login.html`, `public/css/login.css`, `public/js/login.js`
   - `tests/auth.test.js`, `tests/session.unit.test.js`, `tests/login-rate-limiter.test.js`
   - `argon2` dependency (signal only)

**Per-app additions: ~50 LOC. Per-app deletions: ~200-500 LOC depending on existing auth surface.**

### 6.4 Migration — only signal and retrospective need it

Raid and Sprintpoker don't persist user data, so they're fresh integrations with no migration.

For signal and retrospective:

1. **Pre-flight backup**: `cp data/signal.db data/signal.db.pre-migration` and `cp retros.db retros.db.pre-migration`.
2. **Read existing users**: SELECT id, email, name FROM users.
3. **Insert into hub**: hub.users gets one row per unique email. The hub user_id is freshly generated.
4. **Build mapping**: write a CSV `migration-mapping.csv` with `old_app_user_id, hub_user_id, email`.
5. **Rewrite app data**: UPDATE all `user_id` columns in app data tables to use the new hub user_id. For signal: `signals.created_by_user_id`, `teams.owner_id`, etc. For retrospective: `retros.facilitator_id`, `items.author_id`, etc.
6. **Drop old auth tables**: `users`, `sessions`, and similar — replaced by `app_sessions`.
7. **Verify**: counts of signals/retros/teams unchanged; spot-check a few owners by email.

**Migration script: ~200 LOC, dry-run mode mandatory before live run.**

### 6.5 Infrastructure

- **Apache vhost** for `sprintsuite.uk` reverse-proxying `localhost:3000`, HTTPS via Let's Encrypt. New file in `/etc/apache2/sites-available/`.
- **DNS at Ionos**: 3-4 TXT records for Resend domain verification (DKIM, SPF, DMARC). Separate from any prior Clerk records — no conflict.
- **PM2 entry**: `pm2 start /var/www/suite/hub/server.js --name suite-hub`.
- **Cron job**: 5-minute interval, deletes expired sessions and audit events > 90 days.
- **`.env` secrets** on hub: `RESEND_API_KEY`, four `HUB_API_KEY_<APPNAME>` values (one per app, can be rotated independently), `HUB_BASE_URL`, `COOKIE_SECRET`.
- **`.env` secrets** on each app: `HUB_BASE_URL`, `HUB_API_KEY` (the app's own), `APP_NAME` (e.g. `"raid"`).

## 7. Data model

### 7.1 Hub schema

```sql
-- Users
CREATE TABLE users (
  id            TEXT PRIMARY KEY,         -- 16-byte hex
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,         -- unix ms
  disabled_at   INTEGER                   -- nullable
);
CREATE INDEX idx_users_email ON users(email);

-- Central sessions (the source of truth)
CREATE TABLE central_sessions (
  id                  TEXT PRIMARY KEY,   -- 32-byte hex, used as hub_session cookie value
  user_id             TEXT NOT NULL REFERENCES users(id),
  created_at          INTEGER NOT NULL,
  last_heartbeat_at   INTEGER NOT NULL,
  expires_at          INTEGER NOT NULL,   -- created_at + 30 days
  user_agent          TEXT,
  ip                  TEXT
);
CREATE INDEX idx_central_sessions_user ON central_sessions(user_id);
CREATE INDEX idx_central_sessions_expires ON central_sessions(expires_at);

-- Magic link tokens (single-use)
CREATE TABLE magic_link_tokens (
  token         TEXT PRIMARY KEY,         -- 32-byte hex
  email         TEXT NOT NULL,
  return_to     TEXT,                     -- nullable; full URL to bounce to after login
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,         -- created_at + 15 min
  consumed_at   INTEGER                   -- nullable; set on first use
);
CREATE INDEX idx_mlt_email ON magic_link_tokens(email);

-- Launch tokens (single-use, app-scoped)
CREATE TABLE launch_tokens (
  token                 TEXT PRIMARY KEY, -- 32-byte hex
  central_session_id    TEXT NOT NULL REFERENCES central_sessions(id),
  target_app            TEXT NOT NULL,    -- 'raid' | 'signal' | 'retro' | 'poker'
  created_at            INTEGER NOT NULL,
  expires_at            INTEGER NOT NULL, -- created_at + 30 sec
  consumed_at           INTEGER
);

-- Audit log
CREATE TABLE audit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT,                       -- nullable for some events
  event_type  TEXT NOT NULL,              -- 'magic_link_sent' | 'magic_link_consumed' | 'session_created' | 'app_launched' | 'logged_out' | 'session_expired' | 'user_created' | 'user_disabled' | 'user_deleted'
  app         TEXT,                       -- nullable
  metadata    TEXT,                       -- nullable JSON
  created_at  INTEGER NOT NULL,
  ip          TEXT
);
CREATE INDEX idx_audit_user ON audit_events(user_id);
CREATE INDEX idx_audit_created ON audit_events(created_at);
```

### 7.2 Per-app schema addition

Each app gets one new table:

```sql
CREATE TABLE app_sessions (
  id                    TEXT PRIMARY KEY,   -- 32-byte hex, used as app's session cookie value
  user_id               TEXT NOT NULL,      -- hub user_id (no FK; hub is a separate DB)
  central_session_id    TEXT NOT NULL,      -- for heartbeat lookups
  created_at            INTEGER NOT NULL,
  last_validated_at     INTEGER NOT NULL,   -- for the 60-sec cache
  expires_at            INTEGER NOT NULL
);
CREATE INDEX idx_app_sessions_central ON app_sessions(central_session_id);
```

For raid and scrumpoker, this means introducing a SQLite DB where there isn't one currently. Trivial overhead — `better-sqlite3` is added as a dependency and a `data/raid-sessions.db` (or similar) is created at first run.

## 8. Security model

### 8.1 Threats and mitigations

| Threat | Mitigation |
|---|---|
| Magic link intercepted via email account compromise | 15-min expiry; single-use; one click consumes the token regardless of whether legitimate or not |
| Launch token URL leaked (browser history, referer header, screenshare) | 30-sec expiry; consumed server-to-server via POST in the launch handler, so the URL leak window is ~1 sec |
| Hub-to-app API key leak | Per-app keys; rotatable independently; only in `.env`; never logged |
| Open redirect via `return_to=` | Server-side allowlist of the four app domains; reject any other origin |
| CSRF on logout / delete-session endpoints | POST/DELETE only; SameSite=Lax cookies; API key required on hub endpoints |
| XSS exfiltrating session cookies | HttpOnly + Secure + SameSite=Lax on all session cookies; no JS-readable session storage |
| Disabled user with active sessions | Admin disable deletes all the user's `central_sessions` immediately; next heartbeat from any app returns 404 → kicked out within 60 sec |
| Email enumeration via login form | "Check your email" page shown for any submitted email; no timing leak; no email actually sent for unknown addresses |
| Replay of magic link token | `UPDATE ... WHERE consumed_at IS NULL` atomic consume; 0 rows affected → render expired-link page |
| Hub downtime cascading to all apps | Apps cache last successful validation for 5 min (grace period). After that, force re-login. PM2 auto-restart limits hub downtime to seconds. |
| Cookie set on wrong domain (subtle bug) | Explicit `domain=sprintraid.uk` etc. in cookie config; integration test asserts Set-Cookie header per app |

### 8.2 Why no JWTs

The original brainstorm considered signed JWTs for the hub-to-app token exchange. Discarded because:
- Tokens are opaque random hex; validation is a DB lookup, not signature verification.
- Revocation is instant via DB delete; JWTs would have a window of "valid but revoked" between expiry and the next refresh.
- No signing-key management. No clock-skew concerns. No `aud`/`jti` complexity.
- Stateful sessions match the user's mental model (and his explicit design preference).

### 8.3 Rate limiting

- Magic link request endpoint (`POST /login`): max 5 per minute per IP, max 10 per hour per email.
- Launch token consumption (`POST /api/sessions/exchange`): authenticated via API key, naturally rate-limited by app server-to-server volume.
- Heartbeat endpoint: 60 per minute per session (one per minute expected; cap at 60 to allow bursty retries).

Implementation: simple in-memory token bucket via `rate-limiter-flexible` or hand-rolled. Persist counters to SQLite if memory restart resets become problematic (unlikely at hobby scale).

## 9. UI surfaces

Six surfaces total. Sketches only; visual design happens at implementation time.

### 9.1 Hub landing (apex `/`, unauthenticated)

```
┌─────────────────────────────────────────────────────────┐
│ Sprint Suite                              [Sign in]     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│        Agile tools for teams that ship.                 │
│        One sign-in, four focused apps.                  │
│                                                         │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│   │Sprintraid│  │SprintSig.│  │Sprintret.│  │Sprintp.│  │
│   │  Risk +  │  │  Health  │  │   Retro  │  │ Poker  │  │
│   │ Issues   │  │  signals │  │          │  │        │  │
│   └──────────┘  └──────────┘  └──────────┘  └────────┘  │
│                                                         │
│   (SEO content: what each app does, why, etc.)          │
└─────────────────────────────────────────────────────────┘
```

### 9.2 Login (`/login`)

Single email field, centered, minimal.

### 9.3 Check-your-email (`/login/check-email`)

"A sign-in link has been sent to <email>. It expires in 15 minutes."

### 9.4 Dashboard (`/dashboard`)

2×2 grid of app tiles. Top bar shows user email + Sign out.

### 9.5 Admin (`/admin`)

Three tabs:
- **Users**: table (email, last login, active sessions count, status); actions per row (disable, delete); + Add user form.
- **Active sessions**: table (user, app, IP, started, last heartbeat); per-row "kill session" action.
- **Audit log**: chronological list of events, filterable by type.

### 9.6 App-side auth strip

Small element in each app's existing layout: `you@email.com · Sign out`.

## 10. Migration plan

### 10.1 Migration phases (per app)

For signal and retrospective (the two apps with persistent users):

**Phase 1 — Prep (no production impact)**
1. Build hub end-to-end on staging port.
2. Build shared-auth-client library.
3. Run hub in dev with test users.
4. Verify magic link flow end-to-end with a development Resend domain.

**Phase 2 — Bootstrap hub in production**
1. Set up Apache vhost + Let's Encrypt for `sprintsuite.uk`.
2. Deploy hub via PM2.
3. Configure DNS records at Ionos for Resend (4 TXT records: DKIM, SPF, DMARC, plus a verification record).
4. Verify Resend domain.
5. Bootstrap first admin: `node scripts/create-admin.js <your-email>`.
6. Log in via magic link, verify dashboard works.
7. Add other intended users via admin panel.

**Phase 3 — Per-app migration (one app at a time, signal first)**
1. Tag app HEAD as `pre-suite-auth`.
2. Take DB backup.
3. Install `@suite/auth-client`.
4. Wire `requireAuth` middleware on a single non-critical route, deploy, verify.
5. Run `migrate-users.js --dry-run`, review output.
6. Maintenance window:
   - Stop app.
   - Run `migrate-users.js`.
   - Replace remaining session middleware app-wide.
   - Remove old auth code.
   - Start app.
   - Verify: log in, access existing content, content shows correct owner.
7. 24-hour soak.
8. Move to next app.

**Phase 4 — Raid and Sprintpoker (no migration)**
Same as Phase 3 but skip steps 2, 5, 6.2 (no DB backup needed, no migration script).

### 10.2 Rollback

- **Hub-side issue**: PM2 restart with previous code. If schema migration needed reverting, restore `suite.db.pre-deploy` snapshot.
- **App-side issue**: restore `data/signal.db.pre-migration`; `git reset --hard pre-suite-auth`; reinstall old deps; restart.
- **Migration script bug discovered mid-run**: abort, restore from backup; iterate on script before re-running.

## 11. Risks

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Resend deliverability low on day 1 (new sending domain) | High | Medium | DKIM/SPF/DMARC set up correctly before first user-facing email; first emails to known-good addresses (you) for reputation warm-up |
| Migration script corrupts content references | Medium | High | Dry-run mode; full DB backup; verification step asserts unchanged content counts; rollback via backup restore |
| Hub-as-single-point-of-failure during deploys | Medium | Medium | 5-min grace cache on apps; PM2 auto-restart; atomic deploys; hub restart ~2 sec |
| Cookie misconfigured on wrong domain | Medium | Medium | Explicit `domain=sprintraid.uk` etc.; integration test asserts cookies set correctly per app |
| Session/audit tables grow forever | Low | Low | Cron job: delete expired central_sessions + audit events older than 90 days |
| First-user bootstrap (no admin to create first admin) | Certain | n/a | `node scripts/create-admin.js <email>` CLI run once during deploy |
| Resend DNS records conflict with existing Ionos zone | Low | Low | All Resend records on subdomains or specific selectors; no collision with apex/www A records |

## 12. Deferred decisions (decide at implementation time)

| Decision | Default if no preference |
|---|---|
| Email "from" address | `login@sprintsuite.uk` |
| Magic link email subject line | `Your Sprint Suite sign-in link` |
| Magic link email body wording | Final copy at implementation |
| Idle session timeout | 30 min |
| Max session lifetime | 30 days |
| Dashboard tile order | Alphabetical: poker → raid → retro → signal |
| Admin panel pagination size | 50 per page |

## 13. Acceptance criteria

The project is complete when:

- [ ] `https://sprintsuite.uk/` serves the SEO landing page over HTTPS.
- [ ] An invited user can sign in via magic link and land on the dashboard within 30 seconds (excluding email delivery time).
- [ ] Clicking an app tile lands the user inside that app without an additional sign-in prompt.
- [ ] After signing into one app, opening any of the other three apps in a new tab logs the user in silently (two redirects, no UI).
- [ ] Signing out from any app immediately ends the central session; opening any other app within 60 seconds prompts re-login.
- [ ] Admin can list, disable, and delete users via `/admin`; disabled users lose access within 60 seconds.
- [ ] Migration: every existing `signal` and `retrospective` user retains access to their previously-created content after first magic link sign-in.
- [ ] Cron job prunes expired sessions and stale audit events without manual intervention.
- [ ] Hub downtime of up to 5 minutes does not log out actively-using users (grace cache works).
- [ ] All sensitive endpoints reject requests with missing or invalid API keys.
- [ ] Healthcheck script at `/var/www/suite/scripts/healthcheck.sh` reports all five components green.

## 14. Estimated effort

| Phase | Effort |
|---|---|
| Hub build (sections 6.1, 7.1, 8) | ~1.5 days |
| Shared auth-client library (6.2) | ~0.75 days |
| Per-app integration ×4 (6.3) | ~1 day total (~2 hrs each) |
| Migration scripts ×2 (6.4) | ~0.5 days |
| Infrastructure (6.5) | ~0.5 days |
| Testing + soak periods | ~0.75 days |
| **Total focused work** | **~5 days** |

Calendar time will be longer due to soak periods and email reputation warm-up — realistically 1-2 weeks elapsed.

---

## Appendix A — Open questions to confirm at implementation time

1. **Hosting**: confirmed apps + hub all share the same physical server (`194.164.124.172`). Yes.
2. **Apache or Nginx?**: confirmed Apache (existing pattern). Yes.
3. **Logging destination**: where should hub logs go? Recommend stdout → captured by PM2 → rotated by PM2's built-in log rotation.
4. **Backup strategy for `suite.db`**: nightly `cp` to a separate directory; weekly off-server backup (manual for now).
5. **Monitoring**: existing healthcheck script extended. No external monitoring service in v1 (out of scope, free-tier UptimeRobot could be added later).
