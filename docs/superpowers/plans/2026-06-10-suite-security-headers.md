# Suite-wide HTTP Security Headers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set a fixed block of HTTP security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) on every response across the hub and the 4 apps.

**Architecture:** A single pure Express middleware factory (`makeSecurityHeaders`) mounted early — before static and routes — so it covers static assets and error responses too. The hub is the pilot (ESM); the same middleware is copied (adapted to CommonJS) into the 4 app repos by parallel subagents, each auditing its own views and adjusting the CSP `script-src`/`connect-src`/`img-src` only as required before enforcing.

**Tech Stack:** Node ≥20, Express, `node:test` + `supertest` (both already present). No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-06-10-suite-security-headers-design.md`

**Convention note:** Hub middleware lives in `hub/middleware/<name>.js` as `makeX(...)` factories (see `middleware/requestLogger.js`, `middleware/errorHandler.js`). This plan follows that convention — NOT the spec's illustrative `lib/security-headers.js` path. The middleware is wired into both `server.js` and `tests/helpers.js`, which mirror each other and must stay in sync.

---

## PART A — Hub pilot

### Task 1: The `makeSecurityHeaders` middleware (TDD, unit level)

**Files:**
- Create: `hub/middleware/securityHeaders.js`
- Test: `hub/tests/security-headers.test.js`

- [ ] **Step 1: Write the failing unit test**

Create `hub/tests/security-headers.test.js`:

```js
// tests/security-headers.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSecurityHeaders, DEFAULT_CSP } from "../middleware/securityHeaders.js";

// Minimal res double that records setHeader calls.
function fakeRes() {
  const headers = {};
  return { setHeader: (k, v) => { headers[k] = v; }, headers };
}

test("sets the full default header block and calls next", () => {
  const mw = makeSecurityHeaders();
  const res = fakeRes();
  let nexted = false;
  mw({}, res, () => { nexted = true; });

  assert.equal(res.headers["Content-Security-Policy"], DEFAULT_CSP);
  assert.equal(res.headers["Strict-Transport-Security"], "max-age=31536000; includeSubDomains");
  assert.equal(res.headers["X-Frame-Options"], "DENY");
  assert.equal(res.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(res.headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(res.headers["Permissions-Policy"], "geolocation=(), camera=(), microphone=(), payment=()");
  assert.equal(nexted, true);
});

test("DEFAULT_CSP keeps script-src strict and styles inline", () => {
  assert.match(DEFAULT_CSP, /script-src 'self'(;|$)/);
  assert.match(DEFAULT_CSP, /style-src 'self' 'unsafe-inline'/);
  assert.match(DEFAULT_CSP, /frame-ancestors 'none'/);
  assert.match(DEFAULT_CSP, /object-src 'none'/);
  assert.doesNotMatch(DEFAULT_CSP, /script-src[^;]*unsafe-inline/);
});

test("contentSecurityPolicy override replaces the CSP value only", () => {
  const custom = "default-src 'self'; connect-src 'self' wss:";
  const mw = makeSecurityHeaders({ contentSecurityPolicy: custom });
  const res = fakeRes();
  mw({}, res, () => {});
  assert.equal(res.headers["Content-Security-Policy"], custom);
  // Other headers unchanged by the override.
  assert.equal(res.headers["X-Frame-Options"], "DENY");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd hub && node --test tests/security-headers.test.js`
Expected: FAIL — `Cannot find module '../middleware/securityHeaders.js'`.

- [ ] **Step 3: Write the middleware**

Create `hub/middleware/securityHeaders.js`:

```js
// middleware/securityHeaders.js
// Pure, static HTTP security headers set on every response. Mounted early in
// server.js (and mirrored in tests/helpers.js) so it covers static assets and
// error responses too. See docs/.../2026-06-10-suite-security-headers-design.md.

export const DEFAULT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export function makeSecurityHeaders({ contentSecurityPolicy = DEFAULT_CSP } = {}) {
  return function securityHeaders(_req, res, next) {
    res.setHeader("Content-Security-Policy", contentSecurityPolicy);
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=()");
    next();
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd hub && node --test tests/security-headers.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add hub/middleware/securityHeaders.js hub/tests/security-headers.test.js
git commit -m "feat(hub): security-headers middleware (unit-tested)"
```

---

### Task 2: Wire the middleware into the hub app + integration test

**Files:**
- Modify: `hub/tests/helpers.js` (mirror of server.js wiring)
- Modify: `hub/server.js:31-44` (mount after trust-proxy, before static)
- Test: `hub/tests/security-headers.test.js` (append integration test)

- [ ] **Step 1: Write the failing integration test**

Append to `hub/tests/security-headers.test.js`:

```js
import request from "supertest";
import { buildTestApp } from "./helpers.js";

test("headers are present on a real route response (landing /)", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["referrer-policy"], "strict-origin-when-cross-origin");
  assert.match(res.headers["content-security-policy"], /script-src 'self'/);
  assert.equal(res.headers["strict-transport-security"], "max-age=31536000; includeSubDomains");
  assert.match(res.headers["permissions-policy"], /camera=\(\)/);
});

test("headers are present on a 404 (covers error responses)", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/no-such-path-xyz");
  assert.equal(res.status, 404);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.match(res.headers["content-security-policy"], /default-src 'self'/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd hub && node --test tests/security-headers.test.js`
Expected: FAIL — the two new tests fail (`x-frame-options` is `undefined`).

- [ ] **Step 3: Wire into the test harness**

In `hub/tests/helpers.js`, add the import at the top (after the existing imports, e.g. after the `openDb` import):

```js
import { makeSecurityHeaders } from "../middleware/securityHeaders.js";
```

Then, immediately after the line `app.set("trust proxy", "loopback"); // mirror server.js ...` and BEFORE the `const viewsDir = ...` line, insert:

```js
  app.use(makeSecurityHeaders());
```

- [ ] **Step 4: Run to verify the integration tests pass**

Run: `cd hub && node --test tests/security-headers.test.js`
Expected: PASS — all 5 tests (3 unit + 2 integration).

- [ ] **Step 5: Wire into the real server**

In `hub/server.js`, add the import alongside the other middleware imports (after line 23, the `makeErrorHandler` import):

```js
import { makeSecurityHeaders } from "./middleware/securityHeaders.js";
```

Then, immediately after the `app.set("trust proxy", "loopback");` block (the comment + line ~31) and BEFORE the `// Views` section, insert:

```js
// Security headers — mounted early so they cover static assets and error responses.
app.use(makeSecurityHeaders());
```

- [ ] **Step 6: Run the full hub test suite (no regressions)**

Run: `cd hub && npm test`
Expected: PASS — previous count (≈247) + 5 new = all green.

- [ ] **Step 7: Smoke the live header locally**

Run: `cd hub && node server.js &` then `sleep 1 && curl -sI http://localhost:3004/healthz | grep -iE 'content-security|x-frame|strict-transport|x-content-type|referrer|permissions'`
Expected: all 6 header lines printed. Then stop the server: `kill %1`.
(If port 3004 is busy locally, set `PORT` via the hub `.env`/env and adjust the curl port.)

- [ ] **Step 8: Commit**

```bash
git add hub/server.js hub/tests/helpers.js hub/tests/security-headers.test.js
git commit -m "feat(hub): mount security-headers middleware + integration tests"
```

---

### Task 3: Merge and deploy the hub pilot

**Files:** none (git + ops). Walk the deploy one command at a time on prod; do not batch.

- [ ] **Step 1: Push the feature branch as an off-machine backup**

```bash
git push -u origin feat/suite-security-headers
```

- [ ] **Step 2: Local no-ff merge to main**

```bash
git checkout main && git merge --no-ff feat/suite-security-headers -m "Merge feat/suite-security-headers: hub security headers pilot"
```

- [ ] **Step 3: Push main**

```bash
git push origin main
```

- [ ] **Step 4: Deploy on prod (operator, one command at a time)**

On prod: `cd /var/www/suite && git pull`, then restart the hub service, then verify. Each command is issued and its output read before the next — see the deploy recipe in [[project-zod-validation]] memory for the exact suite-hub restart + `/healthz` pattern.

- [ ] **Step 5: Verify live headers on prod**

Run: `curl -sI https://sprintsuite.uk/ | grep -iE 'content-security|x-frame|strict-transport|x-content-type|referrer|permissions'`
Expected: all 6 headers, each appearing exactly ONCE. A duplicate (e.g. two `Strict-Transport-Security` lines) means Apache already sets it — in that case strip the matching `Header set` directive from the suite vhost (`/etc/apache2`) so the app layer is the single source, reload Apache, re-verify.

- [ ] **Step 6: Operator visual pass**

Load `https://sprintsuite.uk/`, `/dashboard` (logged in), `/login`, `/admin` in a browser with devtools open. Confirm: pages render normally, and the Console shows **no CSP violation errors**. Any violation = a real inline script/style the audit missed; fix it (externalise the script, or extend the directive) before declaring the pilot done.

---

## PART B — Swarm rollout to the 4 apps

> Dispatch one subagent per app in parallel (separate repos ⇒ no conflicts, no deploy ordering). Apps are CommonJS + Express. Each subagent follows Task 4 against its own repo.

### Task 4 (×4): Per-app rollout — raid, signal, poker, retro

**Repos (separate from this tree):** raid, signal, poker (`scrumpoker`), retro (`retrospective`). Each subagent works in its app's repo and branch (`feat/security-headers`).

- [ ] **Step 1: Audit the app's views for CSP blockers**

In the app repo run:
```bash
grep -rEc "<script(?![^>]*src)" views 2>/dev/null; grep -rEoh "on(click|submit|change|load|input)=" views 2>/dev/null | wc -l
```
Record counts. **If inline `<script>` blocks or `on*=` handlers exist**, externalise them into a `public/*.js` file so `script-src 'self'` holds. Do NOT add `'unsafe-inline'` to `script-src` — if externalising is non-trivial, STOP and report back to the operator instead.

- [ ] **Step 2: Create the middleware (CommonJS variant)**

Create `middleware/securityHeaders.js` (CJS form of the hub middleware):

```js
// middleware/securityHeaders.js
const DEFAULT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

function makeSecurityHeaders({ contentSecurityPolicy = DEFAULT_CSP } = {}) {
  return function securityHeaders(_req, res, next) {
    res.setHeader("Content-Security-Policy", contentSecurityPolicy);
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=()");
    next();
  };
}

module.exports = { makeSecurityHeaders, DEFAULT_CSP };
```

- [ ] **Step 3: Apply the per-app CSP delta**

- **poker & retro (WebSockets):** mount with an explicit WS origin so socket connections aren't blocked:
  ```js
  const { makeSecurityHeaders, DEFAULT_CSP } = require("./middleware/securityHeaders.js");
  const csp = DEFAULT_CSP.replace("connect-src 'self'", "connect-src 'self' wss: ws:");
  app.use(makeSecurityHeaders({ contentSecurityPolicy: csp }));
  ```
- **raid & signal:** mount with defaults: `app.use(makeSecurityHeaders());`
- **any app loading external images** (extend only if the audit found them): replace `img-src 'self' data:` with the actual origins needed.

Mount it **early** — immediately after any `trust proxy` line and before static/routes — matching the app's existing middleware order.

- [ ] **Step 4: Write the app's test (mirror the hub pattern)**

Add a test in the app's test dir asserting the 6 headers are present on a real route response, using the app's existing request mechanism (supertest or its established harness). Assert `script-src 'self'` is present and that `script-src` does NOT contain `unsafe-inline`. For poker/retro also assert `connect-src` includes `wss:`.

- [ ] **Step 5: Run the app's full test suite**

Run the app's test command. Expected: all prior tests + the new one green.

- [ ] **Step 6: Local smoke for headers**

Boot the app locally and `curl -sI http://localhost:<port>/` — confirm all 6 headers present once.

- [ ] **Step 7: Commit, merge, deploy, verify**

Commit (`feat(<app>): HTTP security headers`), push branch as backup, local `--no-ff` merge to the app's main/master, deploy on prod one command at a time, then:
```bash
curl -sI https://<app-domain>/ | grep -iE 'content-security|x-frame|strict-transport|x-content-type|referrer|permissions'
```
Expected: 6 headers, each once (de-duplicate against Apache as in Part A Step 5). For poker/retro, open the app in a browser and confirm a room loads and the **WebSocket connects with no CSP `connect-src` violation** in the console.

---

## Self-review notes

- **Spec coverage:** header block (Task 1/2), strict `script-src` enforce-now (Task 1 + audit gates in Task 4 Step 1), `style-src 'unsafe-inline'` (DEFAULT_CSP), per-app WS delta (Task 4 Step 3), unit + integration tests (Tasks 1–2), deploy-time `curl -sI` + de-dup against Apache (Task 3 Step 5, Task 4 Step 7), error-response coverage (Task 2 404 test). All covered.
- **No new dependency:** uses `node:test` + `supertest`, both already present.
- **Naming consistency:** `makeSecurityHeaders` / `DEFAULT_CSP` identical across hub (ESM `export`) and apps (CJS `module.exports`).
- **Out of scope (per spec):** CSRF tokens, COOP/COEP, refactoring the 59 inline style attrs, Apache config beyond de-duplication.
