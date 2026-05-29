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
