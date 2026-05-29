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
