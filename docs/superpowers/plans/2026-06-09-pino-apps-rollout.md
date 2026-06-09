# Pino Observability — 4-App Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the hub's structured-logging + central-error-handler stack to raid, signal, poker, retro — HTTP-only, identical across all four — built, tested green, and merged to each app's main locally (no prod deploy this session).

**Architecture:** Convert the three hub ESM modules (`lib/logger.js`, `middleware/requestLogger.js`, `middleware/errorHandler.js`) to CommonJS in raid first (the pilot). Because none of the apps use a view engine, the error handler renders a small self-contained inline HTML page instead of `res.render` — which makes the triplet byte-identical across all four apps (only the `service` name differs). raid's validated triplet is then copied into signal/poker/retro by three parallel subagents.

**Tech Stack:** Node `node --test`, Express (4.x retro / 5.x rest), `pino@^10`, `pino-http@^11`, `pino-pretty@^13` (devDep), `supertest@^7` (devDep, test-only). All apps are CommonJS.

---

## Reference: the hub source being converted

The originals live at `/var/www/suite/hub/{lib/logger.js,middleware/requestLogger.js,middleware/errorHandler.js}` and their tests at `/var/www/suite/hub/tests/{logger,request-logger,error-handler}.test.js`. This plan contains the converted CommonJS forms in full; the hub files are reference only.

## Per-app facts (locked by inspection)

| App | Dir | Module | Express | View engine | WS | Base branch | Test script | New test glob |
|-----|-----|--------|---------|-------------|-----|-------------|-------------|---------------|
| raid | `/var/www/raid` | CJS | 5.1 | none (static HTML) | — | `master` | `node --test tests/*.unit.test.js` | `tests/*.unit.test.js` |
| signal | `/var/www/signal` | CJS | 5.2 | none | — | `feat/suite-auth` | `node --test tests/*.test.js` | `tests/*.test.js` |
| poker (scrumpoker) | `/var/www/scrumpoker` | CJS | 5.1 | none | ws | `main` | `node --test tests/*.test.js` | `tests/*.test.js` |
| retro (retrospective) | `/var/www/retrospective` | CJS | 4.19 | none | ws | `main` | explicit file list (no glob) | add files to script |

Key consequences:
- **No view engine anywhere** → error handler uses inline HTML (below), not `res.render`. The hub's "falls back to plain text when the view fails" test is therefore dropped; there is no view to fail.
- **raid uses `*.unit.test.js`**, the others `*.test.js`. Name new test files to match each app's glob.
- **retro's `test` script lists files explicitly** — new test files MUST be added to that script or `npm test` won't run them.
- **poker already has `supertest`**; raid/signal/retro need it added as a devDep.
- **Express 4 (retro)** shares the `(err, req, res, next)` error-handler signature, so the module is identical; just confirm mount order.

---

# PART A — raid pilot (main session, inline)

raid is the simplest app (no DB, no WS, Express 5, clean tree). It produces the validated CommonJS triplet that Part B copies.

## Task R1: Branch + dependencies

**Files:**
- Modify: `/var/www/raid/package.json`

- [ ] **Step 1: Create the feature branch**

```bash
cd /var/www/raid
git checkout -b feat/raid-pino-observability
```

- [ ] **Step 2: Add runtime + dev deps**

```bash
cd /var/www/raid
npm install pino@^10.3.1 pino-http@^11.0.0
npm install --save-dev pino-pretty@^13.1.3 supertest@^7.0.0
```

- [ ] **Step 3: Verify package.json picked them up**

Run: `cd /var/www/raid && node -e "const p=require('./package.json');console.log(p.dependencies.pino,p.dependencies['pino-http'],p.devDependencies['pino-pretty'],p.devDependencies.supertest)"`
Expected: prints four version strings (no `undefined`).

- [ ] **Step 4: Commit**

```bash
cd /var/www/raid
git add package.json package-lock.json
git commit -m "build(raid): add pino, pino-http, pino-pretty, supertest"
```

## Task R2: `lib/logger.js` (CommonJS) + test

**Files:**
- Create: `/var/www/raid/lib/logger.js`
- Test: `/var/www/raid/tests/pino-logger.unit.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/pino-logger.unit.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Writable } = require("node:stream");
const { createLogger, safeUrl } = require("../lib/logger.js");

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
  assert.equal(cap.records()[0].service, "raid");
});

test("redacts token and password at top level and one nesting level", () => {
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
  assert.ok(out.includes("token=[redacted]"));
  assert.equal(safeUrl("/plain"), "/plain");
  assert.ok(!safeUrl("/x?password=topsecretpw").includes("topsecretpw"));
  assert.equal(safeUrl("/p?token=abc#frag"), "/p?token=[redacted]#frag");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /var/www/raid && node --test tests/pino-logger.unit.test.js`
Expected: FAIL — `Cannot find module '../lib/logger.js'`.

- [ ] **Step 3: Write the implementation**

```js
// lib/logger.js — structured logging (pino). CommonJS.
// Reads NODE_ENV / LOG_LEVEL from the environment directly so importing this
// module never depends on app config wiring.
const { pino } = require("pino");

// Defense-in-depth field redaction. Request/response headers are never logged
// (see middleware/requestLogger.js), so cookies/authorization never reach a
// record; these paths catch app-level logs carrying a token/password field.
const REDACT_PATHS = ["token", "*.token", "password", "*.password"];

// Query-string keys whose values safeUrl masks (e.g. magic-link tokens).
const SENSITIVE_QUERY = new Set(["token", "password"]);

// Mask sensitive query param values while preserving the path, every other
// param byte-for-byte, and any #fragment. Targeted replacement (not a
// URLSearchParams round-trip) so "[redacted]" stays readable.
function safeUrl(url) {
  if (typeof url !== "string") return url;
  const q = url.indexOf("?");
  if (q === -1) return url;
  const path = url.slice(0, q);
  const query = url.slice(q + 1);
  const masked = query.replace(/([^&=#?]+)=([^&#]*)/g, (match, key, _val) =>
    SENSITIVE_QUERY.has(decodeURIComponent(key).toLowerCase()) ? `${key}=[redacted]` : match
  );
  return `${path}?${masked}`;
}

function createLogger({ level, pretty = false, stream } = {}) {
  const opts = {
    level: level ?? process.env.LOG_LEVEL ?? "info",
    base: { service: "raid" },
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  };
  // `stream` takes precedence over `pretty` (used by tests for log capture).
  if (stream) return pino(opts, stream);
  if (pretty) return pino({ ...opts, transport: { target: "pino-pretty" } });
  return pino(opts);
}

const logger = createLogger({ pretty: process.env.NODE_ENV === "development" });

module.exports = { logger, createLogger, safeUrl, REDACT_PATHS };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /var/www/raid && node --test tests/pino-logger.unit.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
cd /var/www/raid
git add lib/logger.js tests/pino-logger.unit.test.js
git commit -m "feat(raid): structured logger (pino) with redaction + safeUrl"
```

## Task R3: `middleware/requestLogger.js` (CommonJS) + test

**Files:**
- Create: `/var/www/raid/middleware/requestLogger.js`
- Test: `/var/www/raid/tests/pino-request-logger.unit.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/pino-request-logger.unit.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { Writable } = require("node:stream");
const { createLogger } = require("../lib/logger.js");
const { makeRequestLogger } = require("../middleware/requestLogger.js");

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
  assert.equal(rec.level, 40);
});

test("never logs request headers (cookie stays private)", async () => {
  const { app, cap } = buildApp();
  await request(app).get("/ok").set("Cookie", "raid_session=supersecretcookie");
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

test("ignores an over-long inbound X-Request-Id (generates its own)", async () => {
  const { app } = buildApp();
  const huge = "a".repeat(5000);
  const res = await request(app).get("/ok").set("X-Request-Id", huge);
  assert.notEqual(res.headers["x-request-id"], huge);
  assert.equal(res.headers["x-request-id"].length, 36);
});

test("never logs response headers (Set-Cookie stays private)", async () => {
  const cap = capture();
  const logger = createLogger({ level: "info", stream: cap.stream });
  const app = express();
  app.use(makeRequestLogger(logger));
  app.get("/setcookie", (req, res) => {
    res.setHeader("Set-Cookie", "raid_session=supersecretsession; HttpOnly");
    res.json({ ok: true });
  });
  await request(app).get("/setcookie");
  await tick();
  assert.ok(!cap.text().includes("supersecretsession"));
  const rec = cap.records().find((r) => r.req && r.req.url === "/setcookie");
  assert.ok(rec);
  assert.equal(rec.res.statusCode, 200);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /var/www/raid && node --test tests/pino-request-logger.unit.test.js`
Expected: FAIL — `Cannot find module '../middleware/requestLogger.js'`.

- [ ] **Step 3: Write the implementation**

```js
// middleware/requestLogger.js — per-request structured logging via pino-http. CommonJS.
const { pinoHttp } = require("pino-http");
const { randomUUID } = require("node:crypto");
const { safeUrl } = require("../lib/logger.js");

function makeRequestLogger(logger) {
  return pinoHttp({
    logger,
    genReqId(req, res) {
      const incoming = req.headers["x-request-id"];
      const trimmed = typeof incoming === "string" ? incoming.trim() : "";
      const id = trimmed && trimmed.length <= 128 ? trimmed : randomUUID();
      res.setHeader("X-Request-Id", id);
      return id;
    },
    customLogLevel(req, res, err) {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    serializers: {
      // Log only id/method/url — never request headers — so cookies/authorization can't leak.
      req(req) {
        return { id: req.id, method: req.method, url: safeUrl(req.url) };
      },
      // Log only the status — never response headers — so Set-Cookie (session id) can't leak.
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  });
}

module.exports = { makeRequestLogger };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /var/www/raid && node --test tests/pino-request-logger.unit.test.js`
Expected: PASS — 7 tests, including the two leak guards.

- [ ] **Step 5: Commit**

```bash
cd /var/www/raid
git add middleware/requestLogger.js tests/pino-request-logger.unit.test.js
git commit -m "feat(raid): pino-http request logger (header-free serializers)"
```

## Task R4: `middleware/errorHandler.js` (CommonJS, inline HTML) + test

**Files:**
- Create: `/var/www/raid/middleware/errorHandler.js`
- Test: `/var/www/raid/tests/pino-error-handler.unit.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/pino-error-handler.unit.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { Writable } = require("node:stream");
const { createLogger } = require("../lib/logger.js");
const { makeRequestLogger } = require("../middleware/requestLogger.js");
const { makeErrorHandler } = require("../middleware/errorHandler.js");

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

function appWithBoom({ nodeEnv = "production" } = {}) {
  const cap = capture();
  const logger = createLogger({ level: "info", stream: cap.stream });
  const app = express();
  app.use(makeRequestLogger(logger));
  app.get("/boom", () => { throw new Error("kaboom-secret-detail"); });
  app.get("/api/boom", () => { throw new Error("kaboom-secret-detail"); });
  app.use(makeErrorHandler({ logger, nodeEnv }));
  return { app, cap };
}

test("API/JSON error returns a clean 500 with a reqId and no internal detail", async () => {
  const { app } = appWithBoom();
  const res = await request(app).get("/boom").set("Accept", "application/json");
  assert.equal(res.status, 500);
  assert.equal(res.body.error, "Internal Server Error");
  assert.ok(typeof res.body.reqId === "string" && res.body.reqId.length > 0);
  assert.ok(!JSON.stringify(res.body).includes("kaboom-secret-detail"));
});

test("logs a structured error carrying the same reqId", async () => {
  const { app, cap } = appWithBoom();
  const res = await request(app).get("/boom").set("Accept", "application/json");
  await tick();
  const errRec = cap.records().find((r) => r.msg === "unhandled error");
  assert.ok(errRec, "expected an 'unhandled error' log record");
  assert.equal(errRec.reqId, res.body.reqId);
});

test("HTML error renders an inline page in prod without the stack", async () => {
  const { app } = appWithBoom({ nodeEnv: "production" });
  const res = await request(app).get("/boom");
  assert.equal(res.status, 500);
  assert.match(res.headers["content-type"], /html/);
  assert.ok(res.text.includes("Something went wrong"));
  assert.ok(!res.text.includes("kaboom-secret-detail"));
  assert.ok(res.headers["x-request-id"]);
  assert.ok(res.text.includes(res.headers["x-request-id"]));
  assert.ok(res.text.includes("Reference:"));
});

test("dev mode exposes the error message (JSON)", async () => {
  const { app } = appWithBoom({ nodeEnv: "development" });
  const res = await request(app).get("/boom").set("Accept", "application/json");
  assert.ok(JSON.stringify(res.body).includes("kaboom-secret-detail"));
});

test("/api/* errors return JSON even when the client asks for HTML", async () => {
  const { app } = appWithBoom();
  const res = await request(app).get("/api/boom").set("Accept", "text/html");
  assert.equal(res.status, 500);
  assert.match(res.headers["content-type"], /json/);
  assert.ok(!res.text.includes("kaboom-secret-detail"));
});

test("dev mode HTML error exposes the stack", async () => {
  const { app } = appWithBoom({ nodeEnv: "development" });
  const res = await request(app).get("/boom");
  assert.equal(res.status, 500);
  assert.match(res.headers["content-type"], /html/);
  assert.ok(res.text.includes("kaboom-secret-detail"));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /var/www/raid && node --test tests/pino-error-handler.unit.test.js`
Expected: FAIL — `Cannot find module '../middleware/errorHandler.js'`.

- [ ] **Step 3: Write the implementation**

```js
// middleware/errorHandler.js — central error handler. Mount LAST, after routes. CommonJS.
// Apps have no view engine, so the HTML branch returns a small self-contained page.
const { STATUS_CODES } = require("node:http");

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function errorPage({ message, reqId }) {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>Something went wrong</title></head>` +
    `<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">` +
    `<h1>Something went wrong</h1>` +
    `<p>${escapeHtml(message)}</p>` +
    `<p style="color:#666">Reference: ${escapeHtml(reqId)}</p>` +
    `<p><a href="/">Return home</a></p>` +
    `</body></html>`
  );
}

function makeErrorHandler({ logger, nodeEnv }) {
  const isProd = nodeEnv === "production";
  return function errorHandler(err, req, res, next) {
    const log = req.log || logger;
    const reqId = req.id;
    if (res.headersSent) {
      log.warn({ err, reqId }, "error after headers sent");
      return next(err);
    }
    log.error({ err, reqId }, "unhandled error");

    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(status);

    const wantsJson =
      (typeof req.path === "string" && req.path.startsWith("/api")) ||
      (typeof req.accepts === "function" && req.accepts(["html", "json"]) === "json");

    if (wantsJson) {
      return res.json({ error: isProd ? STATUS_CODES[status] || "Error" : err.message || "Error", reqId });
    }
    const message = isProd ? "An unexpected error occurred." : err.stack || err.message || "Error";
    return res.type("html").send(errorPage({ message, reqId }));
  };
}

module.exports = { makeErrorHandler };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /var/www/raid && node --test tests/pino-error-handler.unit.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
cd /var/www/raid
git add middleware/errorHandler.js tests/pino-error-handler.unit.test.js
git commit -m "feat(raid): central content-negotiated error handler (inline HTML)"
```

## Task R5: Wire into `server.js` + convert runtime console.*

**Files:**
- Modify: `/var/www/raid/server.js`
- Modify: `/var/www/raid/lib/extract.js:45`
- Modify: `/var/www/raid/lib/extractHandler.js:36`

- [ ] **Step 1: Wire middleware into server.js**

In `/var/www/raid/server.js`:

Add to the require block near the top (after the existing requires, ~line 14):

```js
const { logger } = require('./lib/logger.js');
const { makeRequestLogger } = require('./middleware/requestLogger.js');
const { makeErrorHandler } = require('./middleware/errorHandler.js');
```

Mount the request logger immediately after `const app = express();` and the body parser, BEFORE the auth/static/route mounts. Replace lines 30-32:

```js
const app = express();
app.use(makeRequestLogger(logger));
app.use(express.json({ limit: '1mb' }));
app.set('trust proxy', true); // for req.ip behind a reverse proxy
```

Replace the final `app.listen(...)` line (was line 69) with a structured startup line and the error handler mounted LAST (after all routes, before listen):

```js
app.use(makeErrorHandler({ logger, nodeEnv: process.env.NODE_ENV }));

app.listen(PORT, () => logger.info({ port: Number(PORT), model: MODEL }, 'raid listening'));
```

- [ ] **Step 2: Convert runtime console.* in lib**

In `/var/www/raid/lib/extract.js`, add at the top of the require block:

```js
const { logger } = require('./logger.js');
```

Replace line 45:

```js
    logger.warn({ err: err.message }, 'extract attempt 1 failed - retrying once');
```

In `/var/www/raid/lib/extractHandler.js`, add to its require block:

```js
const { logger } = require('./logger.js');
```

Replace line 36 (`req` is in scope in this handler):

```js
      (req.log || logger).error({ err }, 'extract failed twice');
```

- [ ] **Step 3: Boot the app to confirm it starts and logs structured JSON**

Run: `cd /var/www/raid && PORT=3999 NODE_ENV=production timeout 3 node server.js`
Expected: a single JSON line containing `"msg":"raid listening"`, `"service":"raid"`, `"port":3999`. No crash. (Process exits after the timeout.)

- [ ] **Step 4: Run the full raid test suite**

Run: `cd /var/www/raid && npm test`
Expected: all unit tests pass — the pre-existing suite plus the 3 new pino files (17 new tests).

- [ ] **Step 5: Commit**

```bash
cd /var/www/raid
git add server.js lib/extract.js lib/extractHandler.js
git commit -m "feat(raid): wire request logger + error handler; structured runtime logs"
```

## Task R6: Verify + merge raid

- [ ] **Step 1: Full suite green (evidence)**

Run: `cd /var/www/raid && npm test 2>&1 | tail -5`
Expected: `# pass` count > 0, `# fail 0`.

- [ ] **Step 2: Push the feature branch to origin (backup)**

```bash
cd /var/www/raid
git push -u origin feat/raid-pino-observability
```

- [ ] **Step 3: Merge to master locally (no-ff)**

```bash
cd /var/www/raid
git checkout master
git merge --no-ff feat/raid-pino-observability -m "Merge feat/raid-pino-observability: structured logging + central error handler"
```

- [ ] **Step 4: Confirm master is green**

Run: `cd /var/www/raid && npm test 2>&1 | tail -3`
Expected: `# fail 0`.

**raid is now the validated reference.** Its three module files and three test files are the copy-source for Part B.

---

# PART B — swarm signal / poker / retro

Three parallel subagents, one per app. Each follows the **same task template** below, substituting from the per-app table. Each works ONLY in its own repo. After all three return, the main session reviews each and merges it (Part B finalization).

## Per-app substitution table

| Token | signal | poker | retro |
|-------|--------|-------|-------|
| `<DIR>` | `/var/www/signal` | `/var/www/scrumpoker` | `/var/www/retrospective` |
| `<SERVICE>` | `signal` | `poker` | `retro` |
| `<COOKIE>` | `signal_session` | `poker_session` | `retro_session` |
| `<BASE_BRANCH>` | `feat/suite-auth` | `main` | `main` |
| `<BRANCH>` | `feat/signal-pino-observability` | `feat/poker-pino-observability` | `feat/retro-pino-observability` |
| `<TEST_GLOB>` | `tests/*.test.js` | `tests/*.test.js` | (explicit list — see note) |
| `<NEW_TEST_SUFFIX>` | `.test.js` | `.test.js` | `.test.js` |
| `supertest already present?` | no — add devDep | **yes** | no — add devDep |

**retro note:** its `test` script lists files explicitly. After creating the 3 new test files, edit `/var/www/retrospective/package.json` `scripts.test` to append:
`tests/pino-logger.test.js tests/pino-request-logger.test.js tests/pino-error-handler.test.js`

## Subagent task template (per app)

1. **Branch:** `cd <DIR> && git checkout <BASE_BRANCH> && git checkout -b <BRANCH>`. Do NOT touch the app's pre-existing untracked files; never `git add -A`.
2. **Deps:** `npm install pino@^10.3.1 pino-http@^11.0.0` then `npm install --save-dev pino-pretty@^13.1.3`. If `supertest already present?` is "no", also `npm install --save-dev supertest@^7.0.0`. Commit `package.json package-lock.json`.
3. **Copy the 3 modules from raid** (`/var/www/raid/lib/logger.js`, `/var/www/raid/middleware/requestLogger.js`, `/var/www/raid/middleware/errorHandler.js`) into `<DIR>/lib/` and `<DIR>/middleware/` (create `middleware/` if absent). In the copied `lib/logger.js`, change the single line `base: { service: "raid" }` → `base: { service: "<SERVICE>" }`. The other two modules are copied **unchanged**.
4. **Copy the 3 test files from raid** (`tests/pino-logger.unit.test.js`, `tests/pino-request-logger.unit.test.js`, `tests/pino-error-handler.unit.test.js`) into `<DIR>/tests/`, renaming the suffix from `.unit.test.js` to `<NEW_TEST_SUFFIX>` (i.e. `tests/pino-logger.test.js` etc.). In the copied `pino-logger` test, change the service assertion `assert.equal(cap.records()[0].service, "raid")` → `"<SERVICE>"`. In the copied `pino-request-logger` test, change the two cookie strings `raid_session=...` → `<COOKIE>=...` (the assertion is on the secret value, so this is cosmetic but keep it accurate).
5. **(retro only)** edit `package.json` `scripts.test` to append the 3 new test files (see retro note).
6. **Run the 3 new test files** individually to confirm green: `cd <DIR> && node --test tests/pino-logger<NEW_TEST_SUFFIX> tests/pino-request-logger<NEW_TEST_SUFFIX> tests/pino-error-handler<NEW_TEST_SUFFIX>`. Expected: 17 passing tests, 0 failing. Commit the modules + tests.
7. **Wire `<DIR>/server.js`** exactly as raid Task R5 Step 1: require the 3 modules; `app.use(makeRequestLogger(logger))` as the FIRST middleware (right after `const app = express()`, before body parser / auth / static / routes); `app.use(makeErrorHandler({ logger, nodeEnv: process.env.NODE_ENV }))` as the LAST `app.use` (after all routes, before `app.listen`); replace the startup `console.log(...)` with `logger.info({ port: Number(PORT) }, '<SERVICE> listening')`. Match the app's existing variable names (`app`, `PORT`). **Do not move the WebSocket `upgrade`/`server` wiring** — leave it exactly as-is; logging is HTTP-only.
8. **Convert runtime `console.error`/`console.warn`** in the app's route/lib files (NOT `scripts/`, NOT tests, NOT WS message handlers) to `(req.log || logger).error({ err }, '<message>')` where a `req` is in scope, else `logger.error(...)`. Require `logger` where needed. List every conversion you make in your report.
9. **Boot-smoke:** `cd <DIR> && PORT=3998 NODE_ENV=production timeout 3 node server.js` — expect a single JSON line with `"msg":"<SERVICE> listening"` and `"service":"<SERVICE>"`, no crash. (If the app needs an env var to boot — e.g. a DB path — set a throwaway one; report what you set.)
10. **Full suite:** `cd <DIR> && npm test` — ALL tests green (pre-existing + 17 new). Commit `server.js` + converted files.
11. **Push branch:** `cd <DIR> && git push -u origin <BRANCH>`. Do NOT merge to the base branch — the main session does that after review.
12. **Return a structured report:** app name; branch; files created/modified; new test count and full-suite pass/fail counts; confirmation that the "never logs response headers (Set-Cookie)" test passes; the exact list of console.* conversions; the boot-smoke log line; any deviations or env vars set.

## Part B finalization (main session, after the swarm returns)

For each of signal / poker / retro:

- [ ] **Review the subagent report + diff** — confirm: only the expected files changed; `service` name correct; the two leak-guard tests present and passing; WS wiring untouched; no `scripts/` console.* touched; no stray `git add -A`.
- [ ] **Spot-check the no-headers guard** for each: `cd <DIR> && node --test tests/pino-request-logger<suffix> 2>&1 | tail -3` → `# fail 0`.
- [ ] **Merge locally:** `cd <DIR> && git checkout <BASE_BRANCH> && git merge --no-ff <BRANCH> -m "Merge <BRANCH>: structured logging + central error handler"`.
- [ ] **Confirm green on the base branch:** `cd <DIR> && npm test 2>&1 | tail -3` → `# fail 0`.

## Session end state

All 4 apps: pino + error handler merged to their base branches locally, full suites green, feature branches backed up on origin. **No prod deploy** — that's a later session (see spec "Deploy notes"). Update memory with the new state.

---

## Self-review notes

- **Spec coverage:** CommonJS triplet ✓ (R2–R4); header-free serializers / Set-Cookie guard ✓ (R3 + template step 12); inline-HTML error handler for view-engine-less apps ✓ (R4, refinement over spec's `res.render` assumption — documented above); per-app deltas (WS untouched, Express 4 retro, retro explicit test script, supertest presence) ✓ (table + template); console policy ✓ (R5 + step 8); git workflow ✓ (R1/R6 + finalization); swarm mechanics ✓ (Part B). 
- **Refinement vs spec:** spec assumed the hub's `res.render("error")` path; inspection showed no app has a view engine, so the error handler uses inline HTML and the "plain-text fallback" test is dropped (nothing to fall back from). This makes the triplet identical across apps — strengthens, not weakens, the design.
- **Deviation vs spec:** spec listed a process-spawn "boot-smoke" automated test; replaced with (a) the deterministic supertest Set-Cookie guard as the automated regression guard and (b) a manual boot-smoke step (R5 S3 / template step 9). Rationale: spawn-port tests are flaky; the supertest guard covers the same regression deterministically.
- **Type consistency:** module export shape `{ logger, createLogger, safeUrl, REDACT_PATHS }` consumed consistently; `makeRequestLogger(logger)` and `makeErrorHandler({ logger, nodeEnv })` signatures consistent across R3/R4/R5 and the template.
