# Pino observability rollout to the 4 apps — design

**Date:** 2026-06-09
**Status:** Approved (design)
**Tier-1 #1 (continued):** rolls the hub pino pilot out to the 4 satellite apps.
**Predecessor / template:** `docs/superpowers/specs/2026-06-09-hub-pino-observability-pilot-design.md` and its plan. Hub shipped & LIVE @d7c1612.

## Goal & scope

Bring the hub's structured-logging + central-error-handler stack to the four
satellite apps — **raid, signal, poker, retro** — **HTTP-only**, identical
across all four. This session: build, test green, and merge each app to its own
main locally. **No prod deploy this session** (deploy is a later session, one
command at a time per app).

Each app is its own git repo under `/var/www/<app>`; there are no shared source
files between them, so the work parallelises cleanly with no worktrees.

## The shared artifact: a CommonJS module triplet

The hub modules are ESM. The apps are all CommonJS (`type` absent /
`"commonjs"`). The pilot (raid) produces the **CommonJS** versions of the three
hub modules; these become the starting copy for the other three apps, changing
only the `service` name and import wiring:

- `lib/logger.js` — pino instance. `[redacted]` field redaction for `token` and
  `password`; `safeUrl()` that masks query-param values for magic-link-style
  tokens; dev pretty-print / prod JSON gated on `NODE_ENV`; base field
  `service:"<app>"` (raid|signal|poker|retro).
- `middleware/requestLogger.js` — pino-http. Per-request id honouring an inbound
  `X-Request-Id`; 4xx → `warn`, 5xx → `error`. **Custom `req` and `res`
  serializers that log NO headers** — `req:{id,method,url}`, `res:{statusCode}`.
  This is the Set-Cookie leak fix; it must be present in every app.
- `middleware/errorHandler.js` — central, content-negotiated clean error
  response with reqId; structured log with reqId; in production hides internal
  details; plain-text fallback if an HTML error view fails to render. Express 4
  and Express 5 share the `(err, req, res, next)` signature, so this module is
  byte-identical across all apps.

## Per-app deltas

| App | Module | Express | DB | WS | Base branch | Notes |
|-----|--------|---------|-----|-----|-------------|-------|
| raid | CommonJS | 5.1 | — | — | `master` | Pilot. Pure template; validates the conversion. |
| signal | CommonJS | 5.2 | sqlite | — | `feat/suite-auth` | DB irrelevant to logging. Straight template. |
| poker (scrumpoker) | CommonJS | 5.1 | — | **ws** | `main` | Template on HTTP pipeline only; WS `upgrade` path untouched. |
| retro (retrospective) | CommonJS | 4.19 | sqlite | **ws** | `main` | Express 4 — confirm mount order works; WS untouched. |

Common wiring in every app's server entry:
- Request logger mounted **after static, before routes**.
- Error handler mounted **last** (after all routes).
- Runtime `console.error` in route files → `(req.log || logger).error`.
- `scripts/` console.* left as-is (out of scope).

WS apps (poker, retro): logging covers the Express HTTP pipeline only.
WebSocket connections arrive via the HTTP `upgrade` event and bypass Express
middleware, so they are not logged this round. This is intentional and called
out so it is not mistaken for a gap.

## Testing (per app)

Mirror the hub's approach:
- **logger** unit: `token`/`password` redaction; `safeUrl()` masks query tokens.
- **requestLogger** unit: serialized output contains **no headers and no
  Set-Cookie** (the explicit regression guard for the gotcha); id honours inbound
  `X-Request-Id`; status→level mapping.
- **errorHandler** unit: content negotiation (HTML vs JSON); prod hides
  internals; view-render fallback path.
- **boot-smoke**: start the app, hit one route, assert a structured log line with
  a reqId and **no cookie/headers**. The hub's gotcha was caught by boot-smoke,
  not by unit tests — every app keeps this guard.

All of an app's existing tests must remain green.

## Workflow / swarm mechanics

1. **Pilot raid solo** (main session): TDD the CommonJS triplet + wiring, all
   tests green, merge raid to `master` locally (feature branch pushed to origin
   as backup first).
2. **Swarm signal / poker / retro** via three parallel subagents. Each receives:
   the validated raid triplet, its per-app delta brief, and the hub spec/plan as
   reference. Each does TDD in its own repo and returns a structured report
   (files changed, test counts, confirmation of the no-headers guard).
3. **Review before merge**: the main session reviews each subagent's output —
   spec conformance plus, specifically, the no-headers/no-Set-Cookie regression
   guard — then merges that app locally (feature branch → origin backup →
   `--no-ff` merge to the app's base branch).

## Git workflow (settled preference)

Per-app: feature branch (e.g. `feat/<app>-pino-observability`) pushed to origin
as off-machine backup → verify + review locally → local `--no-ff` merge to the
app's base branch → no PR (solo work). Stage explicit paths only; never
`git add -A` / `.`. `git status` before each commit. Leave each app's existing
untracked files (not ours) untouched.

## Out of scope

- WebSocket message/lifecycle logging.
- zod input validation (Tier-1 #2).
- Express 5 / ESM consolidation (Tier-1 #3; retro still on Express 4).
- Any prod deploy (this session ends at merged-and-ready).
- `scripts/` console.* conversion.

## Deploy notes (for the later deploy session — not this one)

Each app deploy will resemble the hub's: pull the app's base branch, run a real
`npm install` (new runtime deps `pino` + `pino-http`), restart the app's systemd
service. Each app has its own service user / port / env file — to be confirmed
per app at deploy time. `NODE_ENV=production` must be set so pino-pretty (devDep,
not installed on prod) is never required.
