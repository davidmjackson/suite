# Retro team-rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the retro app's per-team shared join-key auth with the Sprint Suite auth hub (email identity + per-company `retro` entitlement), making identity-v2 **teams** the tenant boundary for retro boards.

**Architecture:** Retro becomes an `@suite/auth-client` consumer like poker. The hub gates *access* (login + `retro` entitlement) on HTTP pages and on the WebSocket upgrade; retro enforces *tenancy* in-process (a board belongs to a hub team; you may only touch it when that team is in your `ws.teams`). Boards are disposable, so the schema migrates clean (add `team_id` to `retros`, drop the shared-key `teams` table) with no content migration. No hub or auth-client code changes — poker's Phase A already shipped `verifySession`, `teams` on the session, and entitlement surfacing.

**Tech Stack:** Node.js (CommonJS), Express 4, `ws`, better-sqlite3, `@suite/auth-client` (file-symlinked from `../suite/shared/auth-client`), Playwright (e2e), `node:test` (unit).

**Repo:** `/var/www/retrospective` (default branch `main`). Spec: `/var/www/suite/docs/superpowers/specs/2026-05-31-retro-team-rooms-design.md`.

---

## File map

**Create:**
- `lib/upgradeAuth.js` — pure WS-upgrade allow/deny decision (copy of poker's).
- `lib/teamAccess.js` — pure tenancy helpers (`teamIdInTeams`, `boardTeamAllowed`).
- `tests/upgrade-auth.test.js`, `tests/team-access.test.js`, `tests/db-schema.test.js` — unit tests.
- `tests/e2e/_seed.js`, `tests/e2e/_auth.js` — e2e session+board seeding and cookie injection.
- `.env.example` — documents the new env contract.

**Modify:**
- `db.js` — schema v6 (add `retros.team_id`, drop `teams`), new team-scoped query helpers, remove key-hashing/admin-team functions.
- `server.js` — wire auth-client; `noServer` + upgrade gate; connection rewrite to use `ws.hubUserId`/`ws.teams` + team_id scoping; HTTP route rework; delete the JWT/login/admin subsystem.
- `public/lobby.js` — `/api/me` team dropdown; create board with `teamId`; WS lobby URL carries `teamId`.
- `public/client.js` — WS board URL on `/ws` with `name`/`role`; 401/close → reload; load heartbeat asset.
- `public/lobby.html`, `public/retrospective.html`, `public/actions.html` — remove key field; logout → `/auth/logout`; add `/auth-client/heartbeat.js`.
- `tests/ws-operations.test.js` — reworked for the team_id model.
- `package.json` — add `@suite/auth-client` dep; extend the `test` script with the new unit files.

**Delete:**
- `public/login.html`, `public/login.js`, `public/admin.html`, `public/admin.js`.

---

## Task 1: Branch, dependency, env contract

**Files:**
- Modify: `package.json`
- Create: `.env.example`

- [ ] **Step 1: Create the feature branch and baseline tag**

```bash
cd /var/www/retrospective
git checkout -b feat/suite-auth
git tag pre-suite-auth
```

- [ ] **Step 2: Install the auth-client (symlinked file dep)**

```bash
cd /var/www/retrospective
npm install file:../suite/shared/auth-client
```

Expected: `package.json` gains `"@suite/auth-client": "file:../suite/shared/auth-client"` under dependencies and a symlink appears at `node_modules/@suite/auth-client`.

- [ ] **Step 3: Write `.env.example`**

```bash
# Retro app — auth-hub integration
APP_NAME=retro
HUB_BASE_URL=https://sprintsuite.uk
HUB_API_KEY=replace-with-RETRO-line-from-suite-app-keys.txt
COOKIE_DOMAIN=sprintretro.uk
APP_BASE_URL=https://sprintretro.uk
APP_SESSIONS_DB=./data/retro-sessions.db

# Retro app — local
PORT=3001
NODE_ENV=production
RETRO_DB_PATH=./retros.db
RETRO_ALLOWED_ORIGINS=https://sprintretro.uk
# RETRO_RETENTION_DAYS=30
```

- [ ] **Step 4: Ensure the sessions DB dir is gitignored**

Confirm `.gitignore` contains `data/` (add the line if missing). The auth-client creates `data/retro-sessions.db` at runtime.

- [ ] **Step 5: Commit**

```bash
cd /var/www/retrospective
git add package.json package-lock.json .env.example .gitignore
git commit -m "chore(retro): add @suite/auth-client dep + env contract"
```

---

## Task 2: DB schema v6 — team_id on retros, drop shared-key teams

Retro boards are disposable (per spec), so v6 starts the board tables clean and adds `team_id TEXT NOT NULL`. The shared-key `teams` table and all key-hashing/admin-team code are removed.

**Files:**
- Modify: `db.js`
- Test: `tests/db-schema.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/db-schema.test.js
const test = require("node:test");
const assert = require("node:assert");
const Database = require("better-sqlite3");
const { ensureSchema, createRetroRow, getRetrosForTeamId, getRetroById } = require("../db");

function freshDb() {
  return new Promise((resolve, reject) => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db, (err) => (err ? reject(err) : resolve(db)));
  });
}

test("retros table has a NOT NULL team_id and no shared-key teams table", async () => {
  const db = await freshDb();
  const retroCols = db.prepare("PRAGMA table_info(retros)").all();
  const teamIdCol = retroCols.find((c) => c.name === "team_id");
  assert.ok(teamIdCol, "retros.team_id should exist");
  assert.strictEqual(teamIdCol.notnull, 1, "team_id should be NOT NULL");
  const teamsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='teams'")
    .get();
  assert.strictEqual(teamsTable, undefined, "shared-key teams table should be dropped");
});

test("getRetrosForTeamId returns only that team's boards", async () => {
  const db = await freshDb();
  createRetroRow(db, { id: "r1", title: "A", teamId: "t1" });
  createRetroRow(db, { id: "r2", title: "B", teamId: "t2" });
  const t1 = getRetrosForTeamId(db, "t1");
  assert.deepStrictEqual(t1.map((r) => r.id), ["r1"]);
  const got = getRetroById(db, "r2");
  assert.strictEqual(got.team_id, "t2");
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd /var/www/retrospective && node --test tests/db-schema.test.js`
Expected: FAIL — `createRetroRow` / `getRetrosForTeamId` / `getRetroById` are not exported and `team_id` does not exist.

- [ ] **Step 3: Rewrite `createNormalizedSchema` to add `team_id`**

In `db.js`, change the `retros` DDL inside `createNormalizedSchema` (currently `db.js:317-330`) to add `team_id`:

```js
  db.exec(`CREATE TABLE IF NOT EXISTS ${tableNames.retros} (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    team_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    closed INTEGER NOT NULL,
    closed_at TEXT,
    timer_duration_seconds INTEGER NOT NULL,
    timer_remaining_seconds INTEGER NOT NULL,
    timer_running INTEGER NOT NULL,
    timer_end_at INTEGER,
    last_action_json TEXT,
    updated_at TEXT NOT NULL
  )`);
```

- [ ] **Step 4: Add the v6 migration + drop the shared-key paths in `ensureSchema`**

Replace the body of `ensureSchema` (`db.js:771-826`) with the version below. It bumps `schema_version` to 6; at v6 it drops the legacy `teams` table and any pre-v6 `retros`/`cards`/`actions` (board content is disposable and cannot be remapped from team *name* to hub team id), then recreates the board tables with `team_id`. Remove the now-unused calls to `createTeamsSchema`, `ensureTeamsKeyHashing`, `backfillTeamsFromRetros`, `ensureAdminTeam`.

```js
function dropLegacyBoardData(db) {
  db.exec("DROP TABLE IF EXISTS teams");
  db.exec("DROP TABLE IF EXISTS actions");
  db.exec("DROP TABLE IF EXISTS cards");
  db.exec("DROP TABLE IF EXISTS retros");
}

function ensureSchema(db, callback) {
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    );
    const row = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get();
    const version = row ? Number.parseInt(row.value, 10) : 0;
    if (version < 6) {
      const tx = db.transaction(() => {
        dropLegacyBoardData(db);
        createNormalizedSchema(db, { retros: "retros", cards: "cards" });
        ensureCardCreatedByColumn(db);
        db.exec(
          "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '6')"
        );
      });
      tx();
    } else {
      createNormalizedSchema(db, { retros: "retros", cards: "cards" });
      ensureCardCreatedByColumn(db);
    }
    callback();
  } catch (err) {
    callback(err);
  }
}
```

- [ ] **Step 5: Update retro read/write to use `team_id`**

In `normalizeRetro` (`db.js:60-75`), replace the `team` field with `teamId`:

```js
function normalizeRetro(retro) {
  return {
    id: retro.id,
    title: retro.title || "Retrospective",
    teamId: retro.teamId || retro.team_id || "",
    createdAt: retro.createdAt || new Date().toISOString(),
    closed: Boolean(retro.closed),
    closedAt: retro.closedAt || null,
    columns: normalizeColumns(retro.columns || defaultColumns),
    actions: Array.isArray(retro.actions)
      ? retro.actions.map((action) => normalizeActionItem(action))
      : [],
    timer: normalizeTimer(retro.timer),
    lastAction: retro.lastAction || null
  };
}
```

In `runRetroUpsert` (`db.js:407-453`) replace every `team` column/binding with `team_id`, binding `normalized.teamId`. In `loadRetros` (`db.js:882`) pass `teamId: row.team_id` into `normalizeRetro` instead of `team: row.team`.

- [ ] **Step 6: Add team-scoped helpers and delete shared-key helpers**

Add to `db.js`:

```js
function createRetroRow(db, { id, title, teamId }) {
  const now = new Date().toISOString();
  return runRetroUpsert(
    db,
    "retros",
    normalizeRetro({
      id,
      title,
      teamId,
      createdAt: now,
      closed: false,
      closedAt: null,
      columns: { well: [], improve: [], continue: [] },
      actions: [],
      timer: null,
      lastAction: null
    }),
    now
  );
}

function getRetroById(db, id) {
  return db.prepare("SELECT * FROM retros WHERE id = ?").get(id) || null;
}

function getRetrosForTeamId(db, teamId) {
  return db
    .prepare("SELECT * FROM retros WHERE team_id = ? ORDER BY created_at DESC")
    .all(teamId);
}
```

Delete these functions and their `module.exports` entries: `createTeamsSchema`, `ensureTeamsKeyHashing`, `generateTeamKey`, `createKeySalt`, `hashTeamKey`, `isWeakTeamKey`, `verifyTeamKey`, `getTeamByName`, `getTeamById`, `createTeam`, `rotateTeamKey`, `backfillTeamsFromRetros`, `ensureAdminTeam`, `listTeams`, `deleteTeamById` (`db.js:83-309`). Remove the unused `crypto` require if nothing else uses it. Add `createRetroRow`, `getRetroById`, `getRetrosForTeamId` to `module.exports`.

- [ ] **Step 7: Run the test to confirm it passes**

Run: `cd /var/www/retrospective && node --test tests/db-schema.test.js`
Expected: PASS (both tests).

- [ ] **Step 8: Commit**

```bash
cd /var/www/retrospective
git add db.js tests/db-schema.test.js
git commit -m "feat(retro): schema v6 — team_id on retros, drop shared-key teams"
```

---

## Task 3: Pure auth/tenancy units (`upgradeAuth.js`, `teamAccess.js`)

**Files:**
- Create: `lib/upgradeAuth.js`, `lib/teamAccess.js`
- Test: `tests/upgrade-auth.test.js`, `tests/team-access.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/upgrade-auth.test.js
const test = require("node:test");
const assert = require("node:assert");
const { authenticateUpgrade } = require("../lib/upgradeAuth");

test("denies when verifySession returns null", async () => {
  const r = await authenticateUpgrade(async () => null, "");
  assert.deepStrictEqual(r, { ok: false, status: 401 });
});

test("denies when not entitled", async () => {
  const r = await authenticateUpgrade(
    async () => ({ userId: "u1", entitled: false, teams: [] }),
    "c"
  );
  assert.deepStrictEqual(r, { ok: false, status: 401 });
});

test("allows and returns context when entitled", async () => {
  const ctx = { userId: "u1", entitled: true, teams: [{ id: "t1", name: "A", role: "lead" }] };
  const r = await authenticateUpgrade(async () => ctx, "c");
  assert.deepStrictEqual(r, { ok: true, context: ctx });
});
```

```js
// tests/team-access.test.js
const test = require("node:test");
const assert = require("node:assert");
const { teamIdInTeams, boardTeamAllowed } = require("../lib/teamAccess");

const teams = [{ id: "t1", name: "A", role: "lead" }, { id: "t2", name: "B", role: "member" }];

test("teamIdInTeams matches by id", () => {
  assert.strictEqual(teamIdInTeams("t2", teams), true);
  assert.strictEqual(teamIdInTeams("t9", teams), false);
  assert.strictEqual(teamIdInTeams("t1", null), false);
});

test("boardTeamAllowed requires the board's team_id to be in the user's teams", () => {
  assert.strictEqual(boardTeamAllowed({ team_id: "t1" }, teams), true);
  assert.strictEqual(boardTeamAllowed({ team_id: "t9" }, teams), false);
  assert.strictEqual(boardTeamAllowed(null, teams), false);
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `cd /var/www/retrospective && node --test tests/upgrade-auth.test.js tests/team-access.test.js`
Expected: FAIL — modules `../lib/upgradeAuth` and `../lib/teamAccess` not found.

- [ ] **Step 3: Create `lib/upgradeAuth.js`**

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

- [ ] **Step 4: Create `lib/teamAccess.js`**

```js
// Pure tenancy helpers. A board belongs to one hub team (retros.team_id); a user
// may touch it only when that team is among the teams on their verified session.
function teamIdInTeams(teamId, teams) {
  if (!teamId || !Array.isArray(teams)) return false;
  return teams.some((t) => t && t.id === teamId);
}

function boardTeamAllowed(retro, teams) {
  if (!retro) return false;
  return teamIdInTeams(retro.team_id, teams);
}

module.exports = { teamIdInTeams, boardTeamAllowed };
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `cd /var/www/retrospective && node --test tests/upgrade-auth.test.js tests/team-access.test.js`
Expected: PASS (all 5).

- [ ] **Step 6: Commit**

```bash
cd /var/www/retrospective
git add lib/upgradeAuth.js lib/teamAccess.js tests/upgrade-auth.test.js tests/team-access.test.js
git commit -m "feat(retro): pure WS-upgrade + team-access units"
```

---

## Task 4: Wire auth-client into the HTTP app

Replace the JWT/login/admin HTTP surface with auth-client routes and a team-aware `/api/me`.

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Build the auth client and stop creating the bare WS server**

Replace the top of `server.js` (`server.js:1-35`). Add the auth-client + new lib requires; change `ws` import to also pull `WebSocket`; **do not** construct `new WebSocketServer({ server })` here any more (Task 5 builds it with `noServer`). Update the `db` import list to drop the deleted team-key functions and add the new helpers.

```js
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const http = require("http");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const { createAuthClient } = require("@suite/auth-client");
const { authenticateUpgrade } = require("./lib/upgradeAuth");
const { teamIdInTeams, boardTeamAllowed } = require("./lib/teamAccess");
const {
  normalizeRetro,
  openDatabase,
  ensureSchema,
  loadRetros,
  saveRetro,
  saveRetroCard,
  saveRetroAction,
  saveRetroTimer,
  saveRetros,
  seedFromJsonIfPresent,
  applyRetention,
  createRetroRow,
  getRetroById,
  getRetrosForTeamId
} = require("./db");

const app = express();
const server = http.createServer(app);

const auth = createAuthClient({
  appName: process.env.APP_NAME || "retro",
  hubBaseUrl: process.env.HUB_BASE_URL,
  hubApiKey: process.env.HUB_API_KEY,
  cookieName: "retro_session",
  cookieDomain: process.env.COOKIE_DOMAIN,
  dbPath: process.env.APP_SESSIONS_DB || path.join(__dirname, "data", "retro-sessions.db")
});

const clients = new Map();
const rooms = new Map();
const lobbyRooms = new Map();
```

- [ ] **Step 2: Delete the Admin-team bootstrap in `initializeState`**

In `initializeState` (`server.js:87-123`), remove the `try { ensureAdminTeam(db, adminKey); } catch ...` block (`server.js:94-98`). Leave the `loadRetros`/`seedFromJsonIfPresent` flow intact.

- [ ] **Step 3: Mount auth-client routes + entitled gate; rework the page/`/api/me` routes**

Replace the page-route block and `/api/login`,`/api/logout`,`/api/session`,`/api/admin/*`,`/api/teams` (`server.js:975-1259`) with the following. Keep the existing `express.json` middleware and the CSP middleware above it.

```js
// Auth hub integration
app.use("/auth-client", auth.staticAssets);
app.get("/auth/launch", auth.handleLaunch);
app.get("/auth/logout", auth.handleLogout);
app.post("/api/heartbeat", auth.handleHeartbeat);

function requireEntitled(req, res, next) {
  if (req.user && req.user.entitled) return next();
  return res.redirect(302, `${auth._ctx.hubBaseUrl}/dashboard`);
}

app.get("/", auth.requireAuth, requireEntitled, (req, res) => {
  res.redirect(302, "/lobby");
});

app.get("/lobby", auth.requireAuth, requireEntitled, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "lobby.html"));
});

app.get("/retrospective", auth.requireAuth, requireEntitled, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "retrospective.html"));
});

app.get("/retro", (req, res) => res.redirect(302, "/retrospective"));

app.get("/actions", auth.requireAuth, requireEntitled, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "actions.html"));
});

app.get("/license", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "license.html"));
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptimeSeconds: Math.floor(process.uptime()) });
});

app.get("/api/me", auth.requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id }, teams: req.user.teams || [] });
});

// Static assets only (no unguarded *.html). The page routes above own the HTML.
app.use(
  "/css",
  express.static(path.join(__dirname, "public", "css"))
);
app.use(
  "/js",
  express.static(path.join(__dirname, "public", "js"))
);
app.use(express.static(path.join(__dirname, "public"), {
  index: false,
  extensions: [],
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) res.status(404);
  }
}));
```

> Note: the `express.static` `setHeaders` 404-guard for `.html` is a belt-and-braces backstop; the real protection is that no route serves bare `*.html` and the static mount uses `extensions: []` so `/admin` no longer resolves to `admin.html`. Adjust the static mounts to match retro's actual asset folders if they differ from `css`/`js` (verify with `ls public`).

- [ ] **Step 4: Smoke the HTTP surface boots**

Run: `cd /var/www/retrospective && node -e "require('./server.js')"` for ~2s then Ctrl-C, or rely on the e2e in Task 12.
Expected: process logs the listen line with no `require`/throw errors. (Full request checks come in Tasks 7/12.)

- [ ] **Step 5: Commit**

```bash
cd /var/www/retrospective
git add server.js
git commit -m "feat(retro): mount auth-client routes, entitled gate, /api/me"
```

---

## Task 5: WebSocket upgrade gate (noServer)

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Create the WS server with `noServer` and add the upgrade gate**

Where the bare `wss` was previously created (now removed in Task 4), add — after `const server = http.createServer(app);` and after `auth` is built:

```js
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

server.on("upgrade", async (req, socket, head) => {
  socket.on("error", () => socket.destroy());
  const url = String(req.url || "");
  if (url !== "/ws" && !url.startsWith("/ws?")) {
    socket.destroy();
    return;
  }
  let result;
  try {
    result = await authenticateUpgrade(auth.verifySession, req.headers.cookie);
  } catch (err) {
    console.warn("WS upgrade auth error:", err);
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
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
    wss.emit("connection", ws, req);
  });
});
```

- [ ] **Step 2: Confirm the `connection` handler still binds**

The existing `wss.on("connection", (ws, req) => { ... })` (`server.js:1439`) stays — it is rewritten in Task 6. After this task it still references the old cookie auth; that is fixed next. Verify the file parses: `node -c server.js`. Expected: no syntax error.

- [ ] **Step 3: Commit**

```bash
cd /var/www/retrospective
git add server.js
git commit -m "feat(retro): WS upgrade gate via verifySession (noServer)"
```

---

## Task 6: Rewrite the WS connection — identity + team_id scoping

The connection no longer parses a JWT. Identity comes from `ws.hubUserId`/`ws.teams` (set at upgrade). The display `name` and self-declared `role` come from the WS URL query; the board's team is derived from its stored `team_id` (Approach B); the lobby uses a `teamId` query param validated against `ws.teams`.

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Replace the connection preamble**

Replace `server.js:1439-1496` (from `wss.on("connection"` through the `ws.send(JSON.stringify({ type: "init", retro }));` line) with:

```js
const ALLOWED_ROLES = new Set(["participant", "facilitator"]);

function readConnParams(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rawName = (url.searchParams.get("name") || "").trim().slice(0, 80);
  const rawRole = (url.searchParams.get("role") || "").trim().toLowerCase();
  return {
    retroId: url.searchParams.get("retroId"),
    view: url.searchParams.get("view"),
    teamId: url.searchParams.get("teamId"),
    name: rawName || "Anonymous",
    role: ALLOWED_ROLES.has(rawRole) ? rawRole : "participant"
  };
}

wss.on("connection", (ws, req) => {
  if (!isWebSocketOriginAllowed(req.headers)) {
    ws.send(JSON.stringify({ type: "error", message: "Origin not allowed." }));
    ws.close();
    return;
  }
  const { retroId, view, teamId, name, role } = readConnParams(req);
  const teams = Array.isArray(ws.teams) ? ws.teams : [];

  // Lobby: list one team's boards. The team must be one of the user's teams.
  if (view === "lobby") {
    if (!teamIdInTeams(teamId, teams)) {
      ws.send(JSON.stringify({ type: "error", message: "Not a member of that team." }));
      ws.close();
      return;
    }
    const clientId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    clients.set(ws, { id: clientId, name, team: teamId, role, view: "lobby" });
    joinLobbyRoom(teamId, ws);
    ws.send(JSON.stringify({ type: "retros", retros: listRetrosForTeam(teamId) }));
    ws.on("close", () => {
      clients.delete(ws);
      leaveLobbyRoom(teamId, ws);
    });
    return;
  }

  // Board: derive the owning team from the board itself and check membership.
  const retro = retroId ? getRetro(retroId) : null;
  if (!boardTeamAllowed(retro, teams)) {
    ws.send(JSON.stringify({ type: "error", message: "Retro not found." }));
    ws.close();
    return;
  }

  const clientId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  clients.set(ws, { id: clientId, name, retroId, role });
  joinRoom(retroId, ws);
  ws.send(JSON.stringify({ type: "init", retro }));
```

> `boardTeamAllowed(retro, teams)` reads `retro.team_id`. `getRetro` returns the in-memory normalized retro (Task 6 Step 2 ensures it carries `teamId`/`team_id`).

- [ ] **Step 2: Make `getRetro`/lobby helpers team_id-aware**

Find `listRetrosForTeam`, `joinLobbyRoom`, `leaveLobbyRoom`, `broadcastRetrosToLobby`, `closeTeamRooms`, and `getRetro` (search `server.js`). Change them to key on **team id** instead of team name:
- `listRetrosForTeam(teamId)` → return `state.retros.filter((r) => r.teamId === teamId)` (in-memory) — and ensure each `state.retros` entry exposes both `teamId` and `team_id`. The simplest is to have the in-memory retro carry `team_id` too; in `createRetro` and wherever retros enter `state`, set `retro.team_id = retro.teamId`. Add this one-liner in `createRetro` after `normalizeRetro(...)`: `result.team_id = result.teamId;` (capture the return in a `const result`).
- `joinLobbyRoom`/`leaveLobbyRoom`/`broadcastRetrosToLobby` take a `teamId` string (they were already string-keyed Maps; only the value passed changes from name to id).
- Delete `closeTeamRooms` if it is only referenced by the now-deleted admin delete route.

- [ ] **Step 3: Update `createRetro` to take teamId**

Change `createRetro` (`server.js:66-83`) signature/usage to `createRetro({ title, teamId })`, pass `teamId` into `normalizeRetro`, and set `team_id` on the returned object:

```js
function createRetro({ title, teamId }) {
  const result = normalizeRetro({
    id: `retro-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    teamId,
    createdAt: new Date().toISOString(),
    closed: false,
    closedAt: null,
    columns: { well: [], improve: [], continue: [] },
    actions: [],
    timer: null,
    lastAction: null
  });
  result.team_id = result.teamId;
  return result;
}
```

- [ ] **Step 4: Confirm the file parses**

Run: `cd /var/www/retrospective && node -c server.js`
Expected: no syntax error. (Behavioural verification is in Task 12 e2e.)

- [ ] **Step 5: Commit**

```bash
cd /var/www/retrospective
git add server.js
git commit -m "feat(retro): team_id-scoped WS connection + lobby"
```

---

## Task 7: HTTP board APIs — team_id list/create + ensureTeamAccess

**Files:**
- Modify: `server.js`
- Test: extend `tests/ws-operations.test.js` is done in Task 11; here add a focused HTTP test if a harness exists, else verify via e2e (Task 12).

- [ ] **Step 1: Rewrite `ensureTeamAccess` to use hub teams**

Replace `ensureTeamAccess` (`server.js:784-794`) and delete the old `requireAuth`/`getAuthFromRequest` usage. The route now relies on `auth.requireAuth` (auth-client) having set `req.user`; tenancy is the `team_id` check:

```js
function ensureBoardAccess(req, res, retro) {
  if (!retro || !boardTeamAllowed(retro, req.user.teams)) {
    res.status(404).json({ error: "Retro not found." });
    return false;
  }
  return true;
}
```

- [ ] **Step 2: Rewrite `GET /api/retros` and `POST /api/retros`**

Replace `server.js:1261-1294` with:

```js
app.get("/api/retros", auth.requireAuth, requireEntitled, (req, res) => {
  const teamId = String(req.query.teamId || "");
  if (!teamIdInTeams(teamId, req.user.teams)) {
    res.status(403).json({ error: "Not a member of that team." });
    return;
  }
  res.json({ retros: listRetrosForTeam(teamId) });
});

app.post("/api/retros", auth.requireAuth, requireEntitled, (req, res) => {
  const { title, teamId } = req.body || {};
  if (!teamIdInTeams(teamId, req.user.teams)) {
    res.status(403).json({ error: "Not a member of that team." });
    return;
  }
  const validatedTitle = validateText(title, "Title", maxRetroTitleLength, { required: true });
  if (validatedTitle.error) {
    res.status(400).json({ error: validatedTitle.error });
    return;
  }
  const retro = createRetro({ title: validatedTitle.value, teamId });
  state.retros.push(retro);
  if (!persistRetro(retro)) {
    res.status(500).json({ error: "Unable to persist retro." });
    return;
  }
  broadcastRetrosToLobby(teamId);
  res.status(201).json({ retro });
});
```

> Role is self-declared (no facilitator gate on creation) — any team member may create a board for their team, matching poker's self-declared model.

- [ ] **Step 3: Point the remaining board routes at `ensureBoardAccess` + `auth.requireAuth`**

For each board route that used `ensureTeamAccess(req, res, retro)` (e.g. `GET /api/retros/:id` `server.js:1296`, `POST /api/retros/:id/close` `server.js:1304`, and the card/action mutation routes), add `auth.requireAuth, requireEntitled` to the route chain and replace `const auth = ensureTeamAccess(req, res, retro); if (!auth) return;` with `if (!ensureBoardAccess(req, res, retro)) return;`. Where the old code used `auth.name` for `createdBy`/owner, use `req.user.id` (the hub user id) or the client-supplied display name as appropriate — search for `auth.name` and `auth.role` and replace: `auth.name` → the actor's display name is no longer on the HTTP request, so set `createdBy`/owner from `req.body.author` if the route passes one, else `"Anonymous"`. Remove any `auth.role !== "facilitator"` gates on close/mutations (self-declared model — drop the server-side role gate; the client hides controls for participants, consistent with poker).

> If a route genuinely needs the actor name server-side, accept it in the request body (the board UI already knows the logged-in display name). Keep this minimal: the tenancy check (`ensureBoardAccess`) is the security boundary; role is cosmetic.

- [ ] **Step 4: Confirm parse + commit**

Run: `cd /var/www/retrospective && node -c server.js`
Expected: no syntax error.

```bash
cd /var/www/retrospective
git add server.js
git commit -m "feat(retro): team_id-scoped board APIs, drop role gates"
```

---

## Task 8: Delete the dead JWT / login / admin / rate-limit code

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Remove the JWT + cookie auth machinery**

Delete from `server.js`: `base64UrlEncode`, `base64UrlDecode`, `signToken`, `verifyToken`, `parseCookies`, `getAuthFromRequest`, `getAuthFromHeaders`, the old `requireAuth(req,res)` (`server.js:642-782`). Delete the login rate-limit helpers (`getLoginRateLimitKey`, `checkLoginRateLimit`, `rejectLogin`, `clearLoginAttempts`, and their state Maps/consts — search `RateLimit`/`loginAttempts`). Delete the module-level `authSecret`, `authTtlHours`, `adminKey` constants and any `RETRO_AUTH_SECRET`/`RETRO_AUTH_TTL_HOURS`/`RETRO_ADMIN_KEY`/`RETRO_LOGIN_RATE_LIMIT_*` `process.env` reads.

- [ ] **Step 2: Confirm nothing still references the removed symbols**

Run: `cd /var/www/retrospective && grep -nE "signToken|verifyToken|getAuthFrom|authSecret|adminKey|retro_auth|RateLimit|ensureAdminTeam|verifyTeamKey|getTeamByName" server.js db.js`
Expected: **no matches** (empty output).

- [ ] **Step 3: Confirm parse**

Run: `cd /var/www/retrospective && node -c server.js && node -c db.js`
Expected: no syntax errors.

- [ ] **Step 4: Commit**

```bash
cd /var/www/retrospective
git add server.js
git commit -m "refactor(retro): delete JWT/login/admin/rate-limit subsystem"
```

---

## Task 9: Frontend — lobby (team picker)

**Files:**
- Modify: `public/lobby.js`, `public/lobby.html`

- [ ] **Step 1: Populate a team dropdown from `/api/me`**

In `public/lobby.js`, on load, fetch teams and render a `<select id="team-select">`. Replace any team-key input usage. Skeleton (adapt selectors to the existing markup):

```js
let teams = [];
let currentTeamId = null;

async function loadTeams() {
  const res = await fetch("/api/me", { credentials: "same-origin" });
  if (res.status === 401) { location.reload(); return; }
  const data = await res.json();
  teams = data.teams || [];
  const sel = document.getElementById("team-select");
  sel.innerHTML = "";
  teams.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    sel.appendChild(opt);
  });
  currentTeamId = teams.length ? teams[0].id : null;
  sel.value = currentTeamId || "";
  sel.addEventListener("change", () => { currentTeamId = sel.value; connectLobby(); });
  if (currentTeamId) connectLobby();
}
```

- [ ] **Step 2: Open the lobby WS with `teamId`, `name`, `role`**

```js
function connectLobby() {
  if (lobbyWs) lobbyWs.close();
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const name = encodeURIComponent(getDisplayName());        // existing name source
  const role = encodeURIComponent(getSelectedRole());        // participant|facilitator
  const url = `${proto}//${location.host}/ws?view=lobby&teamId=${encodeURIComponent(currentTeamId)}&name=${name}&role=${role}`;
  lobbyWs = new WebSocket(url);
  lobbyWs.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "retros") renderRetros(msg.retros);
    if (msg.type === "error") { /* show msg.message */ }
  };
  lobbyWs.onclose = (e) => { if (e.code === 4401 || e.code === 1008) location.reload(); };
}
```

- [ ] **Step 3: Create a board with `teamId`**

```js
async function createRetro(title) {
  const res = await fetch("/api/retros", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ title, teamId: currentTeamId })
  });
  if (res.status === 401) { location.reload(); return; }
  const data = await res.json();
  if (data.retro) location.href = `/retrospective?retroId=${encodeURIComponent(data.retro.id)}`;
}
```

- [ ] **Step 4: Update `public/lobby.html`**

Remove the team-key input field and the "join by key" controls. Add `<select id="team-select"></select>` with a label. Change any sign-out link to `href="/auth/logout"`. Add `<script src="/auth-client/heartbeat.js"></script>` before `</body>`.

- [ ] **Step 5: Commit**

```bash
cd /var/www/retrospective
git add public/lobby.js public/lobby.html
git commit -m "feat(retro): lobby team picker via /api/me"
```

---

## Task 10: Frontend — board client + shell pages

**Files:**
- Modify: `public/client.js`, `public/retrospective.html`, `public/actions.html`

- [ ] **Step 1: Point the board WS at `/ws` with `retroId`, `name`, `role`**

In `public/client.js`, build the WS URL on the `/ws` path (board sends only `retroId` + display fields; the server derives the team):

```js
const proto = location.protocol === "https:" ? "wss:" : "ws:";
const retroId = new URLSearchParams(location.search).get("retroId");
const name = encodeURIComponent(getDisplayName());
const role = encodeURIComponent(getSelectedRole());  // participant|facilitator
const wsUrl = `${proto}//${location.host}/ws?retroId=${encodeURIComponent(retroId)}&name=${name}&role=${role}`;
ws = new WebSocket(wsUrl);
ws.onclose = (e) => { if (e.code === 4401 || e.code === 1008) location.reload(); };
```

Remove any reading of a team join-key from the client. If `client.js` previously sent `Authorization` headers or relied on the `retro_auth` cookie, delete that — auth is now the `retro_session` cookie sent automatically on the WS upgrade.

- [ ] **Step 2: Add heartbeat + fix logout on the board/actions pages**

In `public/retrospective.html` and `public/actions.html`: add `<script src="/auth-client/heartbeat.js"></script>` before `</body>`; change any sign-out control to `href="/auth/logout"`.

- [ ] **Step 3: Commit**

```bash
cd /var/www/retrospective
git add public/client.js public/retrospective.html public/actions.html
git commit -m "feat(retro): board client on /ws + hub logout + heartbeat"
```

---

## Task 11: Delete login/admin pages; rework ws-operations tests

**Files:**
- Delete: `public/login.html`, `public/login.js`, `public/admin.html`, `public/admin.js`
- Modify: `tests/ws-operations.test.js`, `package.json`

- [ ] **Step 1: Delete the obsolete pages**

```bash
cd /var/www/retrospective
git rm public/login.html public/login.js public/admin.html public/admin.js
```

- [ ] **Step 2: Rework `tests/ws-operations.test.js`**

The existing file exercises the old name-scoped model. Update its setup to (a) reflect the `team_id` retro shape and (b) drop any JWT/login-key assertions. Where it constructed retros with `team: "X"`, use `team_id: "t1"`. Where it asserted name-based room access, assert `boardTeamAllowed`/`team_id ∈ teams` access instead. Reuse the pure helpers:

```js
const { boardTeamAllowed } = require("../lib/teamAccess");
// example replacement assertion:
assert.strictEqual(boardTeamAllowed({ team_id: "t1" }, [{ id: "t1" }]), true);
assert.strictEqual(boardTeamAllowed({ team_id: "tX" }, [{ id: "t1" }]), false);
```

Remove tests that asserted login/admin/key behaviour (those code paths are deleted).

- [ ] **Step 3: Add the new unit files to the `test` script**

In `package.json`, change `test` to include the new node:test files:

```json
"test": "node tests/ws-operations.test.js && node --test tests/theme-contrast.test.js tests/db-schema.test.js tests/upgrade-auth.test.js tests/team-access.test.js"
```

- [ ] **Step 4: Run the full unit suite**

Run: `cd /var/www/retrospective && npm test`
Expected: PASS (ws-operations + theme-contrast + db-schema + upgrade-auth + team-access).

- [ ] **Step 5: Commit**

```bash
cd /var/www/retrospective
git add public tests/ws-operations.test.js package.json
git commit -m "test(retro): rework ws-ops tests; delete login/admin pages"
```

---

## Task 12: e2e — cookie-injection smoke

Mirror poker/signal: seed an auth-client session + a board owned by the seed team, inject the `retro_session` cookie, and assert tenancy.

**Files:**
- Create: `tests/e2e/_seed.js`, `tests/e2e/_auth.js`
- Modify: `tests/e2e/retro-smoke.spec.js`; delete obsolete login/admin specs if present
- Reference: poker's `tests/e2e` (`/var/www/scrumpoker/tests/e2e`) for the exact cookie-injection shape

- [ ] **Step 1: Write `tests/e2e/_seed.js`**

Seed a session row into the auth-client store and a board into the retro DB. Use the same store API poker uses (`auth._ctx.store.create({...})`), or open the sessions DB directly with better-sqlite3 and insert a row with `entitled=1` and `teams` JSON. Seed: user `u1`, team `t1`/"Alpha"; board `r1` owned by `t1`; a second board `r2` owned by `t2` (a team `u1` is NOT in) to prove rejection.

```js
const path = require("path");
const Database = require("better-sqlite3");
const { ensureSchema, createRetroRow } = require("../../db");

const RETRO_DB = path.join(__dirname, ".data", "retro.db");
const SESSIONS_DB = path.join(__dirname, ".data", "retro-sessions.db");

function seed() {
  // board content
  const db = new Database(RETRO_DB);
  db.pragma("foreign_keys = ON");
  ensureSchema(db, () => {});
  createRetroRow(db, { id: "r1", title: "Sprint 1", teamId: "t1" });
  createRetroRow(db, { id: "r2", title: "Other", teamId: "t2" });
  db.close();

  // auth-client session (fresh ⇒ admitted from cache, no hub call)
  const sdb = new Database(SESSIONS_DB);
  // match the auth-client sessions schema: see shared/auth-client/lib/sessions-db.js
  // insert id, user_id, central_session_id, created_at, last_validated_at, expires_at, entitled, teams
  // (use the store's create() if exported; otherwise raw INSERT mirroring its columns)
  sdb.close();
}

module.exports = { seed, RETRO_DB, SESSIONS_DB, COOKIE: { name: "retro_session", value: "e2e-sess-1" } };
```

> Before writing the raw INSERT, open `/var/www/suite/shared/auth-client/lib/sessions-db.js` and copy the exact column list + how `teams` is JSON-encoded and `entitled` stored (0/1). Prefer requiring the store factory and calling `store.create(...)` so the schema stays in sync.

- [ ] **Step 2: Write `tests/e2e/_auth.js` (cookie injection)**

```js
async function injectSession(context, baseURL, cookie) {
  const url = new URL(baseURL);
  await context.addCookies([{
    name: cookie.name,
    value: cookie.value,
    domain: url.hostname,
    path: "/",
    httpOnly: true,
    sameSite: "Lax"
  }]);
}
module.exports = { injectSession };
```

- [ ] **Step 3: Rewrite `tests/e2e/retro-smoke.spec.js`**

```js
const { test, expect } = require("@playwright/test");
const { seed, COOKIE } = require("./_seed");
const { injectSession } = require("./_auth");

test.beforeAll(() => seed());

test("unauthenticated lobby bounces to the hub", async ({ page }) => {
  const res = await page.goto("/lobby", { waitUntil: "domcontentloaded" });
  // auth-client requireAuth 302s to the hub login; assert we did not stay on /lobby
  expect(page.url()).not.toContain("/lobby");
});

test("member can open their team's board; foreign board is rejected", async ({ page, context, baseURL }) => {
  await injectSession(context, baseURL, COOKIE);
  await page.goto("/retrospective?retroId=r1");
  // board r1 (team t1) loads — assert a board-shell element is visible
  await expect(page.locator("#retro-board, .retro-columns").first()).toBeVisible();

  // r2 (team t2) — the WS rejects; assert an error/redirect, board shell absent
  await page.goto("/retrospective?retroId=r2");
  await expect(page.locator(".retro-error, #ws-error").first()).toBeVisible();
});
```

> Adjust the board-shell / error selectors to retro's actual DOM (inspect `retrospective.html`). Delete `tests/e2e/header-waves.spec.js`/`page-shell.spec.js` only if they depend on the deleted login flow; otherwise leave them.

- [ ] **Step 4: Run e2e**

Run: `cd /var/www/retrospective && npx playwright test`
Expected: PASS for `retro-smoke.spec.js` (3 assertions). Fix selectors as needed until green.

- [ ] **Step 5: Commit**

```bash
cd /var/www/retrospective
git add tests/e2e
git commit -m "test(retro): cookie-injection e2e for team_id tenancy"
```

---

## Task 13: Full verification, holistic review, tag

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit + e2e suite**

Run: `cd /var/www/retrospective && npm test && npx playwright test`
Expected: all green.

- [ ] **Step 2: Manual dev smoke (optional, if a hub is reachable in dev)**

Start the app (`npm start` with a dev `.env` pointing at a dev hub), confirm: `/lobby` bounces when unauthenticated; after launch the team dropdown is populated; create+join a board works; a participant cannot see facilitator-only controls (cosmetic).

- [ ] **Step 3: Grep for leftover shared-key / JWT references across the repo**

Run: `cd /var/www/retrospective && grep -rnE "retro_auth|RETRO_AUTH_SECRET|RETRO_ADMIN_KEY|verifyTeamKey|join key|teamKey" server.js db.js public lib | grep -v node_modules`
Expected: no functional references (only incidental UI copy, if any — review each hit).

- [ ] **Step 4: Tag the merged dev build**

After the holistic review passes and `feat/suite-auth` is fast-forwarded to `main` (the agent/maintainer does the merge), tag:

```bash
cd /var/www/retrospective
git tag post-suite-auth-dev
```

> Do NOT tag `post-suite-auth` yet — that is reserved for after the prod deploy + click-through (Task 14).

---

## Task 14: Production deploy runbook (separate careful session)

> Execute interactively with the user following the step-by-step / no-heredocs / `---`-fenced shell conventions. App-only deploy + one hub grant. Boards are disposable; the schema migration is one-way but the deploy is reversible by tag + backup restore.

- [ ] **Step 1: Push the branch/tags to origin**

```bash
cd /var/www/retrospective
git push origin feat/suite-auth --tags
```

(Or push `main` if already merged, plus tags.)

- [ ] **Step 2: Hub provisioning — grant `retro` to the company**

On the prod hub, grant the `retro` entitlement to company `sprint-suite` (the company/team `Sprint Suite`/`Sprint Team` already exist from the poker deploy; both prod users are members). Run as the hub service user:

```bash
sudo -u suite-hub bash -c 'cd /var/www/suite/hub && node --env-file=.env scripts/grant-entitlement.js --app retro --principal-type company --principal sprint-suite'
```

> Confirm the exact flag names against `hub/scripts/grant-entitlement.js` before running. No quota (retro is free).

- [ ] **Step 3: Deploy prereqs (verify, do not assume)**

Confirm on prod: `/var/www/suite` ≥ `b396f3e` (auth-client express-as-dependency fix); auth-client deps installed (`cd /var/www/suite/shared/auth-client && npm ls better-sqlite3 express`); the retro service user can `require('@suite/auth-client')`. Note the retro systemd unit name, `User=`, and `EnvironmentFile=` path (mirror the scrumpoker deploy notes).

- [ ] **Step 4: Back up, fetch, install**

```bash
cd /var/www/retrospective
cp .env .env.pre-suite-auth
```

Back up the retro DB (path from `RETRO_DB_PATH`) to `<db>.pre-suite-auth`. Then fetch + checkout the deployed ref and:

```bash
npm --prefix /var/www/retrospective install --omit=dev
```

- [ ] **Step 5: Rewrite `/var/www/retrospective/.env` (short single-line writes)**

Set `APP_NAME=retro`, `HUB_BASE_URL=https://sprintsuite.uk`, `COOKIE_DOMAIN=sprintretro.uk`, `APP_BASE_URL=https://sprintretro.uk`, `APP_SESSIONS_DB=<prod path>`, `HUB_API_KEY=<RETRO line from ~/suite-app-keys.txt>`; keep `PORT=3001`, `NODE_ENV=production`, `RETRO_DB_PATH`, `RETRO_ALLOWED_ORIGINS=https://sprintretro.uk`; drop `RETRO_AUTH_SECRET`/`RETRO_AUTH_TTL_HOURS`/`RETRO_ADMIN_KEY`/`RETRO_LOGIN_RATE_LIMIT_*`. Write the key with `sed -n "s|^...|...|p"` from the keys file rather than a long printf. Verify each write landed.

- [ ] **Step 6: Restart + verify the migration applied**

Restart the retro systemd service. Confirm: the service logs the listen line; `https://sprintretro.uk/health` → `{status:"ok"}`; the retro DB now reports `schema_version = 6` and `retros` has a `team_id` column (the v6 migration drops disposable boards on first boot).

- [ ] **Step 7: Click-through**

In a browser: hub dashboard → Sprintretro tile → SSO → `/lobby` shows the team picker → create a board → add a card (realtime sync) → open Actions. Confirm an unauthenticated `/lobby` bounces to the hub.

- [ ] **Step 8: Tag prod**

```bash
cd /var/www/retrospective
git tag post-suite-auth && git push origin post-suite-auth
```

- [ ] **Rollback (app-only, reversible):** `git checkout pre-suite-auth` + restore `.env.pre-suite-auth` + restore the DB backup + restart the service. (The hub grant is additive — harmless to leave.)

---

## Self-review notes

- **Spec coverage:** single-repo (Tasks 2–13) ✓; disposable-board clean migration (Task 2) ✓; drop shared-key `teams` (Task 2) ✓; self-declared roles + admin-plane deletion (Tasks 6–8, 11) ✓; team-picker lobby with server-derived board team / Approach B (Tasks 6, 9) ✓; auth-client HTTP wiring + entitled gate + `/api/me` (Task 4) ✓; WS upgrade gate via `verifySession` (Task 5) ✓; env contract (Tasks 1, 14) ✓; tests incl. cookie-injection e2e (Tasks 2, 3, 11, 12) ✓; deploy + one `grant-entitlement` (Task 14) ✓.
- **Type/name consistency:** `team_id` (DB column) ↔ `teamId` (normalized in-memory + API), with `createRetro`/`createRetroRow` setting both; `boardTeamAllowed(retro, teams)` reads `retro.team_id`; `teamIdInTeams(teamId, teams)` used by lobby + create + list. `authenticateUpgrade(verifySession, cookieHeader)` returns `{ok,status}|{ok,context}`. `req.user = {id, entitled, teams}` (auth-client) — note `/api/me` exposes `user.id` (not `userId`), matching the auth-client `req.user.id`.
- **Known follow-ups (not blockers):** retro's WS message handlers (timer/card/action) currently read `clients.get(ws).role`; with self-declared roles this is now a client-supplied string — acceptable per the self-declared decision (cosmetic gating, the tenancy boundary is the team check). The exact e2e DOM selectors and the auth-client sessions-DB insert shape must be confirmed against the live files during Task 12.
