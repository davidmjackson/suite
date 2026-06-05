# Sprintraid (Architecture)

> Sprintraid is the AI-assisted RAID-log generator of the Sprint Suite platform: a user pastes raw, messy project notes and the app returns a structured, scored, classified RAID log (Risks, Assumptions, Issues, Dependencies) with severity/RAG scoring on risks and dependency-conflict detection. It is a thin, mostly-stateless Express app — there is no persistence of user content; the only network call is to the Anthropic Messages API. Authentication, company scoping, and the monthly extract quota are all delegated to the central Sprint Suite hub via the shared `@suite/auth-client`. Public domain: **sprintraid.uk**.

## Tech stack

| Concern | Choice |
|---|---|
| Runtime | Node.js (`engines` not pinned in raid; auth-client requires `>=20`) |
| Language | JavaScript (CommonJS, no TypeScript, no build step) |
| Web framework | Express `^5.1.0` |
| Template engine | None — static HTML served from `public/` (`index.html`, `license.html`); all dynamic rendering is client-side vanilla JS |
| App database | SQLite via `better-sqlite3` `^12.10.0` (transitively, through `@suite/auth-client`) — used **only** for the local app-session store; RAID has no domain DB of its own |
| AI / LLM provider | **Anthropic** — called directly over HTTPS (`POST https://api.anthropic.com/v1/messages`) with `fetch`. No SDK (`@anthropic-ai/sdk` is NOT a dependency); raw API with `x-api-key` + `anthropic-version: 2023-06-01` |
| Model | `claude-sonnet-4-5` (default; overridable via `RAID_MODEL`) |
| Structured output | Anthropic native structured outputs — `output_config.format = { type: 'json_schema', schema: RAID_SCHEMA }` |
| Auth integration | `@suite/auth-client` (local file dep: `file:../suite/shared/auth-client`) |
| Unit tests | Node's built-in test runner (`node --test`) |
| E2E tests | Playwright `^1.59.1` (`@playwright/test`) |

Direct production dependencies are deliberately minimal: just `express` and `@suite/auth-client`.

## Production deployment / services

(Values from `deploy/systemd/raid.service`, `deploy/apache/raid.conf`, `.env`, and project memory. Some are conventions/inferred.)

| Item | Value |
|---|---|
| systemd service | `raid.service` (`Description=RAID — AI-powered RAID log extraction`) |
| Run-as user | `User=raid`, `Group=raid` per the unit file — a dedicated unprivileged system user. **Note (inferred):** suite memory records the running service user historically as `davidj`; verify with `systemctl show raid -p User` on prod |
| Port | `3003` (`PORT` env; `server.js` default `3003`) |
| Bind | `127.0.0.1:3003` (loopback only; reachable solely via the reverse proxy) |
| Public domain | `sprintraid.uk` (+ `www.sprintraid.uk`) |
| Reverse proxy | Apache `mod_proxy_http` (no WebSockets — plain HTTP proxy), TLS terminated at Apache via Certbot/Let's Encrypt; `ProxyPass / http://127.0.0.1:3003/`; `LimitRequestBody 1048576` mirrors the 1 MB express.json cap |
| Env file | `/var/www/raid/.env` (`EnvironmentFile` in the unit) |
| Working dir | `/var/www/raid` |
| App data / DB | `/var/www/raid/data/raid-sessions.db` (+ `-wal` / `-shm`); `ReadWritePaths=/var/www/raid` |
| Hardening | `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full`, `ProtectHome`, `Restart=always` |

The Apache `<VirtualHost *:443>` block in `deploy/apache/raid.conf` is committed commented-out (Certbot rewrites it on first issuance); prod TLS specifics should be confirmed against the live vhost.

## Repository structure

```
/var/www/raid
├── server.js              # Express entry: wires auth-client, static dirs, /extract, public pages
├── package.json           # name "raid", v0.1.0; deps express + @suite/auth-client
├── .env / .env.example    # ANTHROPIC_API_KEY, PORT, hub integration vars
├── playwright.config.js   # E2E config; webServer boots server.js with dummy hub+key
├── lib/
│   ├── extract.js         # ONLY network code — Anthropic Messages API call + 1 retry, returns parsed+reconciled RAID JSON
│   ├── raid.js            # Pure logic: RAID_SCHEMA (JSON schema), SYSTEM_PROMPT, ragFromSeverity, reconcile (severity/RAG safeguard)
│   ├── extractHandler.js  # POST /extract lifecycle: validate → auth.consume() gate → extract() → respond (fail-closed)
│   ├── buildInfo.js       # version + git commit for /build + cache-busting
│   └── contrast.js        # WCAG contrast-ratio helper (used by theme-contrast tests)
├── public/
│   ├── index.html         # Authed single-page UI (textarea → Generate RAID → result grid)
│   ├── license.html       # Public license page (Instrument-reskinned oscilloscope band)
│   ├── robots.txt
│   ├── css/               # instrument-core.css (synced foundation) + raid.css (amber accent theme)
│   ├── js/                # app.js (state machine), extractUi.js, exports.js (MD/CSV/Jira), clipboard.js, samples.js, oscilloscope.js
│   ├── illos/glyphs.svg   # SVG sprite (raid glyph)
│   ├── fonts/             # self-hosted woff2 (Bricolage Grotesque, Hanken Grotesk, IBM Plex Mono)
│   └── images/            # (empty)
├── data/                  # raid-sessions.db (gitkept dir; DB itself gitignored)
├── deploy/
│   ├── systemd/raid.service
│   ├── apache/raid.conf
│   └── README.md          # deploy runbook
├── docs/
│   ├── extract-server.mjs # LEGACY prototype (pre-suite); not wired into server.js
│   ├── raid-test.mjs      # legacy harness artifact
│   ├── forestbuild-spec.md / handover.md / README.md
│   └── superpowers/       # spec + plan (RAID UX design, MVP plan)
├── tests/                 # *.unit.test.js, harness.test.js, e2e/license-band.spec.js
├── README.md              # ⚠ STALE — describes the retired standalone access-key/login model
└── claude.md              # project context
```

Note: the top-level `app/` directory exists but is empty. `docs/extract-server.mjs` and `docs/raid-test.mjs` are pre-suite prototypes, not part of the running app.

## RAID extraction pipeline

How pasted text becomes a RAID log:

1. **Client (`public/js/app.js`, `extractUi.js`)** — single-page state machine (`idle | loading | result | error`). The textarea is validated (min 10 chars, max 1,000,000); pressing **Generate RAID** `POST`s `{ text }` as JSON to `/extract`.
2. **Route (`server.js` → `lib/extractHandler.js`)** — `app.post('/extract', auth.requireAuth, createExtractHandler({ auth, extract, apiKey, model }))`. The handler:
   - Rejects non-string or `< 10` trimmed chars → `400`.
   - Rejects missing `ANTHROPIC_API_KEY` → `500`.
   - Calls `auth.consume(req.centralSessionId)` **before** the paid LLM call (quota gate — see below). On `quota_exceeded` → `402`; `not_entitled` → `403`; any other failure (hub unreachable/error) → **fail closed `503`**. The paid Anthropic call never runs without a successful consume.
3. **LLM call (`lib/extract.js`)** — the only place network code lives. `extractOnce()` does a raw `fetch` to `https://api.anthropic.com/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`, body:
   - `model` = `claude-sonnet-4-5` (or `RAID_MODEL`)
   - `max_tokens: 2048`
   - `system: SYSTEM_PROMPT` (the full Agile-delivery-manager classification rubric in `lib/raid.js`)
   - `messages: [{ role: 'user', content: text }]`
   - `output_config.format = { type: 'json_schema', schema: RAID_SCHEMA }` (native structured output — Anthropic guarantees the response conforms)
4. **Parsing** — finds the first `text` block in `body.content` and `JSON.parse`s it into the RAID object (`{ risks, assumptions, issues, dependencies }`).
5. **Retry** — `extract()` wraps `extractOnce()`: on any failure it logs and retries **exactly once**, then propagates. No refund on the consumed quota unit if both attempts fail (documented design choice); the handler returns `502` to the client.
6. **Reconcile safeguard (`lib/raid.js → reconcile`)** — server-side, after parsing: for every risk with integer `probability` and `impact`, it **recomputes** `severity = probability * impact` and `rag` (`Red` if sev ≥ 15, `Amber` if 8–14, else `Green`), overwriting whatever the model produced. This defends against LLM arithmetic drift; the prompt asks the model to compute these but the server is authoritative.
7. **Response** — handler returns the reconciled RAID JSON plus `remaining` (quota left for the period). The client renders a result grid and offers **Markdown / CSV / Jira-CSV** exports (`public/js/exports.js`) and clipboard copy.

The RAID JSON schema (`RAID_SCHEMA`, strict `additionalProperties: false`): risks `{title, description, owner, probability, impact, severity, rag, mitigation}`, assumptions `{title, description, owner, validation_needed}`, issues `{title, description, owner, severity(High|Medium|Low), suggested_action}`, dependencies `{title, description, owner, depends_on, conflict_flag, conflict_note}`.

## Data model

Sprintraid has **no domain database** — no RAID logs, notes, or user content are persisted anywhere. Pasted notes are sent to the LLM and discarded (the UI states "Notes are sent to a cloud LLM and not stored").

The only local storage is the **app-session store**, owned by `@suite/auth-client` (`lib/sessions-db.js`), a single SQLite file at `data/raid-sessions.db`:

```
app_sessions (
  id TEXT PRIMARY KEY,              -- local app session id (random 32-byte hex)
  user_id TEXT NOT NULL,           -- hub user id
  central_session_id TEXT NOT NULL,-- hub session id (used for heartbeat + consume)
  created_at INTEGER,
  last_validated_at INTEGER,       -- drives the 60s validation cache
  expires_at INTEGER,
  entitled INTEGER DEFAULT 0,      -- snapshot of RAID entitlement at launch
  teams TEXT DEFAULT '[]',         -- JSON
  company TEXT DEFAULT 'null'      -- JSON company context snapshot
)
INDEX idx_app_sessions_central ON (central_session_id)
```

**Migration mechanism:** none formal. The store uses `CREATE TABLE IF NOT EXISTS` plus idempotent `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` checks on boot to backfill `entitled` / `teams` / `company`. WAL journal mode.

**Company scoping & quota tracking live on the hub, not here.** RAID entitlements and usage counters are stored in the hub DB (`app_entitlements`, `app_usage`), keyed by principal (company/team/user). The RAID grant is created at the **company** principal level (`quotaLimit: 25, quotaPeriod: "month"`). Usage is tracked in `app_usage(app, principal_type, principal_id, period_key, count)`. See "Suite-auth integration & quota".

## Routes / surface area

(`server.js`)

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/auth-client/*` | public | Static auth-client browser assets (`heartbeat.js`, `suite-return.js`) |
| GET | `/auth/launch` | public (token) | Exchange a hub one-time launch token → create local session + cookie → redirect |
| GET | `/auth/logout` | public | Clear local session / sign out |
| GET | `/auth/whoami` | public (JSON) | Returns auth state without redirect — used by `suite-return.js` to reveal the Return-to-Suite button |
| POST | `/api/heartbeat` | session | Browser heartbeat → keeps the hub session alive |
| GET | `/css`,`/js`,`/fonts`,`/illos`,`/images` | public | Static asset dirs |
| GET | `/license.html` | public | License page (Instrument-reskinned) |
| GET | `/robots.txt` | public | robots |
| GET | `/health` | public | `{ ok: true, model }` healthcheck (also Playwright readiness probe) |
| GET | `/build` | public | `{ version, commit }` build info |
| GET | `/` | **requireAuth** | The main authed RAID app SPA (`index.html`); unauthed → bounce to hub `/login?return_to=…` |
| POST | `/extract` | **requireAuth + consume** | The core endpoint: notes → RAID JSON (quota-gated) |

There is **no app-owned admin surface** in the suite build. (The stale README references `/admin.html` + `manageKeys.js` — that belonged to the retired standalone access-key model and is not present in `server.js`.)

## Suite-auth integration & quota

**Auth model.** RAID owns no login/session/password/key code. Users authenticate at the central hub (`HUB_BASE_URL=https://sprintsuite.uk`) and launch RAID with a one-time launch token.

- **Launch / token exchange** (`handlers/launch.js`): `/auth/launch?token=…` calls the hub `POST /api/sessions/exchange`; on success it stores a local `app_sessions` row (capturing `entitled`, `teams`, `company` from the hub response) and sets the `raid_session` cookie (domain `sprintraid.uk`), then redirects to a same-host `return_to` or `/`.
- **Per-request auth** (`middleware.js → requireAuth`): reads the `raid_session` cookie → local session. A **60s validation cache** (`cacheTtlMs`) avoids hub round-trips; beyond that it calls the hub `POST /api/sessions/:id/heartbeat`. `ok` → touch + proceed; `expired` → delete session, clear cookie, bounce to hub; on hub-unreachable a **5-minute grace window** (`graceMs`) lets the request through before finally bouncing. Attaches `req.user = { id, entitled, teams, company }`, `req.centralSessionId`.
- **Company scoping.** The hub resolves entitlements by principal (user/team/company). RAID is granted to the **company** principal, so all members of an onboarded company share the company's RAID access and the company's monthly quota bucket. The session snapshots the company context.
- **CR + CTM-only account-gating.** RAID is one of the account-gated apps (unlike Poker/Retro which allow anonymous share-link players). Access requires a hub user who is entitled — i.e. company roles CR (owner) or CTM (member with RAID enabled). Anonymous users cannot reach `/` or `/extract` (both behind `requireAuth`, and `/extract` additionally requires an entitled `consume`). Provisioning (`hub/lib/provisioning.js`) grants new company owners RAID at 25/month by default; the hub company console (`hub/routes/company.js`) exposes a per-member RAID on/off toggle.
- **Return to Suite.** `index.html` includes `/auth-client/suite-return.js`, which calls `/auth/whoami` and, for authed suite users, reveals the `[data-suite-return]` "Return to Suite" button linking back to the hub `/dashboard`. Anonymous users never see it. (Shipped via `@suite/auth-client` + per-app mount; raid merge `b6f98a4`.)

**Quota model (Layer 4 Thread A — tag `post-raid-quota-dev`).**

- The gate is `auth.consume(centralSessionId)` in `lib/extractHandler.js`, called **before** the paid Anthropic call. It POSTs to the hub `POST /api/apps/raid/consume` with `{ central_session_id }` (Bearer = `HUB_API_KEY`).
- **The counter lives on the hub**, not in raid. Hub `entitlements.consume()` (`hub/lib/entitlements.js`) runs an atomic SQLite transaction: resolves the user's best RAID entitlement, computes the current `period_key`, checks `count >= quota_limit`, and on success upserts `app_usage … count = count + 1`, returning `remaining = limit - newCount`.
- **The cap is 25 per month**, enforced per company principal. `period_key` for a `month` period is the UTC `YYYY-MM` string (`periodKey()`), so the quota **auto-resets at the start of each calendar month (UTC)** — there is no cron/reset job; a new period key simply starts a fresh `app_usage` row at 0.
- **Atomicity / fail-closed.** `consume` is the single check-and-increment that both authorises and reserves a unit. Hub responses map to: `200 → {ok, remaining}`, `402 → quota_exceeded`, `403 → not_entitled`. In raid, any other outcome (network error, `503`, unexpected status) fails closed — the LLM is never called. There is **no refund** if `extract()` subsequently fails (the unit stays consumed; client gets `502`).

## Configuration & secrets

(`.env.example`, `server.js`)

| Key | Required | Default | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | none | Anthropic Messages API key for extraction. Missing → `/extract` returns `500` |
| `RAID_MODEL` | no | `claude-sonnet-4-5` | Anthropic model id used for extraction |
| `PORT` | no | `3003` | Listen port (loopback behind Apache) |
| `APP_NAME` | no | `raid` | App identifier sent to the hub (consume path `/api/apps/raid/…`) |
| `HUB_BASE_URL` | yes | none | Hub origin (prod `https://sprintsuite.uk`) for exchange/heartbeat/consume + login bounce |
| `HUB_API_KEY` | yes | none | Per-app shared secret (the hub's `HUB_API_KEY_RAID`); Bearer auth to hub APIs |
| `COOKIE_DOMAIN` | no | unset | Cookie domain for `raid_session` (prod `sprintraid.uk`) |
| `APP_SESSIONS_DB` | no | `./data/raid-sessions.db` | Path to the local SQLite session store |
| `RAID_VERSION` / `RAID_COMMIT` / `GITHUB_SHA` | no | derived | Override build info reported by `/build` |

`server.js` sets `app.set('trust proxy', true)` so `req.ip` reflects the real client behind Apache. The README's `RAID_KEYS_FILE` / `RAID_SESSION_TTL_MS` / `RAID_ADMIN_KEY_NAME` / `NODE_ENV`-for-secure-cookies rows are **stale** (standalone-era) and not read by the current `server.js`.

## Testing

- **Framework:** Node's built-in test runner for unit tests (`npm test` → `node --test tests/*.unit.test.js`); Playwright for E2E (`npm run test:e2e`).
- **Counts (verified by running `npm test`):** **47 unit subtests, all passing** (~54 ms, no network). Files: `extract.unit.test.js`, `extractHandler.unit.test.js`, `extractUi.unit.test.js`, `exports.unit.test.js`, `samples.unit.test.js`, `return-to-suite.unit.test.js`, `theme-contrast.unit.test.js`, `theme-drift.unit.test.js`. (Memory's "~46" rounds to this.)
- **E2E:** **1 spec** — `tests/e2e/license-band.spec.js` — asserts the public `/license.html` renders the Instrument oscilloscope band with no console errors. The authed `/` is intentionally **not** e2e-tested (it bounces to the hub, which isn't running in CI); it's covered by manual visual pass. Playwright's `webServer` boots `server.js` with a dummy `ANTHROPIC_API_KEY` and an unreachable hub (`HUB_BASE_URL=http://127.0.0.1:9`), readiness-probed via `/health`.
- **Live harness:** `npm run test:harness` (`tests/harness.test.js`) hits the real Anthropic API (~$0.05/run) — a manual, money-spending gate, not part of `npm test`.
- The `theme-drift` test guards that raid's synced Instrument foundation CSS matches the source of truth; `theme-contrast` + `lib/contrast.js` assert RAG/accent colours meet WCAG AA.

## Operational notes & gotchas

- **Default branch is `master`, not `main`.** (Distinct from the hub/suite repo and the user's usual `main` default — do not assume `main` exists here.) Remote: `github.com/davidmjackson/raid.git`.
- **Quota reset is implicit and UTC-based.** No cron job — the 25/month cap resets when the UTC calendar month rolls over (a new `YYYY-MM` `period_key`). To inspect/adjust usage you operate on the **hub** DB (`app_usage` / `app_entitlements`), not raid.
- **Quota is consumed even on extraction failure** (no refund), and the gate **fails closed** when the hub is unreachable — extraction is unavailable (503) rather than free. If the hub is down, RAID extraction is down by design.
- **The README is stale.** It documents the retired standalone salted-SHA-256 access-key / `keys.json` / `/admin.html` / `manageKeys.js` model. None of that exists in the current `server.js`; auth is 100% hub-delegated. Treat `server.js` + `lib/` as source of truth, not the README.
- **Theme accent is amber** (`public/css/raid.css`, part of the Instrument redesign, sub-project SP5, merge `cd7b8c3`). Footgun: `--amber` is a *light* hue — **white text on amber fails WCAG AA (~3:1)**. The primary button therefore uses INK label on `--accent-btn` (a lighter amber tuned to clear AA). Don't switch button text to white. RAG colours and contrast are guarded by the `theme-contrast` unit test.
- **No SDK for Anthropic** — the API is called with raw `fetch` and a pinned `anthropic-version: 2023-06-01` header plus native `output_config` structured outputs. If the structured-output API surface changes, `lib/extract.js` is the single place to update.
- **Server-side severity/RAG is authoritative** — `reconcile()` overwrites the model's risk arithmetic. Changing the RAG thresholds means editing both `SYSTEM_PROMPT` and `ragFromSeverity` in `lib/raid.js` to keep prompt and server in sync.
- **`run-as user discrepancy`:** the unit file declares `User=raid` but suite memory historically notes the service running as `davidj`. Confirm on prod before assuming file ownership/permissions.
- **`docs/extract-server.mjs`** is a legacy prototype, not the running server — don't edit it expecting prod effect. The empty `app/` dir is vestigial.
- **No WebSockets** — unlike Poker, RAID is plain request/response, so the Apache vhost is a simple HTTP reverse proxy.
