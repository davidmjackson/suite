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

function addMember(db, org, company, userId = "mem") {
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run(userId, userId + "@b.c", now());
  org.addCompanyMember({ userId, companyId: company.id, role: "member" });
  return userId;
}

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

test("a member cannot invite anyone (403)", async () => {
  const { app, sid } = await build({ role: "member" });
  const res = await request(app).post("/company/acme/members")
    .type("form").send({ email: "x@b.c", role: "member" })
    .set("Cookie", cookie(sid));
  assert.equal(res.status, 403);
});

test("owner can change a member's role to owner", async () => {
  const { app, db, company, org, sid } = await build({ role: "owner" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "m@b.c", now());
  org.addCompanyMember({ userId: "u2", companyId: company.id, role: "member" });
  const res = await request(app).post("/company/acme/members/u2/role")
    .type("form").send({ role: "owner" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  const m = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?").get("u2", company.id);
  assert.equal(m.role, "owner");
});

test("a member cannot change anyone's role (403)", async () => {
  const { app, db, company, org, sid } = await build({ role: "member" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "m@b.c", now());
  org.addCompanyMember({ userId: "u2", companyId: company.id, role: "member" });
  const res = await request(app).post("/company/acme/members/u2/role")
    .type("form").send({ role: "owner" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 403);
});

test("a plain member cannot change an owner's role (403)", async () => {
  const { app, db, company, org, sid } = await build({ role: "member" });
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

test("owner can remove a member", async () => {
  const { app, db, company, org, sid } = await build({ role: "owner" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "m@b.c", now());
  org.addCompanyMember({ userId: "u2", companyId: company.id, role: "member" });
  const res = await request(app).post("/company/acme/members/u2/remove").set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  const m = db.prepare("SELECT 1 FROM company_members WHERE user_id=? AND company_id=?").get("u2", company.id);
  assert.equal(m, undefined);
});

test("a member cannot remove anyone (403)", async () => {
  const { app, db, company, org, sid } = await build({ role: "member" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "o2@b.c", now());
  org.addCompanyMember({ userId: "u2", companyId: company.id, role: "owner" });
  const res = await request(app).post("/company/acme/members/u2/remove").set("Cookie", cookie(sid));
  assert.equal(res.status, 403);
});

test("removing the last owner shows a friendly error", async () => {
  const { app, sid } = await build({ role: "owner" }); // u1 is the only owner
  const res = await request(app).post("/company/acme/members/u1/remove").set("Cookie", cookie(sid));
  assert.equal(res.status, 400);
  assert.match(res.text, /owner/i);
});

test("owner can create a team", async () => {
  const { app, db, company, sid } = await build({ role: "owner" });
  const res = await request(app).post("/company/acme/teams")
    .type("form").send({ name: "Squad B" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  const t = db.prepare("SELECT * FROM teams WHERE company_id=? AND name=?").get(company.id, "Squad B");
  assert.ok(t);
});

test("creating a team with a blank name is rejected with 400", async () => {
  const { app, sid } = await build({ role: "owner" });
  const res = await request(app).post("/company/acme/teams")
    .type("form").send({ name: "   " }).set("Cookie", cookie(sid));
  assert.equal(res.status, 400);
});

test("GET team page renders members + add picker", async () => {
  const { app, db, company, org, sid } = await build({ role: "owner" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "m2@b.c", now());
  org.addCompanyMember({ userId: "u2", companyId: company.id, role: "member" });
  const t = org.createTeam({ companyId: company.id, name: "Squad" });
  org.addTeamMember({ userId: "u1", teamId: t.id, role: "member" });
  const res = await request(app).get(`/company/acme/teams/${t.id}`).set("Cookie", cookie(sid));
  assert.equal(res.status, 200);
  assert.match(res.text, /Squad/);
  assert.match(res.text, /owner@b\.c/);      // current team member
  assert.match(res.text, /m2@b\.c/);          // available to add
});

test("GET team page is 404 for a team in another company", async () => {
  const { app, db, org, sid } = await build({ role: "owner" });
  const other = org.createCompany({ name: "Other", slug: "other" });
  const otherTeam = org.createTeam({ companyId: other.id, name: "Theirs" });
  const res = await request(app).get(`/company/acme/teams/${otherTeam.id}`).set("Cookie", cookie(sid));
  assert.equal(res.status, 404);
});

test("owner can rename a team", async () => {
  const { app, db, company, org, sid } = await build({ role: "owner" });
  const t = org.createTeam({ companyId: company.id, name: "Old" });
  const res = await request(app).post(`/company/acme/teams/${t.id}/rename`)
    .type("form").send({ name: "Renamed" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  assert.equal(db.prepare("SELECT name FROM teams WHERE id=?").get(t.id).name, "Renamed");
});

test("renaming a team in another company is 404", async () => {
  const { app, org, sid } = await build({ role: "owner" });
  const other = org.createCompany({ name: "Other", slug: "other" });
  const otherTeam = org.createTeam({ companyId: other.id, name: "Theirs" });
  const res = await request(app).post(`/company/acme/teams/${otherTeam.id}/rename`)
    .type("form").send({ name: "Hijack" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 404);
});

test("creating a team with a duplicate name shows a friendly 400, not a 500", async () => {
  const { app, company, org, sid } = await build({ role: "owner" });
  org.createTeam({ companyId: company.id, name: "Squad" });
  const res = await request(app).post("/company/acme/teams")
    .type("form").send({ name: "Squad" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 400);
  assert.match(res.text, /already exists/i);
});

test("renaming a team to an existing name shows a friendly 400, not a 500", async () => {
  const { app, company, org, sid } = await build({ role: "owner" });
  org.createTeam({ companyId: company.id, name: "Alpha" });
  const t = org.createTeam({ companyId: company.id, name: "Beta" });
  const res = await request(app).post(`/company/acme/teams/${t.id}/rename`)
    .type("form").send({ name: "Alpha" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 400);
  assert.match(res.text, /already exists/i);
});

test("add a company member to a team", async () => {
  const { app, db, company, org, sid } = await build({ role: "owner" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "m2@b.c", now());
  org.addCompanyMember({ userId: "u2", companyId: company.id, role: "member" });
  const t = org.createTeam({ companyId: company.id, name: "Squad" });
  const res = await request(app).post(`/company/acme/teams/${t.id}/members`)
    .type("form").send({ userId: "u2" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  assert.ok(db.prepare("SELECT 1 FROM team_members WHERE user_id=? AND team_id=?").get("u2", t.id));
});

test("adding a non-company-member to a team shows a friendly error", async () => {
  const { app, db, company, org, sid } = await build({ role: "owner" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u9", "outsider@b.c", now());
  const t = org.createTeam({ companyId: company.id, name: "Squad" });
  const res = await request(app).post(`/company/acme/teams/${t.id}/members`)
    .type("form").send({ userId: "u9" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 400);
});

test("remove a team member", async () => {
  const { app, db, company, org, sid } = await build({ role: "owner" });
  org.addTeamMember({ userId: "u1", teamId: org.createTeam({ companyId: company.id, name: "Squad" }).id, role: "member" });
  const t = db.prepare("SELECT id FROM teams WHERE company_id=? AND name=?").get(company.id, "Squad");
  const res = await request(app).post(`/company/acme/teams/${t.id}/members/u1/remove`).set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  assert.equal(db.prepare("SELECT 1 FROM team_members WHERE user_id=? AND team_id=?").get("u1", t.id), undefined);
});

test("adding a user already on the team shows a friendly 400, not a 500", async () => {
  const { app, db, company, org, sid } = await build({ role: "owner" });
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "m2@b.c", now());
  org.addCompanyMember({ userId: "u2", companyId: company.id, role: "member" });
  const t = org.createTeam({ companyId: company.id, name: "Squad" });
  org.addTeamMember({ userId: "u2", teamId: t.id, role: "member" });
  const res = await request(app).post(`/company/acme/teams/${t.id}/members`)
    .type("form").send({ userId: "u2" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 400);
  assert.match(res.text, /already on this team/i);
});

test("owner can grant then revoke RAID for a member", async () => {
  const { app, db, org, company, sid } = await build({ role: "owner" });
  addMember(db, org, company);
  let res = await request(app).post("/company/acme/members/mem/apps/raid")
    .type("form").send({ action: "grant" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  let ent = db.prepare("SELECT quota_limit,status FROM app_entitlements WHERE app='raid' AND principal_type='user' AND principal_id='mem'").get();
  assert.equal(ent.status, "active");
  assert.equal(ent.quota_limit, 25);
  res = await request(app).post("/company/acme/members/mem/apps/raid")
    .type("form").send({ action: "revoke" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  ent = db.prepare("SELECT status FROM app_entitlements WHERE app='raid' AND principal_type='user' AND principal_id='mem'").get();
  assert.equal(ent.status, "suspended");
});

test("owner can grant Signal (unlimited) for a member", async () => {
  const { app, db, org, company, sid } = await build({ role: "owner" });
  addMember(db, org, company);
  const res = await request(app).post("/company/acme/members/mem/apps/signal")
    .type("form").send({ action: "grant" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 302);
  const ent = db.prepare("SELECT quota_limit,status FROM app_entitlements WHERE app='signal' AND principal_type='user' AND principal_id='mem'").get();
  assert.equal(ent.status, "active");
  assert.equal(ent.quota_limit, null);
});

test("grant rejects a non-togglable app", async () => {
  const { app, org, company, sid } = await build({ role: "owner" });
  const res = await request(app).post("/company/acme/members/mem/apps/poker")
    .type("form").send({ action: "grant" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 400);
});

test("cannot toggle an owner row", async () => {
  const { app, sid } = await build({ role: "owner" }); // u1 is the owner
  const res = await request(app).post("/company/acme/members/u1/apps/signal")
    .type("form").send({ action: "revoke" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 400);
});

test("a non-owner cannot reach the per-member app toggle (owner-only)", async () => {
  const { app, db, org, company, sid } = await build({ role: "member" }); // u1 is a member
  addMember(db, org, company, "mem2");
  const res = await request(app).post("/company/acme/members/mem2/apps/signal")
    .type("form").send({ action: "grant" }).set("Cookie", cookie(sid));
  assert.equal(res.status, 403);
});
