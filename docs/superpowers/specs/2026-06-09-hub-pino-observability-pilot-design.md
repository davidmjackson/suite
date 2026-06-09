# Hub Pino Observability Pilot — Design

**Date:** 2026-06-09
**Status:** Approved (design); pending implementation plan
**Scope:** The `hub` app only (Tier-1 #1 of the SprintSuite Tech-Stack Upgrade Strategy — strategy doc lives in the second-brain vault at `wiki/decisions/SprintSuite Tech-Stack Upgrade Strategy.md`). A deliberately small pilot to prove the upgrade loop (TDD → review → deploy) before rolling structured logging out to the other four apps.

## Problem

The hub has **no request logging** and **no error-handling middleware**. A thrown error falls through to Express's default handler and becomes an opaque 500 — exactly the failure mode behind the prod `/admin` user-delete bug (a `FOREIGN KEY constraint failed` that could only be found via Apache vhost logs + `journalctl` stack-trace hunting). Debugging prod today is log-spelunking.

## Goal

Every request and every error in the hub becomes a structured, queryable log line carrying a **request-id**, so the next prod 500 is diagnosed by reading one log record — not by SSH + journalctl archaeology. This also de-risks every later upgrade, because regressions become visible.

## Non-goals (explicitly out of scope)

- The other four apps (signal, poker, retro, raid) — separate follow-up plans once the pattern is proven.
- The other Tier-1 items (zod validation, Express 5 / ESM consolidation) — separate plans.
- Converting `scripts/` CLI tools to structured logging — those 40 `console.*` calls are human terminal output and **stay as-is**.
- Log shipping/aggregation (OTel, external collectors) — journald is sufficient at this scale.
- Any change to response behaviour **except** the new clean error response.

## Current state (verified 2026-06-09)

- `hub/server.js`: ESM, Express 5, eta views. No request logging; **no error-handling middleware**; startup logs via `console.log`.
- Runtime `console.*` in `routes/`+`lib/`: **~4** (best-effort email-failure logs in `routes/admin.js`, `routes/login.js`, `routes/request.js`; plus the `app.listen` startup line). All other 40 `console.*` are in `scripts/`.
- `app.set("trust proxy", "loopback")` already set (mirrored in `tests/helpers.js`).
- Tests: `node:test` + `supertest`, **219 passing**.

## Components

Each is a small unit with one purpose and a clear interface.

### 1. `lib/logger.js` — singleton pino logger
- **What:** creates and exports one configured pino instance.
- **Interface:** `import logger from "./lib/logger.js"` → `logger.info({ … }, "message")`.
- **Behaviour:**
  - Level from `process.env.LOG_LEVEL`, default `info`. (`config.js` has no dotenv; the env var is set on the systemd unit.)
  - **Prod** (`config.nodeEnv === "production"`): raw JSON to stdout (systemd journal captures it).
  - **Dev:** `pino-pretty` transport for human-readable output.
  - Base field `service: "hub"`.
  - **Redaction** configured here (see §C below).
- **Depends on:** `pino`, `pino-pretty` (dev), `config.nodeEnv`.

### 2. Request logging — `pino-http` middleware
- **What:** mounted early in `server.js`, before routes.
- **Behaviour:**
  - Generates a request-id, honouring an inbound `X-Request-Id` header if present, else generating one.
  - Attaches a child logger as `req.log` (carries the reqId) for routes/error handler to use.
  - Auto-logs one line per request: method, url, statusCode, responseTime, reqId.
  - Custom level mapping: 5xx → `error`, 4xx → `warn`, else `info`.
- **Depends on:** `pino-http`, the logger from §1.

### 3. Central error-handling middleware
- **What:** `(err, req, res, next)` signature, mounted **last** (after all route mounts in `server.js`).
- **Behaviour:**
  - Logs `req.log.error({ err }, "unhandled error")` (falls back to module logger if `req.log` is absent), carrying the reqId.
  - Returns a **clean** response (§B). Prod hides the stack and internal detail; dev includes the stack.
  - Express 5 forwards rejected async route handlers here automatically — this is what catches the opaque-500 class, since most hub routes are async.
- **Depends on:** the logger, the error view.

### 4. Convert runtime `console.*` → logger
- The ~3 best-effort email-failure `console.error` calls in `routes/admin.js`, `routes/login.js`, `routes/request.js` → `req.log.error({ err }, "…")`.
- The `app.listen` startup `console.log` → `logger.info`.
- **Leave all 40 `scripts/` `console.*` untouched.**

## Embedded design choices (approved)

- **§A Dev pretty-printing:** `pino-pretty` added as a **devDependency** for readable local logs; prod stays pure JSON.
- **§B Error response shape:** content-negotiated.
  - API/JSON requests (path under `/api`, or `Accept: application/json`) → `{ error: "…", reqId }`.
  - HTML requests → a minimal styled `views/error.eta` page showing the reqId (so a user can quote it in a support message).
  - Prod hides the stack; dev shows it.
- **§C Redaction set:** redact `req.headers.cookie`, `req.headers.authorization`, and any `token` / `password` fields. Critical because **magic-link tokens and session cookies must never land in logs**.

## Data flow

```
request
  → pino-http middleware: attach reqId + req.log, start timer
  → [static / body-parse / routes]
      route handler may use req.log.{info,warn,error}
      route throws / rejects ─────────────────────────┐
  → route sends response → pino-http logs the request line (level by status)
                                                       │
  ← central error handler ◀──────────────────────────┘
      logs err + reqId via req.log.error
      content-negotiates clean response (§B)
```

## Error handling

- The central handler is the single place unhandled errors are logged and turned into a response.
- It must **not** leak stack traces or internal messages in production.
- It must handle both HTML and API/JSON callers (§B).
- `pino-http` still logs the request line with the final (500) status.

## Testing (TDD; existing `node:test` + `supertest`)

1. **logger unit:** respects `LOG_LEVEL`; redaction paths configured; emits JSON when `nodeEnv === "production"`.
2. **error handler (integration):** a route that throws → response is a clean 500 (no stack in prod mode) carrying a reqId; assert the structured error was logged (capture via an injected pino destination stream).
3. **request-id (integration):** a normal request gets a reqId in its log line; an inbound `X-Request-Id` is honoured and propagated.
4. **redaction (integration):** a request with a `Cookie` header → the captured log record shows the cookie redacted.
5. **regression:** all existing **219** tests still pass.

## Dependencies

- **prod:** `pino`, `pino-http`
- **dev:** `pino-pretty`

## Deploy considerations

- No response-behaviour change **except** the new clean error page replacing Express's default HTML 500. The error page must be visually acceptable and leak nothing in prod.
- Logs flow to `journalctl -u suite-hub`. `jq` is not installed on the host; JSON is still greppable, and a small pretty filter can be added later if wanted.
- Set `LOG_LEVEL` on the systemd unit if a non-default level is desired (optional; defaults to `info`).
- Standard deploy: branch → local verify (219+ tests green) → merge to main → prod pulls main → restart `suite-hub` → `/healthz` 200 → trigger a deliberate test error path to confirm the clean response + the logged record with reqId.

## Success criteria

- A deliberately-triggered hub error produces: (a) a clean, stack-free 500 to the client carrying a reqId, and (b) a single structured `error` log record in journald containing that same reqId and the stack.
- A normal request produces one structured log line with method/url/status/duration/reqId.
- Cookies / authorization headers / tokens never appear unredacted in any log record.
- All existing tests pass; new tests cover the four behaviours above.
