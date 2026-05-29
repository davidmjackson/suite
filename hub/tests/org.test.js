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

// --- company members ---
function seedUser(db, id, email) {
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run(id, email, Date.now());
}

test("addCompanyMember adds with a valid role; invalid role throws", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  seedUser(db, "u1", "a@b.c");
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "owner" });
  const row = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?").get("u1", c.id);
  assert.equal(row.role, "owner");
  assert.throws(() => org.addCompanyMember({ userId: "u1", companyId: c.id, role: "boss" }), /invalid_company_role/);
  db.close();
});

test("addCompanyMember to a missing company throws", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  seedUser(db, "u1", "a@b.c");
  assert.throws(() => org.addCompanyMember({ userId: "u1", companyId: "nope", role: "member" }), /company_not_found/);
  db.close();
});

test("cannot demote or remove the last owner", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  seedUser(db, "u1", "a@b.c");
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "owner" });
  assert.throws(() => org.setCompanyMemberRole({ userId: "u1", companyId: c.id, role: "admin" }), /last_owner/);
  assert.throws(() => org.removeCompanyMember({ userId: "u1", companyId: c.id }), /last_owner/);
  db.close();
});

test("can demote an owner when another owner exists", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  seedUser(db, "u1", "a@b.c"); seedUser(db, "u2", "d@e.f");
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "owner" });
  org.addCompanyMember({ userId: "u2", companyId: c.id, role: "owner" });
  org.setCompanyMemberRole({ userId: "u1", companyId: c.id, role: "admin" });
  const row = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?").get("u1", c.id);
  assert.equal(row.role, "admin");
  db.close();
});

// --- teams ---
test("createTeam scopes name per company; duplicate name in same company throws", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  const c1 = org.createCompany({ name: "Acme", slug: "acme" });
  const c2 = org.createCompany({ name: "Globex", slug: "globex" });
  const t = org.createTeam({ companyId: c1.id, name: "Platform" });
  assert.equal(t.company_id, c1.id);
  assert.equal(t.name, "Platform");
  // same name, different company is fine
  org.createTeam({ companyId: c2.id, name: "Platform" });
  // same name, same company collides
  assert.throws(() => org.createTeam({ companyId: c1.id, name: "Platform" }), /UNIQUE/);
  db.close();
});

test("createTeam in a missing company throws", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  assert.throws(() => org.createTeam({ companyId: "nope", name: "X" }), /company_not_found/);
  db.close();
});

test("listTeams returns a company's teams sorted by name", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.createTeam({ companyId: c.id, name: "Zeta" });
  org.createTeam({ companyId: c.id, name: "Alpha" });
  assert.deepEqual(org.listTeams(c.id).map(t => t.name), ["Alpha", "Zeta"]);
  db.close();
});

// --- team members ---
test("addTeamMember requires company membership; otherwise throws", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  seedUser(db, "u1", "a@b.c");
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  const t = org.createTeam({ companyId: c.id, name: "Platform" });
  // not yet a company member
  assert.throws(() => org.addTeamMember({ userId: "u1", teamId: t.id, role: "member" }), /not_company_member/);
  // become a member, then it works
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "member" });
  org.addTeamMember({ userId: "u1", teamId: t.id, role: "lead" });
  const row = db.prepare("SELECT role FROM team_members WHERE user_id=? AND team_id=?").get("u1", t.id);
  assert.equal(row.role, "lead");
  db.close();
});

test("addTeamMember rejects invalid role and missing team", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  seedUser(db, "u1", "a@b.c");
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "member" });
  const t = org.createTeam({ companyId: c.id, name: "Platform" });
  assert.throws(() => org.addTeamMember({ userId: "u1", teamId: t.id, role: "captain" }), /invalid_team_role/);
  assert.throws(() => org.addTeamMember({ userId: "u1", teamId: "nope", role: "member" }), /team_not_found/);
  db.close();
});

test("removeTeamMember deletes the row", () => {
  const db = openDb(":memory:");
  const org = createOrg(db);
  seedUser(db, "u1", "a@b.c");
  const c = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: c.id, role: "member" });
  const t = org.createTeam({ companyId: c.id, name: "Platform" });
  org.addTeamMember({ userId: "u1", teamId: t.id, role: "member" });
  org.removeTeamMember({ userId: "u1", teamId: t.id });
  const row = db.prepare("SELECT 1 FROM team_members WHERE user_id=? AND team_id=?").get("u1", t.id);
  assert.equal(row, undefined);
  db.close();
});
