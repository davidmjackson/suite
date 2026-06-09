# zod Validation Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad-hoc manual input validation with declarative zod schemas across the hub (pilot) and the four apps (swarm), preserving all existing behavior and UX.

**Architecture:** Each repo gets its own tiny `lib/validate.js` Express-middleware factory plus a `schemas/` directory of zod schemas (copy-per-repo, no shared runtime package, no deploy ordering). Schemas become the single source of truth for valid shape + normalization. Form routes re-render with values preserved on failure (parity); `/api/*` routes return 400 JSON `{ error, fields, reqId }`; WebSocket apps validate at the message boundary and drop-and-log malformed messages.

**Tech Stack:** Node ESM, Express 5, zod, Eta views, `node --test` + `supertest`, pino (already present).

---

## Important conventions (read before starting)

- **Test runner:** `npm test` runs `node --test tests/`. Run a single file with `node --test tests/<file>.test.js`.
- **Test app builder:** `tests/helpers.js` `buildTestApp()` returns `{ app, db, config }`. Routes are mounted in each test via `const { mountX } = await import("../routes/x.js?t=" + Date.now()); mountX(app, ...)`. Follow the existing pattern in each `tests/<route>.test.js`.
- **`validate()` reassigns `req.body`** with zod's parsed output. Only use `source: "body"` on the hub — Express 5 makes `req.query` a getter-only and reassigning it throws. The hub's untrusted rich input is all in request bodies; route params (`:id`, `:slug`) stay validated by their existing DB lookups.
- **Behavior parity is the bar.** The existing hub suite (240 tests) encodes current behavior. After each task, the full suite must stay green. If an existing test goes red, the schema/wiring is wrong — fix it, do not edit the test (unless the task explicitly says to).
- **Commit after every task.** Stage explicit paths only — never `git add -A`/`.` in this repo.

---

## File Structure (hub pilot)

- Create: `hub/lib/validate.js` — the `validate(schema, opts)` middleware factory.
- Create: `hub/schemas/request.js`, `hub/schemas/login.js`, `hub/schemas/magic.js`, `hub/schemas/api.js`, `hub/schemas/company.js`, `hub/schemas/admin.js` — one schema module per route group.
- Modify: `hub/middleware/errorHandler.js` — include `err.fields` in the JSON branch.
- Modify: `hub/routes/{request,login,magic,api-sessions,api-apps,company,admin}.js` — replace manual checks with `validate(...)`.
- Create: `hub/tests/validate.test.js` — unit tests for the helper.
- Modify: `hub/tests/error-handler.test.js` — add the `fields` assertion.
- Modify: `hub/package.json` — add `zod` dependency.

---

## Phase 0 — Foundation

### Task 1: Add zod and the `validate()` helper

**Files:**
- Modify: `hub/package.json` (add dependency)
- Create: `hub/lib/validate.js`
- Create: `hub/tests/validate.test.js`

- [ ] **Step 1: Install zod**

Run (from `hub/`): `npm install zod`
Expected: `zod` appears under `dependencies` in `package.json`, `package-lock.json` updated.

- [ ] **Step 2: Write the failing test**

Create `hub/tests/validate.test.js`:

```js
// tests/validate.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { validate } from "../lib/validate.js";

function run(mw, req) {
  return new Promise((resolve) => {
    const res = {};
    let nextErr = "no-next";
    mw(req, res, (err) => { nextErr = err; resolve({ req, res, nextErr }); });
    // synchronous safeParse path resolves via next(); onInvalid path resolves below
    if (req._resolvedByOnInvalid) resolve({ req, res, nextErr });
  });
}

test("validate: on success replaces req.body with parsed/coerced data and calls next()", async () => {
  const schema = z.object({ email: z.preprocess((v) => String(v).trim().toLowerCase(), z.string()) });
  const { req, nextErr } = await run(validate(schema), { body: { email: "  A@B.COM ", extra: "x" } });
  assert.equal(nextErr, undefined); // next() with no arg
  assert.deepEqual(req.body, { email: "a@b.com" }); // unknown key "extra" stripped
});

test("validate: on failure with no onInvalid calls next(err) with status 400 and fields", async () => {
  const schema = z.object({ email: z.string().email() });
  const { nextErr } = await run(validate(schema), { body: { email: "nope" } });
  assert.equal(nextErr.status, 400);
  assert.ok(nextErr.fields.email, "fieldErrors include email");
});

test("validate: on failure with onInvalid calls it instead of next()", async () => {
  const schema = z.object({ email: z.string().email() });
  let called = false;
  const onInvalid = (req, res) => { called = true; req._resolvedByOnInvalid = true; };
  const { nextErr } = await run(validate(schema, { onInvalid }), { body: { email: "nope" } });
  assert.equal(called, true);
  assert.equal(nextErr, "no-next"); // next was never called
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `node --test tests/validate.test.js`
Expected: FAIL — `Cannot find module '../lib/validate.js'`.

- [ ] **Step 4: Implement the helper**

Create `hub/lib/validate.js`:

```js
// lib/validate.js — zod request-body validation middleware.
// validate(schema, { onInvalid }) -> Express middleware.
// On success: req.body is replaced with zod's parsed (coerced, unknown-key-stripped) output.
// On failure: if onInvalid(req, res, error) is given it is called (form routes re-render);
//   otherwise next(err) with err.status=400 and err.fields = flattened field errors (JSON routes).
export function validate(schema, { source = "body", onInvalid } = {}) {
  return function validateMiddleware(req, res, next) {
    const result = schema.safeParse(req[source]);
    if (result.success) {
      req[source] = result.data;
      return next();
    }
    if (onInvalid) return onInvalid(req, res, result.error);
    const err = new Error("validation_failed");
    err.status = 400;
    err.fields = result.error.flatten().fieldErrors;
    return next(err);
  };
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `node --test tests/validate.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add hub/lib/validate.js hub/tests/validate.test.js hub/package.json hub/package-lock.json
git commit -m "feat(hub): add zod and validate() middleware helper"
```

---

### Task 2: Error handler includes field errors in JSON responses

**Files:**
- Modify: `hub/middleware/errorHandler.js`
- Modify: `hub/tests/error-handler.test.js`

- [ ] **Step 1: Write the failing test**

Add to `hub/tests/error-handler.test.js` (follow the file's existing app-building pattern; the snippet below shows the assertion shape — adapt the route-mount to match the file):

```js
test("error handler surfaces err.fields in the JSON body for /api routes", async () => {
  const { app } = await buildTestApp();
  app.post("/api/echo", (req, res, next) => {
    const err = new Error("validation_failed");
    err.status = 400;
    err.fields = { email: ["A valid email is required"] };
    next(err);
  });
  app.use(makeErrorHandler({ logger: silentLogger, nodeEnv: "production" }));
  const res = await request(app).post("/api/echo").send({});
  assert.equal(res.status, 400);
  assert.deepEqual(res.body.fields, { email: ["A valid email is required"] });
});
```

(Reuse whatever `makeErrorHandler` import + `silentLogger`/logger stub the existing tests in this file already use.)

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --test tests/error-handler.test.js`
Expected: FAIL — `res.body.fields` is `undefined`.

- [ ] **Step 3: Implement — add fields to the JSON branch**

In `hub/middleware/errorHandler.js`, change the JSON response line:

```js
    if (wantsJson) {
      const body = { error: isProd ? STATUS_CODES[status] || "Error" : err.message || "Error", reqId };
      if (err.fields) body.fields = err.fields;
      return res.json(body);
    }
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test tests/error-handler.test.js`
Expected: PASS (existing tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add hub/middleware/errorHandler.js hub/tests/error-handler.test.js
git commit -m "feat(hub): surface zod field errors in JSON error responses"
```

---

## Phase 1 — Hub route migration (one route group per task)

Each task: write/extend the schema, wire `validate()` into the route, confirm the existing suite for that route stays green, commit. The existing `tests/<route>.test.js` files already assert current behavior — they are the regression guard.

### Task 3: `/request` (form route, the worked form exemplar)

**Files:**
- Create: `hub/schemas/request.js`
- Modify: `hub/routes/request.js`
- Test guard: `hub/tests/request.test.js` (existing — must stay green)

- [ ] **Step 1: Write the schema**

Create `hub/schemas/request.js`:

```js
// schemas/request.js — POST /request access-request body.
import { z } from "zod";

export const APP_KEYS = ["poker", "retro", "signal", "raid"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const trim = (v) => (typeof v === "string" ? v.trim() : v);
const optionalText = z.preprocess(
  (v) => { const t = trim(v); return t === "" || t == null ? null : t; },
  z.string().nullable()
).default(null);

export const requestSchema = z.object({
  company_name: z.preprocess(trim, z.string().min(1)),
  contact_name: z.preprocess(trim, z.string().min(1)),
  email: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.string().regex(EMAIL_RE)
  ),
  job_title: optionalText,
  team_size: optionalText,
  message: optionalText,
  apps: z.preprocess(
    (v) => {
      let a = v;
      if (typeof a === "string") a = [a];
      return Array.isArray(a) ? a.filter((x) => APP_KEYS.includes(x)) : [];
    },
    z.array(z.enum(APP_KEYS))
  ).default([]),
});
```

- [ ] **Step 2: Write a failing test for coercion**

Add to `hub/tests/request.test.js`:

```js
test("POST /request normalizes email case + whitespace and stores cleaned values", async () => {
  const { app, db } = await setup();
  await request(app).post("/request").type("form").send({
    company_name: "  Acme  ", contact_name: " Jo ", email: "  JO@ACME.COM ", apps: "poker",
  });
  const row = db.prepare("SELECT * FROM access_requests WHERE email=?").get("jo@acme.com");
  assert.equal(row.company_name, "Acme");
  assert.equal(row.contact_name, "Jo");
  assert.equal(JSON.parse(row.apps_interest).length, 1);
});
```

- [ ] **Step 3: Run it, verify it fails**

Run: `node --test tests/request.test.js`
Expected: FAIL — the current route stores `"  Acme  "`/`" Jo "` untrimmed-of-internal... actually current code already trims; this test pins the behavior. If it already passes, proceed (it documents the schema contract).

- [ ] **Step 4: Wire validate() into the route**

In `hub/routes/request.js`, replace the manual parsing/validation. The honeypot + rate-limit MUST stay ahead of `validate`:

```js
import { createAccessRequests } from "../lib/access-requests.js";
import { createLimiter } from "../lib/rate-limit.js";
import { createAuditLogger } from "../lib/audit.js";
import { validate } from "../lib/validate.js";
import { requestSchema, APP_KEYS } from "../schemas/request.js";
import logger from "../lib/logger.js";

const ipLimiter = createLimiter({ max: 5, windowMs: 60 * 60 * 1000 });

function requestInvalid(req, res) {
  const b = req.body || {};
  let apps = b.apps;
  if (typeof apps === "string") apps = [apps];
  apps = Array.isArray(apps) ? apps.filter((a) => APP_KEYS.includes(a)) : [];
  return res.status(400).render("request", {
    error: "Please provide a company, your name, and a valid email.",
    values: {
      company_name: (b.company_name || "").trim(),
      contact_name: (b.contact_name || "").trim(),
      email: (b.email || "").trim().toLowerCase(),
      job_title: (b.job_title || "").trim() || null,
      team_size: (b.team_size || "").trim() || null,
      message: (b.message || "").trim() || null,
      apps,
    },
  });
}

export function mountRequest(app, { emailSender } = {}) {
  const db = app.locals.db;
  const config = app.locals.config;
  const reqs = createAccessRequests(db);
  const audit = createAuditLogger(db);

  app.get("/request", (req, res) => {
    res.render("request", { error: null, values: {} });
  });

  function honeypotAndLimit(req, res, next) {
    if ((req.body.website || "").trim() !== "") {
      return res.render("request-received", {});
    }
    if (!ipLimiter.check(req.ip)) {
      return res.status(429).render("error", { title: "Too many requests", message: "Please wait a little while and try again." });
    }
    next();
  }

  app.post("/request", honeypotAndLimit, validate(requestSchema, { onInvalid: requestInvalid }), async (req, res) => {
    const { company_name, contact_name, email, job_title, team_size, message, apps } = req.body;
    reqs.createRequest({ companyName: company_name, contactName: contact_name, email, jobTitle: job_title, teamSize: team_size, appsInterest: apps, message });
    audit.log({ userId: null, eventType: "access_requested", metadata: { company: company_name, email }, ip: req.ip });

    if (config && config.adminEmail && emailSender) {
      try {
        await emailSender.sendAccessRequestNotification({
          to: config.adminEmail,
          request: { companyName: company_name, contactName: contact_name, email, jobTitle: job_title, teamSize: team_size, apps, message },
          reviewUrl: `${config.baseUrl}/admin/companies`,
        });
      } catch (err) {
        (req.log || logger).error({ err }, "access request notification failed");
      }
    }
    res.render("request-received", {});
  });
}
```

- [ ] **Step 5: Run the full request suite, verify green**

Run: `node --test tests/request.test.js`
Expected: PASS — all existing tests (honeypot 200, invalid-email 400 + nothing stored, rate-limit, valid store) + the new coercion test.

- [ ] **Step 6: Commit**

```bash
git add hub/schemas/request.js hub/routes/request.js hub/tests/request.test.js
git commit -m "feat(hub): zod-validate POST /request (form parity)"
```

---

### Task 4: `/login` (form route)

**Files:**
- Create: `hub/schemas/login.js`
- Modify: `hub/routes/login.js`
- Test guard: `hub/tests/login.test.js`

- [ ] **Step 1: Write the schema**

Create `hub/schemas/login.js`:

```js
// schemas/login.js — POST /login body. return_to is host-validated in the route
// (needs config.allowedAppDomains), so the schema only normalizes email + passes return_to through.
import { z } from "zod";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const loginSchema = z.object({
  email: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.string().regex(EMAIL_RE)
  ),
  return_to: z.string().optional().default(""),
});
```

- [ ] **Step 2: Run the login suite first to capture the baseline**

Run: `node --test tests/login.test.js`
Expected: PASS (baseline before change).

- [ ] **Step 3: Wire validate() into the route**

In `hub/routes/login.js`: keep `validateReturnTo()` and the rate limiters. Replace the inline email check with the schema. The route still computes `returnTo` from `req.body.return_to` via `validateReturnTo` (host allow-list), and the rate-limit stays after validation:

```js
import { validate } from "../lib/validate.js";
import { loginSchema } from "../schemas/login.js";
// ...
  function loginInvalid(req, res) {
    return res.status(400).render("error", { title: "Bad request", message: "Invalid email." });
  }

  app.post("/login", validate(loginSchema, { onInvalid: loginInvalid }), async (req, res) => {
    const email = req.body.email; // already trimmed + lowercased + regex-valid
    const returnTo = validateReturnTo(req.body.return_to, config.allowedAppDomains);
    const ip = req.ip;

    if (!ipLimiter.check(ip) || !emailLimiter.check(email)) {
      return res.status(429).render("error", { title: "Too many requests", message: "Please wait a minute and try again." });
    }
    // ... unchanged: lookup user, issue magic link, render check-email ...
  });
```

- [ ] **Step 4: Run the login suite, verify green**

Run: `node --test tests/login.test.js`
Expected: PASS — invalid email still 400, valid email still issues a link, rate-limit unchanged.

- [ ] **Step 5: Commit**

```bash
git add hub/schemas/login.js hub/routes/login.js
git commit -m "feat(hub): zod-validate POST /login"
```

---

### Task 5: `/auth/magic` POST (form route, token field)

**Files:**
- Create: `hub/schemas/magic.js`
- Modify: `hub/routes/magic.js`
- Test guard: `hub/tests/magic.test.js`

- [ ] **Step 1: Write the schema**

Create `hub/schemas/magic.js`:

```js
// schemas/magic.js — POST /auth/magic body. Token must be a non-empty string.
import { z } from "zod";
export const magicPostSchema = z.object({
  token: z.string().min(1),
});
```

- [ ] **Step 2: Wire validate() into the POST route only**

In `hub/routes/magic.js`, the GET handler keeps its inline `req.query.token` check (query-source; not reassigned). Replace the POST's manual token check:

```js
import { validate } from "../lib/validate.js";
import { magicPostSchema } from "../schemas/magic.js";
// ...
  function magicInvalid(req, res) {
    return res.status(400).render("error", { title: "Invalid link", message: "This sign-in link is malformed." });
  }

  app.post("/auth/magic", validate(magicPostSchema, { onInvalid: magicInvalid }), (req, res) => {
    const token = req.body.token; // non-empty string, guaranteed
    // ... unchanged: atomic consume, session create, redirect ...
  });
```

- [ ] **Step 3: Run the magic suite, verify green**

Run: `node --test tests/magic.test.js`
Expected: PASS — malformed/missing token still 400, expired still 400, valid token still logs in.

- [ ] **Step 4: Commit**

```bash
git add hub/schemas/magic.js hub/routes/magic.js
git commit -m "feat(hub): zod-validate POST /auth/magic"
```

---

### Task 6: `/api/*` (JSON routes, the worked JSON exemplar)

**Files:**
- Create: `hub/schemas/api.js`
- Modify: `hub/routes/api-sessions.js`, `hub/routes/api-apps.js`
- Modify: `hub/server.js` (mount the error handler — already mounted; verify api routes reach it)
- Test guards: `hub/tests/api-sessions-exchange.test.js`, `hub/tests/api-apps-consume.test.js`

> **Behavior note:** the current API routes return bespoke error codes, e.g.
> `{ error: "missing_launch_token" }` and `{ ok: false, reason: "missing_central_session_id" }`,
> both with status 400. The existing tests assert those exact bodies. To keep them green,
> KEEP the bespoke missing-field guards as-is and use zod only to enforce the field is a
> string when present. Do NOT route these through the central `err.fields` handler (it would
> change the response body). This task therefore tightens types without changing the wire contract.

- [ ] **Step 1: Write the schema**

Create `hub/schemas/api.js`:

```js
// schemas/api.js — JSON API bodies. These routes keep their bespoke 400 bodies
// (asserted by existing tests); schemas coerce/trim only.
import { z } from "zod";

export const exchangeSchema = z.object({
  launch_token: z.string().trim().min(1),
});

export const consumeSchema = z.object({
  central_session_id: z.string().trim().min(1),
});
```

- [ ] **Step 2: Apply schema-as-guard without changing the response body**

In `hub/routes/api-sessions.js`, replace `const { launch_token } = req.body || {};` + the missing check with a safeParse that preserves the exact existing 400 body:

```js
import { exchangeSchema } from "../schemas/api.js";
// ...
    const parsed = exchangeSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: "missing_launch_token" });
    const { launch_token } = parsed.data;
```

In `hub/routes/api-apps.js`, similarly:

```js
import { consumeSchema } from "../schemas/api.js";
// ...
    const parsed = consumeSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ ok: false, reason: "missing_central_session_id" });
    const { central_session_id } = parsed.data;
```

- [ ] **Step 3: Run the api suites, verify green**

Run: `node --test tests/api-sessions-exchange.test.js tests/api-apps-consume.test.js tests/api-sessions-heartbeat.test.js`
Expected: PASS — bodies unchanged, missing-field still 400 with the same `error`/`reason`.

- [ ] **Step 4: Add a test proving the central JSON `fields` path (forward-looking exemplar)**

This documents the generic JSON path for apps that adopt `validate()` without a bespoke body. Add to `hub/tests/validate.test.js` is not possible (no app); instead add a focused route test in a new file `hub/tests/api-validate-fields.test.js`:

```js
// tests/api-validate-fields.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { z } from "zod";
import { buildTestApp } from "./helpers.js";
import { validate } from "../lib/validate.js";
import { makeErrorHandler } from "../middleware/errorHandler.js";

test("generic validate() -> central handler returns 400 JSON with fields for /api", async () => {
  const { app, config } = await buildTestApp();
  app.post("/api/demo", validate(z.object({ email: z.string().email() })), (req, res) => res.json({ ok: true }));
  app.use(makeErrorHandler({ logger: { error() {}, warn() {} }, nodeEnv: config.nodeEnv }));
  const res = await request(app).post("/api/demo").send({ email: "nope" });
  assert.equal(res.status, 400);
  assert.ok(res.body.fields.email);
});
```

- [ ] **Step 5: Run it, verify green**

Run: `node --test tests/api-validate-fields.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add hub/schemas/api.js hub/routes/api-sessions.js hub/routes/api-apps.js hub/tests/api-validate-fields.test.js
git commit -m "feat(hub): zod-guard JSON API bodies + central fields exemplar"
```

---

### Task 7: `/company/*` (form routes)

**Files:**
- Create: `hub/schemas/company.js`
- Modify: `hub/routes/company.js`
- Test guard: `hub/tests/company.test.js`

- [ ] **Step 1: Write the schemas**

Create `hub/schemas/company.js`:

```js
// schemas/company.js — company console form bodies.
import { z } from "zod";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const inviteMemberSchema = z.object({
  email: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.string().regex(EMAIL_RE)),
  role: z.enum(["owner", "member"]).default("member"),
});

export const memberRoleSchema = z.object({
  role: z.enum(["owner", "member"]),
});

export const teamNameSchema = z.object({
  name: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1)),
});

export const teamMemberSchema = z.object({
  userId: z.string().min(1),
});

export const memberAppActionSchema = z.object({
  action: z.enum(["grant", "revoke"]),
});
```

- [ ] **Step 2: Wire each route with its `onInvalid` preserving the existing message**

In `hub/routes/company.js`, replace each manual check. The existing routes render `error` views with specific titles/messages — preserve them via `onInvalid`. Examples:

```js
import { validate } from "../lib/validate.js";
import { inviteMemberSchema, memberRoleSchema, teamNameSchema, teamMemberSchema, memberAppActionSchema } from "../schemas/company.js";

const badReq = (title, message) => (req, res) => res.status(400).render("error", { title, message });

// invite member
app.post("/company/:slug/members", ...manage,
  validate(inviteMemberSchema, { onInvalid: badReq("Bad request", "Invalid email.") }),
  (req, res) => {
    const { email, role } = req.body;
    const r = org.inviteCompanyMember({ email, companyId: req.company.id, role });
    // ... unchanged ...
  });

// set role
app.post("/company/:slug/members/:userId/role", ...manage,
  validate(memberRoleSchema, { onInvalid: badReq("Bad request", "Invalid role.") }),
  (req, res) => {
    const role = req.body.role;
    // ... unchanged (target lookup, last_owner catch) ...
  });

// create team
app.post("/company/:slug/teams", ...manage,
  validate(teamNameSchema, { onInvalid: badReq("Bad request", "Team name is required.") }),
  (req, res) => { const name = req.body.name; /* ... unchanged ... */ });

// rename team — loadTeam() runs inside the handler (needs req.params), so validate first:
app.post("/company/:slug/teams/:teamId/rename", ...manage,
  validate(teamNameSchema, { onInvalid: badReq("Bad request", "Team name is required.") }),
  (req, res) => { const team = loadTeam(req, res); if (!team) return; const name = req.body.name; /* ... */ });

// add team member
app.post("/company/:slug/teams/:teamId/members", ...manage,
  validate(teamMemberSchema, { onInvalid: badReq("Can't add", "That person is not a member of this company.") }),
  (req, res) => { const team = loadTeam(req, res); if (!team) return; const userId = req.body.userId; /* ... */ });

// app grant/revoke — the "unknown app" + "owner" + "not member" checks stay in the handler;
// schema only validates action:
app.post("/company/:slug/members/:userId/apps/:app", ...manage,
  validate(memberAppActionSchema, { onInvalid: badReq("Bad request", "Unknown action.") }),
  (req, res) => { const action = req.body.action; /* ... unchanged spec/target/owner checks ... */ });
```

> Leave the `TOGGLABLE_APPS[appName]` "not granted per-member" check and the owner/membership
> checks in the handler — they depend on DB state, not body shape.

- [ ] **Step 3: Run the company suite, verify green**

Run: `node --test tests/company.test.js`
Expected: PASS — invalid email/role/empty-name still 400 with the same titles; valid paths unchanged.

- [ ] **Step 4: Commit**

```bash
git add hub/schemas/company.js hub/routes/company.js
git commit -m "feat(hub): zod-validate company console forms"
```

---

### Task 8: `/admin/*` (form routes)

**Files:**
- Create: `hub/schemas/admin.js`
- Modify: `hub/routes/admin.js`
- Test guards: `hub/tests/admin-users.test.js`, `hub/tests/admin-companies.test.js`

- [ ] **Step 1: Write the schemas**

Create `hub/schemas/admin.js`:

```js
// schemas/admin.js — admin console form bodies.
import { z } from "zod";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const trim = (v) => (typeof v === "string" ? v.trim() : v);

export const createUserSchema = z.object({
  email: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.string().regex(EMAIL_RE)),
  display_name: z.preprocess((v) => { const t = trim(v); return t === "" || t == null ? null : t; }, z.string().nullable()).default(null),
  is_admin: z.preprocess((v) => (v === "1" ? 1 : 0), z.union([z.literal(0), z.literal(1)])).default(0),
});

export const rejectRequestSchema = z.object({
  review_note: z.preprocess((v) => { const t = trim(v); return t === "" || t == null ? null : t; }, z.string().nullable()).default(null),
});
```

- [ ] **Step 2: Wire the routes**

In `hub/routes/admin.js`:

```js
import { validate } from "../lib/validate.js";
import { createUserSchema, rejectRequestSchema } from "../schemas/admin.js";

const badReq = (title, message) => (req, res) => res.status(400).render("error", { title, message });

app.post("/admin/users", requireSession, requireAdmin,
  validate(createUserSchema, { onInvalid: badReq("Bad request", "Invalid email.") }),
  (req, res) => {
    const { email, display_name: displayName, is_admin: isAdmin } = req.body;
    // ... unchanged: INSERT, UNIQUE catch ...
  });

app.post("/admin/requests/:id/reject", requireSession, requireAdmin,
  validate(rejectRequestSchema), // no onInvalid: review_note is optional, can't fail; defaults null
  (req, res) => {
    const note = req.body.review_note;
    // ... unchanged ...
  });
```

> The `:id/disable`, `:id/enable`, `:id/delete`, `:id/approve`, `sessions/:id/kill` routes take
> no body (only route params + DB state) — leave them unchanged.

- [ ] **Step 3: Run the admin suites, verify green**

Run: `node --test tests/admin-users.test.js tests/admin-companies.test.js`
Expected: PASS — invalid email still 400, is_admin "1"→admin, duplicate-email UNIQUE path unchanged.

- [ ] **Step 4: Commit**

```bash
git add hub/schemas/admin.js hub/routes/admin.js
git commit -m "feat(hub): zod-validate admin console forms"
```

---

### Task 9: Full hub suite green + branch handoff

**Files:** none (verification + integration)

- [ ] **Step 1: Run the ENTIRE hub suite**

Run (from `hub/`): `npm test`
Expected: PASS — all 240 existing tests + the new validate/error-handler/api-validate tests. Record the new total.

- [ ] **Step 2: Manual smoke (optional but recommended)**

Run: `node server.js` in one terminal; in another, `curl -s -X POST localhost:PORT/login -d 'email=bad' -w '\n'` → expect the 400 "Invalid email" page; `curl -s -X POST localhost:PORT/api/sessions/exchange -H 'x-api-key: <key>' -H 'content-type: application/json' -d '{}' -w '\n'` → expect `{"error":"missing_launch_token"}`.

- [ ] **Step 3: Request code review**

Use superpowers:requesting-code-review on the branch before merge (two-stage: spec-intent review, then implementation review). Address findings via superpowers:receiving-code-review.

- [ ] **Step 4: Merge + push backup branch**

Per the user's git workflow: push the feature branch to origin as an off-machine backup, then local `--no-ff` merge to `main` and push `main`. Do NOT open a PR for solo work unless asked.

```bash
git push -u origin feat/hub-zod-validation
git checkout main
git merge --no-ff feat/hub-zod-validation
git push origin main
```

---

## Phase 2 — Swarm to the 4 apps

The reviewed hub `lib/validate.js` + the `schemas/` convention + the error-handler tweak are the reference. Dispatch one agent per app (parallel, separate repos = no conflict) using superpowers:dispatching-parallel-agents. Each agent runs the per-app task template below in its repo.

**Repos / services:**
- raid — `/var/www/raid`, svc `raid`, :3003 (HTTP only)
- signal — `/var/www/signal`, branch `feat/suite-auth`, svc `signal`, :3002 (HTTP only)
- scrumpoker (poker) — `/var/www/scrumpoker`, :3000 (HTTP + **WS**)
- retrospective (retro) — `/var/www/retrospective`, :3001 (HTTP + **WS**)

### Per-app task template (each agent)

- [ ] **Step 1: Install zod + copy the helper**

From the app repo: `npm install zod`. Copy `hub/lib/validate.js` to the app's `lib/validate.js` verbatim (adjust only the import path style if the app differs). If the app has no `lib/`, place it where the app keeps middleware.

- [ ] **Step 2: Enumerate input surfaces**

`grep -rn "req.body\|req.query\|JSON.parse" routes src` (paths per app). List every HTTP route that reads a body and — for poker/retro — every WebSocket message type handled. Produce the route/message inventory before writing schemas.

- [ ] **Step 3: HTTP schemas + wire (TDD)**

For each body-reading route, create a schema in `schemas/<group>.js` and wire `validate(schema, { onInvalid })` (form routes) or `validate(schema)` (JSON routes) exactly as the hub does. Write a test per schema (valid/invalid/coercion) and a route test (bad input → 400 / re-render). Match the app's existing test runner.

- [ ] **Step 4: Error-handler tweak (HTTP)**

If the app has a central error handler (raid does, from the pino slice), apply the same `if (err.fields) body.fields = err.fields;` change in its JSON branch. If the app has no central handler, add one mirroring `hub/middleware/errorHandler.js` (it should already have one from the pino rollout — verify).

- [ ] **Step 5 (poker + retro only): WebSocket message validation**

Create `schemas/ws.js` with a per-message-type registry and a `validateMessage` helper:

```js
// schemas/ws.js
import { z } from "zod";
// One schema per message type. Fill in real types from the Step-2 inventory.
const SCHEMAS = {
  // vote:   z.object({ roomId: z.string().min(1), value: z.string().min(1) }),
  // reveal: z.object({ roomId: z.string().min(1) }),
};
export function validateMessage(type, payload) {
  const schema = SCHEMAS[type];
  if (!schema) return { ok: false, error: new Error("unknown_message_type") };
  const r = schema.safeParse(payload);
  return r.success ? { ok: true, data: r.data } : { ok: false, error: r.error };
}
```

At the socket message boundary, wrap parse + dispatch (drop + log on any failure, socket stays open):

```js
import logger from "../lib/logger.js"; // the app's existing pino logger
import { validateMessage } from "../schemas/ws.js";

ws.on("message", (raw) => {
  let msg;
  try { msg = JSON.parse(raw); }
  catch (err) { logger.warn({ err }, "invalid ws json"); return; } // drop
  const { ok, data, error } = validateMessage(msg.type, msg.payload ?? msg);
  if (!ok) { logger.warn({ err: error, type: msg.type }, "invalid ws payload"); return; } // drop
  dispatch(msg.type, data, ws); // existing handler now receives validated data
});
```

Write a WS test: a malformed payload is dropped (handler not invoked / room state unchanged), socket stays open. Match the app's existing WS test harness.

- [ ] **Step 6: Full app suite green + commit + branch**

Run the app's full test suite — must stay green. Commit on a feature branch (`feat/<app>-zod-validation`), push to origin as backup, local `--no-ff` merge to the app's main/deploy branch.

### Deploy (after all swarm branches merge)

Per app, independently, **one command at a time** (no ordering constraint — copy-per-repo, zero runtime coupling). For each app: pull → `npm install` (zod is a new dep) → restart service → health-check 200 with `-w '\n'`. Follow the step-by-step shell rules (one short command per block, `---` fences, no `&&`).

---

## Self-review notes

- **Spec coverage:** validate helper (Task 1) ✓; form parity onInvalid (Tasks 3,4,5,7,8) ✓; JSON 400+fields (Task 2 + Task 6 exemplar) ✓; WS drop+log (Phase 2 Step 5) ✓; copy-per-repo (Phase 2 Step 1) ✓; no deploy ordering (Deploy section) ✓; 240 tests stay green (Task 9) ✓.
- **API contract caveat:** Task 6 deliberately keeps the bespoke `error`/`reason` bodies rather than routing through `err.fields`, because existing tests assert them. New app JSON routes without that legacy can use the generic `validate()` → fields path (Task 6 Step 4 exemplar).
- **Express 5 caveat:** `validate()` only reassigns `req.body`; `req.query`/`req.params` are getter-only and are not reassigned. Hub validation is body-only.
- **Type consistency:** the helper signature `validate(schema, { source, onInvalid })`, `err.status`/`err.fields`, and schema export names are used identically across all tasks.
