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
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("op1", "op1@test", Date.now());
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
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("op1", "op1@test", Date.now());
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
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("op1", "op1@test", Date.now());
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("existing", "james@ibm.com", Date.now());
  const r = await pendingRequest(db);
  const prov = createProvisioner(db, { inviteTtlMs: 1000 });
  const res = prov.approve({ requestId: r.id, grantedBy: "op1" });
  assert.equal(res.user.id, "existing");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email=?").get("james@ibm.com").n, 1);
});

test("approve gives a unique slug when the base slug is taken", async () => {
  const { db } = await buildTestApp();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("op1", "op1@test", Date.now());
  const prov = createProvisioner(db, { inviteTtlMs: 1000 });
  prov.approve({ requestId: (await pendingRequest(db)).id, grantedBy: "op1" });
  prov.approve({ requestId: (await pendingRequest(db, { email: "j2@ibm.com" })).id, grantedBy: "op1" });
  const slugs = db.prepare("SELECT slug FROM companies ORDER BY slug").all().map((c) => c.slug);
  assert.deepEqual(slugs, ["ibm", "ibm-2"]);
});

test("approve of an unknown request returns not_found", async () => {
  const { db } = await buildTestApp();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("op1", "op1@test", Date.now());
  const prov = createProvisioner(db, { inviteTtlMs: 1000 });
  const res = prov.approve({ requestId: "nope", grantedBy: "op1" });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "not_found");
});
