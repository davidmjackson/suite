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
