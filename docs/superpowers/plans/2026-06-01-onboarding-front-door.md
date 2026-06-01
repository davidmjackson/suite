# Onboarding Front Door (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stranger can submit a public "Request free access" form; the operator reviews it in `/admin/companies` and on Approve the system provisions a company + first CR (owner) + all four app entitlements (RAID capped at 25/mo) and emails the CR a sign-in link.

**Architecture:** Hub-internal, server-rendered Eta + HTML forms, no new service. A new migration adds an `access_requests` table. A thin data layer (`lib/access-requests.js`) and an orchestration layer (`lib/provisioning.js`) sit on top of the existing `lib/org.js` + `lib/entitlements.js`. A public route (`routes/request.js`) captures requests; the operator plane (`routes/admin.js`) gains a companies/requests view + approve/reject actions. Invites reuse the existing `magic_link_tokens` path with a longer, invite-specific TTL.

**Tech Stack:** Node.js (ESM), Express, better-sqlite3, Eta views, Resend email, `node:test` + supertest. Spec: `docs/superpowers/specs/2026-06-01-suite-onboarding-front-door-design.md`.

**Conventions to follow (from the existing codebase):**
- All IDs/tokens via `lib/tokens.js`: `randomId()`, `randomToken()`, `now()`.
- Migrations are applied by `db/index.js` running every `*.sql` in `db/migrations/` in sorted order with `db.exec` on **every** startup — so every statement must be idempotent (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
- Tests run with `npm test` (= `node --test tests/`). A single file: `node --test tests/<file>.test.js`.
- Run all commands from `/var/www/suite/hub`.
- Email regex used everywhere: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`.
- Audit via `lib/audit.js` `createAuditLogger(db).log({ userId, eventType, metadata, ip })` — `userId` may be `null`; pass `metadata` as a plain object (it is JSON-stringified internally).

---

## File Structure

**Create:**
- `hub/db/migrations/003-access-requests.sql` — the `access_requests` table (idempotent), schema_version → 3.
- `hub/lib/access-requests.js` — `createAccessRequests(db)`: CRUD for `access_requests`.
- `hub/lib/provisioning.js` — `createProvisioner(db, { inviteTtlMs })`: `approve({ requestId, grantedBy })` orchestration + `slugify`.
- `hub/routes/request.js` — `mountRequest(app, { emailSender })`: public `GET/POST /request`.
- `hub/views/request.eta` — the public request form.
- `hub/views/request-received.eta` — the "thanks" confirmation page.
- `hub/views/admin/companies.eta` — operator companies + pending requests view.
- `hub/views/emails/access-approved.eta` — the CR's sign-in invite email.
- `hub/tests/access-requests.test.js`, `hub/tests/provisioning.test.js`, `hub/tests/request.test.js`, `hub/tests/admin-companies.test.js`.

**Modify:**
- `hub/config.js` — add `inviteTtlMs`.
- `hub/lib/email.js` — add `sendAccessApproved`.
- `hub/lib/org.js` — add `listAllCompanies()`.
- `hub/lib/entitlements.js` — add `listCompanyApps(companyId)`.
- `hub/routes/admin.js` — accept `{ emailSender }`; add `/admin/companies`, approve, reject.
- `hub/views/admin/users.eta`, `hub/views/admin/sessions.eta`, `hub/views/admin/audit.eta` — add a "Companies & requests" nav link.
- `hub/views/landing.eta` — add a "Request free access" link.
- `hub/server.js` — `mountRequest`; pass `{ emailSender }` to `mountAdmin`.

---

## Task 1: Migration — `access_requests` table

**Files:**
- Create: `hub/db/migrations/003-access-requests.sql`
- Test: `hub/tests/access-requests.test.js` (created here, extended in Task 2)

- [ ] **Step 1: Write the failing test** — create `hub/tests/access-requests.test.js`:

```javascript
// tests/access-requests.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTestApp } from "./helpers.js";

test("003 migration creates access_requests with expected columns", async () => {
  const { db } = await buildTestApp();
  const cols = db.prepare("PRAGMA table_info(access_requests)").all().map((c) => c.name);
  for (const c of [
    "id", "company_name", "contact_name", "email", "job_title", "team_size",
    "apps_interest", "message", "status", "created_at", "reviewed_by",
    "reviewed_at", "review_note", "company_id",
  ]) {
    assert.ok(cols.includes(c), `missing column ${c}`);
  }
  const v = db.prepare("SELECT MAX(version) AS v FROM schema_version").get().v;
  assert.ok(v >= 3, "schema_version should be >= 3");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/access-requests.test.js`
Expected: FAIL — `no such table: access_requests`.

- [ ] **Step 3: Create the migration** — `hub/db/migrations/003-access-requests.sql`:

```sql
-- 003-access-requests.sql
CREATE TABLE IF NOT EXISTS access_requests (
  id            TEXT PRIMARY KEY,
  company_name  TEXT NOT NULL,
  contact_name  TEXT NOT NULL,
  email         TEXT NOT NULL,
  job_title     TEXT,
  team_size     TEXT,
  apps_interest TEXT,
  message       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    INTEGER NOT NULL,
  reviewed_by   TEXT REFERENCES users(id),
  reviewed_at   INTEGER,
  review_note   TEXT,
  company_id    TEXT REFERENCES companies(id)
);
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);

INSERT INTO schema_version (version, applied_at) VALUES (3, strftime('%s','now')*1000)
  ON CONFLICT(version) DO NOTHING;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/access-requests.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hub/db/migrations/003-access-requests.sql hub/tests/access-requests.test.js
git commit -m "feat(hub): migration 003 access_requests table"
```

---

## Task 2: Data layer — `lib/access-requests.js`

**Files:**
- Create: `hub/lib/access-requests.js`
- Test: `hub/tests/access-requests.test.js` (extend)

- [ ] **Step 1: Add failing tests** — append to `hub/tests/access-requests.test.js`:

```javascript
import { createAccessRequests } from "../lib/access-requests.js";

test("createRequest inserts a pending row and serialises apps_interest", async () => {
  const { db } = await buildTestApp();
  const reqs = createAccessRequests(db);
  const r = reqs.createRequest({
    companyName: "IBM", contactName: "James", email: "james@ibm.com",
    jobTitle: "Scrum Master", teamSize: "11-50", appsInterest: ["poker", "retro"],
    message: "hi",
  });
  assert.equal(r.status, "pending");
  assert.equal(r.company_name, "IBM");
  assert.equal(JSON.parse(r.apps_interest).length, 2);
  assert.ok(r.created_at > 0);
});

test("listByStatus and getRequest", async () => {
  const { db } = await buildTestApp();
  const reqs = createAccessRequests(db);
  const a = reqs.createRequest({ companyName: "A", contactName: "x", email: "a@a.com" });
  reqs.createRequest({ companyName: "B", contactName: "y", email: "b@b.com" });
  const pending = reqs.listByStatus("pending");
  assert.equal(pending.length, 2);
  assert.equal(reqs.getRequest(a.id).company_name, "A");
  assert.equal(reqs.getRequest("nope"), null);
});

test("markReviewed updates status and stamps fields", async () => {
  const { db } = await buildTestApp();
  const reqs = createAccessRequests(db);
  const a = reqs.createRequest({ companyName: "A", contactName: "x", email: "a@a.com" });
  const updated = reqs.markReviewed({ id: a.id, status: "rejected", reviewedBy: "op1", note: "spam" });
  assert.equal(updated.status, "rejected");
  assert.equal(updated.reviewed_by, "op1");
  assert.equal(updated.review_note, "spam");
  assert.ok(updated.reviewed_at > 0);
  assert.equal(reqs.listByStatus("pending").length, 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/access-requests.test.js`
Expected: FAIL — cannot find module `../lib/access-requests.js`.

- [ ] **Step 3: Implement** — `hub/lib/access-requests.js`:

```javascript
// lib/access-requests.js
import { randomId, now } from "./tokens.js";

export function createAccessRequests(db) {
  function getRequest(id) {
    return db.prepare("SELECT * FROM access_requests WHERE id = ?").get(id) || null;
  }

  function createRequest({
    companyName, contactName, email,
    jobTitle = null, teamSize = null, appsInterest = null, message = null,
  }) {
    const id = randomId();
    db.prepare(`
      INSERT INTO access_requests
        (id,company_name,contact_name,email,job_title,team_size,apps_interest,message,status,created_at)
      VALUES (?,?,?,?,?,?,?,?, 'pending', ?)
    `).run(
      id, companyName, contactName, email, jobTitle, teamSize,
      appsInterest ? JSON.stringify(appsInterest) : null, message, now(),
    );
    return getRequest(id);
  }

  function listByStatus(status) {
    return db.prepare("SELECT * FROM access_requests WHERE status = ? ORDER BY created_at DESC").all(status);
  }

  function markReviewed({ id, status, reviewedBy = null, note = null, companyId = null }) {
    db.prepare(`
      UPDATE access_requests
      SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, company_id = ?
      WHERE id = ?
    `).run(status, reviewedBy, now(), note, companyId, id);
    return getRequest(id);
  }

  return { createRequest, getRequest, listByStatus, markReviewed };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/access-requests.test.js`
Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add hub/lib/access-requests.js hub/tests/access-requests.test.js
git commit -m "feat(hub): access-requests data layer"
```

---

## Task 3: Config + email — invite TTL & approved-email sender

**Files:**
- Modify: `hub/config.js`
- Modify: `hub/lib/email.js`
- Create: `hub/views/emails/access-approved.eta`
- Test: `hub/tests/email.test.js` (extend)

- [ ] **Step 1: Add failing test** — append to `hub/tests/email.test.js`:

```javascript
import { renderAccessApprovedEmail } from "../lib/email.js";

test("renderAccessApprovedEmail includes the sign-in url", async () => {
  const html = await renderAccessApprovedEmail({ url: "https://test/auth/magic?token=abc" });
  assert.match(html, /auth\/magic\?token=abc/);
  assert.match(html, /Sprint Suite/);
});
```

(If `test`/`assert` are not already imported at the top of `email.test.js`, the existing file already imports them — reuse those imports; do not duplicate.)

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/email.test.js`
Expected: FAIL — `renderAccessApprovedEmail` is not exported.

- [ ] **Step 3a: Add invite TTL to config** — in `hub/config.js`, add one line inside the `config` object, right after the `magicLinkTtlMs` line:

```javascript
  magicLinkTtlMs: 15 * 60 * 1000,
  inviteTtlMs: 7 * 24 * 60 * 60 * 1000,
  launchTokenTtlMs: 30 * 1000,
```

- [ ] **Step 3b: Create the email template** — `hub/views/emails/access-approved.eta`:

```eta
<!-- views/emails/access-approved.eta -->
<!doctype html>
<html><body style="font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 32px auto; color: #222;">
<h2 style="margin-bottom: 8px;">Your Sprint Suite access is approved</h2>
<p>Welcome aboard. Click below to sign in and set up your team. This link is valid for 7 days.</p>
<p><a href="<%= it.url %>" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none;">Sign in to Sprint Suite</a></p>
<p style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
<p style="color: #999; font-size: 12px; margin-top: 32px;">Sprint Suite · sprintsuite.uk</p>
</body></html>
```

- [ ] **Step 3c: Add render + send helpers** — in `hub/lib/email.js`, add the render function after `renderMagicLinkEmail`:

```javascript
export async function renderAccessApprovedEmail({ url }) {
  return await eta.renderAsync("emails/access-approved", { url });
}
```

  and add a `sendAccessApproved` method inside the object returned by `createEmailSender`, right after `sendMagicLink`:

```javascript
    async sendAccessApproved({ to, url }) {
      const html = await renderAccessApprovedEmail({ url });
      return await resend.emails.send({
        from,
        to,
        subject: "You're approved — sign in to Sprint Suite",
        html,
      });
    },
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/email.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hub/config.js hub/lib/email.js hub/views/emails/access-approved.eta hub/tests/email.test.js
git commit -m "feat(hub): invite TTL config + access-approved email"
```

---

## Task 4: Read helpers — `org.listAllCompanies` + `entitlements.listCompanyApps`

**Files:**
- Modify: `hub/lib/org.js`
- Modify: `hub/lib/entitlements.js`
- Test: `hub/tests/org.test.js` (extend), `hub/tests/entitlements.test.js` (extend)

- [ ] **Step 1: Add failing tests**

Append to `hub/tests/org.test.js`:

```javascript
test("listAllCompanies returns every company with member counts", async () => {
  const { db } = await buildTestApp();
  const org = createOrg(db);
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "u1@a.com", Date.now());
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "owner" });
  const all = org.listAllCompanies();
  assert.equal(all.length, 1);
  assert.equal(all[0].slug, "acme");
  assert.equal(all[0].memberCount, 1);
});
```

(Use the same imports the existing `org.test.js` already has — `createOrg`, `buildTestApp`, `test`, `assert`. Do not duplicate imports.)

Append to `hub/tests/entitlements.test.js`:

```javascript
test("listCompanyApps lists active company-scoped apps", async () => {
  const { db } = await buildTestApp();
  const ent = createEntitlements(db);
  ent.grantEntitlement({ app: "poker", principalType: "company", principalId: "co1" });
  ent.grantEntitlement({ app: "raid", principalType: "company", principalId: "co1", quotaLimit: 25, quotaPeriod: "month" });
  ent.grantEntitlement({ app: "signal", principalType: "user", principalId: "u1" }); // wrong principal, excluded
  const apps = ent.listCompanyApps("co1");
  assert.deepEqual(apps, ["poker", "raid"]);
});
```

(Reuse the existing `entitlements.test.js` imports for `createEntitlements`, `buildTestApp`, `test`, `assert`.)

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/org.test.js tests/entitlements.test.js`
Expected: FAIL — `org.listAllCompanies is not a function` / `ent.listCompanyApps is not a function`.

- [ ] **Step 3a: Implement `listAllCompanies`** — in `hub/lib/org.js`, add this function before the `return {` block:

```javascript
  function listAllCompanies() {
    return db.prepare(`
      SELECT c.id AS id, c.name AS name, c.slug AS slug, c.status AS status,
             (SELECT COUNT(*) FROM company_members cm WHERE cm.company_id = c.id) AS memberCount
      FROM companies c
      ORDER BY c.name
    `).all();
  }
```

  and add `listAllCompanies` to the returned object (e.g. on the line with `adminCompaniesForUser, listCompanyMembers, listTeamMembers,`):

```javascript
    adminCompaniesForUser, listCompanyMembers, listTeamMembers, listAllCompanies,
```

- [ ] **Step 3b: Implement `listCompanyApps`** — in `hub/lib/entitlements.js`, add before the `return {` block:

```javascript
  function listCompanyApps(companyId) {
    return db.prepare(`
      SELECT app FROM app_entitlements
      WHERE principal_type = 'company' AND principal_id = ? AND status = 'active'
      ORDER BY app
    `).all(companyId).map((r) => r.app);
  }
```

  and add it to the returned object:

```javascript
  return { principalsForUser, grantEntitlement, revokeEntitlement, resolveEntitlement, consume, listCompanyApps };
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/org.test.js tests/entitlements.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hub/lib/org.js hub/lib/entitlements.js hub/tests/org.test.js hub/tests/entitlements.test.js
git commit -m "feat(hub): listAllCompanies + listCompanyApps read helpers"
```

---

## Task 5: Provisioning orchestration — `lib/provisioning.js`

**Files:**
- Create: `hub/lib/provisioning.js`
- Test: `hub/tests/provisioning.test.js`

- [ ] **Step 1: Write failing tests** — create `hub/tests/provisioning.test.js`:

```javascript
// tests/provisioning.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTestApp } from "./helpers.js";
import { createAccessRequests } from "../lib/access-requests.js";
import { createProvisioner, slugify } from "../lib/provisioning.js";

test("slugify produces clean kebab slugs", () => {
  assert.equal(slugify("IBM"), "ibm");
  assert.equal(slugify("  Acme & Co!! "), "acme-co");
  assert.equal(slugify(""), "company");
});

async function pendingRequest(db, over = {}) {
  const reqs = createAccessRequests(db);
  return reqs.createRequest({
    companyName: "IBM", contactName: "James", email: "james@ibm.com", ...over,
  });
}

test("approve provisions company + owner + 4 entitlements + invite token", async () => {
  const { db } = await buildTestApp();
  const r = await pendingRequest(db);
  const prov = createProvisioner(db, { inviteTtlMs: 1000 });
  const res = prov.approve({ requestId: r.id, grantedBy: "op1" });
  assert.equal(res.ok, true);

  const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(res.company.id);
  assert.equal(company.name, "IBM");
  assert.equal(company.slug, "ibm");

  const member = db.prepare("SELECT role FROM company_members WHERE company_id=? AND user_id=?")
    .get(company.id, res.user.id);
  assert.equal(member.role, "owner");

  const ents = db.prepare("SELECT app, quota_limit, quota_period FROM app_entitlements WHERE principal_type='company' AND principal_id=? ORDER BY app").all(company.id);
  assert.deepEqual(ents.map((e) => e.app), ["poker", "raid", "retro", "signal"]);
  const raid = ents.find((e) => e.app === "raid");
  assert.equal(raid.quota_limit, 25);
  assert.equal(raid.quota_period, "month");

  const tok = db.prepare("SELECT * FROM magic_link_tokens WHERE email = ?").get("james@ibm.com");
  assert.ok(tok, "an invite token row exists");
  assert.equal(res.token, tok.token);

  const updated = createAccessRequests(db).getRequest(r.id);
  assert.equal(updated.status, "approved");
  assert.equal(updated.company_id, company.id);
});

test("approve is a no-op on an already-handled request", async () => {
  const { db } = await buildTestApp();
  const r = await pendingRequest(db);
  const prov = createProvisioner(db, { inviteTtlMs: 1000 });
  prov.approve({ requestId: r.id, grantedBy: "op1" });
  const second = prov.approve({ requestId: r.id, grantedBy: "op1" });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "not_pending");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM companies").get().n, 1);
});

test("approve reuses an existing user row for a known email", async () => {
  const { db } = await buildTestApp();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("existing", "james@ibm.com", Date.now());
  const r = await pendingRequest(db);
  const prov = createProvisioner(db, { inviteTtlMs: 1000 });
  const res = prov.approve({ requestId: r.id, grantedBy: "op1" });
  assert.equal(res.user.id, "existing");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email=?").get("james@ibm.com").n, 1);
});

test("approve gives a unique slug when the base slug is taken", async () => {
  const { db } = await buildTestApp();
  const prov = createProvisioner(db, { inviteTtlMs: 1000 });
  prov.approve({ requestId: (await pendingRequest(db)).id, grantedBy: "op1" });
  prov.approve({ requestId: (await pendingRequest(db, { email: "j2@ibm.com" })).id, grantedBy: "op1" });
  const slugs = db.prepare("SELECT slug FROM companies ORDER BY slug").all().map((c) => c.slug);
  assert.deepEqual(slugs, ["ibm", "ibm-2"]);
});

test("approve of an unknown request returns not_found", async () => {
  const { db } = await buildTestApp();
  const prov = createProvisioner(db, { inviteTtlMs: 1000 });
  const res = prov.approve({ requestId: "nope", grantedBy: "op1" });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "not_found");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/provisioning.test.js`
Expected: FAIL — cannot find module `../lib/provisioning.js`.

- [ ] **Step 3: Implement** — `hub/lib/provisioning.js`:

```javascript
// lib/provisioning.js
import { randomId, randomToken, now } from "./tokens.js";
import { createOrg } from "./org.js";
import { createEntitlements } from "./entitlements.js";
import { createAccessRequests } from "./access-requests.js";

// Apps every approved company gets. RAID is capped; the rest are unlimited.
const DEFAULT_APPS = [
  { app: "poker" },
  { app: "retro" },
  { app: "signal" },
  { app: "raid", quotaLimit: 25, quotaPeriod: "month" },
];

export function slugify(name) {
  const base = String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "company";
}

export function createProvisioner(db, { inviteTtlMs }) {
  const org = createOrg(db);
  const ent = createEntitlements(db);
  const reqs = createAccessRequests(db);

  function uniqueSlug(base) {
    let slug = base;
    let n = 2;
    while (org.getCompanyBySlug(slug)) {
      slug = `${base}-${n}`;
      n += 1;
    }
    return slug;
  }

  // Synchronous (better-sqlite3 transaction). Email sending happens in the
  // route AFTER this returns, because it is async and must not be in the tx.
  const approve = db.transaction(({ requestId, grantedBy }) => {
    const reqRow = reqs.getRequest(requestId);
    if (!reqRow) return { ok: false, reason: "not_found" };
    if (reqRow.status !== "pending") return { ok: false, reason: "not_pending" };

    const slug = uniqueSlug(slugify(reqRow.company_name));
    const company = org.createCompany({ name: reqRow.company_name, slug });

    const email = reqRow.email.trim().toLowerCase();
    let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) {
      const id = randomId();
      db.prepare("INSERT INTO users (id,email,display_name,is_admin,created_at) VALUES (?,?,?,?,?)")
        .run(id, email, reqRow.contact_name || null, 0, now());
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    }

    const already = db.prepare("SELECT 1 FROM company_members WHERE user_id=? AND company_id=?")
      .get(user.id, company.id);
    if (!already) org.addCompanyMember({ userId: user.id, companyId: company.id, role: "owner" });

    for (const a of DEFAULT_APPS) {
      ent.grantEntitlement({
        app: a.app,
        principalType: "company",
        principalId: company.id,
        quotaLimit: a.quotaLimit ?? null,
        quotaPeriod: a.quotaPeriod ?? null,
        grantedBy,
      });
    }

    const token = randomToken();
    const t = now();
    db.prepare("INSERT INTO magic_link_tokens (token,email,return_to,created_at,expires_at) VALUES (?,?,?,?,?)")
      .run(token, email, null, t, t + inviteTtlMs);

    reqs.markReviewed({ id: requestId, status: "approved", reviewedBy: grantedBy, companyId: company.id });

    return { ok: true, company, user, token };
  });

  return { approve, uniqueSlug };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/provisioning.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add hub/lib/provisioning.js hub/tests/provisioning.test.js
git commit -m "feat(hub): approveAccessRequest provisioning orchestration"
```

---

## Task 6: Public request form — `routes/request.js` + views

**Files:**
- Create: `hub/routes/request.js`
- Create: `hub/views/request.eta`
- Create: `hub/views/request-received.eta`
- Test: `hub/tests/request.test.js`

- [ ] **Step 1: Write failing tests** — create `hub/tests/request.test.js`:

```javascript
// tests/request.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";

async function setup() {
  const { app, db } = await buildTestApp();
  const { mountRequest } = await import("../routes/request.js?t=" + Date.now());
  mountRequest(app, {});
  return { app, db };
}

test("GET /request renders the form", async () => {
  const { app } = await setup();
  const res = await request(app).get("/request");
  assert.equal(res.status, 200);
  assert.match(res.text, /company_name/);
  assert.match(res.text, /Request access/);
});

test("POST /request stores a pending request", async () => {
  const { app, db } = await setup();
  const res = await request(app).post("/request").type("form").send({
    company_name: "IBM", contact_name: "James", email: "james@ibm.com",
    job_title: "Scrum Master", team_size: "11-50", apps: ["poker", "retro"], message: "hi",
  });
  assert.equal(res.status, 200);
  assert.match(res.text, /received/i);
  const row = db.prepare("SELECT * FROM access_requests WHERE email=?").get("james@ibm.com");
  assert.equal(row.company_name, "IBM");
  assert.equal(row.status, "pending");
  assert.equal(JSON.parse(row.apps_interest).length, 2);
});

test("POST /request rejects an invalid email with 400 and stores nothing", async () => {
  const { app, db } = await setup();
  const res = await request(app).post("/request").type("form").send({
    company_name: "IBM", contact_name: "James", email: "not-an-email",
  });
  assert.equal(res.status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM access_requests").get().n, 0);
});

test("POST /request silently drops bot submissions (honeypot filled)", async () => {
  const { app, db } = await setup();
  const res = await request(app).post("/request").type("form").send({
    company_name: "IBM", contact_name: "James", email: "james@ibm.com", website: "http://spam",
  });
  assert.equal(res.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM access_requests").get().n, 0);
});

test("POST /request rate-limits a flood from one IP", async () => {
  const { app } = await setup();
  let last;
  for (let i = 0; i < 7; i++) {
    last = await request(app).post("/request").type("form").send({
      company_name: "C" + i, contact_name: "x", email: `x${i}@c.com`,
    });
  }
  assert.equal(last.status, 429);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/request.test.js`
Expected: FAIL — cannot find module `../routes/request.js`.

- [ ] **Step 3a: Implement the route** — `hub/routes/request.js`:

```javascript
// routes/request.js
import { createAccessRequests } from "../lib/access-requests.js";
import { createLimiter } from "../lib/rate-limit.js";
import { createAuditLogger } from "../lib/audit.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const APP_KEYS = ["poker", "retro", "signal", "raid"];
const ipLimiter = createLimiter({ max: 5, windowMs: 60 * 60 * 1000 });

export function mountRequest(app, { emailSender } = {}) {
  const db = app.locals.db;
  const reqs = createAccessRequests(db);
  const audit = createAuditLogger(db);

  app.get("/request", (req, res) => {
    res.render("request", { error: null, values: {} });
  });

  app.post("/request", (req, res) => {
    // Honeypot: a hidden field bots tend to fill. Real users leave it empty.
    if ((req.body.website || "").trim() !== "") {
      return res.render("request-received", {});
    }
    if (!ipLimiter.check(req.ip)) {
      return res.status(429).render("error", { title: "Too many requests", message: "Please wait a little while and try again." });
    }

    const companyName = (req.body.company_name || "").trim();
    const contactName = (req.body.contact_name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const jobTitle = (req.body.job_title || "").trim() || null;
    const teamSize = (req.body.team_size || "").trim() || null;
    const message = (req.body.message || "").trim() || null;

    let apps = req.body.apps;
    if (typeof apps === "string") apps = [apps];
    apps = Array.isArray(apps) ? apps.filter((a) => APP_KEYS.includes(a)) : [];

    if (!companyName || !contactName || !EMAIL_RE.test(email)) {
      return res.status(400).render("request", {
        error: "Please provide a company, your name, and a valid email.",
        values: { company_name: companyName, contact_name: contactName, email, job_title: jobTitle, team_size: teamSize, message },
      });
    }

    reqs.createRequest({ companyName, contactName, email, jobTitle, teamSize, appsInterest: apps, message });
    audit.log({ userId: null, eventType: "access_requested", metadata: { company: companyName, email }, ip: req.ip });
    res.render("request-received", {});
  });
}
```

- [ ] **Step 3b: Create the form view** — `hub/views/request.eta`:

```eta
<%~ include("partials/header", { title: "Request free access", user: null }) %>
<section style="max-width:520px;margin:32px auto;">
<h1>Request free access</h1>
<p class="muted">Tell us about your team and we'll set you up.</p>
<% if (it.error) { %><p style="color:#b91c1c;"><%= it.error %></p><% } %>
<form method="POST" action="/request">
<p><input type="text" name="company_name" placeholder="Company / group" required value="<%= it.values.company_name || '' %>"></p>
<p><input type="text" name="contact_name" placeholder="Your name" required value="<%= it.values.contact_name || '' %>"></p>
<p><input type="email" name="email" placeholder="Work email" required value="<%= it.values.email || '' %>"></p>
<p><input type="text" name="job_title" placeholder="Job title (optional)" value="<%= it.values.job_title || '' %>"></p>
<p><select name="team_size">
<option value="">Team size (optional)</option>
<option value="1-10">1–10</option>
<option value="11-50">11–50</option>
<option value="51-200">51–200</option>
<option value="200+">200+</option>
</select></p>
<fieldset style="border:1px solid #ddd;padding:12px;margin:0 0 12px;">
<legend>Apps you're interested in</legend>
<label><input type="checkbox" name="apps" value="poker"> Sprintpoker</label><br>
<label><input type="checkbox" name="apps" value="retro"> Sprintretro</label><br>
<label><input type="checkbox" name="apps" value="signal"> Sprintsignal</label><br>
<label><input type="checkbox" name="apps" value="raid"> Sprintraid</label>
</fieldset>
<p><textarea name="message" placeholder="Anything else? (optional)" rows="3" style="width:100%;"></textarea></p>
<div style="position:absolute;left:-9999px;" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>
<p><button class="btn" type="submit">Request access</button></p>
</form>
</section>
<%~ include("partials/footer") %>
```

- [ ] **Step 3c: Create the confirmation view** — `hub/views/request-received.eta`:

```eta
<%~ include("partials/header", { title: "Request received", user: null }) %>
<section style="max-width:520px;margin:48px auto;text-align:center;">
<h1>Thanks — request received</h1>
<p class="muted">We'll review your request and email you a sign-in link once you're approved.</p>
<p style="margin-top:24px;"><a class="btn" href="/">Back to home</a></p>
</section>
<%~ include("partials/footer") %>
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/request.test.js`
Expected: PASS (all five tests).

- [ ] **Step 5: Commit**

```bash
git add hub/routes/request.js hub/views/request.eta hub/views/request-received.eta hub/tests/request.test.js
git commit -m "feat(hub): public request-free-access form"
```

---

## Task 7: Operator companies view + approve/reject — `routes/admin.js`

**Files:**
- Modify: `hub/routes/admin.js`
- Create: `hub/views/admin/companies.eta`
- Test: `hub/tests/admin-companies.test.js`

- [ ] **Step 1: Write failing tests** — create `hub/tests/admin-companies.test.js`:

```javascript
// tests/admin-companies.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";
import { createAccessRequests } from "../lib/access-requests.js";

async function setup({ isAdmin = true } = {}) {
  const { app, db } = await buildTestApp();
  const sent = [];
  const emailSender = { async sendAccessApproved({ to, url }) { sent.push({ to, url }); } };
  const { mountAdmin } = await import("../routes/admin.js?t=" + Date.now());
  mountAdmin(app, { emailSender });
  db.prepare("INSERT INTO users (id,email,display_name,is_admin,created_at) VALUES (?,?,?,?,?)")
    .run("admin1", "admin@test", "Admin", isAdmin ? 1 : 0, now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "admin1", now(), now(), now() + 60_000);
  return { app, db, sid, sent };
}

test("non-admin is blocked from /admin/companies", async () => {
  const { app, sid } = await setup({ isAdmin: false });
  const res = await request(app).get("/admin/companies").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 403);
});

test("admin sees companies and pending requests", async () => {
  const { app, db, sid } = await setup();
  createAccessRequests(db).createRequest({ companyName: "IBM", contactName: "James", email: "james@ibm.com" });
  const res = await request(app).get("/admin/companies").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /IBM/);
  assert.match(res.text, /james@ibm.com/);
});

test("approve provisions and emails the CR", async () => {
  const { app, db, sid, sent } = await setup();
  const r = createAccessRequests(db).createRequest({ companyName: "IBM", contactName: "James", email: "james@ibm.com" });
  const res = await request(app).post(`/admin/requests/${r.id}/approve`).set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 302);
  const company = db.prepare("SELECT * FROM companies WHERE slug='ibm'").get();
  assert.ok(company);
  const ents = db.prepare("SELECT app FROM app_entitlements WHERE principal_id=?").all(company.id);
  assert.equal(ents.length, 4);
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /auth\/magic\?token=/);
  assert.equal(sent[0].to, "james@ibm.com");
});

test("approving an already-handled request returns a friendly 400", async () => {
  const { app, db, sid } = await setup();
  const r = createAccessRequests(db).createRequest({ companyName: "IBM", contactName: "James", email: "james@ibm.com" });
  await request(app).post(`/admin/requests/${r.id}/approve`).set("Cookie", `hub_session=${sid}`);
  const res = await request(app).post(`/admin/requests/${r.id}/approve`).set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 400);
});

test("reject marks the request rejected and provisions nothing", async () => {
  const { app, db, sid } = await setup();
  const r = createAccessRequests(db).createRequest({ companyName: "IBM", contactName: "James", email: "james@ibm.com" });
  const res = await request(app).post(`/admin/requests/${r.id}/reject`).type("form")
    .set("Cookie", `hub_session=${sid}`).send({ review_note: "spam" });
  assert.equal(res.status, 302);
  assert.equal(createAccessRequests(db).getRequest(r.id).status, "rejected");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM companies").get().n, 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/admin-companies.test.js`
Expected: FAIL — `/admin/companies` is 404 (route not defined) and `mountAdmin` ignores `emailSender`.

- [ ] **Step 3a: Wire new deps into `mountAdmin`** — in `hub/routes/admin.js`, change the imports block to add:

```javascript
import { createOrg } from "../lib/org.js";
import { createEntitlements } from "../lib/entitlements.js";
import { createAccessRequests } from "../lib/access-requests.js";
import { createProvisioner } from "../lib/provisioning.js";
```

  change the signature `export function mountAdmin(app) {` to:

```javascript
export function mountAdmin(app, { emailSender } = {}) {
```

  and just after `const audit = createAuditLogger(db);` add:

```javascript
  const config = app.locals.config;
  const org = createOrg(db);
  const ent = createEntitlements(db);
  const reqs = createAccessRequests(db);
  const provisioner = createProvisioner(db, { inviteTtlMs: config.inviteTtlMs });
```

- [ ] **Step 3b: Add the three routes** — in `hub/routes/admin.js`, add before the closing `}` of `mountAdmin`:

```javascript
  app.get("/admin/companies", requireSession, requireAdmin, (req, res) => {
    const companies = org.listAllCompanies();
    const appsByCompany = {};
    for (const c of companies) appsByCompany[c.id] = ent.listCompanyApps(c.id);
    const requests = reqs.listByStatus("pending");
    res.render("admin/companies", { user: req.user, companies, appsByCompany, requests });
  });

  app.post("/admin/requests/:id/approve", requireSession, requireAdmin, async (req, res) => {
    const result = provisioner.approve({ requestId: req.params.id, grantedBy: req.user.id });
    if (!result.ok) {
      const message = result.reason === "not_pending"
        ? "That request has already been handled."
        : "Request not found.";
      return res.status(400).render("error", { title: "Can't approve", message });
    }
    audit.log({ userId: req.user.id, eventType: "access_request_approved", metadata: { company: result.company.slug, email: result.user.email }, ip: req.ip });
    const url = `${config.baseUrl}/auth/magic?token=${result.token}`;
    try {
      if (emailSender) await emailSender.sendAccessApproved({ to: result.user.email, url });
    } catch (err) {
      console.error("access-approved email send failed", err);
    }
    res.redirect("/admin/companies");
  });

  app.post("/admin/requests/:id/reject", requireSession, requireAdmin, (req, res) => {
    const note = (req.body.review_note || "").trim() || null;
    const r = reqs.getRequest(req.params.id);
    if (!r || r.status !== "pending") {
      return res.status(400).render("error", { title: "Can't reject", message: "That request has already been handled." });
    }
    reqs.markReviewed({ id: req.params.id, status: "rejected", reviewedBy: req.user.id, note });
    audit.log({ userId: req.user.id, eventType: "access_request_rejected", metadata: { email: r.email }, ip: req.ip });
    res.redirect("/admin/companies");
  });
```

- [ ] **Step 3c: Create the view** — `hub/views/admin/companies.eta`:

```eta
<%~ include("../partials/header", { title: "Admin · Companies", user: it.user }) %>
<nav style="margin-bottom:24px;">
<a href="/admin">Users</a> · <a href="/admin/sessions">Active sessions</a> · <a href="/admin/audit">Audit log</a> · <a href="/admin/companies">Companies &amp; requests</a>
</nav>
<div class="card">
<h2>Pending requests (<%= it.requests.length %>)</h2>
<% if (it.requests.length === 0) { %><p class="muted">No pending requests.</p><% } else { %>
<table>
<thead><tr><th>Company</th><th>Contact</th><th>Email</th><th>Apps</th><th></th></tr></thead>
<tbody>
<% for (const r of it.requests) { %>
<tr>
<td><%= r.company_name %></td>
<td><%= r.contact_name %></td>
<td><%= r.email %></td>
<td><%= r.apps_interest || "—" %></td>
<td>
<form method="POST" action="/admin/requests/<%= r.id %>/approve" style="display:inline;"><button class="btn" type="submit">Approve</button></form>
<form method="POST" action="/admin/requests/<%= r.id %>/reject" style="display:inline;" onsubmit="return confirm('Reject this request?')"><button class="btn danger" type="submit">Reject</button></form>
</td>
</tr>
<% } %>
</tbody></table>
<% } %>
</div>
<div class="card">
<h2>Companies (<%= it.companies.length %>)</h2>
<table>
<thead><tr><th>Name</th><th>Slug</th><th>Status</th><th>Members</th><th>Apps</th></tr></thead>
<tbody>
<% for (const c of it.companies) { %>
<tr>
<td><a href="/company/<%= c.slug %>"><%= c.name %></a></td>
<td><%= c.slug %></td>
<td><%= c.status %></td>
<td><%= c.memberCount %></td>
<td><%= (it.appsByCompany[c.id] || []).join(", ") || "—" %></td>
</tr>
<% } %>
</tbody></table>
</div>
<%~ include("../partials/footer") %>
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/admin-companies.test.js`
Expected: PASS (all six tests).

- [ ] **Step 5: Commit**

```bash
git add hub/routes/admin.js hub/views/admin/companies.eta hub/tests/admin-companies.test.js
git commit -m "feat(hub): operator companies view + approve/reject requests"
```

---

## Task 8: Wire it together + nav links + full suite green

**Files:**
- Modify: `hub/server.js`
- Modify: `hub/views/admin/users.eta`, `hub/views/admin/sessions.eta`, `hub/views/admin/audit.eta`
- Modify: `hub/views/landing.eta`

- [ ] **Step 1: Wire routes in `server.js`** — in `hub/server.js`, add the import after `import { mountCompany } from "./routes/company.js";`:

```javascript
import { mountRequest } from "./routes/request.js";
```

  then change the two mount lines so they read:

```javascript
mountAdmin(app, { emailSender });
mountCompany(app);
mountRequest(app, { emailSender });
```

(i.e. add `{ emailSender }` to the existing `mountAdmin(app);` call, and add the new `mountRequest` line.)

- [ ] **Step 2: Add the admin nav link** — in each of `hub/views/admin/users.eta`, `hub/views/admin/sessions.eta`, `hub/views/admin/audit.eta`, find the nav line:

```eta
<a href="/admin">Users</a> · <a href="/admin/sessions">Active sessions</a> · <a href="/admin/audit">Audit log</a>
```

  and replace it with:

```eta
<a href="/admin">Users</a> · <a href="/admin/sessions">Active sessions</a> · <a href="/admin/audit">Audit log</a> · <a href="/admin/companies">Companies &amp; requests</a>
```

- [ ] **Step 3: Add the landing-page link** — in `hub/views/landing.eta`, replace the sign-in line:

```eta
<% if (!it.user) { %><p style="margin-top:24px;"><a class="btn" href="/login">Sign in</a></p><% } %>
```

  with:

```eta
<% if (!it.user) { %><p style="margin-top:24px;"><a class="btn" href="/login">Sign in</a> <a class="btn" href="/request">Request free access</a></p><% } %>
```

- [ ] **Step 4: Run the FULL test suite**

Run: `npm test`
Expected: PASS — all existing tests plus the new files green. (Baseline was 134/134; this adds ~25 tests.)

- [ ] **Step 5: Smoke-check the server boots** (catches view/import wiring errors a unit test might miss)

Run: `node -e "import('./server.js').catch(e=>{console.error(e);process.exit(1)})" & sleep 1; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/request; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/healthz; kill %1`
Expected: `200` then `200`. (If `PORT`/env is unset locally, this may need the hub `.env`; if so, skip and rely on the suite + a manual check at deploy.)

- [ ] **Step 6: Commit**

```bash
git add hub/server.js hub/views/admin/users.eta hub/views/admin/sessions.eta hub/views/admin/audit.eta hub/views/landing.eta
git commit -m "feat(hub): wire request route + companies nav + landing link"
```

---

## Deployment notes (for when the plan is fully implemented)

Hub-internal change. Follow the IONOS deploy conventions + the step-by-step / no-heredoc shell rules in memory.
1. Pull the new SHA on prod.
2. Restart `suite-hub` — migration `003` applies automatically on boot (`db/index.js` runs all `*.sql`).
3. Verify `/healthz` → 200, `/request` → 200, and `/admin/companies` (as the operator) renders.
4. Rollback = checkout the prior hub SHA + restart; migration `003` is additive (`CREATE TABLE IF NOT EXISTS`) and safe to leave in place.

---

## Self-Review (completed during planning)

- **Spec coverage:** `access_requests` table (Task 1) ✓; public form with company/name/email + job title/team size/apps/message + honeypot + rate-limit (Task 6) ✓; operator companies view + approve/reject (Task 7) ✓; provisioning = company + CR owner + all four entitlements (RAID 25/mo) + magic-link invite, one transaction, idempotent, existing-email reuse, slug collision (Task 5) ✓; magic-link + long session, no permanent token (reuses `magic_link_tokens`, invite TTL via `config.inviteTtlMs`) ✓; audit logging (`access_requested`, `access_request_approved`, `access_request_rejected`) ✓; duplicate-company handled by operator at approval (no auto domain match) ✓; deploy = migration + restart, no app redeploy ✓.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type/name consistency:** `createAccessRequests` API (`createRequest`/`getRequest`/`listByStatus`/`markReviewed`), `createProvisioner(db,{inviteTtlMs}).approve(...)`, `org.listAllCompanies()`, `ent.listCompanyApps()`, `emailSender.sendAccessApproved({to,url})`, and `config.inviteTtlMs` are used identically across data layer, provisioning, routes, tests, and wiring.
- **Out-of-scope confirmed deferred:** CTM role-gating (slice 2), Poker/Retro share-links (slice 3), CR-manages-CTMs (reuses live `/company/:slug` console).
