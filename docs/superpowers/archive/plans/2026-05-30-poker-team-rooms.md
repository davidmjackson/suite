# Poker Team-Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace poker's shared team-access-key WebSocket auth with hub identity, scoping ephemeral rooms to identity-v2 teams, enforcing the per-company `poker` entitlement, and validating the session on the WS upgrade.

**Architecture:** Two authorization layers — identity (auth-client + hub: logged-in + `poker`-entitled) gates the page and the WS upgrade; tenancy (poker, in-process: `teamId ∈ ws.teams`) scopes the room as `${teamId}-${roomName}`. The hub `exchange` is extended to return the user's teams within the entitled company; the auth-client persists `entitled` + `teams` on the session and exposes `verifySession(cookieHeader)` for the WS upgrade gate. No per-join hub calls.

**Tech Stack:** Node.js, Express 5, `ws`, better-sqlite3, `node --test`, supertest (hub + new poker httpApp tests), Playwright (poker e2e). Two repos: `/var/www/suite` (hub ESM + shared CJS auth-client) and `/var/www/scrumpoker` (poker CJS).

**Spec:** `docs/superpowers/specs/2026-05-30-poker-team-rooms-design.md`

**Repo / branch strategy:**
- Phase A (Tasks 1–6) commits to **`/var/www/suite`** on a branch `feat/poker-teams-contract` (hub + auth-client; additive, raid/signal unaffected).
- Phase B (Tasks 7–15) commits to **`/var/www/scrumpoker`** on a branch `feat/suite-auth`.
- Phase A must merge (or at least be present on the auth-client symlink) before Phase B integration tests pass, because poker consumes the new `verifySession` + `req.user.teams`.

**Note on dates/tags:** `git tag` commands use fixed tag names (no date interpolation).

---

## File Structure

**`/var/www/suite` (Phase A):**
- Modify `hub/lib/org.js` — add `teamsForUser(userId, companyId)`.
- Modify `hub/routes/api-sessions.js` — exchange returns `teams`.
- Modify `shared/auth-client/lib/sessions-db.js` — `entitled` + `teams` columns; `create` persists; `get` parses.
- Modify `shared/auth-client/handlers/launch.js` — persist `entitled` + `teams`.
- Modify `shared/auth-client/middleware.js` — `attachUser` adds `entitled` + `teams`.
- Create `shared/auth-client/lib/verify-session.js` — `createVerifySession(ctx)`.
- Modify `shared/auth-client/lib/factory.js` — wire `verifySession` into the returned client.
- Tests: `hub/tests/org.test.js`, `hub/tests/api-sessions-exchange.test.js`, `shared/auth-client/tests/sessions-db.test.js`, `.../middleware.test.js`, `.../launch.test.js`, new `.../verify-session.test.js`.

**`/var/www/scrumpoker` (Phase B):**
- Modify `lib/wsHandlers.js` — `handleLogin` team-based.
- Create `lib/upgradeAuth.js` — `authenticateUpgrade(verifySession, cookieHeader)`.
- Modify `lib/wsServer.js` — `noServer` + upgrade gate; drop rate limiter.
- Modify `lib/httpApp.js` — auth routes, `requireAuth` + entitled gate on `/`, `/api/me`; delete admin plane.
- Modify `server.js` — build + inject the auth client; drop keys/admin wiring.
- Modify `public/index.html`, `public/js/app.js` — team dropdown; remove access-key/admin; new login payload; 401 reload; heartbeat.
- Delete `lib/accessKeys.js`, `lib/loginRateLimiter.js`, `lib/adminActivity.js`, `manageKeys.js`, `keys.json`, `public/admin.html`, `public/js/admin.js`.
- Tests: update `tests/ws-handlers.test.js`; new `tests/upgrade-auth.test.js`, `tests/http-app.test.js`; e2e rewrite under `tests/e2e/`; delete `tests/access-keys.test.js`, `tests/admin-activity.test.js`, `tests/login-rate-limiter.test.js`, `tests/e2e/admin-key-management.spec.js`.

---

# Phase A — Hub + auth-client contract (`/var/www/suite`)

## Task 1: Hub `org.teamsForUser(userId, companyId)`

**Files:**
- Modify: `hub/lib/org.js`
- Test: `hub/tests/org.test.js`

- [ ] **Step 1: Branch**

```bash
cd /var/www/suite
git checkout -b feat/poker-teams-contract
```

- [ ] **Step 2: Write the failing test**

Append to `hub/tests/org.test.js` (match the existing import/`openDb(":memory:")` setup already used in that file):

```js
test("teamsForUser returns the user's teams in a company with their role, excluding others", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "u1@x.y", now());
  const c1 = org.createCompany({ name: "C1", slug: "c1" });
  const c2 = org.createCompany({ name: "C2", slug: "c2" });
  org.addCompanyMember({ userId: "u1", companyId: c1.id, role: "member" });
  org.addCompanyMember({ userId: "u1", companyId: c2.id, role: "member" });
  const tA = org.createTeam({ companyId: c1.id, name: "Alpha" });
  const tB = org.createTeam({ companyId: c1.id, name: "Bravo" }); // user NOT a member
  const tC = org.createTeam({ companyId: c2.id, name: "Charlie" }); // other company
  org.addTeamMember({ userId: "u1", teamId: tA.id, role: "lead" });
  org.addTeamMember({ userId: "u1", teamId: tC.id, role: "member" });

  const teams = org.teamsForUser("u1", c1.id);
  assert.deepEqual(teams, [{ id: tA.id, name: "Alpha", role: "lead" }]);
  assert.equal(teams.find((t) => t.id === tB.id), undefined);
  assert.equal(teams.find((t) => t.id === tC.id), undefined);
});
```

If `org.test.js` does not already import `now`, add `import { now } from "../lib/tokens.js";` at the top.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/org.test.js`
Expected: FAIL — `org.teamsForUser is not a function`.

- [ ] **Step 4: Implement**

In `hub/lib/org.js`, add the function before the `return {` block:

```js
  function teamsForUser(userId, companyId) {
    return db.prepare(`
      SELECT t.id AS id, t.name AS name, tm.role AS role
      FROM team_members tm
      JOIN teams t ON t.id = tm.team_id
      WHERE tm.user_id = ? AND t.company_id = ?
      ORDER BY t.name
    `).all(userId, companyId);
  }
```

And add `teamsForUser,` to the returned object (next to `createTeam, listTeams,`).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/org.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /var/www/suite
git add hub/lib/org.js hub/tests/org.test.js
git commit -m "feat(hub): org.teamsForUser — a user's teams within a company"
```

---

## Task 2: Hub exchange returns `teams`

**Files:**
- Modify: `hub/routes/api-sessions.js`
- Test: `hub/tests/api-sessions-exchange.test.js`

- [ ] **Step 1: Write the failing test**

Append to `hub/tests/api-sessions-exchange.test.js`:

```js
test("exchange returns the user's teams scoped to the per-company entitled app", async () => {
  const { app, db } = await buildWithApi();
  db.prepare("INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)")
    .run("u1", "a@b.c", "Alice", now());
  const { createEntitlements } = await import("../lib/entitlements.js?t=" + Date.now());
  const { createOrg } = await import("../lib/org.js?t=" + Date.now());
  const org = createOrg(db);
  const co = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: co.id, role: "owner" });
  const team = org.createTeam({ companyId: co.id, name: "Alpha" });
  org.addTeamMember({ userId: "u1", teamId: team.id, role: "lead" });
  createEntitlements(db).grantEntitlement({ app: "poker", principalType: "company", principalId: co.id });

  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const tok = randomToken();
  db.prepare("INSERT INTO launch_tokens (token,central_session_id,target_app,created_at,expires_at) VALUES (?,?,?,?,?)")
    .run(tok, sid, "poker", now(), now() + 30_000);

  const res = await request(app)
    .post("/api/sessions/exchange")
    .set("Authorization", "Bearer k-poker")
    .send({ launch_token: tok });

  assert.equal(res.status, 200);
  assert.equal(res.body.entitlement.entitled, true);
  assert.deepEqual(res.body.teams, [{ id: team.id, name: "Alpha", role: "lead" }]);
});

test("exchange returns teams:[] when not entitled or principal is not a company", async () => {
  const { app, db } = await buildWithApi();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const tok = randomToken();
  db.prepare("INSERT INTO launch_tokens (token,central_session_id,target_app,created_at,expires_at) VALUES (?,?,?,?,?)")
    .run(tok, sid, "poker", now(), now() + 30_000);

  const res = await request(app)
    .post("/api/sessions/exchange")
    .set("Authorization", "Bearer k-poker")
    .send({ launch_token: tok });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.teams, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/api-sessions-exchange.test.js`
Expected: FAIL — `res.body.teams` is `undefined`.

- [ ] **Step 3: Implement**

In `hub/routes/api-sessions.js`:

Add the import near the other lib imports:
```js
import { createOrg } from "../lib/org.js";
```

Instantiate `org` next to `entitlements` inside `mountApiSessions`:
```js
  const entitlements = createEntitlements(db);
  const org = createOrg(db);
```

Replace the exchange's entitlement + response block:
```js
    const entitlement = entitlements.resolveEntitlement(row.user_id, row.target_app);
    const companyId =
      entitlement.entitled && entitlement.principal?.type === "company"
        ? entitlement.principal.id
        : null;
    const teams = companyId ? org.teamsForUser(row.user_id, companyId) : [];
    audit.log({ userId: row.user_id, eventType: "session_exchanged", app: req.callingApp, ip: req.ip });
    res.json({
      user: { id: row.user_id, email: row.email, displayName: row.display_name },
      central_session_id: row.central_session_id,
      entitlement,
      teams,
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/api-sessions-exchange.test.js`
Expected: PASS (including the existing exchange tests — `teams` is purely additive).

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite
git add hub/routes/api-sessions.js hub/tests/api-sessions-exchange.test.js
git commit -m "feat(hub): exchange returns user's teams for per-company entitled app"
```

---

## Task 3: auth-client session store — persist `entitled` + `teams`

**Files:**
- Modify: `shared/auth-client/lib/sessions-db.js`
- Test: `shared/auth-client/tests/sessions-db.test.js`

- [ ] **Step 1: Write the failing test**

Append to `shared/auth-client/tests/sessions-db.test.js` (match its existing `createSessionsStore` import + `:memory:` usage):

```js
test("create persists entitled+teams and get returns them parsed", () => {
  const store = createSessionsStore(":memory:");
  store.create({
    id: "s1", userId: "u1", centralSessionId: "c1", expiresAt: Date.now() + 60_000,
    entitled: true, teams: [{ id: "t1", name: "Alpha", role: "lead" }],
  });
  const s = store.get("s1");
  assert.equal(s.entitled, true);
  assert.deepEqual(s.teams, [{ id: "t1", name: "Alpha", role: "lead" }]);
});

test("create defaults entitled=false and teams=[] when omitted (back-compat)", () => {
  const store = createSessionsStore(":memory:");
  store.create({ id: "s2", userId: "u2", centralSessionId: "c2", expiresAt: Date.now() + 60_000 });
  const s = store.get("s2");
  assert.equal(s.entitled, false);
  assert.deepEqual(s.teams, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/shared/auth-client && node --test tests/sessions-db.test.js`
Expected: FAIL — `s.teams` is `undefined`.

- [ ] **Step 3: Implement**

In `shared/auth-client/lib/sessions-db.js`, update the `db.exec` schema to include the two columns in the `CREATE TABLE`, then add an idempotent column-add for pre-existing stores immediately after the `db.exec(...)`:

```js
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      central_session_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_validated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      entitled INTEGER NOT NULL DEFAULT 0,
      teams TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_app_sessions_central ON app_sessions(central_session_id);
  `);
  const cols = db.prepare("PRAGMA table_info(app_sessions)").all().map((c) => c.name);
  if (!cols.includes("entitled")) db.exec("ALTER TABLE app_sessions ADD COLUMN entitled INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes("teams")) db.exec("ALTER TABLE app_sessions ADD COLUMN teams TEXT NOT NULL DEFAULT '[]'");
```

Replace `create` and `get`:

```js
    create({ id, userId, centralSessionId, expiresAt, entitled = false, teams = [] }) {
      const t = Date.now();
      db.prepare(`INSERT INTO app_sessions (id,user_id,central_session_id,created_at,last_validated_at,expires_at,entitled,teams) VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, userId, centralSessionId, t, t, expiresAt, entitled ? 1 : 0, JSON.stringify(teams));
    },
    get(id) {
      const row = db.prepare("SELECT * FROM app_sessions WHERE id = ? AND expires_at > ?").get(id, Date.now());
      if (!row) return undefined;
      return { ...row, entitled: !!row.entitled, teams: JSON.parse(row.teams || "[]") };
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/suite/shared/auth-client && node --test tests/sessions-db.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite
git add shared/auth-client/lib/sessions-db.js shared/auth-client/tests/sessions-db.test.js
git commit -m "feat(auth-client): persist entitled+teams on the app session"
```

---

## Task 4: auth-client launch handler persists `entitled` + `teams`

**Files:**
- Modify: `shared/auth-client/handlers/launch.js`
- Test: `shared/auth-client/tests/launch.test.js`

- [ ] **Step 1: Write the failing test**

Append to `shared/auth-client/tests/launch.test.js`. Match that file's existing harness for building `ctx` and calling `handleLaunch`; the assertion to add, after a successful launch where the stubbed `ctx.hubApi.exchange` returns `{ user:{id:"u1"}, central_session_id:"c1", entitlement:{entitled:true}, teams:[{id:"t1",name:"Alpha",role:"lead"}] }`:

```js
test("launch persists entitled+teams from the exchange onto the session", async () => {
  // Arrange: build ctx with an in-memory store and a stubbed exchange (mirror this file's existing setup)
  const { createSessionsStore } = require("../lib/sessions-db.js");
  const store = createSessionsStore(":memory:");
  const captured = {};
  const ctx = {
    store,
    hubApi: { exchange: async () => ({
      user: { id: "u1" }, central_session_id: "c1",
      entitlement: { entitled: true }, teams: [{ id: "t1", name: "Alpha", role: "lead" }],
    }) },
    cookieName: "poker_session", cookieDomain: undefined, sessionMaxMs: 60_000,
  };
  const { createLaunchHandler } = require("../handlers/launch.js");
  const handleLaunch = createLaunchHandler(ctx);
  const req = { query: { token: "tok" }, headers: {} };
  const res = {
    setHeader() {}, redirect(code, dest) { captured.code = code; captured.dest = dest; },
    status() { return this; }, send() {},
  };

  await handleLaunch(req, res);

  // The session id is the cookie value; read it back by scanning the store via the only row.
  const created = store._debugLastId ? store.get(store._debugLastId) : null;
  // Fallback: assert via a known id is not possible (random), so assert the row count + fields by re-querying:
  // Simplest: spy on store.create instead.
});
```

Because the session id is random, prefer spying on `store.create`. Replace the test body with a `create` spy:

```js
test("launch persists entitled+teams from the exchange onto the session", async () => {
  const calls = [];
  const ctx = {
    store: { create: (rec) => calls.push(rec) },
    hubApi: { exchange: async () => ({
      user: { id: "u1" }, central_session_id: "c1",
      entitlement: { entitled: true }, teams: [{ id: "t1", name: "Alpha", role: "lead" }],
    }) },
    cookieName: "poker_session", cookieDomain: undefined, sessionMaxMs: 60_000,
  };
  const { createLaunchHandler } = require("../handlers/launch.js");
  const handleLaunch = createLaunchHandler(ctx);
  const req = { query: { token: "tok" }, headers: {} };
  const res = { setHeader() {}, redirect() {} };

  await handleLaunch(req, res);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].entitled, true);
  assert.deepEqual(calls[0].teams, [{ id: "t1", name: "Alpha", role: "lead" }]);
});
```

Ensure the file has `const { test } = require("node:test");` and `const assert = require("node:assert/strict");` (add if not present).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/shared/auth-client && node --test tests/launch.test.js`
Expected: FAIL — `calls[0].entitled` is `undefined`.

- [ ] **Step 3: Implement**

In `shared/auth-client/handlers/launch.js`, update the `ctx.store.create({...})` call:

```js
    ctx.store.create({
      id: sessionId,
      userId: info.user.id,
      centralSessionId: info.central_session_id,
      expiresAt: Date.now() + ctx.sessionMaxMs,
      entitled: info.entitlement?.entitled === true,
      teams: info.teams || [],
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/suite/shared/auth-client && node --test tests/launch.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite
git add shared/auth-client/handlers/launch.js shared/auth-client/tests/launch.test.js
git commit -m "feat(auth-client): launch persists entitled+teams onto the session"
```

---

## Task 5: auth-client `attachUser` surfaces `entitled` + `teams`

**Files:**
- Modify: `shared/auth-client/middleware.js`
- Test: `shared/auth-client/tests/middleware.test.js`

- [ ] **Step 1: Write the failing test**

Append to `shared/auth-client/tests/middleware.test.js` (match its existing pattern for building `requireAuth` with a real `:memory:` store + stubbed `hubApi`):

```js
test("requireAuth attaches entitled+teams from the session to req.user", async () => {
  const { createSessionsStore } = require("../lib/sessions-db.js");
  const { createRequireAuth } = require("../middleware.js");
  const store = createSessionsStore(":memory:");
  store.create({
    id: "s1", userId: "u1", centralSessionId: "c1", expiresAt: Date.now() + 60_000,
    entitled: true, teams: [{ id: "t1", name: "Alpha", role: "lead" }],
  });
  const requireAuth = createRequireAuth({
    store, hubApi: { heartbeat: async () => "ok" },
    cookieName: "poker_session", cacheTtlMs: 60_000, graceMs: 300_000,
  });
  const req = { headers: { cookie: "poker_session=s1" } };
  let nexted = false;
  await requireAuth(req, { redirect() {} }, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(req.user.id, "u1");
  assert.equal(req.user.entitled, true);
  assert.deepEqual(req.user.teams, [{ id: "t1", name: "Alpha", role: "lead" }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/shared/auth-client && node --test tests/middleware.test.js`
Expected: FAIL — `req.user.entitled` is `undefined`.

- [ ] **Step 3: Implement**

In `shared/auth-client/middleware.js`, update `attachUser`:

```js
  function attachUser(req, sess) {
    req.user = { id: sess.user_id, entitled: !!sess.entitled, teams: sess.teams || [] };
    req.appSessionId = sess.id;
    req.centralSessionId = sess.central_session_id;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/suite/shared/auth-client && node --test tests/middleware.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite
git add shared/auth-client/middleware.js shared/auth-client/tests/middleware.test.js
git commit -m "feat(auth-client): attach entitled+teams to req.user"
```

---

## Task 6: auth-client `verifySession(cookieHeader)` for the WS upgrade

**Files:**
- Create: `shared/auth-client/lib/verify-session.js`
- Modify: `shared/auth-client/lib/factory.js`
- Test: `shared/auth-client/tests/verify-session.test.js`

- [ ] **Step 1: Write the failing test**

Create `shared/auth-client/tests/verify-session.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSessionsStore } = require("../lib/sessions-db.js");
const { createVerifySession } = require("../lib/verify-session.js");

function ctxWith(store, heartbeat = async () => "ok") {
  return { store, hubApi: { heartbeat }, cookieName: "poker_session", cacheTtlMs: 60_000, graceMs: 300_000 };
}

test("returns context for a fresh session (no hub call)", async () => {
  const store = createSessionsStore(":memory:");
  store.create({ id: "s1", userId: "u1", centralSessionId: "c1", expiresAt: Date.now() + 60_000, entitled: true, teams: [{ id: "t1", name: "Alpha", role: "lead" }] });
  let called = false;
  const verifySession = createVerifySession(ctxWith(store, async () => { called = true; return "ok"; }));
  const res = await verifySession("poker_session=s1");
  assert.deepEqual(res, { userId: "u1", entitled: true, teams: [{ id: "t1", name: "Alpha", role: "lead" }] });
  assert.equal(called, false);
});

test("returns null when cookie missing or session unknown", async () => {
  const store = createSessionsStore(":memory:");
  const verifySession = createVerifySession(ctxWith(store));
  assert.equal(await verifySession(undefined), null);
  assert.equal(await verifySession("poker_session=nope"), null);
});

test("returns null when the central session is expired", async () => {
  const store = createSessionsStore(":memory:");
  store.create({ id: "s1", userId: "u1", centralSessionId: "c1", expiresAt: Date.now() + 60_000 });
  // force a stale last_validated_at so the heartbeat path runs
  store.touch("s1");
  const ctx = ctxWith(store, async () => "expired");
  ctx.cacheTtlMs = -1; // make age >= cacheTtlMs to force revalidation
  const verifySession = createVerifySession(ctx);
  assert.equal(await verifySession("poker_session=s1"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/shared/auth-client && node --test tests/verify-session.test.js`
Expected: FAIL — cannot find `../lib/verify-session.js`.

- [ ] **Step 3: Implement**

Create `shared/auth-client/lib/verify-session.js`:

```js
// lib/verify-session.js — connection-layer session check (e.g. WebSocket upgrade).
// Mirrors requireAuth's cache/grace freshness logic but returns data instead of
// redirecting. Returns { userId, entitled, teams } or null.
const { parseCookies } = require("./cookies.js");

function createVerifySession(ctx) {
  const { store, hubApi, cookieName, cacheTtlMs, graceMs } = ctx;

  function context(sess) {
    return { userId: sess.user_id, entitled: !!sess.entitled, teams: sess.teams || [] };
  }

  return async function verifySession(cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    const cookieVal = cookies[cookieName];
    if (!cookieVal) return null;
    const sess = store.get(cookieVal);
    if (!sess) return null;

    const age = Date.now() - sess.last_validated_at;
    if (age < cacheTtlMs) return context(sess);

    const result = await hubApi.heartbeat(sess.central_session_id);
    if (result === "ok") { store.touch(cookieVal); return context(sess); }
    if (result === "expired") { store.delete(cookieVal); return null; }
    if (age < cacheTtlMs + graceMs) return context(sess);
    store.delete(cookieVal);
    return null;
  };
}

module.exports = { createVerifySession };
```

In `shared/auth-client/lib/factory.js`, add the require near the top:
```js
const { createVerifySession } = require("./verify-session.js");
```
and add to the returned object (next to `getCurrentUser`):
```js
    verifySession: createVerifySession(ctx),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/suite/shared/auth-client && node --test tests/verify-session.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full auth-client + hub suites (regression)**

Run: `cd /var/www/suite/shared/auth-client && node --test tests/`
Expected: PASS, all green (the original 24 + new).
Run: `cd /var/www/suite/hub && node --test tests/`
Expected: PASS (94 + new).

- [ ] **Step 6: Commit + merge Phase A**

```bash
cd /var/www/suite
git add shared/auth-client/lib/verify-session.js shared/auth-client/lib/factory.js shared/auth-client/tests/verify-session.test.js
git commit -m "feat(auth-client): verifySession helper for the WS upgrade gate"
git checkout main
git merge --ff-only feat/poker-teams-contract
```

> Phase A is now on `main`. The auth-client symlink poker consumes is updated in place — no `npm install` needed in poker for the lib itself (its deps are unchanged).

---

# Phase B — Poker (`/var/www/scrumpoker`)

## Task 7: Wire the auth-client into poker (branch + dep + env)

**Files:**
- Modify: `package.json` (dep), create `.env.example`

- [ ] **Step 1: Branch + rollback tag**

```bash
cd /var/www/scrumpoker
git checkout -b feat/suite-auth
git tag pre-suite-auth
```

- [ ] **Step 2: Install the auth-client (symlinked file dep) + supertest for httpApp tests**

```bash
cd /var/www/scrumpoker
npm install file:../suite/shared/auth-client
npm install --save-dev supertest
```

- [ ] **Step 3: Verify it loads**

Run: `cd /var/www/scrumpoker && node -e "console.log(typeof require('@suite/auth-client').createAuthClient)"`
Expected: `function`.

- [ ] **Step 4: Create `.env.example`**

Create `/var/www/scrumpoker/.env.example`:

```
APP_NAME=poker
HUB_BASE_URL=https://sprintsuite.uk
HUB_API_KEY=replace-with-POKER-line-from-suite-app-keys.txt
COOKIE_DOMAIN=sprintpoker.uk
APP_BASE_URL=https://sprintpoker.uk
APP_SESSIONS_DB=./data/poker-sessions.db
PORT=3005
```

- [ ] **Step 5: Commit**

```bash
cd /var/www/scrumpoker
git add package.json package-lock.json .env.example
git commit -m "chore(poker): add @suite/auth-client + supertest dev dep + .env.example"
```

---

## Task 8: `handleLogin` — team membership instead of access key

**Files:**
- Modify: `lib/wsHandlers.js`
- Test: `tests/ws-handlers.test.js`

- [ ] **Step 1: Update the test harness + write failing tests**

In `tests/ws-handlers.test.js`: remove `withTempKeysFile` and the `keysFile` field from `createHarness` (and the `fs/os/path` requires if now unused). Change `loginPayload` to team-based and have `handleLogin` calls pass a `ws` carrying `.teams`. Replace the access-key login fixtures with:

```js
function loginPayload(overrides = {}) {
  return { name: 'Alice', role: ROLES.FACILITATOR, room: 'planning', teamId: 't1', ...overrides };
}

function wsWith(userId, teams = [{ id: 't1', name: 'Alpha', role: 'lead' }]) {
  return { userId, teams };
}
```

Add these tests:

```js
test('handleLogin joins a room namespaced by teamId when the user is a member', (t) => {
  const h = createHarness(t);
  const ws = wsWith('u1');
  handleLogin({ ws, userId: 'u1', payload: loginPayload(), rooms: h.rooms, participants: h.participants, sendToClient: h.sendToClient, sendRoomState: h.sendRoomState });
  assert.ok(h.participants['u1']);
  assert.equal(h.participants['u1'].roomName, 't1-planning');
  assert.deepEqual(h.roomStates, ['t1-planning']);
});

test('handleLogin rejects a teamId the user is not a member of', (t) => {
  const h = createHarness(t);
  const ws = wsWith('u1');
  handleLogin({ ws, userId: 'u1', payload: loginPayload({ teamId: 'other' }), rooms: h.rooms, participants: h.participants, sendToClient: h.sendToClient, sendRoomState: h.sendRoomState });
  assert.equal(h.participants['u1'], undefined);
  assert.equal(h.clientMessages.at(-1).message.payload.message, "You're not a member of that team.");
});

test('handleLogin rejects when teamId is missing', (t) => {
  const h = createHarness(t);
  const ws = wsWith('u1');
  handleLogin({ ws, userId: 'u1', payload: loginPayload({ teamId: undefined }), rooms: h.rooms, participants: h.participants, sendToClient: h.sendToClient, sendRoomState: h.sendRoomState });
  assert.equal(h.participants['u1'], undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/scrumpoker && node --test tests/ws-handlers.test.js`
Expected: FAIL — handleLogin still requires `accessKey` / namespaces by access key.

- [ ] **Step 3: Implement**

In `lib/wsHandlers.js`: remove the `require('./accessKeys')` import block (`getInternalRoomName`, `isValidAccessKey`, `loadKeys`). Replace `handleLogin` entirely:

```js
function handleLogin({
  ws,
  userId,
  payload,
  rooms,
  participants,
  sendToClient,
  sendRoomState
}) {
  if (!payload || !payload.name || !payload.role || !payload.room || !payload.teamId) {
    return sendError(sendToClient, ws, 'Login requires name, role, room, and team.');
  }

  const { name, role, room, teamId } = payload;
  if (!isValidRole(role)) {
    return sendError(sendToClient, ws, 'Invalid role.');
  }

  const teams = Array.isArray(ws.teams) ? ws.teams : [];
  if (!teams.some((team) => team.id === teamId)) {
    return sendError(sendToClient, ws, "You're not a member of that team.");
  }

  const internalRoom = `${teamId}-${room}`;
  ws.name = name;
  ws.role = role;
  ws.roomName = internalRoom;
  joinRoom(rooms, internalRoom, userId);

  const roomForLogin = rooms.get(internalRoom);
  const assignedRole = getAssignedLoginRole(role, roomForLogin.facilitatorId);
  if (isFacilitator(assignedRole)) {
    roomForLogin.facilitatorId = userId;
  }

  participants[userId] = {
    id: userId,
    ws,
    name,
    role: assignedRole,
    vote: null,
    roomName: internalRoom
  };

  assignFacilitator(rooms, participants, internalRoom);
  sendRoomState(internalRoom);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/scrumpoker && node --test tests/ws-handlers.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /var/www/scrumpoker
git add lib/wsHandlers.js tests/ws-handlers.test.js
git commit -m "feat(poker): handleLogin authorizes by team membership, rooms namespaced by teamId"
```

---

## Task 9: WS upgrade auth decision + gate

**Files:**
- Create: `lib/upgradeAuth.js`
- Modify: `lib/wsServer.js`
- Test: `tests/upgrade-auth.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/upgrade-auth.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { authenticateUpgrade } = require('../lib/upgradeAuth');

test('rejects (401) when verifySession returns null', async () => {
  const r = await authenticateUpgrade(async () => null, 'poker_session=x');
  assert.deepEqual(r, { ok: false, status: 401 });
});

test('rejects (401) when the user is not entitled', async () => {
  const r = await authenticateUpgrade(async () => ({ userId: 'u1', entitled: false, teams: [] }), 'c');
  assert.deepEqual(r, { ok: false, status: 401 });
});

test('accepts and returns context when entitled', async () => {
  const ctx = { userId: 'u1', entitled: true, teams: [{ id: 't1', name: 'Alpha', role: 'lead' }] };
  const r = await authenticateUpgrade(async () => ctx, 'c');
  assert.deepEqual(r, { ok: true, context: ctx });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/scrumpoker && node --test tests/upgrade-auth.test.js`
Expected: FAIL — cannot find `../lib/upgradeAuth`.

- [ ] **Step 3: Implement the pure decision**

Create `lib/upgradeAuth.js`:

```js
// Decides whether a WebSocket upgrade is allowed. Pure: takes the auth-client's
// verifySession + the raw Cookie header, returns an allow/deny decision.
async function authenticateUpgrade(verifySession, cookieHeader) {
  const ctx = await verifySession(cookieHeader);
  if (!ctx) return { ok: false, status: 401 };
  if (!ctx.entitled) return { ok: false, status: 401 };
  return { ok: true, context: ctx };
}

module.exports = { authenticateUpgrade };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/scrumpoker && node --test tests/upgrade-auth.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the gate into `wsServer.js`**

In `lib/wsServer.js`: remove the `createLoginRateLimiter` import and the `loginRateLimiter` parameter. Add `const { authenticateUpgrade } = require('./upgradeAuth');`. Change the `WebSocketServer` construction and add the upgrade handler; update `createWsServer`'s signature to take `auth` instead of `keysFile`/`loginRateLimiter`:

```js
function createWsServer({ server, rooms, auth, logger = console }) {
  const participants = {};
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 64 * 1024
  });

  server.on('upgrade', async (req, socket, head) => {
    if (!String(req.url || '').startsWith('/ws')) {
      socket.destroy();
      return;
    }
    let result;
    try {
      result = await authenticateUpgrade(auth.verifySession, req.headers.cookie);
    } catch (err) {
      logger.error('WS upgrade auth error:', err);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!result.ok) {
      socket.write(`HTTP/1.1 ${result.status} Unauthorized\r\n\r\n`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.hubUserId = result.context.userId;
      ws.teams = result.context.teams;
      wss.emit('connection', ws, req);
    });
  });
```

In the `wss.on('connection', …)` body, remove `ws.clientKey = getClientKey(req);` and the `login` case's rate-limiter wrapping. The `login` case becomes:

```js
        case 'login': {
          handleLogin({
            ws,
            userId,
            payload,
            rooms,
            participants,
            sendToClient,
            sendRoomState
          });
          break;
        }
```

Remove the now-unused `getClientKey` function and the `createLoginRateLimiter` default. Keep the `uuidv4()` `userId` assignment for participant slots.

- [ ] **Step 6: Run the whole poker unit suite (catch wiring breaks)**

Run: `cd /var/www/scrumpoker && node --test tests/ws-handlers.test.js tests/ws-operations.test.js tests/upgrade-auth.test.js`
Expected: PASS (these don't import wsServer's removed deps; if `ws-operations.test.js` constructs `createWsServer`, update its call to pass a stub `auth: { verifySession: async () => ({ userId:'u', entitled:true, teams:[] }) }` and drop `keysFile`).

- [ ] **Step 7: Commit**

```bash
cd /var/www/scrumpoker
git add lib/upgradeAuth.js lib/wsServer.js tests/upgrade-auth.test.js tests/ws-operations.test.js
git commit -m "feat(poker): gate the WS upgrade on a valid, entitled hub session"
```

---

## Task 10: httpApp — auth routes, entitled gate, `/api/me`; delete admin plane

**Files:**
- Modify: `lib/httpApp.js`
- Test: `tests/http-app.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/http-app.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const request = require('supertest');
const { createHttpApp } = require('../lib/httpApp');

function fakeAuth({ entitled = true, teams = [{ id: 't1', name: 'Alpha', role: 'lead' }] } = {}) {
  return {
    staticAssets: (req, res, next) => next(),
    handleLaunch: (req, res) => res.send('launch'),
    handleLogout: (req, res) => res.send('logout'),
    handleHeartbeat: (req, res) => res.json({ ok: true }),
    requireAuth: (req, res, next) => { req.user = { id: 'u1', entitled, teams }; next(); },
    _ctx: { hubBaseUrl: 'https://hub' },
  };
}

function build(authOverrides) {
  return createHttpApp({
    publicDir: path.join(__dirname, '..', 'public'),
    auth: fakeAuth(authOverrides),
    getRoomCount: () => 0,
    buildInfo: { version: 't', commit: 'c' },
  });
}

test('/api/me returns the authed user id + teams', async () => {
  const res = await request(build()).get('/api/me');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { userId: 'u1', teams: [{ id: 't1', name: 'Alpha', role: 'lead' }] });
});

test('GET / bounces to the hub dashboard when not entitled', async () => {
  const res = await request(build({ entitled: false })).get('/').redirects(0);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, 'https://hub/dashboard');
});

test('removed admin route returns 404', async () => {
  const res = await request(build()).get('/api/admin/keys');
  assert.equal(res.status, 404);
});

test('/health returns ok', async () => {
  const res = await request(build()).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/scrumpoker && node --test tests/http-app.test.js`
Expected: FAIL — `createHttpApp` still expects `keysFile`/`adminKey` and has no `/api/me`.

- [ ] **Step 3: Implement**

Rewrite `lib/httpApp.js`. Remove all access-key/admin imports (`accessKeys`, `adminActivity`), `createRequireAdminKey`, `sendAccessKeyError`, `recordAdminActivity`, every `/api/admin/*` route, and the `/api/admin/session` route. Keep `applySecurityHeaders`, `setNoCacheHeaders`, `sendStaticFile`, the CSP/permissions constants, the static mount, `/`, `/license`, `/health`. New signature + auth wiring:

```js
function createHttpApp({ publicDir, auth, getRoomCount, buildInfo = {} }) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.set('etag', false);

  app.use((req, res, next) => {
    applySecurityHeaders(res);
    setNoCacheHeaders(res);
    next();
  });

  app.use(express.json({ limit: '8kb' }));

  // Auth hub integration (launch / logout / heartbeat + browser heartbeat asset)
  app.use('/auth-client', auth.staticAssets);
  app.get('/auth/launch', auth.handleLaunch);
  app.get('/auth/logout', auth.handleLogout);
  app.post('/api/heartbeat', auth.handleHeartbeat);

  const requireEntitled = (req, res, next) => {
    if (req.user && req.user.entitled) return next();
    return res.redirect(302, `${auth._ctx.hubBaseUrl}/dashboard`);
  };

  app.use(
    '/',
    express.static(publicDir, {
      dotfiles: 'ignore', index: false, extensions: ['html'], redirect: false,
      etag: false, lastModified: false, cacheControl: false, acceptRanges: false,
      setHeaders: (res) => { applySecurityHeaders(res); setNoCacheHeaders(res); }
    })
  );

  app.get('/', auth.requireAuth, requireEntitled, (_req, res) => {
    sendStaticFile(res, path.join(publicDir, 'index.html'));
  });

  app.get(['/license', '/licence'], (_req, res) => {
    sendStaticFile(res, path.join(publicDir, 'license.html'));
  });

  app.get('/api/me', auth.requireAuth, (req, res) => {
    res.json({ userId: req.user.id, teams: req.user.teams || [] });
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      version: buildInfo.version || 'unknown',
      commit: buildInfo.commit || 'unknown',
      uptime: process.uptime(),
      rooms: getRoomCount()
    });
  });

  return app;
}
```

Update `module.exports` to drop `sendAccessKeyError` (keep `applySecurityHeaders`, `createHttpApp`, `setNoCacheHeaders`).

> Note: the broad `express.static('/', …)` mount must NOT serve `admin.html` — that file is deleted in Task 12. The static mount is registered before `/`, but `auth.requireAuth` on `/` still gates the SPA entry; `index.html` is delivered via the guarded route.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/scrumpoker && node --test tests/http-app.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /var/www/scrumpoker
git add lib/httpApp.js tests/http-app.test.js
git commit -m "feat(poker): hub auth routes, entitled gate on /, /api/me; remove admin plane"
```

---

## Task 11: `server.js` composition — build + inject the auth client

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Rewrite the composition root**

Replace `server.js` with (preserving the rooms map + expiry sweep):

```js
// server.js
const path = require('path');
const { createAuthClient } = require('@suite/auth-client');
const {
  DEFAULT_ROOM_EXPIRY_MS,
  expireRooms
} = require('./lib/roomState');
const { getBuildInfo } = require('./lib/buildInfo');
const { createHttpApp } = require('./lib/httpApp');
const { createWsServer } = require('./lib/wsServer');

console.log('⏳ server.js is starting');

// Map<roomName: string, { users: Set<string>, lastActive: number }>
const rooms = new Map();

const PORT = process.env.PORT || 3005;
const publicDir = path.join(__dirname, 'public');

const auth = createAuthClient({
  appName: process.env.APP_NAME || 'poker',
  hubBaseUrl: process.env.HUB_BASE_URL,
  hubApiKey: process.env.HUB_API_KEY,
  cookieName: 'poker_session',
  cookieDomain: process.env.COOKIE_DOMAIN,
  dbPath: process.env.APP_SESSIONS_DB || path.join(__dirname, 'data', 'poker-sessions.db'),
});

const app = createHttpApp({
  publicDir,
  auth,
  buildInfo: getBuildInfo(__dirname),
  getRoomCount: () => rooms.size
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Scrum Poker listening on :${PORT}`);
});
server.on('request', (_req, res) => {
  if (!res.headersSent) {
    res.removeHeader('Server');
  }
});

const { participants } = createWsServer({ server, rooms, auth });

setInterval(() => {
  expireRooms(rooms, Date.now(), DEFAULT_ROOM_EXPIRY_MS, participants);
}, 60 * 1000);
```

- [ ] **Step 2: Smoke-check it boots with stub env (no hub needed)**

Run:
```bash
cd /var/www/scrumpoker && APP_SESSIONS_DB=:memory: HUB_BASE_URL=https://hub HUB_API_KEY=k PORT=3055 node -e "require('./server.js'); setTimeout(()=>{console.log('booted');process.exit(0)},500)"
```
Expected: prints `Scrum Poker listening on :3055` then `booted`, exit 0.

- [ ] **Step 3: Commit**

```bash
cd /var/www/scrumpoker
git add server.js
git commit -m "feat(poker): build + inject @suite/auth-client; drop keys/admin wiring"
```

---

## Task 12: Delete the access-key + operator-admin subsystem

**Files:**
- Delete: `lib/accessKeys.js`, `lib/loginRateLimiter.js`, `lib/adminActivity.js`, `manageKeys.js`, `keys.json`, `public/admin.html`, `public/js/admin.js`, `tests/access-keys.test.js`, `tests/admin-activity.test.js`, `tests/login-rate-limiter.test.js`

- [ ] **Step 1: Confirm nothing live still imports them**

Run: `cd /var/www/scrumpoker && grep -rn "accessKeys\|loginRateLimiter\|adminActivity\|manageKeys\|getInternalRoomName\|getKeysFilePath\|getActivityFilePath" lib/ server.js public/js/ --include=*.js | grep -v "admin.js"`
Expected: **no output** (all references removed in Tasks 8–11). If anything prints, fix that reference first.

- [ ] **Step 2: Delete the files**

```bash
cd /var/www/scrumpoker
git rm lib/accessKeys.js lib/loginRateLimiter.js lib/adminActivity.js manageKeys.js keys.json public/admin.html public/js/admin.js tests/access-keys.test.js tests/admin-activity.test.js tests/login-rate-limiter.test.js
```

- [ ] **Step 3: Run the full unit suite**

Run: `cd /var/www/scrumpoker && node --test tests/*.test.js`
Expected: PASS — remaining suites (build-info, roles, room-state, theme-contrast, ws-handlers, ws-operations, upgrade-auth, http-app) all green.

- [ ] **Step 4: Commit**

```bash
cd /var/www/scrumpoker
git commit -m "chore(poker): remove access-key + operator-admin subsystem"
```

---

## Task 13: Frontend — team dropdown, drop access-key/admin, new login payload

**Files:**
- Modify: `public/index.html`, `public/js/app.js`

- [ ] **Step 1: Update `index.html`**

In `public/index.html`:

Replace the access-key field (the `<label class="field" for="access-key-input">…</label>` block) with a team dropdown:

```html
                <label class="field" id="team-field" for="team-select">
                    <span>Team</span>
                    <select id="team-select"></select>
                </label>
```

Remove the `Admin` option from `#role-select` (delete the `<option value="Admin">Admin</option>` line). Remove the admin room link: delete `<a id="admin-room-link" href="/admin" class="room-admin-link hidden">Team access</a>`.

Add the heartbeat asset script in `<head>` (after `app.js`):
```html
    <script src="/auth-client/heartbeat.js" defer></script>
```

- [ ] **Step 2: Update `app.js` — element refs + populate teams**

In `public/js/app.js`: remove `accessKeyInput`, `adminRoomLink` refs and any `roleSelect` "Admin" handling. Add a `teamSelect` ref:

```js
const teamSelect = document.getElementById('team-select');
```

Add a loader that runs on startup (call it where the app initialises, e.g. alongside `connectWebSocket()`):

```js
async function loadTeams() {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (!res.ok) { window.location.reload(); return; }
    const { teams } = await res.json();
    teamSelect.innerHTML = '';
    for (const t of teams) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      teamSelect.appendChild(opt);
    }
    const teamField = document.getElementById('team-field');
    if (teams.length === 1) {
      teamField.classList.add('hidden');
    } else if (teams.length === 0) {
      teamField.classList.add('hidden');
      showLoginError("You're not on a team yet — ask your admin to add you.");
    }
  } catch {
    showLoginError('Could not load your teams. Re-launch poker from the hub.');
  }
}
```

(Use whatever the existing login-error helper is named; the spec/file calls it via `loginError`. If the helper is `showLoginError`, keep it; otherwise set `loginError.textContent` + unhide as the file already does.)

- [ ] **Step 3: Update `app.js` — login payload + remove admin-verify flow**

Delete the admin sign-in branch (the `isAdminRole`/"Checking key..."/`/api/admin/session`/`window.location.assign('/admin')` logic). The login click handler builds the payload from the dropdown:

```js
function sendLogin() {
  const payload = {
    name: nameInput.value.trim(),
    role: roleSelect.value,
    room: roomInput.value.trim(),
    teamId: teamSelect.value,
  };
  if (!payload.teamId) { showLoginError("Select a team to join."); return; }
  ws.send(JSON.stringify({ type: 'login', payload }));
}
```

Wire the login button to `sendLogin` (replacing the old access-key/admin branch).

- [ ] **Step 4: Update `app.js` — upgrade-rejection handling**

The WS now gets rejected at upgrade (401) for an expired/unentitled session, surfacing as `onerror`/`onclose` before any `yourId`. Guard the auto-reconnect so it does not loop against a persistent 401: track whether the socket ever opened; if it closes without having opened, reload to bounce through the hub instead of the 5s retry.

```js
let everOpened = false;
// in ws.onopen:  everOpened = true;
// in ws.onclose:
ws.onclose = () => {
  if (!everOpened) {
    showLoginError('Your session expired — re-launch poker from the hub.');
    setTimeout(() => window.location.reload(), 1500);
    return;
  }
  everOpened = false;
  showLogin({ clearError: false });
  setTimeout(connectWebSocket, 5000);
};
```

Point logout at `/auth/logout` (the logout button handler navigates to `/auth/logout`).

- [ ] **Step 5: Bump the cache-busting query on app.js**

In `index.html`, bump `js/app.js?v=16` to `js/app.js?v=17`.

- [ ] **Step 6: Commit**

```bash
cd /var/www/scrumpoker
git add public/index.html public/js/app.js
git commit -m "feat(poker): team dropdown + hub login flow; remove access-key/admin UI"
```

> Manual verification of the full browser flow happens at deploy (poker has no headless WS-login harness for the real hub); Task 14 covers the e2e via cookie injection.

---

## Task 14: e2e — cookie-injection (replace access-key/admin specs)

**Files:**
- Create: `tests/e2e/helpers/seed.js`, `tests/e2e/helpers/_auth.js`
- Modify: `playwright.config.js`, `tests/e2e/scrum-poker-smoke.spec.js`, `tests/e2e/multi-user-room.spec.js`
- Delete: `tests/e2e/admin-key-management.spec.js`

- [ ] **Step 1: Add a webServer + seed to `playwright.config.js`**

Set the poker server to boot with a seeded sessions DB and stub hub env (verifySession works off the local store on the cache-fresh path, so no live hub is needed):

```js
const path = require('path');
module.exports = require('@playwright/test').defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  reporter: 'list',
  timeout: 30 * 1000,
  use: {
    baseURL: 'http://127.0.0.1:3066',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node server.js',
    url: 'http://127.0.0.1:3066/health',
    reuseExistingServer: false,
    env: {
      PORT: '3066',
      APP_NAME: 'poker',
      HUB_BASE_URL: 'http://127.0.0.1:9',
      HUB_API_KEY: 'test',
      APP_SESSIONS_DB: path.join(__dirname, 'tests', 'e2e', '.data', 'poker-sessions.db'),
    },
  },
});
```

- [ ] **Step 2: Seed helper**

Create `tests/e2e/helpers/seed.js` — seeds a fresh, entitled session with one team directly into the same sessions DB the server uses:

```js
const path = require('path');
const fs = require('fs');
const { createSessionsStore } = require('@suite/auth-client/lib/sessions-db.js');

const DB = path.join(__dirname, '..', '.data', 'poker-sessions.db');

function seedSession({ id = 's-e2e', userId = 'u-e2e', teams = [{ id: 't1', name: 'Alpha', role: 'lead' }] } = {}) {
  fs.mkdirSync(path.dirname(DB), { recursive: true });
  const store = createSessionsStore(DB);
  store.create({ id, userId, centralSessionId: 'c-e2e', expiresAt: Date.now() + 60 * 60 * 1000, entitled: true, teams });
  return { id, userId, teams };
}

module.exports = { seedSession, DB };
```

- [ ] **Step 3: Cookie-injection helper**

Create `tests/e2e/helpers/_auth.js`:

```js
async function injectSession(context, sessionId = 's-e2e') {
  await context.addCookies([{
    name: 'poker_session', value: sessionId,
    domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax',
  }]);
}
module.exports = { injectSession };
```

- [ ] **Step 4: Rewrite the smoke spec**

Replace `tests/e2e/scrum-poker-smoke.spec.js` with a cookie-injected flow:

```js
const { test, expect } = require('@playwright/test');
const { seedSession } = require('./helpers/seed');
const { injectSession } = require('./helpers/_auth');

test('authed user picks a team, joins a room, votes, reveals', async ({ page, context }) => {
  seedSession();
  await injectSession(context);
  await page.goto('/');
  // single team auto-selected + team field hidden
  await expect(page.locator('#team-select option')).toHaveCount(1);
  await page.fill('#room-input', 'planning');
  await page.fill('#name-input', 'Alice');
  await page.selectOption('#role-select', 'Facilitator');
  await page.click('#login-button');
  await expect(page.locator('#poker-room-section')).toBeVisible();
  // cast a vote (deck renders after join)
  await page.locator('#voting-cards [data-vote="5"]').click();
  await page.click('#show-votes-button');
  await expect(page.locator('#vote-summary')).toBeVisible();
});

test('no session bounces away from the app page', async ({ page }) => {
  const res = await page.goto('/');
  // requireAuth → 302 to the hub; with a dead stub hub the nav fails or lands off-app
  await expect(page.locator('#poker-room-section')).toBeHidden();
});
```

(Adjust the vote-card selector to match the deck markup `cardDeck.js` renders; inspect a card's actual attribute/class.)

Delete the admin spec:
```bash
cd /var/www/scrumpoker
git rm tests/e2e/admin-key-management.spec.js
```

For `tests/e2e/multi-user-room.spec.js`: update its login steps to inject a session + use the team dropdown (same pattern). If it relied on access keys for room scoping, scope by `teamId` instead.

- [ ] **Step 5: Run e2e**

Run: `cd /var/www/scrumpoker && npx playwright test`
Expected: PASS (smoke + multi-user). Fix selectors against the real markup as needed.

- [ ] **Step 6: Commit**

```bash
cd /var/www/scrumpoker
git add tests/e2e playwright.config.js
git commit -m "test(poker): cookie-injection e2e for hub-authed team rooms"
```

---

## Task 15: Full regression + holistic review + merge-readiness

- [ ] **Step 1: Full poker unit + e2e**

Run: `cd /var/www/scrumpoker && node --test tests/*.test.js`
Expected: all green.
Run: `cd /var/www/scrumpoker && npx playwright test`
Expected: all green.

- [ ] **Step 2: Full suite-side regression (Phase A already on main)**

Run: `cd /var/www/suite/hub && node --test tests/`
Run: `cd /var/www/suite/shared/auth-client && node --test tests/`
Expected: both green (94+ and 24+).

- [ ] **Step 3: Confirm no dead references remain**

Run: `cd /var/www/scrumpoker && grep -rn "accessKey\|SCRUM_POKER_ADMIN_KEY\|/admin\|keys.json" lib/ public/js/ server.js --include=*.js --include=*.html`
Expected: no functional references (only possibly a comment; remove any that remain).

- [ ] **Step 4: Holistic self-review against the spec**

Re-read `docs/superpowers/specs/2026-05-30-poker-team-rooms-design.md` and confirm each section maps to shipped code: two-layer auth ✔, teams in exchange ✔, persisted entitled+teams ✔, verifySession ✔, upgrade gate ✔, handleLogin team check + `${teamId}-${room}` ✔, admin/access-key removal ✔, frontend dropdown + 401 reload ✔, tests ✔. Note any gap and add a task.

- [ ] **Step 5: Tag dev-complete (do NOT deploy here)**

```bash
cd /var/www/scrumpoker
git tag post-suite-auth-dev
```

> Merge `feat/suite-auth` → `master` (poker's default branch) at finish-branch time. **Do not deploy** — deployment + the hub provisioning prerequisite (create company, add members, create team, add team members, grant `poker` per-company) happen in a separate careful prod session per the spec's Deploy section.

---

## Self-Review (plan author)

- **Spec coverage:** Architecture two layers → Tasks 8–10; contract teams/exchange → Tasks 1–2; persisted entitled+teams → Tasks 3–5; verifySession → Task 6; upgrade gate → Task 9; handleLogin team scoping → Task 8; admin/access-key removal → Task 12; frontend → Task 13; error handling (401 reload, zero-team message, teamId re-validation) → Tasks 8/9/13; testing → every task + Tasks 14–15; deploy/provisioning → spec only (deferred), flagged in Task 15. No uncovered sections.
- **Type/name consistency:** `verifySession(cookieHeader)` → `{ userId, entitled, teams }` used identically in Task 6 (auth-client), Task 9 (`authenticateUpgrade`), and the upgrade wiring. `req.user = { id, entitled, teams }` consistent across Tasks 5/10. `teams` element shape `{ id, name, role }` consistent across Tasks 1/2/3/8/14. Room key `${teamId}-${room}` consistent (Task 8). `createWsServer({ server, rooms, auth })` consistent (Tasks 9/11). `createHttpApp({ publicDir, auth, getRoomCount, buildInfo })` consistent (Tasks 10/11).
- **Placeholder scan:** the only soft spots are deliberate "match the file's existing harness" notes for test files I can't fully reproduce without the current test bodies (launch/middleware/org tests) and "adjust the vote-card selector to the real markup" — both are bounded, with the actual assertion code given. No "TODO/handle errors/etc." left.
