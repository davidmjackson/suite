# Sprintsignal (Architecture)
> Sprintsignal ("Signal") is an Agile team health-check / sentiment survey app in the Sprint Suite. A facilitator (signed in via the central hub) creates a survey for one of their company's teams from a question template, shares an **anonymous** access link with the team, and reviews pooled results as a radar chart with rules-based improvement insights, a per-question breakdown, and a CSV export. Surveys can be re-run against a baseline to track change over time. It is an independent codebase that shares only patterns (and a synced `theme-core`/Instrument design system) with its sister apps (Scrum Poker, Retrospective, RAID); authentication and company/entitlement context are delegated to the suite hub via `@suite/auth-client`.

## Tech stack
- **Runtime / language:** Node.js (CommonJS, `"use strict"`), uses native `process.loadEnvFile` and the built-in `node:test` runner — Node 20+.
- **Framework:** Express `^5.2.1`.
- **Template engine:** None. The UI is static HTML files in `public/` plus vanilla JS; the server only `sendFile`s them. There is no server-side view engine and no build step.
- **DB + driver:** SQLite via `better-sqlite3` `^12.10.0` (synchronous, WAL journalling, `foreign_keys = ON`). Raw SQL, no ORM.
- **Auth:** `@suite/auth-client` (local file dependency `file:../suite/shared/auth-client`, i.e. `/var/www/suite/shared/auth-client`) — delegates sign-in to the hub. Signal itself owns no password/session/login code.
- **Key in-house libs:** `lib/scoring.js` (pure scoring/normalisation), `lib/insights.js` (rules-based insight classifier), `lib/quality.js` (anonymous response quality checks), `lib/accessKeys.js` (salted SHA-256 team keys), `lib/adminActivity.js` (append-only JSONL audit log), `lib/templateLoader.js` (file-based question templates).
- **Test framework:** `node --test` for unit tests; `@playwright/test` `^1.60.0` for e2e.
- **Frontend:** Hand-drawn SVG radar chart (`public/js/radar.js`), strict CSP that forbids inline scripts/`eval`/CDNs (external scripts only). No WebSockets — surveys are async request/response.

## Production deployment / services
(Memory-confirmed where noted; deploy templates in-repo carry placeholder hostnames.)
- **systemd service:** `signal.service` (template in `deploy/systemd/`, `Type=simple`, `ExecStart=/usr/bin/node server.js`, `Restart=always`, `WorkingDirectory=/var/www/signal`, `EnvironmentFile=/var/www/signal/.env`).
- **Run-as user:** `User=signal` / `Group=signal` (dedicated unprivileged system user). Hardening: `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full`, `ProtectHome`, `ReadWritePaths=/var/lib/signal /var/www/signal`.
- **Repo owner on prod:** `davidj` (per memory). Note this mismatch with the service `User=signal` — see Gotchas (admin-activity EACCES).
- **Port:** `3002` (default in `server.js`; bound to `127.0.0.1` in production, `0.0.0.0` in dev).
- **Public domain:** `sprintsignal.uk` (memory-confirmed; the in-repo apache template uses `signal.example.com` as a placeholder).
- **Reverse proxy:** Apache (`deploy/apache/signal.conf`) — `mod_proxy`/`mod_proxy_http`/`mod_headers`, terminates TLS, `ProxyPass / http://127.0.0.1:3002/`, sets `X-Forwarded-Proto` explicitly, `LimitRequestBody 65536`. No WebSocket upgrade needed. App sets `trust proxy = 1`.
- **Env file:** `/var/www/signal/.env` (loaded by systemd; also auto-loaded in dev by `server.js`).
- **Data / DB files:** Production data path is `/var/lib/signal` (the systemd RW path). Two SQLite DBs: the content DB (`DB_PATH`, default `data/signal.db`) and the app-session store (`APP_SESSIONS_DB`, default `data/signal-sessions.db`, owned/managed by `@suite/auth-client`). The audit log defaults to `<repo>/admin-activity.jsonl` unless `SIGNAL_ACTIVITY_FILE` overrides it.

## Repository structure
~2-level tree of the important paths:
- `server.js` — composition root: loads env, opens DB, loads file templates, builds the auth client, assembles and starts the Express app; handles SIGINT/SIGTERM shutdown.
- `lib/` — all server logic:
  - `httpApp.js` — builds the Express app: security headers, JSON parse (32 kb), auth-hub routes, public respondent API, guarded admin API, static assets, pages, error handling.
  - `db.js` — SQLite schema, migrations (`SCHEMA_VERSION = 2`), question-bank seed, and all data access (users/teams/templates/surveys/responses/answers).
  - `surveyRoutes.js` — facilitator REST for teams, templates, and surveys (create/list/close/reopen/delete, key rotation). Company-scoped.
  - `responseRoutes.js` — **public, anonymous** respondent fetch + submit.
  - `reportRoutes.js` — admin reporting (radar+insights, per-question breakdown, CSV export); enforces the `MIN_RESPONSES = 3` anonymity floor.
  - `companyAccess.js` — `teamCompanyAllowed(team, company)` cross-tenant guard.
  - `scoring.js` / `insights.js` / `quality.js` — pure scoring, insight classification, anonymous quality flags.
  - `accessKeys.js` — salted SHA-256 team access keys + survey access codes.
  - `adminActivity.js` — append-only JSONL audit log (fingerprints, never raw secrets).
  - `templateLoader.js` — import-once `templates/*.json` question templates on boot.
  - `securityHeaders.js`, `contrast.js`, `buildInfo.js` — edge headers, contrast helper, build/version info.
- `public/` — static frontend: `dashboard.html`, `admin.html`, `survey.html` (authed shells, carry the Return-to-Suite button), `respond.html`, `license.html` (public), plus `css/` (`instrument-core.css`, `signal.css`), `js/` (`radar.js`, `oscilloscope.js`, `respond.js`, `survey.js`, `admin.js`, `dashboard.js`, `api.js`), `fonts/`, `illos/`.
- `templates/` — `scrum-health-survey-v1.json` (file-based question template).
- `scripts/` — `db-maintenance.js` (migrate / retention / vacuum), `sync-theme.sh` + `theme-manifest.txt` (theme-core sync).
- `tests/` — unit tests (`*.test.js`) and `tests/e2e/` Playwright specs + seed/credentials helpers.
- `deploy/` — `systemd/` unit and `apache/signal.conf`.
- `docs/` — `signal-spec.md` (build spec), `techstack-overview.md`, `deployment.md`, `theme-core/`, `superpowers/specs|plans/` (incl. the 2026-06-02 company-scoping design + plan).
- `.env` / `.env.example`, `playwright.config.js`, `package.json`, `README.md` (note: README is partly stale — it still mentions `argon2`, `SESSION_SECRET`, `manageKeys.js`, and Nginx, all pre-hub artifacts that no longer apply).

## Data model
SQLite, raw SQL. Schema version is stored in a `meta(key,value)` table; `ensureSchema()` runs migrations on boot (`migrateToV1`, then `migrateToV2`), then `seedQuestionBank()` idempotently seeds the built-in template. `SCHEMA_VERSION = 2`.

Tables:
- **`meta`** — key/value; holds `schema_version`.
- **`users`**, **`auth_tokens`** — legacy local-auth tables created by `migrateToV1` and still present, but **vestigial**: login is now delegated to the hub. Many `db.js` user/token helpers exist but are unused by request paths (kept for tests / history).
- **`teams`** — `id, company_id (NOT NULL), name, key_hash, key_salt, weak, created_at`. `UNIQUE(company_id, name COLLATE NOCASE)` — names are unique **per company**, not globally, so tenants can't infer each other's teams. Indexed on `company_id`.
- **`templates` / `axes` / `questions`** — the question bank. A template has ordered axes; each axis has ordered questions; a question carries `is_reverse_scored`. Survey *content* is data, not code. These are **shared/global** (not company-scoped) and preserved across the v2 migration.
- **`surveys`** — `id, team_id → teams, template_id → templates, parent_survey_id → surveys (baseline link), access_code (UNIQUE), status ('open'|'closed'), opened_at, closed_at`.
- **`responses`** — `id, survey_id → surveys (ON DELETE CASCADE), duration_seconds, flagged_quality, submitted_at`. **No member/email/name/IP column** — anonymity by design.
- **`answers`** — `id, response_id → responses (CASCADE), question_id → questions, score`. Raw 1..5 scores stored immutably; never inverted at write time.

Key relationships & rules:
- Company scoping flows team → company: a facilitator only ever touches `teams` (and their surveys/responses) where `teams.company_id === req.user.company.id`. There is no `company` table in Signal; company identity comes from the hub session.
- Baseline/follow-up: a follow-up survey inherits its team + template from its parent so the two runs pair cleanly on the radar.
- Retention (`applyRetention`): deletes `surveys` closed more than N days ago; responses/answers cascade. Open surveys are never touched.

## Routes / surface area
Mount order in `httpApp.js` is deliberate so the auth guard never catches a public path.

Auth-hub (provided by `@suite/auth-client`):
- `GET /auth/launch` — exchange a one-time hub launch token for a local `signal_session` cookie.
- `GET /auth/logout` — revoke central session, clear cookie, redirect to hub root.
- `GET /auth/whoami` — suite-session status as JSON, no redirect (public; powers the Return-to-Suite reveal).
- `POST /api/heartbeat` — browser keep-alive / revocation check.
- `GET /auth-client/*` — static heartbeat + suite-return JS assets.

Public / health:
- `GET /health` — JSON status (version, commit, `schemaVersion`, uptime).
- `GET /` — 302 → `/dashboard`.
- `GET /s/:code` — serves `respond.html` (anonymous survey page).
- `GET /license`, `GET /licence` — serve `license.html`.

Anonymous submit (public, mounted before the guard, `lib/responseRoutes.js`, under `/api/respond`):
- `GET /api/respond/:code` — questions for an open survey (reverse flags deliberately withheld), or `{open:false}`.
- `POST /api/respond/:code` — submit a complete answer set (validated: every question once, integer 1..5); runs quality checks invisibly; never reveals flagging.

Facilitator admin API (`/api`, behind `auth.requireAuth`, company-scoped — `lib/surveyRoutes.js`):
- `GET /api/templates` · `GET /api/teams` · `POST /api/teams` (returns plaintext key once) · `POST /api/teams/:id/rotate-key` · `DELETE /api/teams/:id`.
- `GET /api/surveys` · `GET /api/surveys/:id` · `POST /api/surveys` (baseline or follow-up) · `POST /api/surveys/:id/close` · `POST /api/surveys/:id/reopen` · `DELETE /api/surveys/:id`.

Reporting API (`/api`, behind `requireAuth`, company-scoped — `lib/reportRoutes.js`):
- `GET /api/surveys/:id/report` — radar means + baseline overlay + insights (locked until `MIN_RESPONSES`).
- `GET /api/surveys/:id/breakdown` — per-question aggregation (locked until `MIN_RESPONSES`).
- `GET /api/surveys/:id/export.csv` — CSV of the breakdown (409 if below the floor).
- Any other unmatched `/api/*` → JSON 404.

Authenticated pages (guarded, bounce to hub login when no session):
- `GET /dashboard`, `GET /admin`, `GET /survey`.

## Suite-auth integration
Signal is a pure relying party of the hub via `@suite/auth-client` (`createAuthClient` in `server.js`, configured with `appName=signal`, `hubBaseUrl`, `hubApiKey`, `cookieName="signal_session"`, `cookieDomain`, and the app-session DB path). `createAuthClient` throws at boot if `HUB_BASE_URL`/`HUB_API_KEY` are missing, so a misconfigured deploy fails fast.

Flow:
1. **Launch:** the user signs in at the hub, which redirects to `GET /auth/launch?token=…`. The handler calls `hubApi.exchange(token)` (hub `POST /…/exchange` with the per-app `HUB_API_KEY`), creates a local app session row in `signal-sessions.db` capturing `userId`, `central_session_id`, `entitled`, `teams`, and `company`, and sets the `signal_session` cookie. It then redirects to a same-host `return_to` or `/`.
2. **requireAuth:** validates the session cookie against the local store; if older than `cacheTtlMs` it re-validates via `hubApi.heartbeat(central_session_id)` (with a grace window). On success it sets `req.user = { id, entitled, teams, company }` (`company` is `{ id, name } | null`); on expiry/revocation it clears the cookie and bounces to `{hub}/login?return_to=…`.
3. **Logout:** revokes the central session via the hub and clears the local cookie.

Company scoping: every facilitator route derives the active company from `req.user.company` and filters via `db.listTeamsForCompany` / `db.listSurveysWithCountsForCompany` and the `teamCompanyAllowed()` guard on single-resource lookups. Cross-tenant access returns 404 (not 403), so it never confirms that another company's resource exists. If a session has no company, write routes return 403 ("sign in again").

**CR/CTM account-gating:** Signal is an account-gated app — only signed-in suite users with a Signal entitlement can reach the facilitator surface. The gate is enforced **at the hub**, not in Signal: the hub only issues a Signal launch token to a user whose company grants Signal access and whose role permits it (per the suite access model, owners (CR) and member app-users (CTM) — not anonymous Players). The launch handler records `entitlement.entitled` onto the session (`req.user.entitled`), but the primary enforcement is that anonymous/un-entitled users never receive a launch token and therefore can never obtain a `signal_session`. Anonymous *respondents* are entirely separate: they need only a survey access code and never authenticate. Note: there is **no per-use quota** in Signal (the hub `exchange` can return `402 quota_exceeded`, used by RAID's metered model, but Signal is unlimited-per-company, so this path is effectively unused here).

**Return-to-Suite:** the three authed shells (`dashboard.html`, `admin.html`, `survey.html`) include `/auth-client/suite-return.js` (defer) and a hidden `<a data-suite-return hidden>Return to Suite</a>` button that the snippet reveals (via `GET /auth/whoami`) only for authenticated suite users. The public/anonymous shells (`respond.html`, `license.html`) deliberately omit it (asserted by `tests/return-to-suite.test.js`).

## Anonymity & data model notes
Anonymity is structural, not a policy bolt-on:
- The `responses` table has **no column** that can identify a person — no member id, email, name, or IP. A response carries only `survey_id`, `duration_seconds`, `flagged_quality`, and `submitted_at`. `answers` link only to a response, not a person.
- Respondents are never authenticated; they reach a survey solely via its `access_code` (`/s/:code`) and submit through the public `/api/respond/:code`. No cookie or session is created for them.
- The facilitator only ever sees **pooled, axis-level** aggregates and per-question means/spread — never an individual response. Reverse-scoring flags are withheld from the respondent payload and applied server-side only.
- **Anonymity floor:** reports/breakdowns stay locked until a survey has `MIN_RESPONSES = 3` responses (`lib/reportRoutes.js`); a baseline overlay only appears if the baseline run also clears the floor. CSV export 409s below the floor. This prevents reconstructing one person's answers from a tiny sample.
- **Quality flags** (speed / straight-lining / reverse-inconsistency, in `lib/quality.js`) are computed per response but surfaced only as an aggregate count ("N responses flagged") — never which response, and the respondent is never told they were flagged.
- The audit log stores actor ids and team/survey names but never raw team keys or access codes (it stores SHA-256 `fingerprint`s instead).

## Configuration & secrets
From `.env` / `.env.example` and the systemd unit:
- `PORT` (3002), `NODE_ENV`, `HOST` (defaults to `127.0.0.1` in production).
- `DB_PATH` — content SQLite DB (default `data/signal.db`; on prod under `/var/lib/signal`).
- `APP_BASE_URL` — base used to build shareable anonymous links `/s/<code>`.
- `APP_NAME` — `signal` (sent to the hub).
- `HUB_BASE_URL` — the hub origin (e.g. `https://sprintsuite.uk`). Required at boot.
- `HUB_API_KEY` — Signal's per-app hub API key (from `~/suite-app-keys.txt` on the prod box). Required at boot. **Secret.**
- `COOKIE_DOMAIN` — cookie scope for `signal_session`; unset in local dev (localhost), set to the app domain in production.
- `APP_SESSIONS_DB` — local hub-session map store (default `data/signal-sessions.db`).
- `SIGNAL_ACTIVITY_FILE` — optional override for the audit-log path (default `<repo>/admin-activity.jsonl`).
- `RETENTION_DAYS` — consumed by `scripts/db-maintenance.js retention` when no day count is passed.

## Testing
- **Unit:** `npm test` → `node --test tests/*.test.js`. ~83 assertions across: `db.test.js` (schema/migrations/data access), `scoring.test.js`, `insights.test.js`, `quality.test.js`, `templateLoader.test.js`, `server.test.js` (HTTP routes incl. company scoping), `companyAccess.test.js`, `return-to-suite.test.js`, `contrast.test.js`, `theme-contrast.test.js`, `theme-drift.test.js`. (Memory cites ~86 — same order of magnitude.)
- **E2E:** `npm run test:e2e` → Playwright (`playwright.config.js`), single-worker, on port 3010 against a throwaway `data/e2e.db` + `data/e2e-sessions.db`. `tests/e2e/seed.js` resets the DB and injects a fresh app-session so specs authenticate by setting the `signal_session` cookie; `HUB_BASE_URL` points at `http://hub.invalid` on purpose (fresh session is served from cache, hub is never contacted). ~11 specs across `smoke.spec.js`, `survey.spec.js`, `grouping.spec.js`, `company-scoping.spec.js` (cross-tenant isolation), `header-waves.spec.js`. (Memory cites ~10.)
- **DB maintenance scripts** (`npm run db:migrate|db:retention|db:vacuum`) wrap `scripts/db-maintenance.js`.

## Operational notes & gotchas
- **v2 company-scoping was a clean-cut tenant wipe.** `migrateToV2` (identity-v2 Layer 4, Thread C) `DROP`s and recreates `teams`, `surveys`, `responses`, `answers` to add `teams.company_id` — **all pre-existing facilitator data (teams + surveys + responses) was destroyed** on upgrade. Templates/axes/questions and the legacy users/auth_tokens tables were preserved. A pre-migration DB backup exists on prod at `/var/lib/signal/backup-pre-companyscoping.tgz` (memory). A `data/signal.db.pre-migration` snapshot is also present in the dev repo. Schema is at version 2; any future change must bump `SCHEMA_VERSION` and add a `migrateToVN()` branch.
- **Known pre-existing admin-activity EACCES bug.** The audit log defaults to `<repo>/admin-activity.jsonl`, written `mode 0o600`. On prod the repo is owned by `davidj` but the service runs as `User=signal`; the existing `admin-activity.jsonl` is owned by `davidj`, so the `signal` user cannot append → `EACCES`. Writes are best-effort (`safeLogActivity` swallows the error and logs to stderr), so admin actions still succeed but audit entries are silently dropped. Fix options: `chown signal` the file, or set `SIGNAL_ACTIVITY_FILE` to a path under `/var/lib/signal` (the systemd RW path). (Tracked in the hub backlog memory.)
- **Stale README.** `README.md` predates the hub migration — ignore its `argon2`/`SESSION_SECRET`/`manageKeys.js`/Nginx references. The current auth model is hub-delegated; there is no local login. The legacy `users`/`auth_tokens` tables and many `db.js` user/token helpers are vestigial.
- **No WebSockets** — survey flow is plain request/response; the CSP (`connect-src 'self'`, no `ws:`) reflects this. The radar chart is hand-drawn SVG specifically because the strict CSP forbids inline scripts and CDNs.
- **`getTeamByName` / `listTeams` / `listSurveysWithCounts` are NOT company-scoped** — they are retained for tests only. Request paths must use the `...ForCompany` variants; using the global ones in a handler would leak across tenants.
- **Scoring invariant:** raw 1..5 scores are stored verbatim; reverse-scoring is applied exactly once at read time in `scoring.js`. Double-inversion is the classic bug to guard against; never store inverted scores.
- **Unbounded retention by default:** `applyRetention` only runs when invoked via `db:retention`; without a scheduled job, closed-survey responses accumulate indefinitely. Relevant before making any privacy-note retention promise.
- **`trust proxy = 1`** is set in the app; Apache must set `X-Forwarded-Proto` (the template does) for correct Secure-cookie / scheme handling.
