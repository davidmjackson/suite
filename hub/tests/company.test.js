// tests/company.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";
import { createOrg } from "../lib/org.js";

// Build the app with the company routes mounted, plus a logged-in user
// who is a member of company "acme" at the given role.
async function build({ role = "owner" } = {}) {
  const { app, db, config } = await buildTestApp();
  const { mountCompany } = await import("../routes/company.js?t=" + Date.now());
  mountCompany(app);
  const org = createOrg(db);
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "owner@b.c", now());
  if (role) org.addCompanyMember({ userId: "u1", companyId: c.id, role });
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  return { app, db, org, company: c, sid, config };
}

const cookie = (sid) => `hub_session=${sid}`;

test("GET /company/:slug renders the console for an owner", async () => {
  const { app, org, company, sid } = await build({ role: "owner" });
  org.createTeam({ companyId: company.id, name: "Squad A" });
  const res = await request(app).get("/company/acme").set("Cookie", cookie(sid));
  assert.equal(res.status, 200);
  assert.match(res.text, /Acme/);
  assert.match(res.text, /owner@b\.c/);
  assert.match(res.text, /Squad A/);
  assert.match(res.text, /Back to dashboard/);
});

test("GET /company/:slug is 403 for a plain member", async () => {
  const { app, sid } = await build({ role: "member" });
  const res = await request(app).get("/company/acme").set("Cookie", cookie(sid));
  assert.equal(res.status, 403);
});

test("GET /company/:slug is 404 for an unknown slug", async () => {
  const { app, sid } = await build({ role: "owner" });
  const res = await request(app).get("/company/nope").set("Cookie", cookie(sid));
  assert.equal(res.status, 404);
});

test("owner can invite a new member; user + membership created", async () => {
  const { app, db, company, sid } = await build({ role: "owner" });
  const res = await request(app).post("/company/acme/members")
    .type("form").send({ email: "New@B.C", role: "member" })
    .set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "/company/acme");
  const u = db.prepare("SELECT * FROM users WHERE email = ?").get("new@b.c");
  assert.ok(u, "user row created (lowercased)");
  const m = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?").get(u.id, company.id);
  assert.equal(m.role, "member");
});

test("invalid email is rejected with 400", async () => {
  const { app, sid } = await build({ role: "owner" });
  const res = await request(app).post("/company/acme/members")
    .type("form").send({ email: "not-an-email", role: "member" })
    .set("Cookie", cookie(sid));
  assert.equal(res.status, 400);
});

test("admin cannot invite an owner (403)", async () => {
  const { app, sid } = await build({ role: "admin" });
  const res = await request(app).post("/company/acme/members")
    .type("form").send({ email: "x@b.c", role: "owner" })
    .set("Cookie", cookie(sid));
  assert.equal(res.status, 403);
});

test("owner can change a member's role", async () => {
  const { app, db, company, org, sid } = await build({ role: "owner" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "m@b.c", now());
  org.addCompanyMember({ userId: "u2", companyId: company.id, role: "member" });
  const res = await request(app).post("/company/acme/members/u2/role")
    .type("form").send({ role: "admin" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  const m = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?").get("u2", company.id);
  assert.equal(m.role, "admin");
});

test("admin cannot promote anyone to owner (403)", async () => {
  const { app, db, company, org, sid } = await build({ role: "admin" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "m@b.c", now());
  org.addCompanyMember({ userId: "u2", companyId: company.id, role: "member" });
  const res = await request(app).post("/company/acme/members/u2/role")
    .type("form").send({ role: "owner" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 403);
});

test("admin cannot change an owner's role (403)", async () => {
  const { app, db, company, org, sid } = await build({ role: "admin" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "o2@b.c", now());
  org.addCompanyMember({ userId: "u2", companyId: company.id, role: "owner" });
  const res = await request(app).post("/company/acme/members/u2/role")
    .type("form").send({ role: "member" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 403);
});

test("demoting the last owner shows a friendly error, not a 500", async () => {
  const { app, sid } = await build({ role: "owner" }); // u1 is the only owner
  const res = await request(app).post("/company/acme/members/u1/role")
    .type("form").send({ role: "member" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 400);
  assert.match(res.text, /owner/i);
});
