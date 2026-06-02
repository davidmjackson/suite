// tests/db-004.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { openDb } from "../db/index.js";
import { randomId, now } from "../lib/tokens.js";

const MIGRATION = new URL("../db/migrations/004-ctm-role-gating.sql", import.meta.url);
function runMigration(db) {
  db.exec(fs.readFileSync(MIGRATION, "utf8"));
}

// Seed a company with an owner + an admin member + company-level signal/raid grants,
// emulating PRE-migration prod data (insert directly, bypassing role-validating libs).
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
    db.prepare("INSERT INTO app_entitlements (id,app,principal_type,principal_id,status,quota_limit,quota_period,granted_by,granted_at) VALUES (?,?, 'company', ?, 'active', ?,?, NULL, ?)")
      .run(randomId(), app, companyId, lim, per, now());
  }
  return { companyId, ownerId, adminId };
}

test("migration 004 collapses admin to member", () => {
  const db = openDb(":memory:");
  const { ownerId, adminId, companyId } = seedLegacy(db);
  runMigration(db);
  const role = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?").get(adminId, companyId).role;
  assert.equal(role, "member");
  const ownerRole = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?").get(ownerId, companyId).role;
  assert.equal(ownerRole, "owner");
  db.close();
});

test("migration 004 re-homes company signal/raid to owners (user-level) and suspends company grants", () => {
  const db = openDb(":memory:");
  const { ownerId, adminId, companyId } = seedLegacy(db);
  runMigration(db);
  const ownerSignal = db.prepare("SELECT * FROM app_entitlements WHERE app='signal' AND principal_type='user' AND principal_id=? AND status='active'").get(ownerId);
  const ownerRaid = db.prepare("SELECT * FROM app_entitlements WHERE app='raid' AND principal_type='user' AND principal_id=? AND status='active'").get(ownerId);
  assert.ok(ownerSignal, "owner should have user-level signal");
  assert.equal(ownerSignal.quota_limit, null);
  assert.ok(ownerRaid, "owner should have user-level raid");
  assert.equal(ownerRaid.quota_limit, 25);
  assert.equal(ownerRaid.quota_period, "month");
  const memberSignal = db.prepare("SELECT 1 FROM app_entitlements WHERE app='signal' AND principal_type='user' AND principal_id=? AND status='active'").get(adminId);
  assert.equal(memberSignal, undefined);
  const compActive = db.prepare("SELECT app FROM app_entitlements WHERE principal_type='company' AND principal_id=? AND status='active' ORDER BY app").all(companyId).map(r => r.app);
  assert.deepEqual(compActive, ["poker", "retro"]);
  db.close();
});

test("migration 004 is idempotent (re-running is a no-op)", () => {
  const db = openDb(":memory:");
  const { ownerId } = seedLegacy(db);
  runMigration(db);
  runMigration(db);
  const ownerRaidRows = db.prepare("SELECT COUNT(*) AS n FROM app_entitlements WHERE app='raid' AND principal_type='user' AND principal_id=?").get(ownerId).n;
  assert.equal(ownerRaidRows, 1, "must not create duplicate user-level raid rows");
  db.close();
});
