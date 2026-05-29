# Hub Identity & Entitlements (v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a three-tier identity model (companies → teams → users) and a per-principal app-entitlements system with usage quotas to the Sprint Suite hub, plus the hub↔app contract (entitlement at exchange, dashboard tile gating, authoritative `consume` endpoint) and the matching `@suite/auth-client` helpers.

**Architecture:** Implements Layers 1+2 of `docs/superpowers/specs/2026-05-29-hub-identity-entitlements-design.md`. One new idempotent SQL migration (`002`) adds six tables. Two new pure-logic hub modules — `lib/org.js` (org CRUD + invariants) and `lib/entitlements.js` (resolution + atomic quota consume) — are `createX(db)` factories matching `lib/audit.js`. The hub↔app contract is wired into the existing `exchange` route, a new `consume` route, and the dashboard. The CommonJS auth-client gains a `consume()` helper and surfaces the entitlement object at exchange. Operator tooling is a set of thin CLI scripts over the tested lib functions (Layer 3 self-service admin UI stays deferred).

**Tech Stack:** Node ≥20, ESM (hub), CommonJS (auth-client), better-sqlite3, Express 5, Eta views, `node:test` + `node:assert/strict` + `supertest`.

**Branch:** Create `feat/identity-v2` off `main` in `/var/www/suite` before Task A1. Hub lives in the suite repo (`/var/www/suite/hub`); auth-client in `/var/www/suite/shared/auth-client`. Both share this repo.

**Test commands:**
- Hub all: `cd /var/www/suite/hub && npm test`
- Hub one file: `cd /var/www/suite/hub && node --test tests/<file>.test.js`
- auth-client all: `cd /var/www/suite/shared/auth-client && npm test`
- auth-client one file: `cd /var/www/suite/shared/auth-client && node --test tests/<file>.test.js`

**Baseline (must stay green):** hub 49/49, auth-client 20/20.

---

## Conventions you MUST follow (verified against the codebase)

1. **Migrations re-run on every `openDb`.** `db/index.js` execs *every* `.sql` file in `db/migrations/` (sorted) on each open. So `002` MUST be fully idempotent: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and the `schema_version` insert uses `ON CONFLICT(version) DO NOTHING`. The spec's raw DDL omits `IF NOT EXISTS` — add it.
2. **IDs** are generated with `randomId()` from `lib/tokens.js` (16 random bytes hex). **Timestamps** with `now()` (epoch ms). Import both from `../lib/tokens.js`.
3. **Lib modules** are `export function createX(db) { ... return {...} }` (see `lib/audit.js`). They take an already-open db. No env reads inside lib modules.
4. **Lib unit tests** use `openDb(":memory:")` directly + plain `import` (no `?t=` cache-bust needed — lib modules don't read `process.env`). See `tests/audit.test.js`.
5. **Route tests** use `buildTestApp()` from `tests/helpers.js`, then `await import("../routes/X.js?t=" + Date.now())` and `mountX(app)`, then drive with `supertest`. The `?t=` cache-bust is required for route/config modules. See `tests/api-sessions-exchange.test.js`.
6. **Routes** are `export function mountX(app) { const db = app.locals.db; const config = app.locals.config; ... }`.
7. **`foreign_keys = ON`** is set in `openDb` — FK violations throw. In-memory test DBs created via `openDb(":memory:")` get all migrations and FK enforcement.
8. **Commit style:** Conventional Commits, e.g. `feat(hub): ...`, `feat(auth-client): ...`. Commit after each task's tests pass.

---

# PART A — Layer 1: Identity & org data model

## Task A1: Migration 002 — the six new tables

**Files:**
- Create: `hub/db/migrations/002-identity-entitlements.sql`
- Test: `hub/tests/db-002.test.js`

- [ ] **Step 1: Write the failing test**

Create `hub/tests/db-002.test.js`:

```js
// tests/db-002.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { openDb } from "../db/index.js";

test("migration 002 creates org + entitlement tables and bumps schema_version", () => {
  const db = openDb(":memory:");
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map(r => r.name);
  for (const t of ["companies", "teams", "company_members", "team_members", "app_entitlements", "app_usage"]) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  const v = db.prepare("SELECT MAX(version) AS v FROM schema_version").get().v;
  assert.equal(v, 2);
  db.close();
});

test("migration 002 is idempotent (re-open does not throw)", () => {
  const tmp = "/tmp/test-002-" + Date.now() + ".db";
  const db1 = openDb(tmp); db1.close();
  const db2 = openDb(tmp); // re-runs all migrations
  assert.equal(db2.prepare("SELECT 1 FROM companies LIMIT 1").all().length, 0);
  db2.close();
  fs.unlinkSync(tmp);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/db-002.test.js`
Expected: FAIL — `missing table companies` (the migration doesn't exist yet).

- [ ] **Step 3: Create the migration**

Create `hub/db/migrations/002-identity-entitlements.sql`:

```sql
-- 002-identity-entitlements.sql
CREATE TABLE IF NOT EXISTS companies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS company_members (
  user_id     TEXT NOT NULL REFERENCES users(id),
  company_id  TEXT NOT NULL REFERENCES companies(id),
  role        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, company_id)
);

CREATE TABLE IF NOT EXISTS team_members (
  user_id     TEXT NOT NULL REFERENCES users(id),
  team_id     TEXT NOT NULL REFERENCES teams(id),
  role        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_teams_company       ON teams(company_id);
CREATE INDEX IF NOT EXISTS idx_company_members_co  ON company_members(company_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team   ON team_members(team_id);

CREATE TABLE IF NOT EXISTS app_entitlements (
  id              TEXT PRIMARY KEY,
  app             TEXT NOT NULL,
  principal_type  TEXT NOT NULL,
  principal_id    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  quota_limit     INTEGER,
  quota_period    TEXT,
  granted_by      TEXT REFERENCES users(id),
  granted_at      INTEGER NOT NULL,
  UNIQUE(app, principal_type, principal_id)
);
CREATE INDEX IF NOT EXISTS idx_entitlements_principal ON app_entitlements(principal_type, principal_id);
CREATE INDEX IF NOT EXISTS idx_entitlements_app       ON app_entitlements(app);

CREATE TABLE IF NOT EXISTS app_usage (
  app             TEXT NOT NULL,
  principal_type  TEXT NOT NULL,
  principal_id    TEXT NOT NULL,
  period_key      TEXT NOT NULL,
  count           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (app, principal_type, principal_id, period_key)
);

INSERT INTO schema_version (version, applied_at) VALUES (2, strftime('%s','now')*1000)
  ON CONFLICT(version) DO NOTHING;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/db-002.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full hub suite to confirm no regressions**

Run: `cd /var/www/suite/hub && npm test`
Expected: all pass (baseline 49 + 2 new = 51).

- [ ] **Step 6: Commit**

```bash
git add hub/db/migrations/002-identity-entitlements.sql hub/tests/db-002.test.js
git commit -m "feat(hub): add 002 migration for identity & entitlements tables"
```

---

## Task A2: `lib/org.js` — companies (create / get / suspend)

**Files:**
- Create: `hub/lib/org.js`
- Test: `hub/tests/org.test.js`

- [ ] **Step 1: Write the failing test**

Create `hub/tests/org.test.js`:

```js
// tests/org.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.js";
import { createOrg } from "../lib/org.js";

test("createCompany inserts and returns the row", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  assert.ok(c.id);
  assert.equal(c.name, "Acme");
  assert.equal(c.slug, "acme");
  assert.equal(c.status, "active");
  assert.ok(c.created_at > 0);
  assert.deepEqual(org.getCompany(c.id), c);
  assert.equal(org.getCompanyBySlug("acme").id, c.id);
  db.close();
});

test("createCompany rejects duplicate slug", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  org.createCompany({ name: "Acme", slug: "acme" });
  assert.throws(() => org.createCompany({ name: "Acme2", slug: "acme" }), /UNIQUE/);
  db.close();
});

test("suspendCompany sets status", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.suspendCompany(c.id);
  assert.equal(org.getCompany(c.id).status, "suspended");
  db.close();
});

test("getCompany returns null when missing", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  assert.equal(org.getCompany("nope"), null);
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/org.test.js`
Expected: FAIL — `Cannot find module '../lib/org.js'`.

- [ ] **Step 3: Create `lib/org.js` with the company functions**

Create `hub/lib/org.js`:

```js
// lib/org.js
import { randomId, now } from "./tokens.js";

const COMPANY_ROLES = new Set(["owner", "admin", "member"]);
const TEAM_ROLES = new Set(["lead", "member"]);

export function createOrg(db) {
  const getCompany = (id) => db.prepare("SELECT * FROM companies WHERE id = ?").get(id) || null;
  const getCompanyBySlug = (slug) => db.prepare("SELECT * FROM companies WHERE slug = ?").get(slug) || null;
  const getTeam = (id) => db.prepare("SELECT * FROM teams WHERE id = ?").get(id) || null;
  const ownerCount = (companyId) =>
    db.prepare("SELECT COUNT(*) AS n FROM company_members WHERE company_id = ? AND role = 'owner'").get(companyId).n;

  function createCompany({ name, slug }) {
    if (!name || !slug) throw new Error("name_and_slug_required");
    const id = randomId();
    db.prepare("INSERT INTO companies (id,name,slug,status,created_at) VALUES (?,?,?, 'active', ?)")
      .run(id, name, slug, now());
    return getCompany(id);
  }

  function suspendCompany(id) {
    db.prepare("UPDATE companies SET status = 'suspended' WHERE id = ?").run(id);
  }

  return {
    createCompany, getCompany, getCompanyBySlug, suspendCompany, getTeam, ownerCount,
    COMPANY_ROLES, TEAM_ROLES,
  };
}
```

(Members/teams functions are added in later tasks; `ownerCount`/`getTeam`/role sets are exported now so later tasks extend the same return object.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/org.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add hub/lib/org.js hub/tests/org.test.js
git commit -m "feat(hub): org module — company create/get/suspend"
```

---

## Task A3: `lib/org.js` — company members + last-owner invariant

**Files:**
- Modify: `hub/lib/org.js`
- Test: `hub/tests/org.test.js` (append)

- [ ] **Step 1: Write the failing tests (append to `tests/org.test.js`)**

```js
// --- company members ---
function seedUser(db, id, email) {
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run(id, email, Date.now());
}

test("addCompanyMember adds with a valid role; invalid role throws", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  seedUser(db, "u1", "a@b.c");
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "owner" });
  const row = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?").get("u1", c.id);
  assert.equal(row.role, "owner");
  assert.throws(() => org.addCompanyMember({ userId: "u1", companyId: c.id, role: "boss" }), /invalid_company_role/);
  db.close();
});

test("addCompanyMember to a missing company throws", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  seedUser(db, "u1", "a@b.c");
  assert.throws(() => org.addCompanyMember({ userId: "u1", companyId: "nope", role: "member" }), /company_not_found/);
  db.close();
});

test("cannot demote or remove the last owner", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  seedUser(db, "u1", "a@b.c");
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "owner" });
  assert.throws(() => org.setCompanyMemberRole({ userId: "u1", companyId: c.id, role: "admin" }), /last_owner/);
  assert.throws(() => org.removeCompanyMember({ userId: "u1", companyId: c.id }), /last_owner/);
  db.close();
});

test("can demote an owner when another owner exists", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  seedUser(db, "u1", "a@b.c"); seedUser(db, "u2", "d@e.f");
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "owner" });
  org.addCompanyMember({ userId: "u2", companyId: c.id, role: "owner" });
  org.setCompanyMemberRole({ userId: "u1", companyId: c.id, role: "admin" });
  const row = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?").get("u1", c.id);
  assert.equal(row.role, "admin");
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/org.test.js`
Expected: FAIL — `org.addCompanyMember is not a function`.

- [ ] **Step 3: Add the member functions to `lib/org.js`**

Inside `createOrg`, add these functions before the `return`:

```js
  function addCompanyMember({ userId, companyId, role }) {
    if (!COMPANY_ROLES.has(role)) throw new Error("invalid_company_role");
    if (!getCompany(companyId)) throw new Error("company_not_found");
    db.prepare("INSERT INTO company_members (user_id,company_id,role,created_at) VALUES (?,?,?,?)")
      .run(userId, companyId, role, now());
  }

  function setCompanyMemberRole({ userId, companyId, role }) {
    if (!COMPANY_ROLES.has(role)) throw new Error("invalid_company_role");
    const current = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?").get(userId, companyId);
    if (!current) throw new Error("not_a_member");
    if (current.role === "owner" && role !== "owner" && ownerCount(companyId) <= 1) {
      throw new Error("last_owner");
    }
    db.prepare("UPDATE company_members SET role=? WHERE user_id=? AND company_id=?").run(role, userId, companyId);
  }

  const removeCompanyMember = db.transaction(({ userId, companyId }) => {
    const current = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?").get(userId, companyId);
    if (!current) return;
    if (current.role === "owner" && ownerCount(companyId) <= 1) throw new Error("last_owner");
    db.prepare(`
      DELETE FROM team_members
      WHERE user_id = ? AND team_id IN (SELECT id FROM teams WHERE company_id = ?)
    `).run(userId, companyId);
    db.prepare("DELETE FROM company_members WHERE user_id=? AND company_id=?").run(userId, companyId);
  });
```

Then extend the `return` object to include them:

```js
  return {
    createCompany, getCompany, getCompanyBySlug, suspendCompany, getTeam, ownerCount,
    addCompanyMember, setCompanyMemberRole, removeCompanyMember,
    COMPANY_ROLES, TEAM_ROLES,
  };
```

Note: `removeCompanyMember` is a `db.transaction(...)` wrapper, so it is called as `org.removeCompanyMember({ ... })` exactly like a normal function (better-sqlite3 transactions are callable). The transaction makes the cascade-delete-then-delete atomic.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/org.test.js`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add hub/lib/org.js hub/tests/org.test.js
git commit -m "feat(hub): org module — company members + last-owner invariant"
```

---

## Task A4: `lib/org.js` — teams (create unique-per-company / get / list)

**Files:**
- Modify: `hub/lib/org.js`
- Test: `hub/tests/org.test.js` (append)

- [ ] **Step 1: Write the failing tests (append)**

```js
// --- teams ---
test("createTeam scopes name per company; duplicate name in same company throws", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  const c1 = org.createCompany({ name: "Acme", slug: "acme" });
  const c2 = org.createCompany({ name: "Globex", slug: "globex" });
  const t = org.createTeam({ companyId: c1.id, name: "Platform" });
  assert.equal(t.company_id, c1.id);
  assert.equal(t.name, "Platform");
  // same name, different company is fine
  org.createTeam({ companyId: c2.id, name: "Platform" });
  // same name, same company collides
  assert.throws(() => org.createTeam({ companyId: c1.id, name: "Platform" }), /UNIQUE/);
  db.close();
});

test("createTeam in a missing company throws", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  assert.throws(() => org.createTeam({ companyId: "nope", name: "X" }), /company_not_found/);
  db.close();
});

test("listTeams returns a company's teams sorted by name", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.createTeam({ companyId: c.id, name: "Zeta" });
  org.createTeam({ companyId: c.id, name: "Alpha" });
  assert.deepEqual(org.listTeams(c.id).map(t => t.name), ["Alpha", "Zeta"]);
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/org.test.js`
Expected: FAIL — `org.createTeam is not a function`.

- [ ] **Step 3: Add team functions to `lib/org.js`**

Add before the `return`:

```js
  function createTeam({ companyId, name }) {
    if (!getCompany(companyId)) throw new Error("company_not_found");
    const id = randomId();
    db.prepare("INSERT INTO teams (id,company_id,name,created_at) VALUES (?,?,?,?)")
      .run(id, companyId, name, now());
    return getTeam(id);
  }

  function listTeams(companyId) {
    return db.prepare("SELECT * FROM teams WHERE company_id=? ORDER BY name").all(companyId);
  }
```

Extend the `return` object: add `createTeam, listTeams` (`getTeam` is already exported).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/org.test.js`
Expected: PASS (11 tests total).

- [ ] **Step 5: Commit**

```bash
git add hub/lib/org.js hub/tests/org.test.js
git commit -m "feat(hub): org module — teams (unique per company)"
```

---

## Task A5: `lib/org.js` — team members + "must belong to the company" invariant

**Files:**
- Modify: `hub/lib/org.js`
- Test: `hub/tests/org.test.js` (append)

- [ ] **Step 1: Write the failing tests (append)**

```js
// --- team members ---
test("addTeamMember requires company membership; otherwise throws", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  seedUser(db, "u1", "a@b.c");
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  const t = org.createTeam({ companyId: c.id, name: "Platform" });
  // not yet a company member
  assert.throws(() => org.addTeamMember({ userId: "u1", teamId: t.id, role: "member" }), /not_company_member/);
  // become a member, then it works
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "member" });
  org.addTeamMember({ userId: "u1", teamId: t.id, role: "lead" });
  const row = db.prepare("SELECT role FROM team_members WHERE user_id=? AND team_id=?").get("u1", t.id);
  assert.equal(row.role, "lead");
  db.close();
});

test("addTeamMember rejects invalid role and missing team", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  seedUser(db, "u1", "a@b.c");
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "member" });
  const t = org.createTeam({ companyId: c.id, name: "Platform" });
  assert.throws(() => org.addTeamMember({ userId: "u1", teamId: t.id, role: "captain" }), /invalid_team_role/);
  assert.throws(() => org.addTeamMember({ userId: "u1", teamId: "nope", role: "member" }), /team_not_found/);
  db.close();
});

test("removeTeamMember deletes the row", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  seedUser(db, "u1", "a@b.c");
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "member" });
  const t = org.createTeam({ companyId: c.id, name: "Platform" });
  org.addTeamMember({ userId: "u1", teamId: t.id, role: "member" });
  org.removeTeamMember({ userId: "u1", teamId: t.id });
  const row = db.prepare("SELECT 1 FROM team_members WHERE user_id=? AND team_id=?").get("u1", t.id);
  assert.equal(row, undefined);
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/org.test.js`
Expected: FAIL — `org.addTeamMember is not a function`.

- [ ] **Step 3: Add team-member functions to `lib/org.js`**

Add before the `return`:

```js
  function addTeamMember({ userId, teamId, role }) {
    if (!TEAM_ROLES.has(role)) throw new Error("invalid_team_role");
    const team = getTeam(teamId);
    if (!team) throw new Error("team_not_found");
    const isMember = db.prepare("SELECT 1 FROM company_members WHERE user_id=? AND company_id=?")
      .get(userId, team.company_id);
    if (!isMember) throw new Error("not_company_member");
    db.prepare("INSERT INTO team_members (user_id,team_id,role,created_at) VALUES (?,?,?,?)")
      .run(userId, teamId, role, now());
  }

  function removeTeamMember({ userId, teamId }) {
    db.prepare("DELETE FROM team_members WHERE user_id=? AND team_id=?").run(userId, teamId);
  }
```

Extend the `return` object: add `addTeamMember, removeTeamMember`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/org.test.js`
Expected: PASS (14 tests total).

- [ ] **Step 5: Run the full hub suite**

Run: `cd /var/www/suite/hub && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add hub/lib/org.js hub/tests/org.test.js
git commit -m "feat(hub): org module — team members + company-membership invariant"
```

---

# PART B — Layer 2: Entitlements engine

## Task B1: `lib/entitlements.js` — grant/revoke + `principalsForUser`

**Files:**
- Create: `hub/lib/entitlements.js`
- Test: `hub/tests/entitlements.test.js`

- [ ] **Step 1: Write the failing test**

Create `hub/tests/entitlements.test.js`:

```js
// tests/entitlements.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.js";
import { createOrg } from "../lib/org.js";
import { createEntitlements, periodKey } from "../lib/entitlements.js";

function seedUser(db, id, email) {
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run(id, email, Date.now());
}

test("periodKey: month and day formats (UTC)", () => {
  const t = Date.UTC(2026, 4, 9, 13, 0, 0); // 2026-05-09
  assert.equal(periodKey("month", t), "2026-05");
  assert.equal(periodKey("day", t), "2026-05-09");
  assert.equal(periodKey(null, t), "2026-05"); // defaults to month
});

test("grantEntitlement inserts; re-grant updates terms (upsert on unique key)", () => {
  const db = openDb(":memory:");
  const ent = createEntitlements(db);
  seedUser(db, "u1", "a@b.c");
  ent.grantEntitlement({ app: "raid", principalType: "user", principalId: "u1", quotaLimit: 100, quotaPeriod: "month", grantedBy: "u1" });
  let row = db.prepare("SELECT * FROM app_entitlements WHERE app='raid' AND principal_type='user' AND principal_id='u1'").get();
  assert.equal(row.quota_limit, 100);
  ent.grantEntitlement({ app: "raid", principalType: "user", principalId: "u1", quotaLimit: 250, quotaPeriod: "month" });
  row = db.prepare("SELECT * FROM app_entitlements WHERE app='raid' AND principal_type='user' AND principal_id='u1'").get();
  assert.equal(row.quota_limit, 250);
  assert.equal(row.status, "active");
  db.close();
});

test("grantEntitlement rejects invalid principal type", () => {
  const db = openDb(":memory:");
  const ent = createEntitlements(db);
  assert.throws(() => ent.grantEntitlement({ app: "raid", principalType: "robot", principalId: "x" }), /invalid_principal_type/);
  db.close();
});

test("revokeEntitlement suspends the grant", () => {
  const db = openDb(":memory:");
  const ent = createEntitlements(db);
  seedUser(db, "u1", "a@b.c");
  ent.grantEntitlement({ app: "signal", principalType: "user", principalId: "u1" });
  ent.revokeEntitlement({ app: "signal", principalType: "user", principalId: "u1" });
  const row = db.prepare("SELECT status FROM app_entitlements WHERE app='signal' AND principal_type='user' AND principal_id='u1'").get();
  assert.equal(row.status, "suspended");
  db.close();
});

test("principalsForUser returns user + teams + companies", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  const ent = createEntitlements(db);
  seedUser(db, "u1", "a@b.c");
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "member" });
  const t = org.createTeam({ companyId: c.id, name: "Platform" });
  org.addTeamMember({ userId: "u1", teamId: t.id, role: "member" });
  const ps = ent.principalsForUser("u1");
  assert.ok(ps.some(p => p.type === "user" && p.id === "u1"));
  assert.ok(ps.some(p => p.type === "company" && p.id === c.id));
  assert.ok(ps.some(p => p.type === "team" && p.id === t.id));
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/entitlements.test.js`
Expected: FAIL — `Cannot find module '../lib/entitlements.js'`.

- [ ] **Step 3: Create `lib/entitlements.js` (grant/revoke + helpers)**

Create `hub/lib/entitlements.js`:

```js
// lib/entitlements.js
import { randomId, now } from "./tokens.js";

const PRINCIPAL_TYPES = new Set(["company", "team", "user"]);

export function periodKey(period, t) {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  if (period === "day") {
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return `${y}-${m}`; // month (default)
}

export function createEntitlements(db) {
  const principalsForUser = (userId) => {
    const principals = [{ type: "user", id: userId }];
    for (const r of db.prepare("SELECT team_id FROM team_members WHERE user_id=?").all(userId)) {
      principals.push({ type: "team", id: r.team_id });
    }
    for (const r of db.prepare("SELECT company_id FROM company_members WHERE user_id=?").all(userId)) {
      principals.push({ type: "company", id: r.company_id });
    }
    return principals;
  };

  function grantEntitlement({ app, principalType, principalId, quotaLimit = null, quotaPeriod = null, grantedBy = null }) {
    if (!PRINCIPAL_TYPES.has(principalType)) throw new Error("invalid_principal_type");
    db.prepare(`
      INSERT INTO app_entitlements (id,app,principal_type,principal_id,status,quota_limit,quota_period,granted_by,granted_at)
      VALUES (?,?,?,?, 'active', ?,?,?,?)
      ON CONFLICT(app,principal_type,principal_id) DO UPDATE SET
        status='active',
        quota_limit=excluded.quota_limit,
        quota_period=excluded.quota_period,
        granted_by=excluded.granted_by,
        granted_at=excluded.granted_at
    `).run(randomId(), app, principalType, principalId, quotaLimit, quotaPeriod, grantedBy, now());
    return db.prepare("SELECT * FROM app_entitlements WHERE app=? AND principal_type=? AND principal_id=?")
      .get(app, principalType, principalId);
  }

  function revokeEntitlement({ app, principalType, principalId }) {
    db.prepare("UPDATE app_entitlements SET status='suspended' WHERE app=? AND principal_type=? AND principal_id=?")
      .run(app, principalType, principalId);
  }

  return { principalsForUser, grantEntitlement, revokeEntitlement };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/entitlements.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add hub/lib/entitlements.js hub/tests/entitlements.test.js
git commit -m "feat(hub): entitlements module — grant/revoke + principal resolution"
```

---

## Task B2: `lib/entitlements.js` — `resolveEntitlement` (allow/deny + quota math + precedence)

**Files:**
- Modify: `hub/lib/entitlements.js`
- Test: `hub/tests/entitlements.test.js` (append)

- [ ] **Step 1: Write the failing tests (append)**

```js
// --- resolveEntitlement ---
test("no grant -> denied", () => {
  const db = openDb(":memory:");
  const ent = createEntitlements(db);
  seedUser(db, "u1", "a@b.c");
  assert.deepEqual(ent.resolveEntitlement("u1", "raid"), { entitled: false, principal: null, quota: null });
  db.close();
});

test("user-level unlimited grant -> entitled, quota null", () => {
  const db = openDb(":memory:");
  const ent = createEntitlements(db);
  seedUser(db, "u1", "a@b.c");
  ent.grantEntitlement({ app: "signal", principalType: "user", principalId: "u1" });
  const r = ent.resolveEntitlement("u1", "signal");
  assert.equal(r.entitled, true);
  assert.deepEqual(r.principal, { type: "user", id: "u1" });
  assert.equal(r.quota, null);
  db.close();
});

test("company-level quota grant -> remaining = limit - usage", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  const ent = createEntitlements(db);
  seedUser(db, "u1", "a@b.c");
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "owner" });
  ent.grantEntitlement({ app: "raid", principalType: "company", principalId: c.id, quotaLimit: 100, quotaPeriod: "month" });
  const t = Date.UTC(2026, 4, 9);
  // seed 13 used in this period
  db.prepare("INSERT INTO app_usage (app,principal_type,principal_id,period_key,count) VALUES ('raid','company',?,?,13)")
    .run(c.id, periodKey("month", t));
  const r = ent.resolveEntitlement("u1", "raid", t);
  assert.equal(r.entitled, true);
  assert.deepEqual(r.principal, { type: "company", id: c.id });
  assert.deepEqual(r.quota, { limit: 100, period: "month", remaining: 87 });
  db.close();
});

test("multiple matches: unlimited wins over quota'd", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  const ent = createEntitlements(db);
  seedUser(db, "u1", "a@b.c");
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "owner" });
  ent.grantEntitlement({ app: "raid", principalType: "user", principalId: "u1", quotaLimit: 5, quotaPeriod: "month" });
  ent.grantEntitlement({ app: "raid", principalType: "company", principalId: c.id }); // unlimited
  const r = ent.resolveEntitlement("u1", "raid");
  assert.equal(r.entitled, true);
  assert.equal(r.quota, null); // unlimited preferred
  db.close();
});

test("multiple quota'd matches: most-remaining wins", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  const ent = createEntitlements(db);
  seedUser(db, "u1", "a@b.c");
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "owner" });
  ent.grantEntitlement({ app: "raid", principalType: "user", principalId: "u1", quotaLimit: 10, quotaPeriod: "month" });
  ent.grantEntitlement({ app: "raid", principalType: "company", principalId: c.id, quotaLimit: 100, quotaPeriod: "month" });
  const r = ent.resolveEntitlement("u1", "raid");
  assert.deepEqual(r.principal, { type: "company", id: c.id }); // 100 remaining > 10
  assert.equal(r.quota.remaining, 100);
  db.close();
});

test("suspended grant is ignored", () => {
  const db = openDb(":memory:");
  const ent = createEntitlements(db);
  seedUser(db, "u1", "a@b.c");
  ent.grantEntitlement({ app: "signal", principalType: "user", principalId: "u1" });
  ent.revokeEntitlement({ app: "signal", principalType: "user", principalId: "u1" });
  assert.equal(ent.resolveEntitlement("u1", "signal").entitled, false);
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/entitlements.test.js`
Expected: FAIL — `ent.resolveEntitlement is not a function`.

- [ ] **Step 3: Add the selection + resolve logic to `lib/entitlements.js`**

Inside `createEntitlements`, add these before the `return` (the `select` helper is shared with `consume` in Task B3):

```js
  const usageCount = (app, principalType, principalId, pk) => {
    const row = db.prepare(
      "SELECT count FROM app_usage WHERE app=? AND principal_type=? AND principal_id=? AND period_key=?"
    ).get(app, principalType, principalId, pk);
    return row ? row.count : 0;
  };

  // Returns the chosen entitlement row + computed remaining (null when unlimited), or null when none.
  const select = (userId, app, t) => {
    const principals = principalsForUser(userId);
    const matches = [];
    for (const p of principals) {
      const e = db.prepare(
        "SELECT * FROM app_entitlements WHERE app=? AND principal_type=? AND principal_id=? AND status='active'"
      ).get(app, p.type, p.id);
      if (e) matches.push(e);
    }
    if (matches.length === 0) return null;
    const unlimited = matches.find((e) => e.quota_limit == null);
    if (unlimited) return { entitlement: unlimited, remaining: null };
    let best = null;
    for (const e of matches) {
      const pk = periodKey(e.quota_period || "month", t);
      const remaining = e.quota_limit - usageCount(e.app, e.principal_type, e.principal_id, pk);
      if (best === null || remaining > best.remaining) best = { entitlement: e, remaining };
    }
    return best;
  };

  function resolveEntitlement(userId, app, t = now()) {
    const sel = select(userId, app, t);
    if (!sel) return { entitled: false, principal: null, quota: null };
    const e = sel.entitlement;
    const principal = { type: e.principal_type, id: e.principal_id };
    if (e.quota_limit == null) return { entitled: true, principal, quota: null };
    return { entitled: true, principal, quota: { limit: e.quota_limit, period: e.quota_period, remaining: sel.remaining } };
  }
```

Extend the `return` object: add `resolveEntitlement` (keep `usageCount`/`select` private — not returned).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/entitlements.test.js`
Expected: PASS (11 tests total).

- [ ] **Step 5: Commit**

```bash
git add hub/lib/entitlements.js hub/tests/entitlements.test.js
git commit -m "feat(hub): entitlements — resolveEntitlement with quota math + precedence"
```

---

## Task B3: `lib/entitlements.js` — atomic `consume`

**Files:**
- Modify: `hub/lib/entitlements.js`
- Test: `hub/tests/entitlements.test.js` (append)

- [ ] **Step 1: Write the failing tests (append)**

```js
// --- consume ---
test("consume on unlimited grant returns ok with remaining null, no counter row", () => {
  const db = openDb(":memory:");
  const ent = createEntitlements(db);
  seedUser(db, "u1", "a@b.c");
  ent.grantEntitlement({ app: "signal", principalType: "user", principalId: "u1" });
  const r = ent.consume("u1", "signal");
  assert.deepEqual(r, { ok: true, remaining: null });
  const usage = db.prepare("SELECT COUNT(*) AS n FROM app_usage").get().n;
  assert.equal(usage, 0);
  db.close();
});

test("consume with no grant -> not_entitled", () => {
  const db = openDb(":memory:");
  const ent = createEntitlements(db);
  seedUser(db, "u1", "a@b.c");
  assert.deepEqual(ent.consume("u1", "raid"), { ok: false, reason: "not_entitled" });
  db.close();
});

test("consume increments the counter and reports remaining", () => {
  const db = openDb(":memory:");
  const ent = createEntitlements(db);
  seedUser(db, "u1", "a@b.c");
  ent.grantEntitlement({ app: "raid", principalType: "user", principalId: "u1", quotaLimit: 3, quotaPeriod: "month" });
  const t = Date.UTC(2026, 4, 9);
  assert.deepEqual(ent.consume("u1", "raid", t), { ok: true, remaining: 2 });
  assert.deepEqual(ent.consume("u1", "raid", t), { ok: true, remaining: 1 });
  assert.deepEqual(ent.consume("u1", "raid", t), { ok: true, remaining: 0 });
  assert.deepEqual(ent.consume("u1", "raid", t), { ok: false, reason: "quota_exceeded" });
  const count = db.prepare("SELECT count FROM app_usage WHERE app='raid' AND principal_type='user' AND principal_id='u1'").get().count;
  assert.equal(count, 3); // never exceeded the limit
  db.close();
});

test("consume never exceeds the limit across many calls (atomic check+increment)", () => {
  const db = openDb(":memory:");
  const ent = createEntitlements(db);
  seedUser(db, "u1", "a@b.c");
  ent.grantEntitlement({ app: "raid", principalType: "user", principalId: "u1", quotaLimit: 10, quotaPeriod: "month" });
  const t = Date.UTC(2026, 4, 9);
  let ok = 0;
  for (let i = 0; i < 25; i++) if (ent.consume("u1", "raid", t).ok) ok++;
  assert.equal(ok, 10);
  const count = db.prepare("SELECT count FROM app_usage WHERE principal_id='u1'").get().count;
  assert.equal(count, 10);
  db.close();
});

test("consume buckets by period_key (new month resets)", () => {
  const db = openDb(":memory:");
  const ent = createEntitlements(db);
  seedUser(db, "u1", "a@b.c");
  ent.grantEntitlement({ app: "raid", principalType: "user", principalId: "u1", quotaLimit: 1, quotaPeriod: "month" });
  const may = Date.UTC(2026, 4, 9);
  const jun = Date.UTC(2026, 5, 2);
  assert.equal(ent.consume("u1", "raid", may).ok, true);
  assert.equal(ent.consume("u1", "raid", may).ok, false); // May exhausted
  assert.equal(ent.consume("u1", "raid", jun).ok, true);   // June fresh bucket
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/entitlements.test.js`
Expected: FAIL — `ent.consume is not a function`.

- [ ] **Step 3: Add `consume` (atomic transaction) to `lib/entitlements.js`**

Inside `createEntitlements`, add before the `return`:

```js
  const consumeTx = db.transaction((userId, app, t) => {
    const sel = select(userId, app, t);
    if (!sel) return { ok: false, reason: "not_entitled" };
    const e = sel.entitlement;
    if (e.quota_limit == null) return { ok: true, remaining: null };
    const pk = periodKey(e.quota_period || "month", t);
    const count = usageCount(e.app, e.principal_type, e.principal_id, pk);
    if (count >= e.quota_limit) return { ok: false, reason: "quota_exceeded" };
    db.prepare(`
      INSERT INTO app_usage (app,principal_type,principal_id,period_key,count)
      VALUES (?,?,?,?,1)
      ON CONFLICT(app,principal_type,principal_id,period_key) DO UPDATE SET count = count + 1
    `).run(e.app, e.principal_type, e.principal_id, pk);
    return { ok: true, remaining: e.quota_limit - (count + 1) };
  });

  function consume(userId, app, t = now()) {
    return consumeTx(userId, app, t);
  }
```

Extend the `return` object: add `consume`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/entitlements.test.js`
Expected: PASS (16 tests total).

- [ ] **Step 5: Run the full hub suite**

Run: `cd /var/www/suite/hub && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add hub/lib/entitlements.js hub/tests/entitlements.test.js
git commit -m "feat(hub): entitlements — atomic quota consume"
```

---

# PART C — Layer 2: Hub ↔ app contract

## Task C1: Extend `/api/sessions/exchange` with the entitlement block

**Files:**
- Modify: `hub/routes/api-sessions.js`
- Test: `hub/tests/api-sessions-exchange.test.js` (append)

- [ ] **Step 1: Write the failing test (append to `tests/api-sessions-exchange.test.js`)**

```js
test("exchange includes an entitlement block scoped to the target app", async () => {
  const { app, db } = await buildWithApi();
  db.prepare("INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)")
    .run("u1", "a@b.c", "Alice", now());
  // grant raid to the user, unlimited
  const { createEntitlements } = await import("../lib/entitlements.js?t=" + Date.now());
  createEntitlements(db).grantEntitlement({ app: "raid", principalType: "user", principalId: "u1" });

  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const tok = randomToken();
  db.prepare("INSERT INTO launch_tokens (token,central_session_id,target_app,created_at,expires_at) VALUES (?,?,?,?,?)")
    .run(tok, sid, "raid", now(), now() + 30_000);

  const res = await request(app)
    .post("/api/sessions/exchange")
    .set("Authorization", "Bearer k-raid")
    .send({ launch_token: tok });

  assert.equal(res.status, 200);
  assert.equal(res.body.entitlement.entitled, true);
  assert.deepEqual(res.body.entitlement.principal, { type: "user", id: "u1" });
  assert.equal(res.body.entitlement.quota, null);
});

test("exchange returns entitled:false when the user has no grant for the app", async () => {
  const { app, db } = await buildWithApi();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const tok = randomToken();
  db.prepare("INSERT INTO launch_tokens (token,central_session_id,target_app,created_at,expires_at) VALUES (?,?,?,?,?)")
    .run(tok, sid, "raid", now(), now() + 30_000);

  const res = await request(app)
    .post("/api/sessions/exchange")
    .set("Authorization", "Bearer k-raid")
    .send({ launch_token: tok });

  assert.equal(res.status, 200);
  assert.equal(res.body.entitlement.entitled, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/api-sessions-exchange.test.js`
Expected: FAIL — `res.body.entitlement` is undefined.

- [ ] **Step 3: Wire `resolveEntitlement` into the exchange handler**

In `hub/routes/api-sessions.js`, add the import at the top:

```js
import { createEntitlements } from "../lib/entitlements.js";
```

Inside `mountApiSessions`, after `const audit = createAuditLogger(db);`, add:

```js
  const entitlements = createEntitlements(db);
```

Then change the final `res.json({ ... })` in the `exchange` handler to include the entitlement (scoped to the launch token's `target_app`):

```js
    const entitlement = entitlements.resolveEntitlement(row.user_id, row.target_app);
    audit.log({ userId: row.user_id, eventType: "session_exchanged", app: req.callingApp, ip: req.ip });
    res.json({
      user: { id: row.user_id, email: row.email, displayName: row.display_name },
      central_session_id: row.central_session_id,
      entitlement,
    });
```

(The existing `audit.log` line is moved above `res.json`; keep only one copy.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/api-sessions-exchange.test.js`
Expected: PASS (all, including the 4 pre-existing exchange tests).

- [ ] **Step 5: Commit**

```bash
git add hub/routes/api-sessions.js hub/tests/api-sessions-exchange.test.js
git commit -m "feat(hub): surface entitlement in /api/sessions/exchange"
```

---

## Task C2: `POST /api/apps/:app/consume` endpoint

**Files:**
- Create: `hub/routes/api-apps.js`
- Modify: `hub/server.js`
- Test: `hub/tests/api-apps-consume.test.js`

- [ ] **Step 1: Write the failing test**

Create `hub/tests/api-apps-consume.test.js`:

```js
// tests/api-apps-consume.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";

async function buildWithApps() {
  const { app, db, config } = await buildTestApp();
  const { mountApiApps } = await import("../routes/api-apps.js?t=" + Date.now());
  mountApiApps(app);
  return { app, db, config };
}

async function seedSession(db, userId = "u1") {
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run(userId, userId + "@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, userId, now(), now(), now() + 60_000);
  return sid;
}

test("consume requires a bearer key", async () => {
  const { app } = await buildWithApps();
  const res = await request(app).post("/api/apps/raid/consume").send({ central_session_id: "x" });
  assert.equal(res.status, 401);
});

test("consume rejects when :app does not match the calling key", async () => {
  const { app, db } = await buildWithApps();
  const sid = await seedSession(db);
  const res = await request(app).post("/api/apps/raid/consume")
    .set("Authorization", "Bearer k-signal") // signal key on a raid path
    .send({ central_session_id: sid });
  assert.equal(res.status, 403);
  assert.equal(res.body.reason, "wrong_app");
});

test("consume returns 403 not_entitled when the user has no grant", async () => {
  const { app, db } = await buildWithApps();
  const sid = await seedSession(db);
  const res = await request(app).post("/api/apps/raid/consume")
    .set("Authorization", "Bearer k-raid")
    .send({ central_session_id: sid });
  assert.equal(res.status, 403);
  assert.equal(res.body.reason, "not_entitled");
});

test("consume returns 200 and decrements remaining; 402 when exhausted", async () => {
  const { app, db } = await buildWithApps();
  const sid = await seedSession(db);
  const { createEntitlements } = await import("../lib/entitlements.js?t=" + Date.now());
  createEntitlements(db).grantEntitlement({ app: "raid", principalType: "user", principalId: "u1", quotaLimit: 1, quotaPeriod: "month" });

  const ok = await request(app).post("/api/apps/raid/consume")
    .set("Authorization", "Bearer k-raid").send({ central_session_id: sid });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.remaining, 0);

  const exhausted = await request(app).post("/api/apps/raid/consume")
    .set("Authorization", "Bearer k-raid").send({ central_session_id: sid });
  assert.equal(exhausted.status, 402);
  assert.equal(exhausted.body.reason, "quota_exceeded");
});

test("consume returns 404 for an unknown session", async () => {
  const { app } = await buildWithApps();
  const res = await request(app).post("/api/apps/raid/consume")
    .set("Authorization", "Bearer k-raid").send({ central_session_id: "nope" });
  assert.equal(res.status, 404);
});

test("consume returns 400 when central_session_id is missing", async () => {
  const { app } = await buildWithApps();
  const res = await request(app).post("/api/apps/raid/consume")
    .set("Authorization", "Bearer k-raid").send({});
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/api-apps-consume.test.js`
Expected: FAIL — `Cannot find module '../routes/api-apps.js'`.

- [ ] **Step 3: Create `hub/routes/api-apps.js`**

```js
// routes/api-apps.js
import { createRequireApiKey } from "../middleware/requireApiKey.js";
import { createEntitlements } from "../lib/entitlements.js";
import { createAuditLogger } from "../lib/audit.js";

export function mountApiApps(app) {
  const db = app.locals.db;
  const config = app.locals.config;
  const requireApiKey = createRequireApiKey(config);
  const entitlements = createEntitlements(db);
  const audit = createAuditLogger(db);

  app.post("/api/apps/:app/consume", requireApiKey, (req, res) => {
    const appName = req.params.app;
    if (appName !== req.callingApp) return res.status(403).json({ ok: false, reason: "wrong_app" });
    const { central_session_id } = req.body || {};
    if (!central_session_id) return res.status(400).json({ ok: false, reason: "missing_central_session_id" });
    const sess = db.prepare("SELECT user_id FROM central_sessions WHERE id = ?").get(central_session_id);
    if (!sess) return res.status(404).json({ ok: false, reason: "session_not_found" });

    const result = entitlements.consume(sess.user_id, appName);
    if (result.ok) {
      audit.log({ userId: sess.user_id, eventType: "app_consume", app: appName, ip: req.ip });
      return res.status(200).json({ ok: true, remaining: result.remaining });
    }
    if (result.reason === "quota_exceeded") return res.status(402).json(result);
    return res.status(403).json(result); // not_entitled
  });
}
```

- [ ] **Step 4: Register the route in `server.js`**

In `hub/server.js`, add the import near the other route imports:

```js
import { mountApiApps } from "./routes/api-apps.js";
```

And add the mount call right after `mountApiSessions(app);`:

```js
  mountApiApps(app);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/api-apps-consume.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: Run the full hub suite**

Run: `cd /var/www/suite/hub && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add hub/routes/api-apps.js hub/server.js hub/tests/api-apps-consume.test.js
git commit -m "feat(hub): add authoritative POST /api/apps/:app/consume endpoint"
```

---

## Task C3: Dashboard shows only entitled tiles

> **⚠ Deployment impact (read before deploying — does not affect this task's tests):** raid and signal are LIVE and currently launchable by every hub user. After this change, a tile only renders as launchable when the user has an active entitlement for that app. **Before deploying, grant entitlements to existing users** (see the "Deployment" section at the end — `scripts/seed-default-entitlements.js`), or the live dashboard will show "Request access" for raid/signal to everyone.

**Files:**
- Modify: `hub/routes/dashboard.js`
- Modify: `hub/views/dashboard.eta`
- Test: `hub/tests/dashboard.test.js` (modify/extend)

- [ ] **Step 1: Write the failing test (append to `tests/dashboard.test.js`)**

The existing file already defines `buildWithDashboard()` and seeds a session by inserting a user + `central_sessions` row and setting `hub_session=<sid>` as the cookie (see its "logged-in user sees four tiles" test). Reuse that exact pattern. Append:

```js
test("dashboard renders a launchable tile only for entitled apps", async () => {
  const { app, db } = await buildWithDashboard();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const { createEntitlements } = await import("../lib/entitlements.js?t=" + Date.now());
  createEntitlements(db).grantEntitlement({ app: "raid", principalType: "user", principalId: "u1" });

  const res = await request(app).get("/dashboard").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 200);
  // raid is entitled -> launch form present
  assert.match(res.text, /action="\/launch\/raid"/);
  // signal is NOT entitled -> no launch form, shows Request access
  assert.doesNotMatch(res.text, /action="\/launch\/signal"/);
  assert.match(res.text, /Request access/);
});
```

> Note: the existing "logged-in user sees four tiles" test only asserts the four app *names* (`Sprintraid` … `Sprintpoker`), which still render in both the entitled and unentitled branches — so it stays green without changes.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/dashboard.test.js`
Expected: FAIL — currently the dashboard renders a `/launch/signal` form unconditionally, so `assert.doesNotMatch(... /launch/signal)` fails.

- [ ] **Step 3: Update `routes/dashboard.js` to compute per-app entitlement**

Replace the contents of `hub/routes/dashboard.js` with:

```js
// routes/dashboard.js
import { createRequireSession } from "../middleware/requireSession.js";
import { createEntitlements } from "../lib/entitlements.js";

const APPS = [
  { key: "raid", name: "Sprintraid", icon: "🛡", desc: "Risks/Issues" },
  { key: "signal", name: "Sprintsignal", icon: "📡", desc: "Team signals" },
  { key: "retro", name: "Sprintretro", icon: "🔄", desc: "Retrospectives" },
  { key: "poker", name: "Sprintpoker", icon: "🎴", desc: "Planning poker" },
];

export function mountDashboard(app) {
  const db = app.locals.db;
  const requireSession = createRequireSession(db);
  const entitlements = createEntitlements(db);
  app.get("/dashboard", requireSession, (req, res) => {
    const apps = APPS.map((a) => ({
      ...a,
      entitled: entitlements.resolveEntitlement(req.user.id, a.key).entitled,
    }));
    res.render("dashboard", { user: req.user, apps });
  });
}
```

- [ ] **Step 4: Update `views/dashboard.eta` to iterate the apps**

Replace the contents of `hub/views/dashboard.eta` with:

```eta
<%~ include("partials/header", { title: "Dashboard", user: it.user }) %>
<h1>Your apps</h1>
<section class="grid-4">
<% it.apps.forEach(function (a) { %>
  <% if (a.entitled) { %>
  <form method="POST" action="/launch/<%= a.key %>"><button class="tile" type="submit" style="width:100%;text-align:left;cursor:pointer;border:1px solid var(--border);">
  <h3><%= a.icon %> <%= a.name %></h3><p><%= a.desc %></p></button></form>
  <% } else { %>
  <div class="tile" style="width:100%;text-align:left;border:1px solid var(--border);opacity:0.55;">
  <h3><%= a.icon %> <%= a.name %></h3><p><%= a.desc %></p><p><em>Request access</em></p></div>
  <% } %>
<% }); %>
</section>
<% if (it.user.isAdmin) { %><p style="margin-top:32px;"><a href="/admin">Admin</a></p><% } %>
<%~ include("partials/footer") %>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/dashboard.test.js`
Expected: PASS. If a pre-existing dashboard test asserted that all four `/launch/*` forms render unconditionally, update it to grant the relevant entitlement first (the dashboard is now gated).

- [ ] **Step 6: Run the full hub suite**

Run: `cd /var/www/suite/hub && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add hub/routes/dashboard.js hub/views/dashboard.eta hub/tests/dashboard.test.js
git commit -m "feat(hub): gate dashboard tiles by app entitlement"
```

---

# PART D — `@suite/auth-client` additions

> auth-client is **CommonJS**. Tests are `node --test tests/`, use `require`, and inject `fetchImpl` for hub calls (see `tests/hub-api.test.js`). **Do NOT add entitlement *enforcement* here** — denying a launch on `entitled:false` is Layer 4 (deferred). This part only *surfaces* entitlement and adds the `consume()` helper so apps can call it when Layer 4 wires their hot paths.

## Task D1: `hub-api.js` gains `consume()`; exchange already returns entitlement

**Files:**
- Modify: `shared/auth-client/lib/hub-api.js`
- Modify: `shared/auth-client/lib/factory.js`
- Test: `shared/auth-client/tests/hub-api.test.js` (append)

- [ ] **Step 1: Read the existing hub-api test to match the fetch-injection pattern**

Run: `cd /var/www/suite/shared/auth-client && cat tests/hub-api.test.js`
Note the fake `fetchImpl` shape (a function returning `{ status, json: async () => ({...}) }`).

- [ ] **Step 2: Write the failing tests (append to `tests/hub-api.test.js`)**

```js
test("exchange passes through the entitlement object", async () => {
  const fetchImpl = async () => ({
    status: 200,
    json: async () => ({
      user: { id: "u1", email: "a@b.c", displayName: "Alice" },
      central_session_id: "cs1",
      entitlement: { entitled: true, principal: { type: "user", id: "u1" }, quota: null },
    }),
  });
  const api = createHubApi({ baseUrl: "https://hub", apiKey: "k", appName: "raid", fetchImpl });
  const info = await api.exchange("tok");
  assert.equal(info.entitlement.entitled, true);
  assert.deepEqual(info.entitlement.principal, { type: "user", id: "u1" });
});

test("consume maps 200/402/403 to a verdict object and hits the app-scoped URL", async () => {
  let calledUrl = null;
  function make(status, body) {
    return async (url) => { calledUrl = url; return { status, json: async () => body }; };
  }
  const ok = createHubApi({ baseUrl: "https://hub", apiKey: "k", appName: "raid", fetchImpl: make(200, { ok: true, remaining: 5 }) });
  assert.deepEqual(await ok.consume("cs1"), { ok: true, remaining: 5 });
  assert.equal(calledUrl, "https://hub/api/apps/raid/consume");

  const quota = createHubApi({ baseUrl: "https://hub", apiKey: "k", appName: "raid", fetchImpl: make(402, { ok: false, reason: "quota_exceeded" }) });
  assert.deepEqual(await quota.consume("cs1"), { ok: false, reason: "quota_exceeded" });

  const denied = createHubApi({ baseUrl: "https://hub", apiKey: "k", appName: "raid", fetchImpl: make(403, { ok: false, reason: "not_entitled" }) });
  assert.deepEqual(await denied.consume("cs1"), { ok: false, reason: "not_entitled" });
});

test("consume returns unreachable when fetch throws", async () => {
  const api = createHubApi({ baseUrl: "https://hub", apiKey: "k", appName: "raid", fetchImpl: async () => { throw new Error("net"); } });
  assert.deepEqual(await api.consume("cs1"), { ok: false, reason: "unreachable" });
});
```

(Ensure `const { createHubApi } = require("../lib/hub-api.js");` is at the top of the file — it already is for the existing tests.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /var/www/suite/shared/auth-client && node --test tests/hub-api.test.js`
Expected: FAIL — `api.consume is not a function`.

- [ ] **Step 4: Add `appName` + `consume()` to `lib/hub-api.js`**

In `shared/auth-client/lib/hub-api.js`, change the factory signature to accept `appName`, and add the `consume` method. Full updated file:

```js
// lib/hub-api.js
function createHubApi({ baseUrl, apiKey, appName, fetchImpl = globalThis.fetch }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  return {
    async exchange(launchToken) {
      const res = await fetchImpl(`${baseUrl}/api/sessions/exchange`, {
        method: "POST",
        headers,
        body: JSON.stringify({ launch_token: launchToken }),
      });
      if (res.status !== 200) throw new Error(`exchange_failed:${res.status}`);
      return await res.json();
    },
    async heartbeat(centralSessionId) {
      try {
        const res = await fetchImpl(`${baseUrl}/api/sessions/${centralSessionId}/heartbeat`, {
          method: "POST", headers,
        });
        if (res.status === 200) return "ok";
        if (res.status === 404) return "expired";
        return "error";
      } catch {
        return "unreachable";
      }
    },
    async consume(centralSessionId) {
      try {
        const res = await fetchImpl(`${baseUrl}/api/apps/${appName}/consume`, {
          method: "POST",
          headers,
          body: JSON.stringify({ central_session_id: centralSessionId }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.status === 200) return { ok: true, remaining: body.remaining ?? null };
        if (res.status === 402) return { ok: false, reason: "quota_exceeded" };
        if (res.status === 403) return { ok: false, reason: body.reason || "not_entitled" };
        return { ok: false, reason: "error" };
      } catch {
        return { ok: false, reason: "unreachable" };
      }
    },
    async deleteSession(centralSessionId) {
      try {
        await fetchImpl(`${baseUrl}/api/sessions/${centralSessionId}`, { method: "DELETE", headers });
      } catch {}
    },
  };
}

module.exports = { createHubApi };
```

- [ ] **Step 5: Pass `appName` into `createHubApi` from the factory**

In `shared/auth-client/lib/factory.js`, update the `createHubApi` call:

```js
  const hubApi = createHubApi({ baseUrl: options.hubBaseUrl, apiKey: options.hubApiKey, appName: options.appName });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /var/www/suite/shared/auth-client && node --test tests/hub-api.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/auth-client/lib/hub-api.js shared/auth-client/lib/factory.js shared/auth-client/tests/hub-api.test.js
git commit -m "feat(auth-client): add hub consume() helper + pass appName"
```

---

## Task D2: Expose `client.consume()` on the created auth client

**Files:**
- Modify: `shared/auth-client/lib/factory.js`
- Test: `shared/auth-client/tests/factory.test.js` (create if absent; otherwise append)

- [ ] **Step 1: Write the failing test**

Create `shared/auth-client/tests/factory.test.js` (or append if it exists):

```js
// tests/factory.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAuthClient } = require("../lib/factory.js");

test("client.consume delegates to hubApi.consume", async () => {
  const client = createAuthClient({
    appName: "raid",
    hubBaseUrl: "https://hub",
    hubApiKey: "k",
    cookieName: "raid_session",
    dbPath: ":memory:",
  });
  // inject a fake hubApi (same monkey-patch pattern the handler tests use)
  client._ctx.hubApi = { consume: async (csid) => ({ ok: true, remaining: 9, _csid: csid }) };
  const r = await client.consume("cs1");
  assert.deepEqual(r, { ok: true, remaining: 9, _csid: "cs1" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/shared/auth-client && node --test tests/factory.test.js`
Expected: FAIL — `client.consume is not a function`.

- [ ] **Step 3: Expose `consume` in `lib/factory.js`**

In `shared/auth-client/lib/factory.js`, add to the returned object (it reads `ctx.hubApi` late so the test's monkey-patch is honoured — same reason the handlers read `ctx.hubApi` late, per the plan-quirks note):

```js
  return {
    requireAuth: createRequireAuth(ctx),
    handleLaunch: createLaunchHandler(ctx),
    handleLogout: createLogoutHandler(ctx),
    handleHeartbeat: createHeartbeatHandler(ctx),
    getCurrentUser: (req) => req.user || null,
    consume: (centralSessionId) => ctx.hubApi.consume(centralSessionId),
    _ctx: ctx,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/suite/shared/auth-client && node --test tests/factory.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full auth-client suite**

Run: `cd /var/www/suite/shared/auth-client && npm test`
Expected: all pass (baseline 20 + new tests).

- [ ] **Step 6: Commit**

```bash
git add shared/auth-client/lib/factory.js shared/auth-client/tests/factory.test.js
git commit -m "feat(auth-client): expose client.consume()"
```

---

# PART E — Operator CLI scripts

> These are thin wrappers over the already-tested `lib/org.js` + `lib/entitlements.js`. They mirror `scripts/create-admin.js` (import `config`, `openDb`, call lib, log, `db.close()`). Each is verified with a manual smoke run against a throwaway DB — unit coverage of the underlying logic lives in the lib test suites. Run smoke tests with an explicit throwaway DB so you never touch real data:
> `DB_PATH=/tmp/cli-smoke.db BASE_URL=x RESEND_API_KEY=x FROM_EMAIL=x COOKIE_SECRET=x ALLOWED_APP_DOMAINS=x HUB_API_KEY_RAID=x HUB_API_KEY_SIGNAL=x HUB_API_KEY_RETRO=x HUB_API_KEY_POKER=x node scripts/<script>.js ...`
> (config.js requires those env vars.) Delete `/tmp/cli-smoke.db*` between runs if you want a clean slate.

## Task E1: `scripts/create-company.js` + `scripts/add-company-member.js`

**Files:**
- Create: `hub/scripts/create-company.js`
- Create: `hub/scripts/add-company-member.js`

- [ ] **Step 1: Create `scripts/create-company.js`**

```js
// scripts/create-company.js
import config from "../config.js";
import { openDb } from "../db/index.js";
import { createOrg } from "../lib/org.js";

const name = process.argv[2];
const slug = process.argv[3];
if (!name || !slug) {
  console.error("Usage: node scripts/create-company.js <name> <slug>");
  process.exit(1);
}
const db = openDb(config.dbPath);
const org = createOrg(db);
const existing = org.getCompanyBySlug(slug);
if (existing) {
  console.log(`Company slug '${slug}' already exists (id=${existing.id})`);
} else {
  const c = org.createCompany({ name, slug });
  console.log(`Created company '${c.name}' slug=${c.slug} (id=${c.id})`);
}
db.close();
```

- [ ] **Step 2: Create `scripts/add-company-member.js`**

```js
// scripts/add-company-member.js
import config from "../config.js";
import { openDb } from "../db/index.js";
import { createOrg } from "../lib/org.js";

const email = (process.argv[2] || "").toLowerCase();
const slug = process.argv[3];
const role = process.argv[4];
if (!email || !slug || !role) {
  console.error("Usage: node scripts/add-company-member.js <email> <company-slug> <owner|admin|member>");
  process.exit(1);
}
const db = openDb(config.dbPath);
const org = createOrg(db);
const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
if (!user) { console.error(`No user with email ${email} (create them in the hub first)`); process.exit(1); }
const company = org.getCompanyBySlug(slug);
if (!company) { console.error(`No company with slug ${slug}`); process.exit(1); }
org.addCompanyMember({ userId: user.id, companyId: company.id, role });
console.log(`Added ${email} to '${company.name}' as ${role}`);
db.close();
```

- [ ] **Step 3: Smoke-test both**

```bash
cd /var/www/suite/hub
DB_PATH=/tmp/cli-smoke.db BASE_URL=x RESEND_API_KEY=x FROM_EMAIL=x COOKIE_SECRET=x ALLOWED_APP_DOMAINS=x HUB_API_KEY_RAID=x HUB_API_KEY_SIGNAL=x HUB_API_KEY_RETRO=x HUB_API_KEY_POKER=x node scripts/create-company.js Acme acme
```
Expected: `Created company 'Acme' slug=acme (id=...)`.

Then create a user and add them:
```bash
DB_PATH=/tmp/cli-smoke.db BASE_URL=x RESEND_API_KEY=x FROM_EMAIL=x COOKIE_SECRET=x ALLOWED_APP_DOMAINS=x HUB_API_KEY_RAID=x HUB_API_KEY_SIGNAL=x HUB_API_KEY_RETRO=x HUB_API_KEY_POKER=x node scripts/create-admin.js owner@acme.com
DB_PATH=/tmp/cli-smoke.db BASE_URL=x RESEND_API_KEY=x FROM_EMAIL=x COOKIE_SECRET=x ALLOWED_APP_DOMAINS=x HUB_API_KEY_RAID=x HUB_API_KEY_SIGNAL=x HUB_API_KEY_RETRO=x HUB_API_KEY_POKER=x node scripts/add-company-member.js owner@acme.com acme owner
```
Expected: `Added owner@acme.com to 'Acme' as owner`. Then `rm -f /tmp/cli-smoke.db*`.

- [ ] **Step 4: Commit**

```bash
git add hub/scripts/create-company.js hub/scripts/add-company-member.js
git commit -m "feat(hub): CLI scripts for company create + add member"
```

---

## Task E2: `scripts/create-team.js` + `scripts/add-team-member.js`

**Files:**
- Create: `hub/scripts/create-team.js`
- Create: `hub/scripts/add-team-member.js`

- [ ] **Step 1: Create `scripts/create-team.js`**

```js
// scripts/create-team.js
import config from "../config.js";
import { openDb } from "../db/index.js";
import { createOrg } from "../lib/org.js";

const slug = process.argv[2];
const teamName = process.argv[3];
if (!slug || !teamName) {
  console.error("Usage: node scripts/create-team.js <company-slug> <team-name>");
  process.exit(1);
}
const db = openDb(config.dbPath);
const org = createOrg(db);
const company = org.getCompanyBySlug(slug);
if (!company) { console.error(`No company with slug ${slug}`); process.exit(1); }
const t = org.createTeam({ companyId: company.id, name: teamName });
console.log(`Created team '${t.name}' in '${company.name}' (id=${t.id})`);
db.close();
```

- [ ] **Step 2: Create `scripts/add-team-member.js`**

```js
// scripts/add-team-member.js
import config from "../config.js";
import { openDb } from "../db/index.js";
import { createOrg } from "../lib/org.js";

const email = (process.argv[2] || "").toLowerCase();
const slug = process.argv[3];
const teamName = process.argv[4];
const role = process.argv[5];
if (!email || !slug || !teamName || !role) {
  console.error("Usage: node scripts/add-team-member.js <email> <company-slug> <team-name> <lead|member>");
  process.exit(1);
}
const db = openDb(config.dbPath);
const org = createOrg(db);
const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
if (!user) { console.error(`No user with email ${email}`); process.exit(1); }
const company = org.getCompanyBySlug(slug);
if (!company) { console.error(`No company with slug ${slug}`); process.exit(1); }
const team = org.listTeams(company.id).find((t) => t.name === teamName);
if (!team) { console.error(`No team '${teamName}' in company ${slug}`); process.exit(1); }
org.addTeamMember({ userId: user.id, teamId: team.id, role });
console.log(`Added ${email} to team '${teamName}' as ${role}`);
db.close();
```

- [ ] **Step 3: Smoke-test**

Reuse the throwaway DB from E1's pattern (recreate Acme + owner first if you deleted it). Expected outputs: `Created team 'Platform' in 'Acme' (id=...)` and `Added owner@acme.com to team 'Platform' as lead`. Clean up `/tmp/cli-smoke.db*` after.

- [ ] **Step 4: Commit**

```bash
git add hub/scripts/create-team.js hub/scripts/add-team-member.js
git commit -m "feat(hub): CLI scripts for team create + add member"
```

---

## Task E3: `scripts/grant-entitlement.js`

**Files:**
- Create: `hub/scripts/grant-entitlement.js`

- [ ] **Step 1: Create `scripts/grant-entitlement.js`**

Resolves the principal reference per type: `user` → email, `company` → slug, `team` → `slug:teamName`.

```js
// scripts/grant-entitlement.js
import config from "../config.js";
import { openDb } from "../db/index.js";
import { createOrg } from "../lib/org.js";
import { createEntitlements } from "../lib/entitlements.js";

const [app, principalType, ref, quotaLimitArg, quotaPeriodArg] = process.argv.slice(2);
if (!app || !principalType || !ref) {
  console.error("Usage: node scripts/grant-entitlement.js <app> <user|company|team> <ref> [quotaLimit] [quotaPeriod]");
  console.error("  ref: user=email, company=slug, team=slug:teamName");
  console.error("  e.g. grant-entitlement.js raid company acme 100 month");
  process.exit(1);
}
const db = openDb(config.dbPath);
const org = createOrg(db);
const ent = createEntitlements(db);

let principalId;
if (principalType === "user") {
  const u = db.prepare("SELECT id FROM users WHERE email = ?").get(ref.toLowerCase());
  if (!u) { console.error(`No user with email ${ref}`); process.exit(1); }
  principalId = u.id;
} else if (principalType === "company") {
  const c = org.getCompanyBySlug(ref);
  if (!c) { console.error(`No company with slug ${ref}`); process.exit(1); }
  principalId = c.id;
} else if (principalType === "team") {
  const [slug, teamName] = ref.split(":");
  const c = slug ? org.getCompanyBySlug(slug) : null;
  if (!c) { console.error(`No company with slug ${slug}`); process.exit(1); }
  const team = org.listTeams(c.id).find((t) => t.name === teamName);
  if (!team) { console.error(`No team '${teamName}' in company ${slug}`); process.exit(1); }
  principalId = team.id;
} else {
  console.error(`Invalid principal type '${principalType}' (use user|company|team)`);
  process.exit(1);
}

const quotaLimit = quotaLimitArg ? parseInt(quotaLimitArg, 10) : null;
const quotaPeriod = quotaPeriodArg || (quotaLimit != null ? "month" : null);
ent.grantEntitlement({ app, principalType, principalId, quotaLimit, quotaPeriod });
console.log(
  `Granted ${app} to ${principalType}:${ref}` +
  (quotaLimit != null ? ` (quota ${quotaLimit}/${quotaPeriod})` : " (unlimited)")
);
db.close();
```

- [ ] **Step 2: Smoke-test (unlimited + quota'd)**

With Acme created (E1):
```bash
cd /var/www/suite/hub
DB_PATH=/tmp/cli-smoke.db BASE_URL=x RESEND_API_KEY=x FROM_EMAIL=x COOKIE_SECRET=x ALLOWED_APP_DOMAINS=x HUB_API_KEY_RAID=x HUB_API_KEY_SIGNAL=x HUB_API_KEY_RETRO=x HUB_API_KEY_POKER=x node scripts/grant-entitlement.js signal company acme
```
Expected: `Granted signal to company:acme (unlimited)`.
```bash
DB_PATH=/tmp/cli-smoke.db BASE_URL=x RESEND_API_KEY=x FROM_EMAIL=x COOKIE_SECRET=x ALLOWED_APP_DOMAINS=x HUB_API_KEY_RAID=x HUB_API_KEY_SIGNAL=x HUB_API_KEY_RETRO=x HUB_API_KEY_POKER=x node scripts/grant-entitlement.js raid company acme 100 month
```
Expected: `Granted raid to company:acme (quota 100/month)`. Clean up `/tmp/cli-smoke.db*`.

- [ ] **Step 3: Commit**

```bash
git add hub/scripts/grant-entitlement.js
git commit -m "feat(hub): CLI script to grant app entitlements"
```

---

## Task E4: `scripts/seed-default-entitlements.js` (deploy aid)

> Purpose: make the live dashboard keep working when Task C3's gating ships. Grants raid + signal to a chosen company (or every existing user) so current users don't lose access. Run once at deploy, after deciding the policy.

**Files:**
- Create: `hub/scripts/seed-default-entitlements.js`

- [ ] **Step 1: Create `scripts/seed-default-entitlements.js`**

```js
// scripts/seed-default-entitlements.js
// Grants signal (unlimited) + raid (quota) to every existing hub user, as a
// stop-gap so the entitlement-gated dashboard keeps working at deploy time.
// Replace/extend with company-level grants once companies are set up.
import config from "../config.js";
import { openDb } from "../db/index.js";
import { createEntitlements } from "../lib/entitlements.js";

const RAID_QUOTA = parseInt(process.argv[2] || "50", 10); // per-user monthly cap
const db = openDb(config.dbPath);
const ent = createEntitlements(db);
const users = db.prepare("SELECT id, email FROM users WHERE disabled_at IS NULL").all();
for (const u of users) {
  ent.grantEntitlement({ app: "signal", principalType: "user", principalId: u.id });
  ent.grantEntitlement({ app: "raid", principalType: "user", principalId: u.id, quotaLimit: RAID_QUOTA, quotaPeriod: "month" });
  console.log(`Granted signal(unlimited)+raid(${RAID_QUOTA}/month) to ${u.email}`);
}
console.log(`Done: ${users.length} users.`);
db.close();
```

- [ ] **Step 2: Smoke-test against the throwaway DB**

```bash
cd /var/www/suite/hub
DB_PATH=/tmp/cli-smoke.db BASE_URL=x RESEND_API_KEY=x FROM_EMAIL=x COOKIE_SECRET=x ALLOWED_APP_DOMAINS=x HUB_API_KEY_RAID=x HUB_API_KEY_SIGNAL=x HUB_API_KEY_RETRO=x HUB_API_KEY_POKER=x node scripts/seed-default-entitlements.js 50
```
Expected: one "Granted ..." line per user + "Done: N users." Clean up `/tmp/cli-smoke.db*`.

- [ ] **Step 3: Commit**

```bash
git add hub/scripts/seed-default-entitlements.js
git commit -m "feat(hub): deploy-aid script to seed default per-user entitlements"
```

---

# Final verification & self-review

- [ ] **Run both full suites:**

```bash
cd /var/www/suite/hub && npm test
```
Expected: all green (baseline 49 + new identity/entitlement/route/dashboard tests).

```bash
cd /var/www/suite/shared/auth-client && npm test
```
Expected: all green (baseline 20 + new hub-api/factory tests).

- [ ] **Spec coverage check** — confirm each spec section maps to a task:
  - Layer 1 tables + `002` migration → A1
  - companies/teams/members + roles + invariants → A2–A5
  - `app_entitlements` / `app_usage` tables → A1
  - resolution logic (allow/deny, quota math, precedence) → B2
  - RAID quota mechanics / hard block / atomic consume → B3
  - exchange entitlement payload → C1
  - dashboard tile gating → C3
  - `POST /api/apps/:app/consume` (200/402/403) → C2
  - auth-client surfaces entitlement + `consume()` helper → D1, D2
  - operator interface (CLI) → E1–E4

- [ ] **Deferred (NOT in this plan — confirm they remain out of scope):** auth-client *enforcement* (deny launch on `entitled:false`); wiring `consume()` into RAID's `/extract` hot path; `refund` endpoint; per-app team scoping for poker/retro/signal; access-request flows + self-service company-admin UI (Layer 3). These are Layers 3+4.

---

# Deployment (later, careful remote session — NOT part of TDD build)

> Follow the suite's deploy conventions (one command per block, wait for output; see the IONOS deploy reference and the no-heredocs rule). The hub is LIVE — these are migration-bearing changes.

1. **Push `feat/identity-v2`** to origin, then on the IONOS box `cd /var/www/suite && git fetch && git checkout feat/identity-v2 && git pull` (or merge to `main` first per your branch policy — raid/signal deploys merged to `main`).
2. **Migration 002 auto-applies** on the next hub start (`openDb` runs it; idempotent). No separate migrate step. Back up `/var/www/suite/hub/data/suite.db` first anyway.
3. **⚠ Before users hit the gated dashboard, grant entitlements** so raid + signal stay reachable. Decide policy:
   - Quickest stop-gap: `sudo -u suite-hub bash -c 'cd /var/www/suite/hub && node --env-file=.env scripts/seed-default-entitlements.js 50'` (per-user signal-unlimited + raid 50/month).
   - Cleaner: create a company, add users, grant company-level (`scripts/create-company.js`, `add-company-member.js`, `grant-entitlement.js`). Choose RAID's real monthly cap.
4. **Restart** `suite-hub.service`, then verify: dashboard shows entitled tiles; `curl` the exchange/consume contract if desired; magic-link login still works.
5. Existing raid/signal app code ignores the new `entitlement` field at exchange (backward compatible) and does **not** call `consume` yet (Layer 4) — so no app redeploy is required for this hub change.

---

**End of plan.**
