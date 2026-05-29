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
