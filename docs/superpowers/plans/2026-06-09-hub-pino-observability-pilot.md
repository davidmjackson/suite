# Hub Pino Observability Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the hub structured logging (pino + pino-http with a per-request id) and a central error handler, so every request and error becomes a queryable log line and opaque 500s become clean, logged responses.

**Architecture:** A singleton pino logger (`lib/logger.js`) plus two mountable middlewares (`middleware/requestLogger.js`, `middleware/errorHandler.js`) wired into `server.js`. Request headers are never logged (custom `req` serializer), sensitive query params are masked, and `token`/`password` fields are redacted — so magic-link tokens and session cookies can't leak. The existing `views/error.eta` is reused for HTML error responses.

**Tech Stack:** Node ESM, Express 5, pino, pino-http, pino-pretty (dev), eta, `node:test` + supertest.

---

## Context the worker needs

- `hub/server.js` assembles the app inline and calls `app.listen` at module top — **there is no `createApp()` factory, and we are not adding one** (out of scope). Wire middleware directly into `server.js`.
- Tests build their own minimal Express app per file (see `tests/api-apps-consume.test.js`) or use `tests/helpers.js buildTestApp()` (sets up eta + json + static, mounts landing, returns `{ app, db, config }`). The integration tests below reuse `buildTestApp()` so the eta engine is available for HTML error rendering.
- `config.js` has **no dotenv**; env vars come from the systemd unit. The logger reads `process.env.LOG_LEVEL` / `process.env.NODE_ENV` directly (NOT via `config.js`) so importing the logger never triggers `config.js`'s `required()` throws.
- **Pretty-print rule:** the default logger uses `pino-pretty` only when `process.env.NODE_ENV === "development"` (explicit). When unset (as in tests) or `production`, it emits plain JSON. This keeps tests free of pino-pretty's worker thread.
- Run a single test file with: `node --test tests/<file>.test.js`. Run all: `npm test` (= `node --test tests/`). Working dir for all commands: `/var/www/suite/hub`.
- Branch already created: `feat/hub-pino-observability`. Commit after every task.

## File structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `hub/package.json` | Modify | Add `pino`, `pino-http` deps; `pino-pretty` devDep |
| `hub/lib/logger.js` | Create | `createLogger()` factory, `safeUrl()`, redaction config, default singleton |
| `hub/middleware/requestLogger.js` | Create | `makeRequestLogger(logger)` → pino-http middleware (reqId, level mapping, header-free serializer) |
| `hub/middleware/errorHandler.js` | Create | `makeErrorHandler({ logger, nodeEnv })` → central `(err,req,res,next)` |
| `hub/views/error.eta` | Modify | Add optional `reqId` reference line |
| `hub/server.js` | Modify | Mount request logger (early) + error handler (last); startup log → logger |
| `hub/routes/admin.js` | Modify | console.error → `(req.log||logger).error` |
| `hub/routes/login.js` | Modify | console.error → `(req.log||logger).error` |
| `hub/routes/request.js` | Modify | console.error → `(req.log||logger).error` |
| `hub/tests/logger.test.js` | Create | Unit: level, base field, redaction, `safeUrl` |
| `hub/tests/request-logger.test.js` | Create | Integration: reqId honored + header, level mapping, header/url privacy |
| `hub/tests/error-handler.test.js` | Create | Integration: clean 500, JSON vs HTML, prod/dev, logged error |
| `hub/tests/email-failure-logging.test.js` | Create | Email-send failure still returns normally (fallback logger path) |

---

## Task 1: Add dependencies

**Files:**
- Modify: `hub/package.json`

- [ ] **Step 1: Install runtime deps**

Run (in `/var/www/suite/hub`):
```bash
npm install pino pino-http
```
Expected: `package.json` gains `pino` and `pino-http` under `dependencies`; `package-lock.json` updated; no errors.

- [ ] **Step 2: Install dev dep**

Run:
```bash
npm install -D pino-pretty
```
Expected: `pino-pretty` added under `devDependencies`.

- [ ] **Step 3: Verify the dependency block**

Run:
```bash
node -e "const p=require('./package.json'); console.log(p.dependencies.pino, p.dependencies['pino-http'], p.devDependencies['pino-pretty'])"
```
Expected: three version strings print (e.g. `^9.x.x ^10.x.x ^13.x.x`), none `undefined`.

- [ ] **Step 4: Confirm existing tests still pass**

Run:
```bash
npm test 2>&1 | tail -5
```
Expected: existing suite passes (the 219 baseline), 0 failures.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(hub): add pino, pino-http, pino-pretty"
```

---

## Task 2: Logger module (`lib/logger.js`)

**Files:**
- Create: `hub/lib/logger.js`
- Test: `hub/tests/logger.test.js`

- [ ] **Step 1: Write the failing test**

Create `hub/tests/logger.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { createLogger, safeUrl } from "../lib/logger.js";

function capture() {
  const chunks = [];
  const stream = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });
  const records = () => chunks.join("").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { stream, records };
}

test("respects the configured level", () => {
  const cap = capture();
  const log = createLogger({ level: "warn", stream: cap.stream });
  log.info("ignored");
  log.warn("kept");
  const recs = cap.records();
  assert.equal(recs.length, 1);
  assert.equal(recs[0].msg, "kept");
});

test("emits JSON with base service field", () => {
  const cap = capture();
  const log = createLogger({ level: "info", stream: cap.stream });
  log.info("hello");
  assert.equal(cap.records()[0].service, "hub");
});

test("redacts token and password fields, including one level deep", () => {
  const cap = capture();
  const log = createLogger({ level: "info", stream: cap.stream });
  log.info({ token: "abc", password: "pw", nested: { token: "zzz" } }, "m");
  const rec = cap.records()[0];
  assert.equal(rec.token, "[redacted]");
  assert.equal(rec.password, "[redacted]");
  assert.equal(rec.nested.token, "[redacted]");
});

test("safeUrl masks sensitive query params but keeps the path", () => {
  const out = safeUrl("/auth/magic?token=topsecretvalue&x=1");
  assert.ok(!out.includes("topsecretvalue"));
  assert.ok(out.startsWith("/auth/magic"));
  assert.ok(out.includes("x=1"));
  assert.equal(safeUrl("/plain"), "/plain");
  assert.ok(!safeUrl("/x?password=topsecretpw").includes("topsecretpw"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node --test tests/logger.test.js
```
Expected: FAIL — cannot find module `../lib/logger.js`.

- [ ] **Step 3: Write the implementation**

Create `hub/lib/logger.js`:
```js
// lib/logger.js — structured logging for the hub (pino).
//
// Reads NODE_ENV / LOG_LEVEL from the environment directly (NOT config.js) so
// importing this module never triggers config.js's required() throws.
import { pino } from "pino";

// Field paths redacted everywhere as defense-in-depth. Request headers are not
// logged at all (see middleware/requestLogger.js), so cookies/authorization
// never reach a log record; these paths catch app-level logs that include a
// token/password field.
export const REDACT_PATHS = ["token", "*.token", "password", "*.password"];

// Query-string keys whose values are masked by safeUrl (e.g. magic-link tokens).
const SENSITIVE_QUERY = new Set(["token", "password"]);

// Mask sensitive query params in a URL while preserving the path + other params.
export function safeUrl(url) {
  if (typeof url !== "string") return url;
  const q = url.indexOf("?");
  if (q === -1) return url;
  const path = url.slice(0, q);
  const params = new URLSearchParams(url.slice(q + 1));
  for (const key of params.keys()) {
    if (SENSITIVE_QUERY.has(key.toLowerCase())) params.set(key, "[redacted]");
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function createLogger({ level, pretty = false, stream } = {}) {
  const opts = {
    level: level || process.env.LOG_LEVEL || "info",
    base: { service: "hub" },
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  };
  if (stream) return pino(opts, stream);
  if (pretty) return pino({ ...opts, transport: { target: "pino-pretty" } });
  return pino(opts);
}

const logger = createLogger({ pretty: process.env.NODE_ENV === "development" });
export default logger;
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
node --test tests/logger.test.js
```
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/logger.js tests/logger.test.js
git commit -m "feat(hub): add pino logger with redaction and safeUrl"
```

---

## Task 3: Request logger middleware (`middleware/requestLogger.js`)

**Files:**
- Create: `hub/middleware/requestLogger.js`
- Test: `hub/tests/request-logger.test.js`

- [ ] **Step 1: Write the failing test**

Create `hub/tests/request-logger.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { Writable } from "node:stream";
import { createLogger } from "../lib/logger.js";
import { makeRequestLogger } from "../middleware/requestLogger.js";

function capture() {
  const chunks = [];
  const stream = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });
  return {
    stream,
    text: () => chunks.join(""),
    records: () => chunks.join("").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
  };
}

function buildApp() {
  const cap = capture();
  const logger = createLogger({ level: "info", stream: cap.stream });
  const app = express();
  app.use(makeRequestLogger(logger));
  app.get("/ok", (req, res) => res.json({ ok: true }));
  app.get("/missing", (req, res) => res.status(404).json({ no: true }));
  return { app, cap };
}

const tick = () => new Promise((r) => setImmediate(r));

test("generates a request id and echoes it in the X-Request-Id header", async () => {
  const { app } = buildApp();
  const res = await request(app).get("/ok");
  assert.equal(res.status, 200);
  assert.ok(res.headers["x-request-id"]);
});

test("honors an inbound X-Request-Id", async () => {
  const { app, cap } = buildApp();
  const res = await request(app).get("/ok").set("X-Request-Id", "abc-123");
  await tick();
  assert.equal(res.headers["x-request-id"], "abc-123");
  assert.ok(cap.records().some((r) => r.req && r.req.id === "abc-123"));
});

test("maps a 404 response to warn level", async () => {
  const { app, cap } = buildApp();
  await request(app).get("/missing");
  await tick();
  const rec = cap.records().find((r) => r.req && r.req.url === "/missing");
  assert.ok(rec);
  assert.equal(rec.level, 40); // pino warn
});

test("never logs request headers (cookie stays private)", async () => {
  const { app, cap } = buildApp();
  await request(app).get("/ok").set("Cookie", "hub_session=supersecretcookie");
  await tick();
  assert.ok(!cap.text().includes("supersecretcookie"));
});

test("masks sensitive query params in the logged url", async () => {
  const { app, cap } = buildApp();
  await request(app).get("/ok?token=topsecretquery");
  await tick();
  assert.ok(!cap.text().includes("topsecretquery"));
  assert.ok(cap.records().some((r) => r.req && r.req.url.startsWith("/ok")));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node --test tests/request-logger.test.js
```
Expected: FAIL — cannot find module `../middleware/requestLogger.js`.

- [ ] **Step 3: Write the implementation**

Create `hub/middleware/requestLogger.js`:
```js
// middleware/requestLogger.js — per-request structured logging via pino-http.
import { pinoHttp } from "pino-http";
import { randomUUID } from "node:crypto";
import { safeUrl } from "../lib/logger.js";

export function makeRequestLogger(logger) {
  return pinoHttp({
    logger,
    genReqId(req, res) {
      const incoming = req.headers["x-request-id"];
      const id = typeof incoming === "string" && incoming.trim() ? incoming.trim() : randomUUID();
      res.setHeader("X-Request-Id", id);
      return id;
    },
    customLogLevel(req, res, err) {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    serializers: {
      // Log only id/method/url — never headers — so cookies/authorization can't leak.
      req(req) {
        return { id: req.id, method: req.method, url: safeUrl(req.url) };
      },
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
node --test tests/request-logger.test.js
```
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add middleware/requestLogger.js tests/request-logger.test.js
git commit -m "feat(hub): add pino-http request logger middleware"
```

---

## Task 4: Error handler middleware (`middleware/errorHandler.js`) + view

**Files:**
- Create: `hub/middleware/errorHandler.js`
- Modify: `hub/views/error.eta`
- Test: `hub/tests/error-handler.test.js`

- [ ] **Step 1: Write the failing test**

Create `hub/tests/error-handler.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { Writable } from "node:stream";
import { buildTestApp } from "./helpers.js";
import { createLogger } from "../lib/logger.js";
import { makeRequestLogger } from "../middleware/requestLogger.js";
import { makeErrorHandler } from "../middleware/errorHandler.js";

function capture() {
  const chunks = [];
  const stream = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });
  return {
    stream,
    text: () => chunks.join(""),
    records: () => chunks.join("").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
  };
}
const tick = () => new Promise((r) => setImmediate(r));

async function appWithBoom({ nodeEnv = "production" } = {}) {
  const cap = capture();
  const logger = createLogger({ level: "info", stream: cap.stream });
  const { app } = await buildTestApp();
  app.use(makeRequestLogger(logger));
  app.get("/boom", () => { throw new Error("kaboom-secret-detail"); });
  app.use(makeErrorHandler({ logger, nodeEnv }));
  return { app, cap };
}

test("API/JSON error returns a clean 500 with a reqId and no internal detail", async () => {
  const { app } = await appWithBoom();
  const res = await request(app).get("/boom").set("Accept", "application/json");
  assert.equal(res.status, 500);
  assert.equal(res.body.error, "Internal Server Error");
  assert.ok(typeof res.body.reqId === "string" && res.body.reqId.length > 0);
  assert.ok(!JSON.stringify(res.body).includes("kaboom-secret-detail"));
});

test("logs a structured error carrying the same reqId", async () => {
  const { app, cap } = await appWithBoom();
  const res = await request(app).get("/boom").set("Accept", "application/json");
  await tick();
  const errRec = cap.records().find((r) => r.msg === "unhandled error");
  assert.ok(errRec, "expected an 'unhandled error' log record");
  assert.equal(errRec.reqId, res.body.reqId);
});

test("HTML error renders the error page in prod without the stack", async () => {
  const { app } = await appWithBoom({ nodeEnv: "production" });
  const res = await request(app).get("/boom");
  assert.equal(res.status, 500);
  assert.match(res.headers["content-type"], /html/);
  assert.ok(res.text.includes("Something went wrong"));
  assert.ok(!res.text.includes("kaboom-secret-detail"));
});

test("dev mode exposes the error message", async () => {
  const { app } = await appWithBoom({ nodeEnv: "development" });
  const res = await request(app).get("/boom").set("Accept", "application/json");
  assert.ok(JSON.stringify(res.body).includes("kaboom-secret-detail"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node --test tests/error-handler.test.js
```
Expected: FAIL — cannot find module `../middleware/errorHandler.js`.

- [ ] **Step 3: Write the implementation**

Create `hub/middleware/errorHandler.js`:
```js
// middleware/errorHandler.js — central error handler. Mount LAST, after routes.
export function makeErrorHandler({ logger, nodeEnv }) {
  const isProd = nodeEnv === "production";
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);
    const log = req.log || logger;
    const reqId = req.id;
    log.error({ err, reqId }, "unhandled error");

    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(status);

    const wantsJson =
      (typeof req.path === "string" && req.path.startsWith("/api")) ||
      (typeof req.accepts === "function" && req.accepts(["html", "json"]) === "json");

    if (wantsJson) {
      return res.json({ error: isProd ? "Internal Server Error" : err.message || "Error", reqId });
    }
    return res.render("error", {
      title: "Something went wrong",
      message: isProd ? "An unexpected error occurred. Please try again." : err.stack || err.message || "Error",
      reqId,
      backHref: "/",
    });
  };
}
```

- [ ] **Step 4: Add the reqId line to the error view**

Modify `hub/views/error.eta` — change it to (add the `reqId` line before the footer include):
```eta
<%~ include("partials/header", { title: it.title || "Error" }) %>
<section class="card" style="max-width:520px;margin:0 auto;">
<h1 style="font-size:26px;"><%= it.title || "Something went wrong" %></h1>
<p class="lede"><%= it.message %></p>
<% if (it.reqId) { %><p class="muted" style="font-size:13px;opacity:.7;">Reference: <%= it.reqId %></p><% } %>
<% if (it.backHref) { %><p><a class="lnk" href="<%= it.backHref %>">Back</a></p><% } %>
</section>
<%~ include("partials/footer") %>
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
node --test tests/error-handler.test.js
```
Expected: PASS — 4 tests pass.

- [ ] **Step 6: Confirm the existing admin error-render path still works**

Run (admin already uses `render("error", …)` without a reqId — the optional line must not break it):
```bash
node --test tests/admin-companies.test.js
```
Expected: PASS — no regressions.

- [ ] **Step 7: Commit**

```bash
git add middleware/errorHandler.js views/error.eta tests/error-handler.test.js
git commit -m "feat(hub): add central error handler + reqId on error page"
```

---

## Task 5: Wire middleware into `server.js`

**Files:**
- Modify: `hub/server.js`

> Not unit-tested (server.js calls `app.listen` at module top and exports nothing — refactoring to a factory is out of scope). Verified by the full suite + a manual boot smoke in Task 7.

- [ ] **Step 1: Add imports**

In `hub/server.js`, after line 20 (`import { createEmailSender } from "./lib/email.js";`), add:
```js
import logger from "./lib/logger.js";
import { makeRequestLogger } from "./middleware/requestLogger.js";
import { makeErrorHandler } from "./middleware/errorHandler.js";
```

- [ ] **Step 2: Mount the request logger early (after static, before body parsing)**

In `hub/server.js`, find:
```js
// Static
app.use(express.static(path.join(__dirname, "public")));

// Body parsing
app.use(express.urlencoded({ extended: false }));
```
Replace with:
```js
// Static
app.use(express.static(path.join(__dirname, "public")));

// Request logging (skips static assets above; wraps all dynamic routes)
app.use(makeRequestLogger(logger));

// Body parsing
app.use(express.urlencoded({ extended: false }));
```

- [ ] **Step 3: Mount the error handler last + convert the startup log**

In `hub/server.js`, find:
```js
app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(config.port, () => console.log(`hub listening on ${config.port}`));
```
Replace with:
```js
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Central error handler — must be last.
app.use(makeErrorHandler({ logger, nodeEnv: config.nodeEnv }));

app.listen(config.port, () => logger.info({ port: config.port }, "hub listening"));
```

- [ ] **Step 4: Run the full suite**

Run:
```bash
npm test 2>&1 | tail -5
```
Expected: all tests pass (baseline 219 + the new logger/request-logger/error-handler tests), 0 failures.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(hub): wire request logger + error handler into server"
```

---

## Task 6: Convert runtime console.error calls

**Files:**
- Modify: `hub/routes/admin.js` (line ~144)
- Modify: `hub/routes/login.js` (line ~53)
- Modify: `hub/routes/request.js` (line ~60)
- Test: `hub/tests/email-failure-logging.test.js`

> `req.log` exists when the request logger is mounted (server.js). Tests that mount these routes on a bare app have no `req.log`, so we fall back to the module `logger`. The fallback must not throw.

- [ ] **Step 1: Write the failing test**

Create `hub/tests/email-failure-logging.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { mountLogin } from "../routes/login.js";

// A throwing email sender exercises the catch block (best-effort logging path).
const throwingSender = {
  async sendMagicLink() { throw new Error("smtp down"); },
};

test("login still succeeds when the magic-link email send throws", async () => {
  const { app, db } = await buildTestApp();
  // Insert shape mirrors tests/login.test.js (users.id is a required column).
  db.prepare("INSERT INTO users (id, email, created_at) VALUES (?,?,?)").run("u1", "known@test.com", Date.now());
  mountLogin(app, { emailSender: throwingSender });
  // The magic-link send only fires for an existing user, so this hits the catch.
  const res = await request(app).post("/login").type("form").send({ email: "known@test.com" });
  // Existing behaviour: always render check-email (no user enumeration), 200.
  assert.equal(res.status, 200);
  assert.ok(res.text.length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node --test tests/email-failure-logging.test.js
```
Expected: FAIL — currently the catch calls `console.error` (works) so this test may PASS already for the success assertion; if it passes, that's fine — it is the regression guard for the conversion in Step 3. Proceed to Step 3 and re-run to confirm it still passes after the change.

- [ ] **Step 3: Convert the three call sites**

In `hub/routes/admin.js`, add to the existing import block near the top (mirror the other `../lib/...` imports):
```js
import logger from "../lib/logger.js";
```
Then change line ~144 from:
```js
      console.error("access-approved email send failed", err);
```
to:
```js
      (req.log || logger).error({ err }, "access-approved email send failed");
```

In `hub/routes/login.js`, add near the top imports:
```js
import logger from "../lib/logger.js";
```
Then change line ~53 from:
```js
        console.error("magic link send failed", err);
```
to:
```js
        (req.log || logger).error({ err }, "magic link send failed");
```

In `hub/routes/request.js`, add near the top imports:
```js
import logger from "../lib/logger.js";
```
Then change line ~60 from:
```js
        console.error("access request notification failed", err);
```
to:
```js
        (req.log || logger).error({ err }, "access request notification failed");
```

- [ ] **Step 4: Run the converted-route test + their existing tests**

Run:
```bash
node --test tests/email-failure-logging.test.js tests/login.test.js tests/admin-companies.test.js tests/request.test.js
```
Expected: PASS — all green; no `Cannot read properties of undefined (reading 'error')` errors.

- [ ] **Step 5: Verify no runtime console.* remain in routes/lib**

Run:
```bash
grep -rn "console\." routes lib server.js | grep -v node_modules || echo "none remaining"
```
Expected: `none remaining` (all 40 `scripts/` console calls are intentionally untouched and not searched here).

- [ ] **Step 6: Commit**

```bash
git add routes/admin.js routes/login.js routes/request.js tests/email-failure-logging.test.js
git commit -m "feat(hub): route email-failure logs through structured logger"
```

---

## Task 7: Full regression + manual boot smoke

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run:
```bash
npm test 2>&1 | tail -8
```
Expected: all tests pass (≥ 219 baseline + new tests), 0 failures.

- [ ] **Step 2: Manual boot + healthz**

Run (one line; uses throwaway env, in-memory DB, JSON logs to stdout):
```bash
BASE_URL=http://localhost:3999 DB_PATH=:memory: RESEND_API_KEY=x FROM_EMAIL=a@b COOKIE_SECRET=x ALLOWED_APP_DOMAINS=https://x HUB_API_KEY_RAID=x HUB_API_KEY_SIGNAL=x HUB_API_KEY_RETRO=x HUB_API_KEY_POKER=x PORT=3999 node server.js &
```
Then:
```bash
sleep 1 && curl -s localhost:3999/healthz; echo
```
Expected: `{"ok":true}` printed, and a JSON line like `{"level":30,...,"service":"hub","port":3999,"msg":"hub listening"}` appeared in the server output.

- [ ] **Step 3: Confirm a forced error produces a clean response + a log line**

Run (hit a route that errors is not trivial without a known bug; instead verify the 404→warn path logs):
```bash
curl -s -o /dev/null -w "%{http_code}\n" localhost:3999/definitely-not-a-route
```
Expected: `404`, and the server output shows a JSON log line for the request at `warn` level (level 40) with `req.url` = `/definitely-not-a-route`.

- [ ] **Step 4: Stop the test server**

Run:
```bash
kill %1 2>/dev/null; echo stopped
```

- [ ] **Step 5: Final commit (if any verification notes/docs changed)**

No code change expected here. If everything is green, the branch is ready for review/merge per the standard flow (local verify → merge to main → prod pull → restart `suite-hub` → `/healthz` → observe a real structured log line in `journalctl -u suite-hub`).

---

## Notes for deployment (post-merge, not part of TDD)

- After merging to `main` and pulling on prod, restart `suite-hub`, confirm `/healthz` 200, then tail `journalctl -u suite-hub -f` and load a page — you should see one JSON request line per dynamic request, each with a reqId.
- Optionally set `LOG_LEVEL` on the systemd unit (defaults to `info`).
- `jq` is not installed on prod; JSON logs are still greppable. A pretty filter can be added later if desired.
