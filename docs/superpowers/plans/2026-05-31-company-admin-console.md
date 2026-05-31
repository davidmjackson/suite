# Company-admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a customer-facing console at `/company/:slug` where company owners/admins self-manage their own teams and members.

**Architecture:** A thin new Express route module (`routes/company.js`) + a permission middleware (`middleware/requireCompanyRole.js`) + two Eta views, all built on the existing `lib/org.js` primitives and migration-002 tables. Invites create the `users` row immediately (no pending table, no change to the magic-link path). Operator `/admin` plane and all entitlement control are untouched.

**Tech Stack:** Node ESM, Express 4, Eta views, better-sqlite3, `node:test` + supertest. Hub currently 94/94 green.

---

## Spec

`docs/superpowers/specs/2026-05-31-company-admin-console-design.md`

## File structure

- **Modify** `hub/lib/org.js` — add read helpers (`adminCompaniesForUser`, `listCompanyMembers`, `listTeamMembers`) + mutators (`renameTeam`, `inviteCompanyMember`). Export them.
- **Create** `hub/middleware/requireCompanyRole.js` — `createRequireCompanyRole(db)` → `(allowedRoles) => middleware`. Loads company by `:slug`, checks `req.user`'s role, attaches `req.company` + `req.companyRole`.
- **Create** `hub/routes/company.js` — `mountCompany(app)`: all `/company/:slug*` routes.
- **Create** `hub/views/company/console.eta` — company overview (members + teams).
- **Create** `hub/views/company/team.eta` — single team's members.
- **Modify** `hub/server.js` — import + call `mountCompany(app)`.
- **Modify** `hub/routes/dashboard.js` + `hub/views/dashboard.eta` — render "Manage <company>" links.
- **Create** `hub/tests/company.test.js` — route/integration tests (supertest).
- **Modify** `hub/tests/org.test.js` — unit tests for the new `org.js` functions.

## Conventions (match existing code exactly)

- Run a single test file: `node --test tests/company.test.js`. Run all: `npm test`.
- ESM imports with `.js` extensions. `import { now, randomId } from "../lib/tokens.js"`.
- Route tests use `buildTestApp()` from `tests/helpers.js` then `mount<X>(app)`, then `request(app)...set("Cookie", \`hub_session=${sid}\`)`.
- Seed a logged-in user in tests: insert `users` row + a `central_sessions` row whose `expires_at > now()` and `last_heartbeat_at > now()-30min`.
- Friendly errors render the existing `error` view: `res.status(code).render("error", { title, message })`.
- Audit via `createAuditLogger(db).log({ userId, eventType, metadata, ip })` — **audit happens at the route layer**, never inside `org.js` (matches `routes/admin.js`).
- Email validation regex (copied from `routes/admin.js` / `routes/login.js`): `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, after `.trim().toLowerCase()`.

---

### Task 1: `org.js` read helpers — `adminCompaniesForUser`, `listCompanyMembers`, `listTeamMembers`

**Files:**
- Modify: `hub/lib/org.js`
- Test: `hub/tests/org.test.js`

**Design notes:**
- `hasLoggedIn` is derived from the durable audit trail, **not** `central_sessions` (those expire / are pruned / are deleted on logout, so an active member who logged out would wrongly read as "never joined"). Use `EXISTS(SELECT 1 FROM audit_events WHERE user_id = u.id AND event_type = 'session_created')`. Caveat: `prune.js` drops audit rows older than 90 days, so a member inactive for >90 days would revert to the "Invited" badge — cosmetic and acceptable.
- SQLite `EXISTS(...)` yields `0`/`1`; coerce to a JS boolean with `!!`.

- [ ] **Step 1: Write failing tests**

Add to the end of `hub/tests/org.test.js`:

```js
// --- Layer 3 console read helpers ---
test("adminCompaniesForUser returns only companies where user is owner/admin", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  seedUser(db, "u1", "u1@b.c");
  const a = org.createCompany({ name: "Acme", slug: "acme" });
  const b = org.createCompany({ name: "Beta", slug: "beta" });
  const c = org.createCompany({ name: "Gamma", slug: "gamma" });
  org.addCompanyMember({ userId: "u1", companyId: a.id, role: "owner" });
  org.addCompanyMember({ userId: "u1", companyId: b.id, role: "admin" });
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "member" });
  const rows = org.adminCompaniesForUser("u1");
  assert.deepEqual(rows.map((r) => r.slug), ["acme", "beta"]);
  assert.equal(rows[0].role, "owner");
  assert.equal(rows[1].role, "admin");
  db.close();
});

test("listCompanyMembers returns members with hasLoggedIn derived from audit", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  seedUser(db, "u1", "owner@b.c");
  seedUser(db, "u2", "invited@b.c");
  const a = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: a.id, role: "owner" });
  org.addCompanyMember({ userId: "u2", companyId: a.id, role: "member" });
  // u1 has logged in (audit session_created); u2 has not.
  db.prepare("INSERT INTO audit_events (user_id,event_type,created_at) VALUES (?,?,?)")
    .run("u1", "session_created", Date.now());
  const rows = org.listCompanyMembers(a.id);
  assert.equal(rows.length, 2);
  const u1 = rows.find((r) => r.userId === "u1");
  const u2 = rows.find((r) => r.userId === "u2");
  assert.equal(u1.email, "owner@b.c");
  assert.equal(u1.role, "owner");
  assert.equal(u1.hasLoggedIn, true);
  assert.equal(u2.hasLoggedIn, false);
  db.close();
});

test("listTeamMembers returns team members scoped to the team", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  seedUser(db, "u1", "u1@b.c");
  seedUser(db, "u2", "u2@b.c");
  const a = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: a.id, role: "owner" });
  org.addCompanyMember({ userId: "u2", companyId: a.id, role: "member" });
  const t = org.createTeam({ companyId: a.id, name: "Squad" });
  org.addTeamMember({ userId: "u1", teamId: t.id, role: "member" });
  const rows = org.listTeamMembers(t.id);
  assert.deepEqual(rows.map((r) => r.userId), ["u1"]);
  assert.equal(rows[0].email, "u1@b.c");
  db.close();
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd /var/www/suite/hub && node --test tests/org.test.js`
Expected: FAIL — `org.adminCompaniesForUser is not a function` (and the other two).

- [ ] **Step 3: Implement the three helpers in `org.js`**

In `hub/lib/org.js`, add these functions inside `createOrg` (e.g. right after `teamsForUser`, before the `return`):

```js
  function adminCompaniesForUser(userId) {
    return db.prepare(`
      SELECT c.id AS id, c.name AS name, c.slug AS slug, cm.role AS role
      FROM company_members cm
      JOIN companies c ON c.id = cm.company_id
      WHERE cm.user_id = ? AND cm.role IN ('owner','admin')
      ORDER BY c.name
    `).all(userId);
  }

  function listCompanyMembers(companyId) {
    return db.prepare(`
      SELECT u.id AS userId, u.email AS email, u.display_name AS display_name, cm.role AS role,
             EXISTS(SELECT 1 FROM audit_events ae WHERE ae.user_id = u.id AND ae.event_type = 'session_created') AS hasLoggedIn
      FROM company_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.company_id = ?
      ORDER BY u.email
    `).all(companyId).map((r) => ({ ...r, hasLoggedIn: !!r.hasLoggedIn }));
  }

  function listTeamMembers(teamId) {
    return db.prepare(`
      SELECT u.id AS userId, u.email AS email, u.display_name AS display_name, tm.role AS role,
             EXISTS(SELECT 1 FROM audit_events ae WHERE ae.user_id = u.id AND ae.event_type = 'session_created') AS hasLoggedIn
      FROM team_members tm
      JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ?
      ORDER BY u.email
    `).all(teamId).map((r) => ({ ...r, hasLoggedIn: !!r.hasLoggedIn }));
  }
```

Then add them to the `return { ... }` object:

```js
  return {
    createCompany, getCompany, getCompanyBySlug, suspendCompany, getTeam, ownerCount,
    addCompanyMember, setCompanyMemberRole, removeCompanyMember,
    createTeam, listTeams, teamsForUser,
    addTeamMember, removeTeamMember,
    adminCompaniesForUser, listCompanyMembers, listTeamMembers,
    COMPANY_ROLES, TEAM_ROLES,
  };
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /var/www/suite/hub && node --test tests/org.test.js`
Expected: PASS (all org tests green).

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite && git add hub/lib/org.js hub/tests/org.test.js
git commit -m "feat(hub): org.js read helpers for company-admin console"
```

---

### Task 2: `org.js` — `renameTeam`

**Files:**
- Modify: `hub/lib/org.js`
- Test: `hub/tests/org.test.js`

- [ ] **Step 1: Write failing test**

Add to `hub/tests/org.test.js`:

```js
test("renameTeam updates the name; missing team throws", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  const a = org.createCompany({ name: "Acme", slug: "acme" });
  const t = org.createTeam({ companyId: a.id, name: "Old" });
  org.renameTeam(t.id, "New");
  assert.equal(org.getTeam(t.id).name, "New");
  assert.throws(() => org.renameTeam("nope", "X"), /team_not_found/);
  assert.throws(() => org.renameTeam(t.id, "  "), /name_required/);
  db.close();
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/org.test.js`
Expected: FAIL — `org.renameTeam is not a function`.

- [ ] **Step 3: Implement `renameTeam`**

In `hub/lib/org.js`, add (next to `createTeam`):

```js
  function renameTeam(teamId, name) {
    const trimmed = (name || "").trim();
    if (!trimmed) throw new Error("name_required");
    if (!getTeam(teamId)) throw new Error("team_not_found");
    db.prepare("UPDATE teams SET name = ? WHERE id = ?").run(trimmed, teamId);
    return getTeam(teamId);
  }
```

Add `renameTeam` to the `return { ... }` (in the teams group: `createTeam, listTeams, renameTeam, teamsForUser,`).

- [ ] **Step 4: Run test, verify pass**

Run: `cd /var/www/suite/hub && node --test tests/org.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite && git add hub/lib/org.js hub/tests/org.test.js
git commit -m "feat(hub): org.renameTeam"
```

---

### Task 3: `org.js` — `inviteCompanyMember`

**Files:**
- Modify: `hub/lib/org.js`
- Test: `hub/tests/org.test.js`

**Design notes:**
- `addCompanyMember` is a plain `INSERT` and `company_members` is unique on `(user_id, company_id)`, so re-inviting an existing member would throw. `inviteCompanyMember` checks for existing membership first and returns `alreadyMember: true` (role untouched) instead.
- Creating the user row uses the same columns as `routes/admin.js:30`: `(id,email,display_name,is_admin,created_at)`.
- Wrap in a `db.transaction(...)` so a create-user + add-member pair is atomic.

- [ ] **Step 1: Write failing tests**

Add to `hub/tests/org.test.js`:

```js
test("inviteCompanyMember creates a dormant user + membership for a new email", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  const a = org.createCompany({ name: "Acme", slug: "acme" });
  // org.inviteCompanyMember does NOT lowercase — the route lowercases before
  // calling it (matches routes/admin.js). Pass an already-normalised email here.
  const r = org.inviteCompanyMember({ email: "new@b.c", companyId: a.id, role: "member" });
  assert.equal(r.alreadyMember, false);
  assert.equal(r.user.email, "new@b.c");
  const u = db.prepare("SELECT * FROM users WHERE email = ?").get("new@b.c");
  assert.ok(u);
  const m = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?").get(u.id, a.id);
  assert.equal(m.role, "member");
  db.close();
});

test("inviteCompanyMember reuses an existing user", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  seedUser(db, "u1", "exists@b.c");
  const a = org.createCompany({ name: "Acme", slug: "acme" });
  const r = org.inviteCompanyMember({ email: "exists@b.c", companyId: a.id, role: "admin" });
  assert.equal(r.alreadyMember, false);
  assert.equal(r.user.id, "u1");
  const m = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?").get("u1", a.id);
  assert.equal(m.role, "admin");
  db.close();
});

test("inviteCompanyMember is a no-op for an existing member (no throw, role untouched)", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  seedUser(db, "u1", "exists@b.c");
  const a = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: a.id, role: "owner" });
  const r = org.inviteCompanyMember({ email: "exists@b.c", companyId: a.id, role: "member" });
  assert.equal(r.alreadyMember, true);
  assert.equal(r.user.id, "u1");
  const m = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?").get("u1", a.id);
  assert.equal(m.role, "owner"); // unchanged
  db.close();
});
```


- [ ] **Step 2: Run tests, verify they fail**

Run: `cd /var/www/suite/hub && node --test tests/org.test.js`
Expected: FAIL — `org.inviteCompanyMember is not a function`.

- [ ] **Step 3: Implement `inviteCompanyMember`**

In `hub/lib/org.js`, add (near the company-member functions):

```js
  const inviteCompanyMember = db.transaction(({ email, companyId, role }) => {
    if (!getCompany(companyId)) throw new Error("company_not_found");
    let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) {
      const id = randomId();
      db.prepare("INSERT INTO users (id,email,display_name,is_admin,created_at) VALUES (?,?,?,?,?)")
        .run(id, email, null, 0, now());
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    }
    const existing = db.prepare("SELECT 1 FROM company_members WHERE user_id=? AND company_id=?")
      .get(user.id, companyId);
    if (existing) return { user, alreadyMember: true };
    addCompanyMember({ userId: user.id, companyId, role });
    return { user, alreadyMember: false };
  });
```

Add `inviteCompanyMember` to the `return { ... }` object (company-member group).

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /var/www/suite/hub && node --test tests/org.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite && git add hub/lib/org.js hub/tests/org.test.js
git commit -m "feat(hub): org.inviteCompanyMember (Approach A invite)"
```

---

### Task 4: `requireCompanyRole` middleware

**Files:**
- Create: `hub/middleware/requireCompanyRole.js`
- Test: `hub/tests/requireCompanyRole.test.js`

**Design notes:**
- Used after `requireSession` (needs `req.user`). Factory returns a `(allowedRoles) => middleware` so routes call `companyRole(["owner","admin"])`.
- The test mounts a tiny throwaway route guarded by the middleware to assert 404 / 403 / pass behaviour.

- [ ] **Step 1: Write failing test**

Create `hub/tests/requireCompanyRole.test.js`:

```js
// tests/requireCompanyRole.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";
import { createOrg } from "../lib/org.js";

async function setup({ role } = {}) {
  const { app, db } = await buildTestApp();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const org = createOrg(db);
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  if (role) org.addCompanyMember({ userId: "u1", companyId: c.id, role });

  const { createRequireSession } = await import("../middleware/requireSession.js?t=" + Date.now());
  const { createRequireCompanyRole } = await import("../middleware/requireCompanyRole.js?t=" + Date.now());
  const requireSession = createRequireSession(db);
  const companyRole = createRequireCompanyRole(db);
  app.get("/company/:slug/probe", requireSession, companyRole(["owner", "admin"]), (req, res) => {
    res.json({ company: req.company.slug, role: req.companyRole });
  });
  return { app, sid };
}

test("404 for an unknown company slug", async () => {
  const { app, sid } = await setup({ role: "owner" });
  const res = await request(app).get("/company/nope/probe").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 404);
});

test("403 for a non-member", async () => {
  const { app, sid } = await setup({ role: null });
  const res = await request(app).get("/company/acme/probe").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 403);
});

test("403 for a plain member (role not allowed)", async () => {
  const { app, sid } = await setup({ role: "member" });
  const res = await request(app).get("/company/acme/probe").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 403);
});

test("passes for an owner and attaches req.company + req.companyRole", async () => {
  const { app, sid } = await setup({ role: "owner" });
  const res = await request(app).get("/company/acme/probe").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { company: "acme", role: "owner" });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/requireCompanyRole.test.js`
Expected: FAIL — cannot find module `../middleware/requireCompanyRole.js`.

- [ ] **Step 3: Implement the middleware**

Create `hub/middleware/requireCompanyRole.js`:

```js
// middleware/requireCompanyRole.js
export function createRequireCompanyRole(db) {
  const getCompany = db.prepare("SELECT * FROM companies WHERE slug = ?");
  const getMembership = db.prepare("SELECT role FROM company_members WHERE user_id = ? AND company_id = ?");
  return (allowedRoles) => (req, res, next) => {
    const company = getCompany.get(req.params.slug);
    if (!company) {
      return res.status(404).render("error", { title: "Not found", message: "No such company." });
    }
    const m = getMembership.get(req.user.id, company.id);
    if (!m || !allowedRoles.includes(m.role)) {
      return res.status(403).render("error", { title: "Forbidden", message: "You don't have access to manage this company." });
    }
    req.company = company;
    req.companyRole = m.role;
    next();
  };
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `cd /var/www/suite/hub && node --test tests/requireCompanyRole.test.js`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite && git add hub/middleware/requireCompanyRole.js hub/tests/requireCompanyRole.test.js
git commit -m "feat(hub): requireCompanyRole middleware"
```

---

### Task 5: console route + view + mount in server.js

**Files:**
- Create: `hub/routes/company.js`
- Create: `hub/views/company/console.eta`
- Modify: `hub/server.js`
- Test: `hub/tests/company.test.js`

**Design notes:**
- This task wires the `GET /company/:slug` console (members + teams display) and the production mount. Mutation routes are added in later tasks to the same `routes/company.js`.
- All `/company/:slug*` routes are guarded by `requireSession` then `companyRole(["owner","admin"])`.
- `it.companyRole` is passed to the view so it can hide owner-only controls from admins (used in later tasks).

- [ ] **Step 1: Write failing test**

Create `hub/tests/company.test.js`:

```js
// tests/company.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";
import { createOrg } from "../lib/org.js";

// Build the app with the company routes mounted, plus a logged-in user
// who is a member of company "acme" at the given role.
async function build({ role = "owner" } = {}) {
  const { app, db, config } = await buildTestApp();
  const { mountCompany } = await import("../routes/company.js?t=" + Date.now());
  mountCompany(app);
  const org = createOrg(db);
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "owner@b.c", now());
  if (role) org.addCompanyMember({ userId: "u1", companyId: c.id, role });
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  return { app, db, org, company: c, sid, config };
}

const cookie = (sid) => `hub_session=${sid}`;

test("GET /company/:slug renders the console for an owner", async () => {
  const { app, org, company, sid } = await build({ role: "owner" });
  org.createTeam({ companyId: company.id, name: "Squad A" });
  const res = await request(app).get("/company/acme").set("Cookie", cookie(sid));
  assert.equal(res.status, 200);
  assert.match(res.text, /Acme/);
  assert.match(res.text, /owner@b\.c/);
  assert.match(res.text, /Squad A/);
  assert.match(res.text, /Back to dashboard/);
});

test("GET /company/:slug is 403 for a plain member", async () => {
  const { app, sid } = await build({ role: "member" });
  const res = await request(app).get("/company/acme").set("Cookie", cookie(sid));
  assert.equal(res.status, 403);
});

test("GET /company/:slug is 404 for an unknown slug", async () => {
  const { app, sid } = await build({ role: "owner" });
  const res = await request(app).get("/company/nope").set("Cookie", cookie(sid));
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/company.test.js`
Expected: FAIL — cannot find module `../routes/company.js`.

- [ ] **Step 3: Implement the route + view + mount**

Create `hub/routes/company.js`:

```js
// routes/company.js
import { createRequireSession } from "../middleware/requireSession.js";
import { createRequireCompanyRole } from "../middleware/requireCompanyRole.js";
import { createOrg } from "../lib/org.js";
import { createAuditLogger } from "../lib/audit.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function mountCompany(app) {
  const db = app.locals.db;
  const requireSession = createRequireSession(db);
  const companyRole = createRequireCompanyRole(db);
  const org = createOrg(db);
  const audit = createAuditLogger(db);
  const manage = [requireSession, companyRole(["owner", "admin"])];

  app.get("/company/:slug", ...manage, (req, res) => {
    const members = org.listCompanyMembers(req.company.id);
    const teams = org.listTeams(req.company.id);
    res.render("company/console", {
      user: req.user,
      company: req.company,
      companyRole: req.companyRole,
      members,
      teams,
    });
  });
}
```

Create `hub/views/company/console.eta`:

```html
<%~ include("../partials/header", { title: "Manage · " + it.company.name, user: it.user }) %>
<nav style="margin-bottom:24px;"><a href="/dashboard">← Back to dashboard</a></nav>
<h1><%= it.company.name %></h1>

<div class="card">
<h2>Members (<%= it.members.length %>)</h2>
<form method="POST" action="/company/<%= it.company.slug %>/members">
<p><input type="email" name="email" placeholder="email@example.com" required></p>
<p>
<select name="role">
<option value="member">Member</option>
<option value="admin">Admin</option>
<% if (it.companyRole === "owner") { %><option value="owner">Owner</option><% } %>
</select>
<button class="btn" type="submit">Invite member</button>
</p>
</form>
<table>
<thead><tr><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
<tbody>
<% for (const m of it.members) { %>
<tr>
<td><%= m.email %></td>
<td>
<% const canEditRow = it.companyRole === "owner" || m.role !== "owner"; %>
<% if (canEditRow) { %>
<form method="POST" action="/company/<%= it.company.slug %>/members/<%= m.userId %>/role" style="display:inline;">
<select name="role">
<option value="member" <%= m.role === "member" ? "selected" : "" %>>Member</option>
<option value="admin" <%= m.role === "admin" ? "selected" : "" %>>Admin</option>
<% if (it.companyRole === "owner") { %><option value="owner" <%= m.role === "owner" ? "selected" : "" %>>Owner</option><% } %>
</select>
<button class="btn" type="submit">Save</button>
</form>
<% } else { %><%= m.role %><% } %>
</td>
<td><%= m.hasLoggedIn ? "Active" : "Invited — not joined yet" %></td>
<td>
<% if (canEditRow) { %>
<form method="POST" action="/company/<%= it.company.slug %>/members/<%= m.userId %>/remove" style="display:inline;" onsubmit="return confirm('Remove <%= m.email %>?')"><button class="btn danger">Remove</button></form>
<% } %>
</td>
</tr>
<% } %>
</tbody></table>
</div>

<div class="card">
<h2>Teams (<%= it.teams.length %>)</h2>
<form method="POST" action="/company/<%= it.company.slug %>/teams">
<p><input type="text" name="name" placeholder="Team name" required> <button class="btn" type="submit">Create team</button></p>
</form>
<ul>
<% for (const t of it.teams) { %>
<li><a href="/company/<%= it.company.slug %>/teams/<%= t.id %>"><%= t.name %></a></li>
<% } %>
</ul>
</div>
<%~ include("../partials/footer") %>
```

In `hub/server.js`, add the import next to the other route imports (after line 16):

```js
import { mountCompany } from "./routes/company.js";
```

and the mount call next to the others (after `mountAdmin(app);`):

```js
mountCompany(app);
```

- [ ] **Step 4: Run test, verify pass**

Run: `cd /var/www/suite/hub && node --test tests/company.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite && git add hub/routes/company.js hub/views/company/console.eta hub/server.js hub/tests/company.test.js
git commit -m "feat(hub): company console GET route + view, mounted"
```

---

### Task 6: invite member (POST /company/:slug/members)

**Files:**
- Modify: `hub/routes/company.js`
- Test: `hub/tests/company.test.js`

**Design notes:**
- Admins may only invite `member` or `admin` (not `owner`) — owner-protection at the action level → 403 otherwise.
- Validate email; invalid → 400 `error` view.
- `alreadyMember` → friendly 200/redirect message is fine; simplest is redirect back (PRG). Since we can't easily flash without sessions, on `alreadyMember` redirect back to the console (idempotent, no error). Bad email → 400 error page.
- Audit `company_member_invited`.

- [ ] **Step 1: Write failing tests**

Add to `hub/tests/company.test.js`:

```js
test("owner can invite a new member; user + membership created", async () => {
  const { app, db, company, sid } = await build({ role: "owner" });
  const res = await request(app).post("/company/acme/members")
    .type("form").send({ email: "New@B.C", role: "member" })
    .set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "/company/acme");
  const u = db.prepare("SELECT * FROM users WHERE email = ?").get("new@b.c");
  assert.ok(u, "user row created (lowercased)");
  const m = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?").get(u.id, company.id);
  assert.equal(m.role, "member");
});

test("invalid email is rejected with 400", async () => {
  const { app, sid } = await build({ role: "owner" });
  const res = await request(app).post("/company/acme/members")
    .type("form").send({ email: "not-an-email", role: "member" })
    .set("Cookie", cookie(sid));
  assert.equal(res.status, 400);
});

test("admin cannot invite an owner (403)", async () => {
  const { app, sid } = await build({ role: "admin" });
  const res = await request(app).post("/company/acme/members")
    .type("form").send({ email: "x@b.c", role: "owner" })
    .set("Cookie", cookie(sid));
  assert.equal(res.status, 403);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd /var/www/suite/hub && node --test tests/company.test.js`
Expected: FAIL — POST returns 404 (route not defined).

- [ ] **Step 3: Implement the route**

In `hub/routes/company.js`, add inside `mountCompany` (after the `GET /company/:slug` handler):

```js
  app.post("/company/:slug/members", ...manage, (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    const role = req.body.role || "member";
    if (!EMAIL_RE.test(email)) {
      return res.status(400).render("error", { title: "Bad request", message: "Invalid email." });
    }
    if (!["owner", "admin", "member"].includes(role)) {
      return res.status(400).render("error", { title: "Bad request", message: "Invalid role." });
    }
    if (req.companyRole === "admin" && role === "owner") {
      return res.status(403).render("error", { title: "Forbidden", message: "Only an owner can grant the owner role." });
    }
    const r = org.inviteCompanyMember({ email, companyId: req.company.id, role });
    if (!r.alreadyMember) {
      audit.log({ userId: req.user.id, eventType: "company_member_invited", metadata: { company: req.company.slug, email, role }, ip: req.ip });
    }
    res.redirect("/company/" + req.company.slug);
  });
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /var/www/suite/hub && node --test tests/company.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite && git add hub/routes/company.js hub/tests/company.test.js
git commit -m "feat(hub): invite company member route"
```

---

### Task 7: change member role (POST /company/:slug/members/:userId/role)

**Files:**
- Modify: `hub/routes/company.js`
- Test: `hub/tests/company.test.js`

**Design notes:**
- Owner-protection: an admin may not set a role **to** owner, nor change a member whose **current** role is owner → 403.
- `org.setCompanyMemberRole` throws `last_owner` (demoting the final owner) and `not_a_member` — catch and render friendly errors (400) instead of a 500.

- [ ] **Step 1: Write failing tests**

Add to `hub/tests/company.test.js`:

```js
test("owner can change a member's role", async () => {
  const { app, db, company, org, sid } = await build({ role: "owner" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "m@b.c", now());
  org.addCompanyMember({ userId: "u2", companyId: company.id, role: "member" });
  const res = await request(app).post("/company/acme/members/u2/role")
    .type("form").send({ role: "admin" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  const m = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?").get("u2", company.id);
  assert.equal(m.role, "admin");
});

test("admin cannot promote anyone to owner (403)", async () => {
  const { app, db, company, org, sid } = await build({ role: "admin" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "m@b.c", now());
  org.addCompanyMember({ userId: "u2", companyId: company.id, role: "member" });
  const res = await request(app).post("/company/acme/members/u2/role")
    .type("form").send({ role: "owner" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 403);
});

test("admin cannot change an owner's role (403)", async () => {
  const { app, db, company, org, sid } = await build({ role: "admin" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "o2@b.c", now());
  org.addCompanyMember({ userId: "u2", companyId: company.id, role: "owner" });
  const res = await request(app).post("/company/acme/members/u2/role")
    .type("form").send({ role: "member" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 403);
});

test("demoting the last owner shows a friendly error, not a 500", async () => {
  const { app, sid } = await build({ role: "owner" }); // u1 is the only owner
  const res = await request(app).post("/company/acme/members/u1/role")
    .type("form").send({ role: "member" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 400);
  assert.match(res.text, /owner/i);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd /var/www/suite/hub && node --test tests/company.test.js`
Expected: FAIL — POST role route returns 404.

- [ ] **Step 3: Implement the route**

In `hub/routes/company.js`, add inside `mountCompany`:

```js
  app.post("/company/:slug/members/:userId/role", ...manage, (req, res) => {
    const role = req.body.role;
    const targetId = req.params.userId;
    if (!["owner", "admin", "member"].includes(role)) {
      return res.status(400).render("error", { title: "Bad request", message: "Invalid role." });
    }
    const target = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?")
      .get(targetId, req.company.id);
    if (!target) {
      return res.status(404).render("error", { title: "Not found", message: "Not a member of this company." });
    }
    if (req.companyRole === "admin" && (role === "owner" || target.role === "owner")) {
      return res.status(403).render("error", { title: "Forbidden", message: "Only an owner can manage owners." });
    }
    try {
      org.setCompanyMemberRole({ userId: targetId, companyId: req.company.id, role });
    } catch (e) {
      if (e.message === "last_owner") {
        return res.status(400).render("error", { title: "Can't change role", message: "A company must keep at least one owner." });
      }
      throw e;
    }
    audit.log({ userId: req.user.id, eventType: "company_member_role_changed", metadata: { company: req.company.slug, target: targetId, role }, ip: req.ip });
    res.redirect("/company/" + req.company.slug);
  });
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /var/www/suite/hub && node --test tests/company.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite && git add hub/routes/company.js hub/tests/company.test.js
git commit -m "feat(hub): change company member role (owner-protected)"
```

---

### Task 8: remove member (POST /company/:slug/members/:userId/remove)

**Files:**
- Modify: `hub/routes/company.js`
- Test: `hub/tests/company.test.js`

**Design notes:**
- Owner-protection: an admin may not remove an owner → 403.
- `org.removeCompanyMember` throws `last_owner` when removing the final owner → friendly 400. (It also cascades team_members for that company.)

- [ ] **Step 1: Write failing tests**

Add to `hub/tests/company.test.js`:

```js
test("owner can remove a member", async () => {
  const { app, db, company, org, sid } = await build({ role: "owner" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "m@b.c", now());
  org.addCompanyMember({ userId: "u2", companyId: company.id, role: "member" });
  const res = await request(app).post("/company/acme/members/u2/remove").set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  const m = db.prepare("SELECT 1 FROM company_members WHERE user_id=? AND company_id=?").get("u2", company.id);
  assert.equal(m, undefined);
});

test("admin cannot remove an owner (403)", async () => {
  const { app, db, company, org, sid } = await build({ role: "admin" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "o2@b.c", now());
  org.addCompanyMember({ userId: "u2", companyId: company.id, role: "owner" });
  const res = await request(app).post("/company/acme/members/u2/remove").set("Cookie", cookie(sid));
  assert.equal(res.status, 403);
});

test("removing the last owner shows a friendly error", async () => {
  const { app, sid } = await build({ role: "owner" }); // u1 is the only owner
  const res = await request(app).post("/company/acme/members/u1/remove").set("Cookie", cookie(sid));
  assert.equal(res.status, 400);
  assert.match(res.text, /owner/i);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd /var/www/suite/hub && node --test tests/company.test.js`
Expected: FAIL — remove route returns 404.

- [ ] **Step 3: Implement the route**

In `hub/routes/company.js`, add inside `mountCompany`:

```js
  app.post("/company/:slug/members/:userId/remove", ...manage, (req, res) => {
    const targetId = req.params.userId;
    const target = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?")
      .get(targetId, req.company.id);
    if (!target) {
      return res.status(404).render("error", { title: "Not found", message: "Not a member of this company." });
    }
    if (req.companyRole === "admin" && target.role === "owner") {
      return res.status(403).render("error", { title: "Forbidden", message: "Only an owner can remove an owner." });
    }
    try {
      org.removeCompanyMember({ userId: targetId, companyId: req.company.id });
    } catch (e) {
      if (e.message === "last_owner") {
        return res.status(400).render("error", { title: "Can't remove", message: "A company must keep at least one owner." });
      }
      throw e;
    }
    audit.log({ userId: req.user.id, eventType: "company_member_removed", metadata: { company: req.company.slug, target: targetId }, ip: req.ip });
    res.redirect("/company/" + req.company.slug);
  });
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /var/www/suite/hub && node --test tests/company.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite && git add hub/routes/company.js hub/tests/company.test.js
git commit -m "feat(hub): remove company member (owner-protected)"
```

---

### Task 9: create team (POST /company/:slug/teams)

**Files:**
- Modify: `hub/routes/company.js`
- Test: `hub/tests/company.test.js`

- [ ] **Step 1: Write failing test**

Add to `hub/tests/company.test.js`:

```js
test("owner can create a team", async () => {
  const { app, db, company, sid } = await build({ role: "owner" });
  const res = await request(app).post("/company/acme/teams")
    .type("form").send({ name: "Squad B" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  const t = db.prepare("SELECT * FROM teams WHERE company_id=? AND name=?").get(company.id, "Squad B");
  assert.ok(t);
});

test("creating a team with a blank name is rejected with 400", async () => {
  const { app, sid } = await build({ role: "owner" });
  const res = await request(app).post("/company/acme/teams")
    .type("form").send({ name: "   " }).set("Cookie", cookie(sid));
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/company.test.js`
Expected: FAIL — teams route returns 404.

- [ ] **Step 3: Implement the route**

In `hub/routes/company.js`, add inside `mountCompany`:

```js
  app.post("/company/:slug/teams", ...manage, (req, res) => {
    const name = (req.body.name || "").trim();
    if (!name) {
      return res.status(400).render("error", { title: "Bad request", message: "Team name is required." });
    }
    const team = org.createTeam({ companyId: req.company.id, name });
    audit.log({ userId: req.user.id, eventType: "team_created", metadata: { company: req.company.slug, team: team.id, name }, ip: req.ip });
    res.redirect("/company/" + req.company.slug);
  });
```

- [ ] **Step 4: Run test, verify pass**

Run: `cd /var/www/suite/hub && node --test tests/company.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite && git add hub/routes/company.js hub/tests/company.test.js
git commit -m "feat(hub): create team route"
```

---

### Task 10: team detail page (GET /company/:slug/teams/:teamId)

**Files:**
- Modify: `hub/routes/company.js`
- Create: `hub/views/company/team.eta`
- Test: `hub/tests/company.test.js`

**Design notes:**
- Guard cross-company access: the `:teamId` must belong to `req.company` (a team id from another company → 404), independent of the slug check.
- Pass `availableMembers` = company members not already on the team, to populate the "Add to team" picker.

- [ ] **Step 1: Write failing tests**

Add to `hub/tests/company.test.js`:

```js
test("GET team page renders members + add picker", async () => {
  const { app, db, company, org, sid } = await build({ role: "owner" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "m2@b.c", now());
  org.addCompanyMember({ userId: "u2", companyId: company.id, role: "member" });
  const t = org.createTeam({ companyId: company.id, name: "Squad" });
  org.addTeamMember({ userId: "u1", teamId: t.id, role: "member" });
  const res = await request(app).get(`/company/acme/teams/${t.id}`).set("Cookie", cookie(sid));
  assert.equal(res.status, 200);
  assert.match(res.text, /Squad/);
  assert.match(res.text, /owner@b\.c/);      // current team member
  assert.match(res.text, /m2@b\.c/);          // available to add
});

test("GET team page is 404 for a team in another company", async () => {
  const { app, db, org, sid } = await build({ role: "owner" });
  const other = org.createCompany({ name: "Other", slug: "other" });
  const otherTeam = org.createTeam({ companyId: other.id, name: "Theirs" });
  const res = await request(app).get(`/company/acme/teams/${otherTeam.id}`).set("Cookie", cookie(sid));
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd /var/www/suite/hub && node --test tests/company.test.js`
Expected: FAIL — team GET route returns 404 for the valid case too.

- [ ] **Step 3: Implement the route + view**

In `hub/routes/company.js`, add a helper near the top of `mountCompany` (after `const manage = ...`):

```js
  // Resolve a team that must belong to req.company; render 404 otherwise.
  function loadTeam(req, res) {
    const team = org.getTeam(req.params.teamId);
    if (!team || team.company_id !== req.company.id) {
      res.status(404).render("error", { title: "Not found", message: "No such team." });
      return null;
    }
    return team;
  }
```

Then add the route:

```js
  app.get("/company/:slug/teams/:teamId", ...manage, (req, res) => {
    const team = loadTeam(req, res);
    if (!team) return;
    const teamMembers = org.listTeamMembers(team.id);
    const memberIds = new Set(teamMembers.map((m) => m.userId));
    const availableMembers = org.listCompanyMembers(req.company.id).filter((m) => !memberIds.has(m.userId));
    res.render("company/team", {
      user: req.user,
      company: req.company,
      companyRole: req.companyRole,
      team,
      teamMembers,
      availableMembers,
    });
  });
```

Create `hub/views/company/team.eta`:

```html
<%~ include("../partials/header", { title: "Team · " + it.team.name, user: it.user }) %>
<nav style="margin-bottom:24px;"><a href="/company/<%= it.company.slug %>">← Back to <%= it.company.name %></a></nav>
<h1><%= it.team.name %></h1>

<div class="card">
<h2>Rename team</h2>
<form method="POST" action="/company/<%= it.company.slug %>/teams/<%= it.team.id %>/rename">
<p><input type="text" name="name" value="<%= it.team.name %>" required> <button class="btn" type="submit">Rename</button></p>
</form>
</div>

<div class="card">
<h2>Members (<%= it.teamMembers.length %>)</h2>
<table>
<thead><tr><th>Email</th><th></th></tr></thead>
<tbody>
<% for (const m of it.teamMembers) { %>
<tr>
<td><%= m.email %></td>
<td><form method="POST" action="/company/<%= it.company.slug %>/teams/<%= it.team.id %>/members/<%= m.userId %>/remove" style="display:inline;"><button class="btn danger">Remove</button></form></td>
</tr>
<% } %>
</tbody></table>

<h3>Add to team</h3>
<% if (it.availableMembers.length === 0) { %>
<p><em>All company members are already on this team.</em></p>
<% } else { %>
<form method="POST" action="/company/<%= it.company.slug %>/teams/<%= it.team.id %>/members">
<select name="userId">
<% for (const m of it.availableMembers) { %><option value="<%= m.userId %>"><%= m.email %></option><% } %>
</select>
<button class="btn" type="submit">Add</button>
</form>
<% } %>
</div>
<%~ include("../partials/footer") %>
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /var/www/suite/hub && node --test tests/company.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite && git add hub/routes/company.js hub/views/company/team.eta hub/tests/company.test.js
git commit -m "feat(hub): team detail page (cross-company guarded)"
```

---

### Task 11: rename team (POST /company/:slug/teams/:teamId/rename)

**Files:**
- Modify: `hub/routes/company.js`
- Test: `hub/tests/company.test.js`

- [ ] **Step 1: Write failing tests**

Add to `hub/tests/company.test.js`:

```js
test("owner can rename a team", async () => {
  const { app, db, company, org, sid } = await build({ role: "owner" });
  const t = org.createTeam({ companyId: company.id, name: "Old" });
  const res = await request(app).post(`/company/acme/teams/${t.id}/rename`)
    .type("form").send({ name: "Renamed" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  assert.equal(db.prepare("SELECT name FROM teams WHERE id=?").get(t.id).name, "Renamed");
});

test("renaming a team in another company is 404", async () => {
  const { app, org, sid } = await build({ role: "owner" });
  const other = org.createCompany({ name: "Other", slug: "other" });
  const otherTeam = org.createTeam({ companyId: other.id, name: "Theirs" });
  const res = await request(app).post(`/company/acme/teams/${otherTeam.id}/rename`)
    .type("form").send({ name: "Hijack" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd /var/www/suite/hub && node --test tests/company.test.js`
Expected: FAIL — rename route returns 404 for the valid case.

- [ ] **Step 3: Implement the route**

In `hub/routes/company.js`, add inside `mountCompany`:

```js
  app.post("/company/:slug/teams/:teamId/rename", ...manage, (req, res) => {
    const team = loadTeam(req, res);
    if (!team) return;
    const name = (req.body.name || "").trim();
    if (!name) {
      return res.status(400).render("error", { title: "Bad request", message: "Team name is required." });
    }
    org.renameTeam(team.id, name);
    audit.log({ userId: req.user.id, eventType: "team_renamed", metadata: { company: req.company.slug, team: team.id, name }, ip: req.ip });
    res.redirect(`/company/${req.company.slug}/teams/${team.id}`);
  });
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /var/www/suite/hub && node --test tests/company.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite && git add hub/routes/company.js hub/tests/company.test.js
git commit -m "feat(hub): rename team route"
```

---

### Task 12: add & remove team members

**Files:**
- Modify: `hub/routes/company.js`
- Test: `hub/tests/company.test.js`

**Design notes:**
- Add uses `org.addTeamMember({ userId, teamId, role: "member" })` (team role is fixed `member` — lead/member toggle is deferred per spec). It throws `not_company_member` if the user isn't a company member → friendly 400.
- Both routes guard the team via `loadTeam` (cross-company → 404).

- [ ] **Step 1: Write failing tests**

Add to `hub/tests/company.test.js`:

```js
test("add a company member to a team", async () => {
  const { app, db, company, org, sid } = await build({ role: "owner" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "m2@b.c", now());
  org.addCompanyMember({ userId: "u2", companyId: company.id, role: "member" });
  const t = org.createTeam({ companyId: company.id, name: "Squad" });
  const res = await request(app).post(`/company/acme/teams/${t.id}/members`)
    .type("form").send({ userId: "u2" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  assert.ok(db.prepare("SELECT 1 FROM team_members WHERE user_id=? AND team_id=?").get("u2", t.id));
});

test("adding a non-company-member to a team shows a friendly error", async () => {
  const { app, db, company, org, sid } = await build({ role: "owner" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u9", "outsider@b.c", now());
  const t = org.createTeam({ companyId: company.id, name: "Squad" });
  const res = await request(app).post(`/company/acme/teams/${t.id}/members`)
    .type("form").send({ userId: "u9" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 400);
});

test("remove a team member", async () => {
  const { app, db, company, org, sid } = await build({ role: "owner" });
  org.addTeamMember({ userId: "u1", teamId: org.createTeam({ companyId: company.id, name: "Squad" }).id, role: "member" });
  const t = db.prepare("SELECT id FROM teams WHERE company_id=? AND name=?").get(company.id, "Squad");
  const res = await request(app).post(`/company/acme/teams/${t.id}/members/u1/remove`).set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  assert.equal(db.prepare("SELECT 1 FROM team_members WHERE user_id=? AND team_id=?").get("u1", t.id), undefined);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd /var/www/suite/hub && node --test tests/company.test.js`
Expected: FAIL — team member routes return 404.

- [ ] **Step 3: Implement the routes**

In `hub/routes/company.js`, add inside `mountCompany`:

```js
  app.post("/company/:slug/teams/:teamId/members", ...manage, (req, res) => {
    const team = loadTeam(req, res);
    if (!team) return;
    const userId = req.body.userId;
    try {
      org.addTeamMember({ userId, teamId: team.id, role: "member" });
    } catch (e) {
      if (e.message === "not_company_member") {
        return res.status(400).render("error", { title: "Can't add", message: "That person is not a member of this company." });
      }
      throw e;
    }
    audit.log({ userId: req.user.id, eventType: "team_member_added", metadata: { company: req.company.slug, team: team.id, target: userId }, ip: req.ip });
    res.redirect(`/company/${req.company.slug}/teams/${team.id}`);
  });

  app.post("/company/:slug/teams/:teamId/members/:userId/remove", ...manage, (req, res) => {
    const team = loadTeam(req, res);
    if (!team) return;
    org.removeTeamMember({ userId: req.params.userId, teamId: team.id });
    audit.log({ userId: req.user.id, eventType: "team_member_removed", metadata: { company: req.company.slug, team: team.id, target: req.params.userId }, ip: req.ip });
    res.redirect(`/company/${req.company.slug}/teams/${team.id}`);
  });
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /var/www/suite/hub && node --test tests/company.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite && git add hub/routes/company.js hub/tests/company.test.js
git commit -m "feat(hub): add/remove team members"
```

---

### Task 13: dashboard "Manage <company>" links + final verification

**Files:**
- Modify: `hub/routes/dashboard.js`
- Modify: `hub/views/dashboard.eta`
- Test: `hub/tests/dashboard.test.js`

**Design notes:**
- The dashboard must show a "Manage <company>" link for each company where the user is owner/admin, using `org.adminCompaniesForUser(req.user.id)`.

- [ ] **Step 1: Write failing test**

Add to `hub/tests/dashboard.test.js`:

```js
test("dashboard shows a Manage link for companies the user owns/admins", async () => {
  const { app, db } = await buildWithDashboard();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const { createOrg } = await import("../lib/org.js?t=" + Date.now());
  const org = createOrg(db);
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "owner" });

  const res = await request(app).get("/dashboard").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /href="\/company\/acme"/);
  assert.match(res.text, /Acme/);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/dashboard.test.js`
Expected: FAIL — no `/company/acme` link in the output.

- [ ] **Step 3: Implement the dashboard change**

In `hub/routes/dashboard.js`, import `createOrg` at the top:

```js
import { createOrg } from "../lib/org.js";
```

In `mountDashboard`, create the org helper and pass `manageable` companies to the view:

```js
export function mountDashboard(app) {
  const db = app.locals.db;
  const requireSession = createRequireSession(db);
  const entitlements = createEntitlements(db);
  const org = createOrg(db);
  app.get("/dashboard", requireSession, (req, res) => {
    const apps = APPS.map((a) => ({
      ...a,
      entitled: entitlements.resolveEntitlement(req.user.id, a.key).entitled,
    }));
    const manageable = org.adminCompaniesForUser(req.user.id);
    res.render("dashboard", { user: req.user, apps, manageable });
  });
}
```

In `hub/views/dashboard.eta`, add a section before the admin link (before the `<% if (it.user.isAdmin) { %>` line):

```html
<% if (it.manageable && it.manageable.length) { %>
<section style="margin-top:32px;">
<h2>Manage</h2>
<ul>
<% it.manageable.forEach(function (c) { %>
<li><a href="/company/<%= c.slug %>">Manage <%= c.name %></a> (<%= c.role %>)</li>
<% }); %>
</ul>
</section>
<% } %>
```

- [ ] **Step 4: Run the test, verify pass**

Run: `cd /var/www/suite/hub && node --test tests/dashboard.test.js`
Expected: PASS.

- [ ] **Step 5: Run the FULL suite**

Run: `cd /var/www/suite/hub && npm test`
Expected: all tests PASS (the prior 94 + the new org/company/middleware/dashboard tests). If anything fails, fix before committing.

- [ ] **Step 6: Commit**

```bash
cd /var/www/suite && git add hub/routes/dashboard.js hub/views/dashboard.eta hub/tests/dashboard.test.js
git commit -m "feat(hub): dashboard Manage links for company owners/admins"
```

---

## Done criteria

- `npm test` in `hub/` is fully green (prior 94 + all new tests).
- A company owner/admin can, from the dashboard, open `/company/:slug`, invite members (creating dormant users), change roles (owner-protected), remove members, create/rename teams, and add/remove team members — all audited and visible in `/admin/audit`.
- Non-members and plain members get 403; unknown slugs/cross-company team ids get 404; last-owner and not-company-member violations show friendly errors, never 500s.
- No migration, no app redeploy. Ships on the next `suite-hub` restart.

## Deployment (after implementation, separate careful session)

Follow `reference-ionos-deploy` + the step-by-step shell rules. Outline: push `main`, on prod `/var/www/suite` `git pull` (fast-forward), restart `suite-hub.service`, verify `/healthz` 200 and that an owner can reach `/company/:slug`. Rollback = checkout the prior hub SHA + restart (routes/views are purely additive; no data altered).
```
