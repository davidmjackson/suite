# CTM Role-Gating (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse company roles to `owner`/`member` (CR/CTM), and let owners selectively grant Signal/RAID per member using the existing per-user entitlement machinery.

**Architecture:** Hub-internal change. Roles drop `admin` (→ `member`); console management becomes owner-only. Poker/Retro stay company-level entitlements (everyone). Signal/RAID become per-user entitlements the owner toggles in the console (RAID 25/mo per member). A one-time idempotent SQL migration re-homes the live `sprint-suite` grants. The exchange derives company context from membership so user-typed entitlements keep it.

**Tech Stack:** Node ESM, Express, better-sqlite3, Eta views, `node:test` + `node:assert/strict`. Tests open `openDb(":memory:")`. Run all hub tests with `npm test` from `/var/www/suite/hub`.

**Spec:** `docs/superpowers/specs/2026-06-02-ctm-role-gating-design.md`

**Working dir for all commands:** `/var/www/suite/hub`

**Branch:** `feat/ctm-role-gating` (already created).

---

## Background the executor must know

- **Migrations are pure `.sql` files run via `db.exec()` on EVERY boot** (`db/index.js` reads `db/migrations/*.sql` sorted and execs each). So a data migration MUST be idempotent / safe to re-run. Existing files: `001-initial.sql`, `002-identity-entitlements.sql`, `003-access-requests.sql`.
- **Entitlement resolution** (`lib/entitlements.js`): `resolveEntitlement(userId, app)` checks the user's principals — `user`, every `team`, and every `company` they belong to — and returns `{ entitled, principal, quota }`. `consume(userId, app)` enforces quota (used by RAID's metered action). `grantEntitlement` upserts on `(app, principal_type, principal_id)`; `revokeEntitlement` sets `status='suspended'`.
- **`app_entitlements`** unique key is `(app, principal_type, principal_id)`. `principal_type ∈ {company, team, user}`.
- **Role model today** (`lib/org.js`): `COMPANY_ROLES = {owner, admin, member}`. Console access = `role IN ('owner','admin')`.
- **Console route** (`routes/company.js`) mounts every handler behind `manage = [requireSession, companyRole(["owner","admin"])]` and has several `req.companyRole === "admin"` special-cases that become dead under two roles.
- **Test helper** `tests/helpers.js` `buildTestApp()` builds an Express app with an in-memory DB; individual unit tests often just `openDb(":memory:")` + the lib under test (see `tests/org.test.js`).
- `randomId()` = `randomBytes(16).toString("hex")` (32 hex chars) — equivalent to SQL `lower(hex(randomblob(16)))`.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `db/migrations/004-ctm-role-gating.sql` | **create** | Idempotent data migration: `admin→member`, re-home company Signal/RAID to owners (user-level), suspend company-level Signal/RAID. |
| `lib/org.js` | modify | `COMPANY_ROLES = {owner, member}`; `adminCompaniesForUser` → owner-only. |
| `lib/provisioning.js` | modify | Grant Poker/Retro at company level; Signal/RAID at user level to the new owner. |
| `routes/company.js` | modify | Management owner-only; drop `admin` branches/options; add per-member Signal/RAID grant/revoke handler; enrich console GET with per-member app state. |
| `views/company/console.eta` | modify | Remove the `admin` role option; add per-member Signal/RAID toggles. |
| `routes/api-sessions.js` | modify | Derive `companyId` from membership when the entitlement is user-typed. |
| Tests (several) | modify/create | New behavior + update existing `admin`-referencing tests. |

---

## Task 1: Data migration — role collapse + Signal/RAID re-home

**Files:**
- Create: `db/migrations/004-ctm-role-gating.sql`
- Test: `tests/db-004.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/db-004.test.js`:

```javascript
// tests/db-004.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { openDb } from "../db/index.js";
import { createOrg } from "../lib/org.js";
import { randomId, now } from "../lib/tokens.js";

const MIGRATION = new URL("../db/migrations/004-ctm-role-gating.sql", import.meta.url);
function runMigration(db) {
  db.exec(fs.readFileSync(MIGRATION, "utf8"));
}

// Seed a company with an owner + an admin member + company-level signal/raid grants,
// bypassing the role-validating lib (we are emulating PRE-migration prod data).
function seedLegacy(db) {
  const companyId = randomId();
  db.prepare("INSERT INTO companies (id,name,slug,status,created_at) VALUES (?,?,?, 'active', ?)")
    .run(companyId, "Acme", "acme", now());
  const ownerId = randomId(), adminId = randomId();
  for (const [id, role] of [[ownerId, "owner"], [adminId, "admin"]]) {
    db.prepare("INSERT INTO users (id,email,display_name,is_admin,created_at) VALUES (?,?,?,0,?)")
      .run(id, id + "@acme.test", null, now());
    db.prepare("INSERT INTO company_members (user_id,company_id,role,created_at) VALUES (?,?,?,?)")
      .run(id, companyId, role, now());
  }
  for (const [app, lim, per] of [["poker", null, null], ["retro", null, null], ["signal", null, null], ["raid", 25, "month"]]) {
    db.prepare("INSERT INTO app_entitlements (id,app,principal_type,principal_id,status,quota_limit,quota_period,granted_by,granted_at) VALUES (?,?, 'company', ?, 'active', ?,?, 'op', ?)")
      .run(randomId(), app, companyId, lim, per, now());
  }
  return { companyId, ownerId, adminId };
}

test("migration 004 collapses admin to member", () => {
  const db = openDb(":memory:");
  const { adminId, companyId } = seedLegacy(db);
  runMigration(db);
  const role = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?").get(adminId, companyId).role;
  assert.equal(role, "member");
  db.close();
});

test("migration 004 re-homes company signal/raid to owners (user-level) and suspends company grants", () => {
  const db = openDb(":memory:");
  const { ownerId, adminId, companyId } = seedLegacy(db);
  runMigration(db);
  // owner now has user-level signal (unlimited) + raid (25/month)
  const ownerSignal = db.prepare("SELECT * FROM app_entitlements WHERE app='signal' AND principal_type='user' AND principal_id=? AND status='active'").get(ownerId);
  const ownerRaid = db.prepare("SELECT * FROM app_entitlements WHERE app='raid' AND principal_type='user' AND principal_id=? AND status='active'").get(ownerId);
  assert.ok(ownerSignal, "owner should have user-level signal");
  assert.equal(ownerSignal.quota_limit, null);
  assert.ok(ownerRaid, "owner should have user-level raid");
  assert.equal(ownerRaid.quota_limit, 25);
  assert.equal(ownerRaid.quota_period, "month");
  // the former admin (now member) gets NO user-level signal/raid
  const memberSignal = db.prepare("SELECT 1 FROM app_entitlements WHERE app='signal' AND principal_type='user' AND principal_id=? AND status='active'").get(adminId);
  assert.equal(memberSignal, undefined);
  // company-level signal/raid are suspended; poker/retro still active
  const compActive = db.prepare("SELECT app FROM app_entitlements WHERE principal_type='company' AND principal_id=? AND status='active' ORDER BY app").all(companyId).map(r => r.app);
  assert.deepEqual(compActive, ["poker", "retro"]);
  db.close();
});

test("migration 004 is idempotent (re-running is a no-op)", () => {
  const db = openDb(":memory:");
  const { ownerId } = seedLegacy(db);
  runMigration(db);
  runMigration(db); // second run
  const ownerRaidRows = db.prepare("SELECT COUNT(*) AS n FROM app_entitlements WHERE app='raid' AND principal_type='user' AND principal_id=?").get(ownerId).n;
  assert.equal(ownerRaidRows, 1, "must not create duplicate user-level raid rows");
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/db-004.test.js` (or `node --test tests/db-004.test.js`)
Expected: FAIL — migration file does not exist yet (`ENOENT`) / assertions fail.

- [ ] **Step 3: Write the migration**

Create `db/migrations/004-ctm-role-gating.sql`:

```sql
-- 004-ctm-role-gating.sql
-- Slice 2: collapse roles to owner|member and re-home Signal/RAID to per-user.
-- IMPORTANT: this file is exec'd on EVERY boot, so every statement must be
-- idempotent / safe to re-run.

-- 1. Collapse the admin tier into member (two-role model: owner | member).
UPDATE company_members SET role = 'member' WHERE role = 'admin';

-- 2. Re-home each company-level Signal/RAID grant to every owner of that
--    company at the user level (Signal unlimited, RAID keeps 25/month).
--    INSERT OR IGNORE + the UNIQUE(app,principal_type,principal_id) key makes
--    re-runs a no-op. After step 3 suspends the source rows, this SELECT is
--    empty on later boots anyway.
INSERT OR IGNORE INTO app_entitlements
  (id, app, principal_type, principal_id, status, quota_limit, quota_period, granted_by, granted_at)
SELECT lower(hex(randomblob(16))), ae.app, 'user', cm.user_id, 'active',
       ae.quota_limit, ae.quota_period, ae.granted_by, ae.granted_at
FROM app_entitlements ae
JOIN company_members cm
  ON cm.company_id = ae.principal_id AND cm.role = 'owner'
WHERE ae.principal_type = 'company'
  AND ae.status = 'active'
  AND ae.app IN ('signal', 'raid');

-- 3. Suspend the company-level Signal/RAID grants so members stop inheriting them.
UPDATE app_entitlements SET status = 'suspended'
WHERE principal_type = 'company'
  AND status = 'active'
  AND app IN ('signal', 'raid');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/db-004.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite (sanity — migration runs on every test DB)**

Run: `npm test`
Expected: All existing tests still PASS (migration is a no-op on empty in-memory DBs).

- [ ] **Step 6: Commit**

```bash
git add db/migrations/004-ctm-role-gating.sql tests/db-004.test.js
git commit -m "feat(hub): migration 004 — collapse roles, re-home Signal/RAID per-user"
```

---

## Task 2: `org.js` — two-role model

**Files:**
- Modify: `lib/org.js` (`COMPANY_ROLES` line ~4; `adminCompaniesForUser` query line ~120)
- Test: `tests/org.test.js`

- [ ] **Step 1: Write/adjust the failing tests**

In `tests/org.test.js`, add these tests and update any existing test that adds a member with role `"admin"` (change `"admin"` → `"member"`). New tests:

```javascript
test("addCompanyMember rejects the removed admin role", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  db.prepare("INSERT INTO users (id,email,is_admin,created_at) VALUES ('u1','u1@x',0,1)").run();
  assert.throws(() => org.addCompanyMember({ userId: "u1", companyId: c.id, role: "admin" }), /invalid_company_role/);
  db.close();
});

test("adminCompaniesForUser returns only companies where the user is owner", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  db.prepare("INSERT INTO users (id,email,is_admin,created_at) VALUES ('owner','o@x',0,1)").run();
  db.prepare("INSERT INTO users (id,email,is_admin,created_at) VALUES ('mem','m@x',0,1)").run();
  org.addCompanyMember({ userId: "owner", companyId: c.id, role: "owner" });
  org.addCompanyMember({ userId: "mem", companyId: c.id, role: "member" });
  assert.equal(org.adminCompaniesForUser("owner").length, 1);
  assert.equal(org.adminCompaniesForUser("mem").length, 0);
  db.close();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/org.test.js`
Expected: FAIL — `admin` is still accepted; a `member` still gets no rows but an `admin` would have (old query included admin).

- [ ] **Step 3: Implement**

In `lib/org.js`, change the roles set:

```javascript
const COMPANY_ROLES = new Set(["owner", "member"]);
```

And change `adminCompaniesForUser` (the `WHERE cm.role IN ('owner','admin')`) to owner-only:

```javascript
  function adminCompaniesForUser(userId) {
    return db.prepare(`
      SELECT c.id AS id, c.name AS name, c.slug AS slug, cm.role AS role
      FROM company_members cm
      JOIN companies c ON c.id = cm.company_id
      WHERE cm.user_id = ? AND cm.role = 'owner'
      ORDER BY c.name
    `).all(userId);
  }
```

(Keep the function name `adminCompaniesForUser` to avoid churn in `dashboard.js`/tests; it now means "companies this user owns".)

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/org.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/org.js tests/org.test.js
git commit -m "feat(hub): collapse company roles to owner|member; owner-only management"
```

---

## Task 3: `provisioning.js` — Signal/RAID granted per-user to the owner

**Files:**
- Modify: `lib/provisioning.js` (the `DEFAULT_APPS` constant + the grant loop in `approve`)
- Test: `tests/provisioning.test.js`

- [ ] **Step 1: Update the failing test**

In `tests/provisioning.test.js`, replace the entitlement assertions in the "approve provisions ..." test (around lines 37-41) with:

```javascript
  // Poker + Retro at COMPANY level
  const compEnts = db.prepare("SELECT app FROM app_entitlements WHERE principal_type='company' AND principal_id=? AND status='active' ORDER BY app").all(company.id);
  assert.deepEqual(compEnts.map((e) => e.app), ["poker", "retro"]);
  // Signal + RAID at USER level, granted to the new owner
  const userEnts = db.prepare("SELECT app, quota_limit, quota_period FROM app_entitlements WHERE principal_type='user' AND principal_id=? AND status='active' ORDER BY app").all(res.user.id);
  assert.deepEqual(userEnts.map((e) => e.app), ["raid", "signal"]);
  const raid = userEnts.find((e) => e.app === "raid");
  assert.equal(raid.quota_limit, 25);
  assert.equal(raid.quota_period, "month");
```

Also update the test name if it says "4 entitlements" → "company poker/retro + owner signal/raid".

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/provisioning.test.js`
Expected: FAIL — signal/raid are still company-level.

- [ ] **Step 3: Implement**

In `lib/provisioning.js`, replace the `DEFAULT_APPS` constant with two lists:

```javascript
// Apps every approved company gets at the COMPANY level (all members inherit).
const DEFAULT_COMPANY_APPS = [{ app: "poker" }, { app: "retro" }];
// Specialist apps granted to the first owner (CR) at the USER level. RAID is
// capped per-member (demo guardrail); members are enabled later in the console.
const DEFAULT_OWNER_APPS = [{ app: "signal" }, { app: "raid", quotaLimit: 25, quotaPeriod: "month" }];
```

In `approve`, replace the single grant loop with:

```javascript
    for (const a of DEFAULT_COMPANY_APPS) {
      ent.grantEntitlement({
        app: a.app,
        principalType: "company",
        principalId: company.id,
        quotaLimit: a.quotaLimit ?? null,
        quotaPeriod: a.quotaPeriod ?? null,
        grantedBy,
      });
    }
    for (const a of DEFAULT_OWNER_APPS) {
      ent.grantEntitlement({
        app: a.app,
        principalType: "user",
        principalId: user.id,
        quotaLimit: a.quotaLimit ?? null,
        quotaPeriod: a.quotaPeriod ?? null,
        grantedBy,
      });
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/provisioning.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/provisioning.js tests/provisioning.test.js
git commit -m "feat(hub): provision Signal/RAID per-user to owner, Poker/Retro company-wide"
```

---

## Task 4: `routes/company.js` — owner-only management + per-member app toggles

**Files:**
- Modify: `routes/company.js`
- Test: `tests/company.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/company.test.js`, add tests for the new toggle endpoint and owner-only gating. The file's existing helpers are `build({ role })` (returns `{ app, db, org, company, sid }`; user `u1` is the session user at that role) and `cookie(sid)`; requests are made with `request(app)...set("Cookie", cookie(sid))`. First add a small helper near the top of the file (after `const cookie = ...`):

```javascript
function addMember(db, org, company, userId = "mem") {
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run(userId, userId + "@b.c", now());
  org.addCompanyMember({ userId, companyId: company.id, role: "member" });
  return userId;
}
```

Then add these tests:

```javascript
test("owner can grant then revoke RAID for a member", async () => {
  const { app, db, org, company, sid } = await build({ role: "owner" });
  addMember(db, org, company);
  let res = await request(app).post("/company/acme/members/mem/apps/raid")
    .type("form").send({ action: "grant" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  let ent = db.prepare("SELECT quota_limit,status FROM app_entitlements WHERE app='raid' AND principal_type='user' AND principal_id='mem'").get();
  assert.equal(ent.status, "active");
  assert.equal(ent.quota_limit, 25);
  res = await request(app).post("/company/acme/members/mem/apps/raid")
    .type("form").send({ action: "revoke" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  ent = db.prepare("SELECT status FROM app_entitlements WHERE app='raid' AND principal_type='user' AND principal_id='mem'").get();
  assert.equal(ent.status, "suspended");
});

test("grant rejects a non-togglable app", async () => {
  const { app, db, org, company, sid } = await build({ role: "owner" });
  addMember(db, org, company);
  const res = await request(app).post("/company/acme/members/mem/apps/poker")
    .type("form").send({ action: "grant" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 400);
});

test("cannot toggle an owner row", async () => {
  const { app, sid } = await build({ role: "owner" }); // u1 is the owner
  const res = await request(app).post("/company/acme/members/u1/apps/signal")
    .type("form").send({ action: "revoke" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 400);
});

test("a non-owner cannot reach the per-member app toggle (owner-only)", async () => {
  const { app, db, org, company, sid } = await build({ role: "member" }); // u1 is a member
  addMember(db, org, company, "mem2");
  const res = await request(app).post("/company/acme/members/mem2/apps/signal")
    .type("form").send({ action: "grant" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 403);
});
```

Also: update existing `company.test.js` tests that exercise `admin`-role behavior — any test inviting/expecting role `"admin"`, or asserting admins can manage, must be rewritten to the two-role model (an admin no longer exists; a non-owner member is forbidden from management). Change `role: "admin"` seeds to `"member"` and flip the "admin can manage" expectations to "member is 403".

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/company.test.js`
Expected: FAIL — the `/apps/:app` route 404s; member currently reaches console (admin allowed).

- [ ] **Step 3: Implement**

In `routes/company.js`:

(a) Add the entitlements import and instance near the others:

```javascript
import { createEntitlements } from "../lib/entitlements.js";
// ... inside mountCompany, after `const org = createOrg(db);`
  const ent = createEntitlements(db);
```

(b) Change `manage` to owner-only:

```javascript
  const manage = [requireSession, companyRole(["owner"])];
```

(c) Remove now-dead `admin` handling:
- In `POST /company/:slug/members`: change role validation to `["owner", "member"]` and **delete** the `if (req.companyRole === "admin" && role === "owner")` block.
- In `POST /company/:slug/members/:userId/role`: change validation to `["owner", "member"]` and **delete** the `if (req.companyRole === "admin" && ...)` block.
- In `POST /company/:slug/members/:userId/remove`: **delete** the `if (req.companyRole === "admin" && target.role === "owner")` block.

(d) Add the per-member app toggle handler and the togglable-app constant (place the constant near the top of the file, after `EMAIL_RE`):

```javascript
const TOGGLABLE_APPS = {
  signal: { quotaLimit: null, quotaPeriod: null },
  raid: { quotaLimit: 25, quotaPeriod: "month" },
};
```

```javascript
  app.post("/company/:slug/members/:userId/apps/:app", ...manage, (req, res) => {
    const appName = req.params.app;
    const action = req.body.action;
    const targetId = req.params.userId;
    const spec = TOGGLABLE_APPS[appName];
    if (!spec) {
      return res.status(400).render("error", { title: "Bad request", message: "That app is not granted per-member." });
    }
    const target = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?")
      .get(targetId, req.company.id);
    if (!target) {
      return res.status(404).render("error", { title: "Not found", message: "Not a member of this company." });
    }
    if (target.role === "owner") {
      return res.status(400).render("error", { title: "Can't change", message: "Owners always have access to every app." });
    }
    if (action === "grant") {
      ent.grantEntitlement({
        app: appName, principalType: "user", principalId: targetId,
        quotaLimit: spec.quotaLimit, quotaPeriod: spec.quotaPeriod, grantedBy: req.user.id,
      });
      audit.log({ userId: req.user.id, eventType: "member_app_granted", metadata: { company: req.company.slug, target: targetId, app: appName }, ip: req.ip });
    } else if (action === "revoke") {
      ent.revokeEntitlement({ app: appName, principalType: "user", principalId: targetId });
      audit.log({ userId: req.user.id, eventType: "member_app_revoked", metadata: { company: req.company.slug, target: targetId, app: appName }, ip: req.ip });
    } else {
      return res.status(400).render("error", { title: "Bad request", message: "Unknown action." });
    }
    res.redirect("/company/" + req.company.slug);
  });
```

(e) Enrich the console GET so the view can render toggles. In `GET /company/:slug`, replace the `members` line with per-member app state:

```javascript
  app.get("/company/:slug", ...manage, (req, res) => {
    const members = org.listCompanyMembers(req.company.id).map((m) => ({
      ...m,
      signalOn: ent.resolveEntitlement(m.userId, "signal").entitled,
      raidOn: ent.resolveEntitlement(m.userId, "raid").entitled,
    }));
    const teams = org.listTeams(req.company.id);
    res.render("company/console", {
      user: req.user,
      company: req.company,
      companyRole: req.companyRole,
      members,
      teams,
    });
  });
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/company.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/company.js tests/company.test.js
git commit -m "feat(hub): owner-only company management + per-member Signal/RAID toggles"
```

---

## Task 5: `console.eta` — drop admin option, add Signal/RAID toggles

**Files:**
- Modify: `views/company/console.eta`
- Test: `tests/company.test.js` (a render assertion)

- [ ] **Step 1: Add a render test**

In `tests/company.test.js` add (reuses the `addMember` helper added in Task 4):

```javascript
test("console shows Signal/RAID toggles for a member and no Admin role option", async () => {
  const { app, db, org, company, sid } = await build({ role: "owner" });
  addMember(db, org, company);
  const res = await request(app).get("/company/acme").set("Cookie", cookie(sid));
  assert.equal(res.status, 200);
  assert.ok(!/>Admin</.test(res.text), "Admin role option should be gone");
  assert.match(res.text, /members\/mem\/apps\/signal/);
  assert.match(res.text, /members\/mem\/apps\/raid/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/company.test.js`
Expected: FAIL — view still has the `Admin` option and no toggle forms.

- [ ] **Step 3: Implement**

In `views/company/console.eta`:

(a) In the invite form `<select name="role">`, delete the line `<option value="admin">Admin</option>`.

(b) In the per-row role `<select name="role">`, delete the line `<option value="admin" ...>Admin</option>`.

(c) Add an **Apps** column. In `<thead>`, change the header row to:

```html
<thead><tr><th>Email</th><th>Role</th><th>Apps</th><th>Status</th><th></th></tr></thead>
```

(d) In the row body, after the Role `<td>...</td>` and before the Status `<td>`, insert an Apps cell:

```html
<td>
<% if (m.role === "owner") { %>
  <span title="Owners always have every app">Signal ✓ · RAID ✓</span>
<% } else { %>
  <% for (const a of [["signal","Signal", m.signalOn],["raid","RAID", m.raidOn]]) { %>
    <form method="POST" action="/company/<%= it.company.slug %>/members/<%= m.userId %>/apps/<%= a[0] %>" style="display:inline;">
      <input type="hidden" name="action" value="<%= a[2] ? 'revoke' : 'grant' %>">
      <button class="btn" type="submit"><%= a[1] %>: <%= a[2] ? 'On' : 'Off' %></button>
    </form>
  <% } %>
<% } %>
</td>
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/company.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add views/company/console.eta tests/company.test.js
git commit -m "feat(hub): console UI — per-member Signal/RAID toggles, drop Admin role"
```

---

## Task 6: `api-sessions.js` — company context for user-typed entitlements

**Files:**
- Modify: `routes/api-sessions.js` (the `companyId` derivation in `/api/sessions/exchange`)
- Test: `tests/api-sessions-exchange.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/api-sessions-exchange.test.js`, add a test asserting that a user whose RAID entitlement is **user-typed** still gets company/team context. The file's helper is `buildWithApi()` (returns `{ app, db, config }`); auth header is `Authorization: Bearer k-raid`. Add:

```javascript
test("exchange returns company context for a user-typed entitlement (signal/raid)", async () => {
  const { app, db } = await buildWithApi();
  const { createOrg } = await import("../lib/org.js?t=" + Date.now());
  const { createEntitlements } = await import("../lib/entitlements.js?t=" + Date.now());
  const org = createOrg(db);
  const ent = createEntitlements(db);
  db.prepare("INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)").run("u1", "a@b.c", "Alice", now());
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "member" });
  const team = org.createTeam({ companyId: c.id, name: "Squad" });
  org.addTeamMember({ userId: "u1", teamId: team.id, role: "member" });
  // RAID granted at USER level only — no company-level RAID exists.
  ent.grantEntitlement({ app: "raid", principalType: "user", principalId: "u1", quotaLimit: 25, quotaPeriod: "month", grantedBy: "op" });
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)").run(sid, "u1", now(), now(), now() + 60_000);
  const tok = randomToken();
  db.prepare("INSERT INTO launch_tokens (token,central_session_id,target_app,created_at,expires_at) VALUES (?,?,?,?,?)").run(tok, sid, "raid", now(), now() + 30_000);

  const res = await request(app).post("/api/sessions/exchange")
    .set("Authorization", "Bearer k-raid").send({ launch_token: tok });
  assert.equal(res.status, 200);
  assert.equal(res.body.entitlement.entitled, true);
  assert.equal(res.body.entitlement.principal.type, "user");
  assert.equal(res.body.teams.length, 1);
  assert.equal(res.body.teams[0].company, "Acme");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/api-sessions-exchange.test.js`
Expected: FAIL — `companyId` is null for user-typed entitlement, so `teams` is empty.

- [ ] **Step 3: Implement**

In `routes/api-sessions.js`, replace the `companyId` derivation:

```javascript
    const entitlement = entitlements.resolveEntitlement(row.user_id, row.target_app);
    // Company context comes from membership, not only from a company-typed
    // entitlement — Signal/RAID are granted per-user yet still belong to a company.
    const companyId =
      entitlement.entitled && entitlement.principal?.type === "company"
        ? entitlement.principal.id
        : (db.prepare("SELECT company_id FROM company_members WHERE user_id = ?").get(row.user_id)?.company_id ?? null);
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/api-sessions-exchange.test.js`
Expected: PASS. Existing exchange tests (poker/retro, company-typed) still PASS — that branch is unchanged.

- [ ] **Step 5: Commit**

```bash
git add routes/api-sessions.js tests/api-sessions-exchange.test.js
git commit -m "fix(hub): derive exchange company context from membership for user-typed entitlements"
```

---

## Task 7: Full suite green + dashboard check

**Files:**
- Possibly modify: `tests/dashboard.test.js` (if it asserted an `admin` sees the Manage link)

- [ ] **Step 1: Run the entire suite**

Run: `npm test`
Expected: ALL tests PASS. If any test fails because it referenced the removed `admin` role, update it to the two-role model: a former-admin is now a `member` with **no** console access (no "Manage" link, 403 on `/company/:slug`).

- [ ] **Step 2: Grep for stragglers**

Run: `grep -rn "\"admin\"\|'admin'" routes lib views tests | grep -vi is_admin | grep -vi requireAdmin`
Expected: No remaining references to the company `admin` role (operator `is_admin` / `requireAdmin` are a different concept and must stay).

- [ ] **Step 3: Commit any test fixes**

```bash
git add -A
git commit -m "test(hub): align remaining tests with two-role model"
```

---

## Task 8: Manual verification notes (pre-deploy, run locally if possible)

- [ ] Confirm `npm test` is fully green and report the count (target ≥ prior 161 + new tests).
- [ ] Spot-read the diff for `routes/company.js` to confirm no `req.companyRole === "admin"` branch remains and `manage` is `["owner"]`.
- [ ] Confirm the migration is idempotent by the Task-1 test (already covered).
- [ ] Note for deploy (do NOT deploy as part of this plan): on prod, migration 004 auto-applies on `suite-hub` restart; it re-homes `sprint-suite`'s Signal/RAID to owner `nirvanadesign` at user level and suspends the company-level grants. Verify post-deploy that the console shows per-member toggles and that `nirvanadesign` retains Signal/RAID.

---

## Self-review notes (author)

- **Spec coverage:** role collapse (Tasks 1,2,4,5) ✓; per-user Signal/RAID + console toggles (Tasks 3,4,5) ✓; per-member RAID 25/mo (Tasks 3,4) ✓; default matrix incl. owner-locked (Tasks 3,4,5) ✓; exchange company-context fix (Task 6) ✓; live-data migration (Task 1) ✓; owner-only management (Tasks 2,4) ✓; testing (all tasks + 7) ✓.
- **Out-of-scope respected:** no share-links, no Signal data-scoping, no billing, no team-tier changes.
- **Type/name consistency:** `TOGGLABLE_APPS` (route) and `DEFAULT_OWNER_APPS` (provisioning) both encode `raid → {25, month}`, `signal → {null,null}`; `adminCompaniesForUser` kept as-is (owner-only semantics); audit events `member_app_granted`/`member_app_revoked` used consistently in route + spec.
