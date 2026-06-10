# Suite-wide HTTP security headers — design

**Date:** 2026-06-10
**Status:** Approved, ready for implementation plan
**Scope:** Hub pilot + swarm rollout to the 4 apps (raid, signal, poker, retro)
**Roadmap slot:** Security hardening (sits alongside Tier-1 stack work; independent of Express 5 / #3)

## Problem

None of the 5 suite surfaces set HTTP security headers at the application layer.
Verified absent across `app.js` / `lib`: Content-Security-Policy, Strict-Transport-Security,
X-Frame-Options / `frame-ancestors`, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
This leaves clickjacking, MIME-sniffing, referrer-leakage, and (absent CSP) reflected/stored-XSS
blast-radius exposure on every page.

Cookies are already hardened (`hub/lib/cookies.js`: `HttpOnly; SameSite=Lax; Secure` in prod) and
`npm audit` is clean — this work closes the response-header gap, not a cookie or dependency gap.

## Audit findings (hub, drives the CSP posture)

- **0** inline `<style>` blocks
- **0** inline `<script>` blocks (no `src`-less scripts)
- **0** `on*=` inline event handlers (onclick/onsubmit/onchange/onload)
- **59** inline `style="..."` attributes
- No external script/style CDNs (only same-origin `sprintsuite.uk` links)

Conclusion: strict `script-src 'self'` holds on the hub with **no refactor**. `style-src` retains
`'unsafe-inline'` for the 59 inline style attributes (a minor, common relaxation; the XSS-critical
directive is `script-src`, which stays strict).

## Architecture

A single pure middleware, `hub/lib/security-headers.js`, exporting an Express middleware that sets a
fixed header block on every response. Mounted **early** in `app.js`, before route handlers, so it
also covers error responses (the pino central error handler runs after it).

- **Pilot:** the hub. Implemented TDD, two-stage reviewed, merged, deployed.
- **Swarm:** the same file is copied into each of the 4 app repos by parallel subagents
  (`raid`, `signal`, `poker`, `retro`). Copy-per-repo, **no shared package** — identical model to
  the zod `lib/validate.js` and pino rollouts. Separate repos ⇒ no merge conflicts, no deploy ordering.

The middleware is pure header-setting: no async, no I/O, cannot throw.

## The header block (hub baseline)

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=()
```

Decisions:
- `script-src 'self'` strict — enforce immediately (chosen posture; not Report-Only).
- `style-src 'self' 'unsafe-inline'` — for the 59 inline style attrs.
- Deprecated `X-XSS-Protection` omitted.
- COOP/COEP deferred to a future hardening pass (COEP breaks cross-origin embeds; not worth the
  breakage risk in v1).
- No CSP `report-uri` in v1 — violations surface in the browser console during each app's audit.

## Per-app CSP deltas (swarm audit)

Each app subagent re-runs the inline-JS/style audit on its own views, then adjusts **only** what its
views require before flipping enforce on:

- **poker & retro** — WebSockets. `connect-src` must permit the WS origin. Same-origin `wss:` is
  covered by `'self'` in modern browsers; the subagent verifies live and adds the explicit `wss:`
  origin only if a violation appears.
- **any app with inline `<script>` or `on*=` handlers** — externalise them (small refactor) so
  `script-src 'self'` holds. The subagent must NOT weaken `script-src` to `'unsafe-inline'` without
  flagging it back to the operator.
- **img-src** — extended to whatever the app actually loads (marketing/landing shots are same-origin;
  `data:` already permitted).

An app flips off → enforce only after its own unit tests **and** a live `curl -sI` pass.

## Testing

- **Unit** (`hub/tests/security-headers.test.js`, `node --test`): asserts every header name and exact
  value is present on a representative route response. The pattern the swarm copies per repo.
- **Deploy-time verification**: `curl -sI https://<surface>` per surface — confirm headers present,
  values correct, and **no duplicates**. A duplicate means Apache already emits that header
  (`/etc/apache2`, not in repo); reconcile to a single source — prefer the app layer, strip the
  Apache `Header` directive.

## Edge cases

- HSTS emitted unconditionally; harmless behind Apache TLS termination + proxy. `includeSubDomains`
  is safe — all suite surfaces are HTTPS.
- Middleware mounted before routes ⇒ headers present on 404 / error responses too.
- Header values are static strings; no per-request computation, so no perf or injection surface.

## Out of scope

- CSRF tokens (separate follow-up; `SameSite=Lax` covers cross-site POST today).
- COOP/COEP cross-origin isolation.
- Refactoring the 59 inline style attrs to drop `style-src 'unsafe-inline'`.
- Apache-layer header configuration changes beyond de-duplication at deploy time.

## Rollout / deploy

1. Hub pilot: TDD → two-stage review → local `--no-ff` merge → push branch as backup → one-command-at-a-time prod deploy → `curl -sI` verify → operator visual pass.
2. Swarm the 4 apps in parallel; each: audit → copy middleware → per-app CSP delta → tests green → merge → deploy → `curl -sI` verify.
3. No deploy ordering between repos (independent surfaces).
