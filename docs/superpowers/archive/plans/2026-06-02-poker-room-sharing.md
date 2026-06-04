# Poker Room Sharing (Slice 3, Part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Sprint Poker from team-scoped, fully account-gated rooms to company-scoped rooms that anonymous Players can join via a per-room share link (vote-only; the company's own people facilitate).

**Architecture:** Two phases, mirroring Thread B. **Phase A** (suite repo `/var/www/suite`, branch `feat/poker-room-sharing`) makes an additive, back-compatible change to the hub exchange + shared auth-client so the user's `company {id,name}` rides on the app session and `verifySession`. Merge Phase A to `main` before starting Phase B. **Phase B** (poker repo `/var/www/scrumpoker`, new branch `feat/room-sharing`) collapses team→company scoping and adds the anonymous share-link path: a dual-path WebSocket upgrade gate (hub session **or** an in-memory per-room share token), anonymous Players clamped to Voter, and a public join page.

**Tech Stack:** Node, Express, `ws`, better-sqlite3 (auth-client sessions), Eta (hub views), `node:test` + `node:assert/strict`, supertest, Playwright (poker e2e). Hub tests: `npm test` in `/var/www/suite/hub`. auth-client tests: `npm test` in `/var/www/suite/shared/auth-client`. Poker unit tests: `npm test` in `/var/www/scrumpoker`; e2e: `npm run test:e2e` (Playwright).

**Spec:** `docs/superpowers/specs/2026-06-02-poker-room-sharing-design.md`

---

## Background the executor must know

- **auth-client is a shared CJS lib** consumed by raid/signal/retro/poker via a `file:` symlink. Phase A changes MUST stay additive — every existing raid/signal/retro/poker behavior and test must keep passing. The persisted session column add is an **idempotent `ALTER`** guarded by a `PRAGMA table_info` check (see `lib/sessions-db.js:26-28` for the existing pattern with `entitled`/`teams`).
- **Exchange response** (`hub/routes/api-sessions.js:50-55`) currently returns `{ user, central_session_id, entitlement, teams }`. `teams` entries already carry a `company` **name** string; there is no top-level company object. The route already computes `const company = companyId ? org.getCompany(companyId) : null` (line 45) — `getCompany` returns the full row incl. `id` and `name`.
- **Poker room state is in-memory only** (`server.js:15` `const rooms = new Map()`); rooms are disposable. The share token lives on the room object and dies with it. Resolution is a linear scan (few rooms per instance).
- **Poker WS upgrade** (`lib/wsServer.js:30-56`) gates on `authenticateUpgrade(auth.verifySession, cookie)` and attaches `ws.hubUserId`/`ws.teams`. Room binding happens later in the `login` message (`lib/wsHandlers.js:24-70`), which builds `internalRoom = \`${teamId}-${room}\`` after checking `teamId ∈ ws.teams`.
- **Poker roles** (`lib/roles.js`): `Voter`/`Observer`/`Facilitator`. First eligible user auto-promoted via `assignFacilitator` (`lib/roomState.js:90-107`).
- **Poker static serving** (`lib/httpApp.js:88-95`) serves `public/*.html` with NO auth (only `/` and `/api/me` are gated). So `public/join.html` is automatically public — no new route needed. The `/ws?…` upgrade path is already permitted (`wsServer.js:33`).
- **Poker frontend** is `public/index.html` + `public/js/app.js` (+ `cardDeck.js`, `clipboard.js`, `breathing-waves.js`). `app.js` loads `/api/me` for the team dropdown (`loadTeams`, lines 411-435), sends `login {name,role,room,teamId}` (lines 913-935), and renders the room from server `updateState` messages.

---

## File structure

| File | Phase | Change | Responsibility |
|---|---|---|---|
| `shared/auth-client/lib/sessions-db.js` | A | modify | Persist `company` JSON on the app session (idempotent ALTER) |
| `shared/auth-client/handlers/launch.js` | A | modify | Store `company` from the exchange payload |
| `shared/auth-client/lib/verify-session.js` | A | modify | Include `company` in the WS-gate context |
| `shared/auth-client/middleware.js` | A | modify | Include `company` on `req.user` |
| `hub/routes/api-sessions.js` | A | modify | Return top-level `company {id,name}` from exchange |
| `scrumpoker/lib/roomState.js` | B | modify | Mint `shareToken` per room; `findRoomByToken`; auth-aware facilitator assignment |
| `scrumpoker/lib/upgradeAuth.js` | B | modify | Keep pure session check; expose company in context |
| `scrumpoker/lib/wsServer.js` | B | modify | Dual-path upgrade gate (session OR room token); attach `ws.authed`/`ws.company`/`ws.anonRoom` |
| `scrumpoker/lib/wsHandlers.js` | B | modify | Company-scoped login; anon = Voter-only; `authed` on participant; facilitator guards |
| `scrumpoker/lib/httpApp.js` | B | modify | `/api/me` returns `company` |
| `scrumpoker/public/js/app.js` | B | modify | Remove team dropdown; company header; "Copy invite link" (anonymous token) |
| `scrumpoker/public/join.html` + `public/js/join.js` | B | create | Public anonymous join page (name → `/ws?token=` → room view) |
| `scrumpoker/public/js/roomView.js` | B | create | Shared room rendering used by both `app.js` and `join.js` |
| tests across both repos | A+B | create/modify | TDD per task |

---

# PHASE A — suite repo (`/var/www/suite`, branch `feat/poker-room-sharing`)

## Task 1: auth-client sessions-db persists `company`

**Files:**
- Modify: `shared/auth-client/lib/sessions-db.js`
- Test: `shared/auth-client/tests/sessions-db.test.js` (create if absent; otherwise add to the existing sessions-db test)

- [ ] **Step 1: Write the failing test**

Create/append `shared/auth-client/tests/sessions-db.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSessionsStore } = require("../lib/sessions-db.js");

test("sessions-db round-trips company (defaults to null)", () => {
  const store = createSessionsStore(":memory:");
  store.create({ id: "s1", userId: "u1", centralSessionId: "c1", expiresAt: Date.now() + 60000 });
  assert.equal(store.get("s1").company, null);

  store.create({ id: "s2", userId: "u2", centralSessionId: "c2", expiresAt: Date.now() + 60000, company: { id: "co1", name: "Acme" } });
  assert.deepEqual(store.get("s2").company, { id: "co1", name: "Acme" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /var/www/suite/shared/auth-client && node --test test/sessions-db.test.js`
Expected: FAIL — `store.get(...).company` is `undefined`.

- [ ] **Step 3: Implement**

In `lib/sessions-db.js`, add the column to the `CREATE TABLE` and the idempotent ALTER list, accept `company` in `create`, and parse it in `get`:

In the `CREATE TABLE app_sessions (...)` body, after the `teams` line add:
```sql
      company TEXT NOT NULL DEFAULT 'null'
```
After the existing `if (!cols.includes("teams")) ...` line add:
```javascript
  if (!cols.includes("company")) db.exec("ALTER TABLE app_sessions ADD COLUMN company TEXT NOT NULL DEFAULT 'null'");
```
Change `create(...)` to accept and store `company`:
```javascript
    create({ id, userId, centralSessionId, expiresAt, entitled = false, teams = [], company = null }) {
      const t = Date.now();
      db.prepare(`INSERT INTO app_sessions (id,user_id,central_session_id,created_at,last_validated_at,expires_at,entitled,teams,company) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, userId, centralSessionId, t, t, expiresAt, entitled ? 1 : 0, JSON.stringify(teams), JSON.stringify(company ?? null));
    },
```
In `get(id)`, after parsing `teams`, parse `company`:
```javascript
      let company;
      try { company = JSON.parse(row.company || "null"); } catch { company = null; }
      return { ...row, entitled: !!row.entitled, teams, company };
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /var/www/suite/shared/auth-client && node --test test/sessions-db.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole auth-client suite (back-compat)**

Run: `cd /var/www/suite/shared/auth-client && npm test`
Expected: ALL pass (existing rows with no `company` column get the default `'null'` via the ALTER).

- [ ] **Step 6: Commit**

```bash
git add shared/auth-client/lib/sessions-db.js shared/auth-client/tests/sessions-db.test.js
git commit -m "feat(auth-client): persist company on the app session (additive)"
```

---

## Task 2: auth-client surfaces `company` in `verifySession` + `req.user`

**Files:**
- Modify: `shared/auth-client/lib/verify-session.js` (the `context` helper, line 9-11)
- Modify: `shared/auth-client/middleware.js` (the `attachUser` helper, line 48-52)
- Test: `shared/auth-client/tests/verify-session.test.js` (add a case) and `shared/auth-client/tests/middleware.test.js` (add a case) — match whatever harness those files already use; if a file is absent, create it using the seeding shape below.

- [ ] **Step 1: Write the failing test**

Append to `shared/auth-client/tests/verify-session.test.js` (build the ctx the same way the existing tests in that file do; the key new assertion is the returned `company`):

```javascript
test("verifySession includes company from the stored session", async () => {
  const { createSessionsStore } = require("../lib/sessions-db.js");
  const { createVerifySession } = require("../lib/verify-session.js");
  const store = createSessionsStore(":memory:");
  store.create({ id: "sid", userId: "u1", centralSessionId: "c1", expiresAt: Date.now() + 60000, entitled: true, company: { id: "co1", name: "Acme" } });
  const verifySession = createVerifySession({ store, hubApi: { heartbeat: async () => "ok" }, cookieName: "poker_session", cacheTtlMs: 60000, graceMs: 300000 });
  const ctx = await verifySession("poker_session=sid");
  assert.deepEqual(ctx.company, { id: "co1", name: "Acme" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /var/www/suite/shared/auth-client && node --test test/verify-session.test.js`
Expected: FAIL — `ctx.company` is `undefined`.

- [ ] **Step 3: Implement**

In `lib/verify-session.js`, change `context`:
```javascript
  function context(sess) {
    return { userId: sess.user_id, entitled: !!sess.entitled, teams: sess.teams || [], company: sess.company ?? null };
  }
```
In `middleware.js`, change `attachUser`:
```javascript
  function attachUser(req, sess) {
    req.user = { id: sess.user_id, entitled: !!sess.entitled, teams: sess.teams || [], company: sess.company ?? null };
    req.appSessionId = sess.id;
    req.centralSessionId = sess.central_session_id;
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /var/www/suite/shared/auth-client && node --test test/verify-session.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/auth-client/lib/verify-session.js shared/auth-client/middleware.js shared/auth-client/tests/
git commit -m "feat(auth-client): expose company on verifySession context + req.user"
```

---

## Task 3: launch handler stores `company` from the exchange

**Files:**
- Modify: `shared/auth-client/handlers/launch.js:18-25` (the `store.create` call)
- Test: `shared/auth-client/tests/launch.test.js` (add a case matching the file's existing harness; stub `ctx.hubApi.exchange` to return a payload with `company`)

- [ ] **Step 1: Write the failing test**

Append to `shared/auth-client/tests/launch.test.js`. Follow the existing "persists entitled+teams" test (line 69) which stubs `store.create` to capture the record:

```javascript
test("launch persists company from the exchange onto the session", async () => {
  const calls = [];
  const ctx = {
    store: { create: (rec) => calls.push(rec) },
    hubApi: { exchange: async () => ({
      user: { id: "u1" }, central_session_id: "c1",
      entitlement: { entitled: true }, teams: [], company: { id: "co1", name: "Acme" },
    }) },
    cookieName: "poker_session", cookieDomain: undefined, sessionMaxMs: 60_000,
  };
  const { createLaunchHandler } = require("../handlers/launch.js");
  const handleLaunch = createLaunchHandler(ctx);
  const req = { query: { token: "tok" }, headers: {} };
  const res = { setHeader() {}, redirect() {} };

  await handleLaunch(req, res);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].company, { id: "co1", name: "Acme" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /var/www/suite/shared/auth-client && node --test test/launch.test.js`
Expected: FAIL — company is not persisted yet.

- [ ] **Step 3: Implement**

In `handlers/launch.js`, add `company` to the `store.create` call:
```javascript
    ctx.store.create({
      id: sessionId,
      userId: info.user.id,
      centralSessionId: info.central_session_id,
      expiresAt: Date.now() + ctx.sessionMaxMs,
      entitled: info.entitlement?.entitled === true,
      teams: info.teams || [],
      company: info.company || null,
    });
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /var/www/suite/shared/auth-client && node --test test/launch.test.js`
Expected: PASS.

- [ ] **Step 5: Full auth-client suite**

Run: `cd /var/www/suite/shared/auth-client && npm test`
Expected: ALL pass.

- [ ] **Step 6: Commit**

```bash
git add shared/auth-client/handlers/launch.js shared/auth-client/tests/launch.test.js
git commit -m "feat(auth-client): store company from exchange on launch"
```

---

## Task 4: hub exchange returns top-level `company`

**Files:**
- Modify: `hub/routes/api-sessions.js:50-55` (the `res.json` payload)
- Test: `hub/tests/api-sessions-exchange.test.js` (add a case)

- [ ] **Step 1: Write the failing test**

In `hub/tests/api-sessions-exchange.test.js`, add (reuse the existing `buildWithApi()` helper + seeding pattern already in that file; the new assertion is the top-level `company`):

```javascript
test("exchange returns top-level company {id,name} for a company member", async () => {
  const { app, db } = await buildWithApi();
  const { createOrg } = await import("../lib/org.js?t=" + Date.now());
  const { createEntitlements } = await import("../lib/entitlements.js?t=" + Date.now());
  const org = createOrg(db);
  const ent = createEntitlements(db);
  db.prepare("INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)").run("u1", "a@b.c", "Alice", now());
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "member" });
  ent.grantEntitlement({ app: "poker", principalType: "company", principalId: c.id, grantedBy: "op" });
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)").run(sid, "u1", now(), now(), now() + 60000);
  const tok = randomToken();
  db.prepare("INSERT INTO launch_tokens (token,central_session_id,target_app,created_at,expires_at) VALUES (?,?,?,?,?)").run(tok, sid, "poker", now(), now() + 30000);

  const res = await request(app).post("/api/sessions/exchange").set("Authorization", "Bearer k-poker").send({ launch_token: tok });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.company, { id: c.id, name: "Acme" });
});
```

> NOTE: confirm the test's API key/header (`k-poker` / app `poker`) matches how `buildWithApi()` is keyed in this file; reuse whatever app the existing exchange tests use if `poker` isn't wired in the harness.

- [ ] **Step 2: Run to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/api-sessions-exchange.test.js`
Expected: FAIL — `res.body.company` is `undefined`.

- [ ] **Step 3: Implement**

In `hub/routes/api-sessions.js`, add `company` to the response object (the `company` row variable already exists at line 45):
```javascript
    res.json({
      user: { id: row.user_id, email: row.email, displayName: row.display_name },
      central_session_id: row.central_session_id,
      entitlement,
      teams,
      company: company ? { id: company.id, name: company.name } : null,
    });
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/api-sessions-exchange.test.js`
Expected: PASS.

- [ ] **Step 5: Full hub suite**

Run: `cd /var/www/suite/hub && npm test`
Expected: ALL pass.

- [ ] **Step 6: Commit**

```bash
git add hub/routes/api-sessions.js hub/tests/api-sessions-exchange.test.js
git commit -m "feat(hub): exchange returns top-level company {id,name}"
```

---

## Task 5: Phase A integration check + merge to main

- [ ] **Step 1: Run both suites green**

Run: `cd /var/www/suite/shared/auth-client && npm test` → ALL pass.
Run: `cd /var/www/suite/hub && npm test` → ALL pass.

- [ ] **Step 2: Push the branch (backup)**

```bash
git push origin feat/poker-room-sharing
```

- [ ] **Step 3: Merge Phase A to main locally + push** (per the project git workflow — local merge, only `main` is remote)

```bash
git checkout main
git merge --no-ff feat/poker-room-sharing -m "Merge Phase A: company on the session contract (poker room sharing)"
git push origin main
git checkout feat/poker-room-sharing
```

> Phase A is now on `main`; Retro slice 3 will reuse it. Do NOT deploy yet — deploy happens after Phase B (Task 16). Phase B (poker repo) can develop against this contract.

---

# PHASE B — poker repo (`/var/www/scrumpoker`, new branch `feat/room-sharing`)

> **Setup:** `cd /var/www/scrumpoker && git checkout main && git pull --ff-only && git checkout -b feat/room-sharing && git tag pre-room-sharing`. Bump the auth-client symlink so poker sees Phase A: `npm --prefix /var/www/scrumpoker install --omit=dev` is only needed on prod; locally the `file:` symlink already points at the updated source. All commands below run in `/var/www/scrumpoker`.

## Task 6: roomState mints a per-room share token + token lookup

**Files:**
- Modify: `lib/roomState.js`
- Test: `tests/room-state.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/room-state.test.js` add:

```javascript
test("a created room has a non-empty hex shareToken and is findable by it", () => {
  const { joinRoom, findRoomByToken } = require("../lib/roomState");
  const rooms = new Map();
  joinRoom(rooms, "co1-planning", "u1");
  const room = rooms.get("co1-planning");
  assert.match(room.shareToken, /^[0-9a-f]{32}$/);
  assert.equal(findRoomByToken(rooms, room.shareToken), "co1-planning");
  assert.equal(findRoomByToken(rooms, "nope"), null);
  assert.equal(findRoomByToken(rooms, ""), null);
});
```

(Use the file's existing `require`/`test`/`assert` header.)

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/room-state.test.js`
Expected: FAIL — `shareToken` undefined / `findRoomByToken` not exported.

- [ ] **Step 3: Implement**

In `lib/roomState.js`, add the crypto import at top:
```javascript
const { randomBytes } = require('node:crypto');
```
In `createRoom`, add a `shareToken`:
```javascript
function createRoom(now = Date.now()) {
  return {
    users: new Set(),
    lastActive: now,
    votesRevealed: false,
    facilitatorId: null,
    shareToken: randomBytes(16).toString('hex')
  };
}
```
Add a lookup function and export it:
```javascript
function findRoomByToken(rooms, token) {
  if (!token) return null;
  for (const [roomName, room] of rooms.entries()) {
    if (room.shareToken === token) return roomName;
  }
  return null;
}
```
Add `findRoomByToken` to `module.exports`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/room-state.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/roomState.js tests/room-state.test.js
git commit -m "feat(poker): per-room share token + findRoomByToken"
```

---

## Task 7: only authenticated participants can be auto-assigned facilitator

**Files:**
- Modify: `lib/roomState.js` (`assignFacilitator`, lines 90-107)
- Test: `tests/room-state.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
test("assignFacilitator skips anonymous participants", () => {
  const { joinRoom, assignFacilitator } = require("../lib/roomState");
  const rooms = new Map();
  joinRoom(rooms, "co1-r", "anon1");
  joinRoom(rooms, "co1-r", "auth1");
  const participants = {
    anon1: { id: "anon1", role: "Voter", roomName: "co1-r", authed: false },
    auth1: { id: "auth1", role: "Voter", roomName: "co1-r", authed: true },
  };
  // facilitator must be the authed user, never the anon one
  const fid = assignFacilitator(rooms, participants, "co1-r");
  assert.equal(fid, "auth1");

  // a room with only anon participants gets no facilitator
  const rooms2 = new Map();
  joinRoom(rooms2, "co1-x", "anonA");
  const p2 = { anonA: { id: "anonA", role: "Voter", roomName: "co1-x", authed: false } };
  assert.equal(assignFacilitator(rooms2, p2, "co1-x"), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/room-state.test.js`
Expected: FAIL — current `assignFacilitator` promotes the first participant regardless of `authed`.

- [ ] **Step 3: Implement**

In `lib/roomState.js`, change the eligibility check inside `assignFacilitator` so only `authed` participants qualify:
```javascript
function assignFacilitator(rooms, participants, roomName) {
  const room = rooms.get(roomName);
  if (!room) return null;

  const eligible = (id) => participants[id] && participants[id].authed;

  if (!room.facilitatorId || !eligible(room.facilitatorId)) {
    const nextFacilitatorId = Array.from(room.users).find(eligible);
    if (nextFacilitatorId) {
      room.facilitatorId = nextFacilitatorId;
      participants[nextFacilitatorId].role = ROLES.FACILITATOR;
    } else {
      room.facilitatorId = null;
    }
  } else {
    participants[room.facilitatorId].role = ROLES.FACILITATOR;
  }

  return room.facilitatorId;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/room-state.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/roomState.js tests/room-state.test.js
git commit -m "feat(poker): only authenticated participants can facilitate"
```

---

## Task 8: dual-path WS upgrade gate (session OR room token)

**Files:**
- Modify: `lib/upgradeAuth.js` (keep the pure session check; it already returns the full context, which now includes `company` from Phase A — no change needed beyond a passthrough test)
- Modify: `lib/wsServer.js` (the `server.on('upgrade')` handler, lines 30-56)
- Test: `tests/upgrade-auth.test.js` (company passthrough) + `tests/ws-server-upgrade.test.js` (create — the dual-path branch)

- [ ] **Step 1: Write the failing tests**

Append to `tests/upgrade-auth.test.js`:
```javascript
test('passes through company in the context', async () => {
  const ctx = { userId: 'u1', entitled: true, teams: [], company: { id: 'co1', name: 'Acme' } };
  const r = await authenticateUpgrade(async () => ctx, 'c');
  assert.deepEqual(r, { ok: true, context: ctx });
});
```

Create `tests/ws-server-upgrade.test.js` to test the upgrade decision in isolation. Extract the decision into a pure helper so it is testable without real sockets:
```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideUpgrade } = require('../lib/wsServer');
const { joinRoom } = require('../lib/roomState');

test('decideUpgrade: valid session → authed context', async () => {
  const rooms = new Map();
  const verify = async () => ({ userId: 'u1', entitled: true, teams: [], company: { id: 'co1', name: 'Acme' } });
  const d = await decideUpgrade({ verifySession: verify, cookie: 'poker_session=x', url: '/ws', rooms });
  assert.equal(d.ok, true);
  assert.equal(d.authed, true);
  assert.equal(d.hubUserId, 'u1');
  assert.deepEqual(d.company, { id: 'co1', name: 'Acme' });
});

test('decideUpgrade: no session but valid room token → anonymous', async () => {
  const rooms = new Map();
  joinRoom(rooms, 'co1-planning', 'host');
  const token = rooms.get('co1-planning').shareToken;
  const verify = async () => null;
  const d = await decideUpgrade({ verifySession: verify, cookie: '', url: `/ws?token=${token}`, rooms });
  assert.equal(d.ok, true);
  assert.equal(d.authed, false);
  assert.equal(d.anonRoom, 'co1-planning');
});

test('decideUpgrade: no session and bad token → 401', async () => {
  const rooms = new Map();
  const d = await decideUpgrade({ verifySession: async () => null, cookie: '', url: '/ws?token=nope', rooms });
  assert.deepEqual(d, { ok: false, status: 401 });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/upgrade-auth.test.js tests/ws-server-upgrade.test.js`
Expected: FAIL — `decideUpgrade` is not exported.

- [ ] **Step 3: Implement**

In `lib/wsServer.js`, add a pure `decideUpgrade` helper and use it in the upgrade handler. `authenticateUpgrade` is already imported (line 4); add `findRoomByToken` to the existing `require('./roomState')` destructure (line 3 currently imports `getRoomState, touchRoom`). Then add near the top (after imports):
```javascript
async function decideUpgrade({ verifySession, cookie, url, rooms }) {
  const sess = await authenticateUpgrade(verifySession, cookie);
  if (sess.ok) {
    const c = sess.context;
    return { ok: true, authed: true, hubUserId: c.userId, teams: c.teams || [], company: c.company || null };
  }
  const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  const token = new URLSearchParams(q).get('token');
  const anonRoom = findRoomByToken(rooms, token);
  if (anonRoom) return { ok: true, authed: false, anonRoom };
  return { ok: false, status: 401 };
}
```
(`authenticateUpgrade` is already imported at line 4 — don't double-import; reuse it.)

Replace the body of `server.on('upgrade', ...)` (lines 37-55) so it calls `decideUpgrade` and attaches the right fields:
```javascript
    let decision;
    try {
      decision = await decideUpgrade({ verifySession: auth.verifySession, cookie: req.headers.cookie, url, rooms });
    } catch (err) {
      logger.error('WS upgrade auth error:', err);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!decision.ok) {
      socket.write(`HTTP/1.1 ${decision.status} Unauthorized\r\n\r\n`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.authed = decision.authed;
      if (decision.authed) {
        ws.hubUserId = decision.hubUserId;
        ws.teams = decision.teams;
        ws.company = decision.company;
      } else {
        ws.anonRoom = decision.anonRoom;
      }
      wss.emit('connection', ws, req);
    });
```
Export `decideUpgrade`:
```javascript
module.exports = { createWsServer, sendToClient, decideUpgrade };
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/upgrade-auth.test.js tests/ws-server-upgrade.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/wsServer.js tests/upgrade-auth.test.js tests/ws-server-upgrade.test.js
git commit -m "feat(poker): dual-path WS upgrade gate (session or room share token)"
```

---

## Task 9: company-scoped login; anonymous Player is Voter-only

**Files:**
- Modify: `lib/wsHandlers.js` (`handleLogin`, lines 24-70)
- Test: `tests/ws-handlers.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/ws-handlers.test.js`, add (the file already has `createHarness`, `wsWith`, `loginPayload`):

```javascript
test('authed login is company-scoped and ignores teamId', (t) => {
  const harness = createHarness(t);
  const ws = { userId: 'alice', authed: true, company: { id: 'co1', name: 'Acme' }, teams: [] };
  handleLogin({ ws, userId: 'alice', payload: { name: 'Alice', role: ROLES.FACILITATOR, room: 'planning' }, rooms: harness.rooms, participants: harness.participants, sendToClient: harness.sendToClient, sendRoomState: harness.sendRoomState });
  assert.ok(harness.rooms.has('co1-planning'));
  assert.equal(harness.participants.alice.authed, true);
  assert.equal(harness.participants.alice.role, ROLES.FACILITATOR);
});

test('anonymous login forces Voter, ignores requested role/room, binds to ws.anonRoom', (t) => {
  const harness = createHarness(t);
  // seed the room the token resolved to
  harness.rooms.set('co1-planning', { users: new Set(), lastActive: Date.now(), votesRevealed: false, facilitatorId: null, shareToken: 'tok' });
  const ws = { userId: 'bob', authed: false, anonRoom: 'co1-planning' };
  handleLogin({ ws, userId: 'bob', payload: { name: 'Bob', role: ROLES.FACILITATOR, room: 'evil-room' }, rooms: harness.rooms, participants: harness.participants, sendToClient: harness.sendToClient, sendRoomState: harness.sendRoomState });
  assert.equal(harness.participants.bob.roomName, 'co1-planning');
  assert.equal(harness.participants.bob.role, ROLES.VOTER);
  assert.equal(harness.participants.bob.authed, false);
  assert.notEqual(harness.rooms.get('co1-planning').facilitatorId, 'bob');
});

test('authed login with no company errors', (t) => {
  const harness = createHarness(t);
  const ws = { userId: 'c', authed: true, company: null, teams: [] };
  handleLogin({ ws, userId: 'c', payload: { name: 'C', role: ROLES.VOTER, room: 'r' }, rooms: harness.rooms, participants: harness.participants, sendToClient: harness.sendToClient, sendRoomState: harness.sendRoomState });
  assert.equal(harness.participants.c, undefined);
  assert.match(harness.clientMessages.at(-1).message.payload.message, /company/i);
});
```

> Also update the existing team-based `handleLogin` tests in this file: the old model required `teamId ∈ ws.teams`. Replace those assertions with the company-scoped behavior (authed `ws.company`, room key `${companyId}-${room}`, no `teamId`). Any test asserting "not a member of that team" should be removed or rewritten to the no-company error above.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/ws-handlers.test.js`
Expected: FAIL — `handleLogin` still requires `teamId` and builds `${teamId}-${room}`.

- [ ] **Step 3: Implement**

Replace `handleLogin` in `lib/wsHandlers.js` with a dual-path version:
```javascript
function handleLogin({ ws, userId, payload, rooms, participants, sendToClient, sendRoomState }) {
  if (!payload || !payload.name) {
    return sendError(sendToClient, ws, 'Login requires a name.');
  }
  const name = String(payload.name);

  let internalRoom;
  let assignedRole;
  const authed = ws.authed === true;

  if (authed) {
    const companyId = ws.company && ws.company.id;
    if (!companyId) {
      return sendError(sendToClient, ws, 'No company on your session — re-launch poker from the hub.');
    }
    if (!payload.role || !payload.room) {
      return sendError(sendToClient, ws, 'Login requires name, role and room.');
    }
    if (!isValidRole(payload.role)) {
      return sendError(sendToClient, ws, 'Invalid role.');
    }
    internalRoom = `${companyId}-${payload.room}`;
    joinRoom(rooms, internalRoom, userId);
    const room = rooms.get(internalRoom);
    assignedRole = getAssignedLoginRole(payload.role, room.facilitatorId);
    if (isFacilitator(assignedRole)) room.facilitatorId = userId;
  } else {
    // Anonymous Player: room comes from the validated share token; always a Voter.
    internalRoom = ws.anonRoom;
    if (!internalRoom || !rooms.has(internalRoom)) {
      return sendError(sendToClient, ws, 'This room has closed or the link is invalid.');
    }
    joinRoom(rooms, internalRoom, userId);
    assignedRole = ROLES.VOTER;
  }

  ws.name = name;
  ws.role = assignedRole;
  ws.roomName = internalRoom;

  participants[userId] = {
    id: userId,
    ws,
    name,
    role: assignedRole,
    vote: null,
    roomName: internalRoom,
    authed
  };

  assignFacilitator(rooms, participants, internalRoom);
  sendRoomState(internalRoom);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/ws-handlers.test.js`
Expected: PASS (after updating the old team-based tests per the note).

- [ ] **Step 5: Commit**

```bash
git add lib/wsHandlers.js tests/ws-handlers.test.js
git commit -m "feat(poker): company-scoped login; anonymous Player is Voter-only"
```

---

## Task 10: facilitator actions stay locked to authenticated members

**Files:**
- Modify: `lib/wsHandlers.js` (`handleChangeRole`, lines 191-242 — block promoting an anon to Facilitator)
- Test: `tests/ws-handlers.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
test('changeRole cannot promote an anonymous participant to Facilitator', (t) => {
  const harness = createHarness(t);
  harness.rooms.set('co1-r', { users: new Set(['fac', 'anon']), lastActive: Date.now(), votesRevealed: false, facilitatorId: 'fac', shareToken: 'tok' });
  harness.participants.fac = { id: 'fac', ws: { userId: 'fac' }, name: 'Fac', role: ROLES.FACILITATOR, vote: null, roomName: 'co1-r', authed: true };
  harness.participants.anon = { id: 'anon', ws: { userId: 'anon' }, name: 'Anon', role: ROLES.VOTER, vote: null, roomName: 'co1-r', authed: false };
  handleChangeRole({ ws: harness.participants.fac.ws, currentUser: harness.participants.fac, payload: { targetUserId: 'anon', newRole: ROLES.FACILITATOR }, participants: harness.participants, rooms: harness.rooms, sendToClient: harness.sendToClient, sendRoomState: harness.sendRoomState });
  assert.equal(harness.participants.anon.role, ROLES.VOTER);
  assert.equal(harness.rooms.get('co1-r').facilitatorId, 'fac');
  assert.match(harness.clientMessages.at(-1).message.payload.message, /facilitator/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/ws-handlers.test.js`
Expected: FAIL — an anon can currently be promoted.

- [ ] **Step 3: Implement**

In `handleChangeRole`, right after the `isValidRole(newRole)` check and resolving `target`, add a guard before the promotion logic:
```javascript
  if (isFacilitator(newRole) && !target.authed) {
    return sendError(sendToClient, ws, 'Only company members can be made Facilitator.');
  }
```
(Place it after the `if (target.roomName !== roomName)` check and before the `if (isFacilitator(newRole)) { ... }` block.)

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/ws-handlers.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full poker unit suite**

Run: `npm test`
Expected: ALL pass. Fix any remaining team-based tests in `ws-operations.test.js` (the old integration test) to the company model, or delete cases that asserted team-membership rejection (now obsolete).

- [ ] **Step 6: Commit**

```bash
git add lib/wsHandlers.js tests/
git commit -m "feat(poker): block promoting anonymous players to Facilitator"
```

---

## Task 11: `/api/me` returns company; surface shareToken in room state

**Files:**
- Modify: `lib/httpApp.js:105-107` (`/api/me`)
- Modify: `lib/roomState.js` (`getRoomState`, lines 77-88 — include `shareToken`)
- Test: `tests/http-app.test.js`, `tests/room-state.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/http-app.test.js`, update the `fakeAuth` to include `company` and assert `/api/me`:
```javascript
test('/api/me returns the authed user id + company', async () => {
  const auth = {
    staticAssets: (req, res, next) => next(),
    handleLaunch: (req, res) => res.send('launch'),
    handleLogout: (req, res) => res.send('logout'),
    handleHeartbeat: (req, res) => res.json({ ok: true }),
    requireAuth: (req, res, next) => { req.user = { id: 'u1', entitled: true, teams: [], company: { id: 'co1', name: 'Acme' } }; next(); },
    _ctx: { hubBaseUrl: 'https://hub' },
  };
  const app = createHttpApp({ publicDir: path.join(__dirname, '..', 'public'), auth, getRoomCount: () => 0, buildInfo: {} });
  const res = await request(app).get('/api/me');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { userId: 'u1', company: { id: 'co1', name: 'Acme' } });
});
```

In `tests/room-state.test.js`:
```javascript
test('getRoomState includes the room shareToken', () => {
  const { joinRoom, getRoomState } = require('../lib/roomState');
  const rooms = new Map();
  joinRoom(rooms, 'co1-r', 'u1');
  const state = getRoomState(rooms, {}, 'co1-r');
  assert.match(state.payload.shareToken, /^[0-9a-f]{32}$/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/http-app.test.js tests/room-state.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `lib/httpApp.js`, change `/api/me`:
```javascript
  app.get('/api/me', auth.requireAuth, (req, res) => {
    res.json({ userId: req.user.id, company: req.user.company || null });
  });
```
In `lib/roomState.js` `getRoomState`, add `shareToken` to the payload:
```javascript
  return {
    type: 'updateState',
    payload: {
      participants: getRoomParticipants(participants, roomName),
      votesRevealed: room.votesRevealed || false,
      facilitatorId: room.facilitatorId || null,
      shareToken: room.shareToken || null
    }
  };
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/http-app.test.js tests/room-state.test.js`
Expected: PASS. Then `npm test` → ALL pass.

- [ ] **Step 5: Commit**

```bash
git add lib/httpApp.js lib/roomState.js tests/
git commit -m "feat(poker): /api/me returns company; room state carries shareToken"
```

---

## Task 12: extract the shared room view (`public/js/roomView.js`)

**Files:**
- Create: `public/js/roomView.js`
- Modify: `public/index.html` (load `roomView.js` before `app.js`)
- Modify: `public/js/app.js` (consume the shared view)

**Why:** both the authed page (`app.js`) and the anonymous join page (`join.js`, Task 14) render the same voting room. Extract the pure rendering/state from `app.js` into a reusable module so we don't duplicate ~600 lines. No behavior change — covered by existing Playwright e2e.

- [ ] **Step 1: Create `public/js/roomView.js`** exposing a factory `window.ScrumPokerRoomView.create({ sendMessage, getEls })` that owns: `handleServerMessage`, `updateUI`, `renderVotingCards`, `renderParticipantsList`, `renderRoundStatus`, `calculateAndDisplayAverage`, and the room-state module vars (`participants`, `votesRevealed`, `facilitatorId`, `currentUser`, `currentRoom`). Move those functions verbatim out of `app.js`, parameterizing DOM lookups through `getEls()`. Keep `cardDeck`/`clipboard`/`breathing-waves` usage as-is.

- [ ] **Step 2: Wire `index.html`** — add `<script src="/js/roomView.js"></script>` before `app.js`.

- [ ] **Step 3: `app.js` consumes it** — replace the moved functions with calls into `ScrumPokerRoomView`. `app.js` keeps only: connection, login flow, team-less changes (Task 13), and the share button (Task 13).

- [ ] **Step 4: Verify no regression via e2e**

Run: `npm run test:e2e`
Expected: existing Playwright specs still PASS (this is a pure refactor).

- [ ] **Step 5: Commit**

```bash
git add public/js/roomView.js public/index.html public/js/app.js
git commit -m "refactor(poker): extract shared roomView module"
```

> NOTE for executor: this is a mechanical extraction. Make the smallest move that keeps e2e green; do not change rendering behavior. If the extraction proves large, split into "move render functions" and "move state vars" as two commits.

---

## Task 13: authed page — remove team dropdown, company header, share-link button

**Files:**
- Modify: `public/js/app.js` (`loadTeams`→`loadCompany`, `handleLogin`, `updateUI` header, invite button)
- Modify: `public/index.html` (remove `#team-field`/`#team-select`; ensure a "Copy invite link" control exists)
- Test: covered by Task 15 e2e (no unit harness for app.js)

- [ ] **Step 1: Replace team loading with company loading.** Change `loadTeams()` to `loadCompany()`: `fetch('/api/me')` → `const { company } = await res.json();` store `currentCompany = company`; remove all `teamSelect`/`team-field` logic. Update `init()` to call `loadCompany()`.

- [ ] **Step 2: Company-scoped login.** In `handleLogin()`, remove `teamId`/`teamSelect` usage; send `sendMessage('login', { name, role, room })`. Remove the "Select a team" guard. Update `getStoredRoomSession`/`saveRoomSession`/`fillLoginFromStoredSession` to drop `teamId`.

- [ ] **Step 3: Company header.** In `updateUI` (now in `roomView.js`), set the org line from the company: `roomOrg.textContent = currentCompany?.name || ''` (replace the `userTeams.find(...)` lookup). Pass `currentCompany` into the room view.

- [ ] **Step 4: Share-link button.** Store `shareToken` from each `updateState` payload. Add a "Copy invite link" button (reuse the existing invite menu markup or add a button in `#facilitator-controls`) whose handler builds `${window.location.origin}/join?token=${shareToken}` and copies it via `window.ScrumPokerClipboard.copyText`. Show it only when `currentUser.role === 'Facilitator'` (consistent with today's invite menu gating).

- [ ] **Step 5: Remove `index.html` team markup** (`#team-field`, `#team-select`) and add/keep the Copy-invite-link control.

- [ ] **Step 6: Manual smoke + commit** (full verification is the e2e in Task 15)

```bash
git add public/js/app.js public/index.html
git commit -m "feat(poker): company-scoped UI; anonymous share-link button"
```

---

## Task 14: public anonymous join page (`join.html` + `join.js`)

**Files:**
- Create: `public/join.html`, `public/js/join.js`
- Test: covered by Task 15 e2e

- [ ] **Step 1: `public/join.html`** — a minimal page (reuse the room markup from `index.html`: `#poker-room-section`, voting cards, participants, results; plus a tiny name-only login overlay). Load `cardDeck.js`, `clipboard.js`, `roomView.js`, then `join.js`. No team field, no facilitator controls, no `/api/me` call.

- [ ] **Step 2: `public/js/join.js`** — bootstrap that:
  - reads `token` from `new URLSearchParams(location.search)`; if missing, show "This link is invalid.";
  - shows a single "Your name" field + Join button;
  - opens `new WebSocket(\`${proto}//${location.host}/ws?token=${token}\`)`;
  - on open, after the user submits a name, `sendMessage('login', { name })`;
  - drives the shared `ScrumPokerRoomView` with incoming `updateState` (vote-only — no facilitator controls rendered);
  - on `error` payload "closed/invalid", shows the friendly message;
  - on `sessionEnded`, shows "The facilitator ended this session."

- [ ] **Step 3: CSP check** — `connect-src 'self' ws: wss:` (httpApp.js:10) already allows the WS; `script-src 'self'` allows the local scripts. No CSP change needed.

- [ ] **Step 4: Commit**

```bash
git add public/join.html public/js/join.js
git commit -m "feat(poker): public anonymous join page (token → vote-only room)"
```

---

## Task 15: e2e — authed company room + anonymous token join

**Files:**
- Modify/create: `tests/e2e/*.spec.js` (follow the repo's existing Playwright + cookie-injection seeding from `tests/e2e/`)

- [ ] **Step 1: Write the e2e specs**
  1. **Authed, company-scoped:** seed an entitled session whose `company = { id:'co1', name:'Acme' }` (extend the existing cookie-injection seed to set the new `company` column); launch `/`, enter name + room, vote, reveal; assert the header shows "Acme" and a "Copy invite link" control is present.
  2. **Anonymous join:** from the authed session, read the room's `shareToken` (expose it in the DOM, e.g. a `data-share-token` attr set from `updateState`), open a second browser context at `/join?token=<token>` with NO cookie, enter a name, vote; assert the vote registers and **no reveal/reset controls** are present.
  3. **Closed-room link:** open `/join?token=deadbeef` (no live room) → assert the friendly "closed or invalid" message and that no WS room is joined.

- [ ] **Step 2: Run**

Run: `npm run test:e2e`
Expected: PASS (3 new specs + existing specs still green; update any existing spec that used the team dropdown).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/
git commit -m "test(poker): e2e for company-scoped rooms + anonymous token join"
```

---

## Task 16: full verify, tag, and prod deploy runbook

**Files:** none (ops)

- [ ] **Step 1: Full suites green**

Run: `cd /var/www/scrumpoker && npm test` → ALL pass.
Run: `cd /var/www/scrumpoker && npm run test:e2e` → ALL pass.

- [ ] **Step 2: Merge poker `feat/room-sharing` → poker `main`** (local merge, push; tag `post-room-sharing-dev`):
```bash
git push origin feat/room-sharing
git checkout main && git merge --no-ff feat/room-sharing -m "Merge poker room sharing (company-scope + anonymous links)"
git tag post-room-sharing-dev && git push origin main --tags
git checkout feat/room-sharing
```

- [ ] **Step 3: Deploy — Phase A (hub) is already on suite `main`** (merged in Task 5). On prod, in a careful step-by-step session (follow `feedback-step-by-step-shell` / `feedback-command-formatting` / `feedback-no-heredocs`):
  1. **Hub:** `cd /var/www/suite && git pull --ff-only origin main` → `sudo systemctl restart suite-hub` → `/healthz` 200. (Exchange now returns `company`; auth-client on disk updated. Additive — verify raid/signal/retro still launch.)
  2. **Backup** the poker sessions DB before deploy (`APP_SESSIONS_DB`, default `/var/www/scrumpoker/data/poker-sessions.db`): copy it aside. The `company` column is added by an idempotent ALTER on boot.
  3. **Poker app:** `cd /var/www/scrumpoker && git fetch --tags && git merge --ff-only origin/main` → `npm --prefix /var/www/scrumpoker install --omit=dev` (refreshes the auth-client symlink so the prod copy has Phase A) → `sudo systemctl restart scrumpoker` → `/health` 200.
  4. **Smoke:** launch poker from the hub → enter a room (no team dropdown; header shows the company) → Copy invite link → open it in a private window (no login) → join as a name → vote; confirm the anonymous voter cannot reveal. Then confirm an existing pre-deploy poker session re-launches cleanly (company snapshots at next exchange).
- [ ] **Step 4: Rollback** (app-only): poker `git checkout pre-room-sharing` + restore the sessions DB backup + `sudo systemctl restart scrumpoker`. Hub Phase A is additive and safe to leave.

---

## Self-review notes (author)

- **Spec coverage:** company contract (Tasks 1-4) ✓; company-scoped rooms (Task 9) ✓; anonymous share link + dual-path gate (Tasks 6,8,9) ✓; share token in-memory, dies with room — `findRoomByToken` scans live rooms, token on the room object, no persistence (Tasks 6,8) ✓; Players vote-only / facilitator authed-only (Tasks 7,9,10) ✓; Copy-invite button from origin (Tasks 11,13) ✓; public join page, no new route (Task 14) ✓; edge cases anon-only room / bad token (Tasks 7,8,9,14,15) ✓; testing (every task + 15) ✓; deploy two-phase (Tasks 5,16) ✓.
- **Out-of-scope respected:** no room browser, no link rotation/revocation, no DB-persisted rooms/tokens, no anon→facilitator promotion, no Retro/Signal/RAID changes.
- **Type/name consistency:** `decideUpgrade` returns `{ok, authed, hubUserId, teams, company, anonRoom, status}`; `ws.authed`/`ws.company`/`ws.anonRoom` set consistently in `wsServer` and read in `handleLogin`; participant gains `authed:boolean`, consumed by `assignFacilitator` + `handleChangeRole`; `findRoomByToken(rooms, token)` used in `decideUpgrade`; room field `shareToken` set in `createRoom`, surfaced in `getRoomState` and `/api` flows.
- **Known soft spots (flagged, not placeholders):** the Task-3 launch test must use the existing file's session-id capture mechanism (the inline sketch marks where); the frontend Tasks 12-14 lean on Playwright e2e rather than unit tests, matching how poker already tests its UI.
```
