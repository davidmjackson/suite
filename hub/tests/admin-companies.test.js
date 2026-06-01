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

test("approve still succeeds (302) when no emailSender is wired", async () => {
  const { app, db } = await buildTestApp();
  const { mountAdmin } = await import("../routes/admin.js?t=" + Date.now());
  mountAdmin(app); // no emailSender
  db.prepare("INSERT INTO users (id,email,display_name,is_admin,created_at) VALUES (?,?,?,?,?)")
    .run("admin2", "admin2@test", "Admin", 1, now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "admin2", now(), now(), now() + 60_000);
  const r = createAccessRequests(db).createRequest({ companyName: "IBM", contactName: "James", email: "james@ibm.com" });
  const res = await request(app).post(`/admin/requests/${r.id}/approve`).set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 302);
  assert.ok(db.prepare("SELECT 1 FROM companies WHERE slug='ibm'").get());
});

test("pending request shows a human-readable apps label, not raw JSON", async () => {
  const { app, db, sid } = await setup();
  createAccessRequests(db).createRequest({ companyName: "IBM", contactName: "James", email: "james@ibm.com", appsInterest: ["poker", "retro"] });
  const res = await request(app).get("/admin/companies").set("Cookie", `hub_session=${sid}`);
  assert.match(res.text, /poker, retro/);
  assert.doesNotMatch(res.text, /\[&quot;poker/);  // not raw/escaped JSON
});
