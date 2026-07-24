// tests/org.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { createOrg } from '../lib/org.js';

test('createCompany inserts and returns the row', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  const c = org.createCompany({ name: 'Acme', slug: 'acme' });
  assert.ok(c.id);
  assert.equal(c.name, 'Acme');
  assert.equal(c.slug, 'acme');
  assert.equal(c.status, 'active');
  assert.ok(c.created_at > 0);
  assert.deepEqual(org.getCompany(c.id), c);
  assert.equal(org.getCompanyBySlug('acme').id, c.id);
  db.close();
});

test('createCompany rejects duplicate slug', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  org.createCompany({ name: 'Acme', slug: 'acme' });
  assert.throws(() => org.createCompany({ name: 'Acme2', slug: 'acme' }), /UNIQUE/);
  db.close();
});

test('suspendCompany sets status', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  const c = org.createCompany({ name: 'Acme', slug: 'acme' });
  org.suspendCompany(c.id);
  assert.equal(org.getCompany(c.id).status, 'suspended');
  db.close();
});

test('getCompany returns null when missing', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  assert.equal(org.getCompany('nope'), null);
  db.close();
});

// --- company members ---
function seedUser(db, id, email) {
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run(id, email, Date.now());
}

test('addCompanyMember adds with a valid role; invalid role throws', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  seedUser(db, 'u1', 'a@b.c');
  const c = org.createCompany({ name: 'Acme', slug: 'acme' });
  org.addCompanyMember({ userId: 'u1', companyId: c.id, role: 'owner' });
  const row = db
    .prepare('SELECT role FROM company_members WHERE user_id=? AND company_id=?')
    .get('u1', c.id);
  assert.equal(row.role, 'owner');
  assert.throws(
    () => org.addCompanyMember({ userId: 'u1', companyId: c.id, role: 'boss' }),
    /invalid_company_role/,
  );
  db.close();
});

test('addCompanyMember to a missing company throws', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  seedUser(db, 'u1', 'a@b.c');
  assert.throws(
    () => org.addCompanyMember({ userId: 'u1', companyId: 'nope', role: 'member' }),
    /company_not_found/,
  );
  db.close();
});

test('cannot demote or remove the last owner', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  seedUser(db, 'u1', 'a@b.c');
  const c = org.createCompany({ name: 'Acme', slug: 'acme' });
  org.addCompanyMember({ userId: 'u1', companyId: c.id, role: 'owner' });
  assert.throws(
    () => org.setCompanyMemberRole({ userId: 'u1', companyId: c.id, role: 'member' }),
    /last_owner/,
  );
  assert.throws(() => org.removeCompanyMember({ userId: 'u1', companyId: c.id }), /last_owner/);
  db.close();
});

test('can demote an owner when another owner exists', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  seedUser(db, 'u1', 'a@b.c');
  seedUser(db, 'u2', 'd@e.f');
  const c = org.createCompany({ name: 'Acme', slug: 'acme' });
  org.addCompanyMember({ userId: 'u1', companyId: c.id, role: 'owner' });
  org.addCompanyMember({ userId: 'u2', companyId: c.id, role: 'owner' });
  org.setCompanyMemberRole({ userId: 'u1', companyId: c.id, role: 'member' });
  const row = db
    .prepare('SELECT role FROM company_members WHERE user_id=? AND company_id=?')
    .get('u1', c.id);
  assert.equal(row.role, 'member');
  db.close();
});

// --- teams ---
test('createTeam scopes name per company; duplicate name in same company throws', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  const c1 = org.createCompany({ name: 'Acme', slug: 'acme' });
  const c2 = org.createCompany({ name: 'Globex', slug: 'globex' });
  const t = org.createTeam({ companyId: c1.id, name: 'Platform' });
  assert.equal(t.company_id, c1.id);
  assert.equal(t.name, 'Platform');
  // same name, different company is fine
  org.createTeam({ companyId: c2.id, name: 'Platform' });
  // same name, same company collides
  assert.throws(() => org.createTeam({ companyId: c1.id, name: 'Platform' }), /UNIQUE/);
  db.close();
});

test('createTeam in a missing company throws', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  assert.throws(() => org.createTeam({ companyId: 'nope', name: 'X' }), /company_not_found/);
  db.close();
});

test("listTeams returns a company's teams sorted by name", () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  const c = org.createCompany({ name: 'Acme', slug: 'acme' });
  org.createTeam({ companyId: c.id, name: 'Zeta' });
  org.createTeam({ companyId: c.id, name: 'Alpha' });
  assert.deepEqual(
    org.listTeams(c.id).map((t) => t.name),
    ['Alpha', 'Zeta'],
  );
  db.close();
});

// --- team members ---
test('addTeamMember requires company membership; otherwise throws', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  seedUser(db, 'u1', 'a@b.c');
  const c = org.createCompany({ name: 'Acme', slug: 'acme' });
  const t = org.createTeam({ companyId: c.id, name: 'Platform' });
  // not yet a company member
  assert.throws(
    () => org.addTeamMember({ userId: 'u1', teamId: t.id, role: 'member' }),
    /not_company_member/,
  );
  // become a member, then it works
  org.addCompanyMember({ userId: 'u1', companyId: c.id, role: 'member' });
  org.addTeamMember({ userId: 'u1', teamId: t.id, role: 'lead' });
  const row = db
    .prepare('SELECT role FROM team_members WHERE user_id=? AND team_id=?')
    .get('u1', t.id);
  assert.equal(row.role, 'lead');
  db.close();
});

test('addTeamMember rejects invalid role and missing team', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  seedUser(db, 'u1', 'a@b.c');
  const c = org.createCompany({ name: 'Acme', slug: 'acme' });
  org.addCompanyMember({ userId: 'u1', companyId: c.id, role: 'member' });
  const t = org.createTeam({ companyId: c.id, name: 'Platform' });
  assert.throws(
    () => org.addTeamMember({ userId: 'u1', teamId: t.id, role: 'captain' }),
    /invalid_team_role/,
  );
  assert.throws(
    () => org.addTeamMember({ userId: 'u1', teamId: 'nope', role: 'member' }),
    /team_not_found/,
  );
  db.close();
});

test('removeTeamMember deletes the row', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  seedUser(db, 'u1', 'a@b.c');
  const c = org.createCompany({ name: 'Acme', slug: 'acme' });
  org.addCompanyMember({ userId: 'u1', companyId: c.id, role: 'member' });
  const t = org.createTeam({ companyId: c.id, name: 'Platform' });
  org.addTeamMember({ userId: 'u1', teamId: t.id, role: 'member' });
  org.removeTeamMember({ userId: 'u1', teamId: t.id });
  const row = db
    .prepare('SELECT 1 FROM team_members WHERE user_id=? AND team_id=?')
    .get('u1', t.id);
  assert.equal(row, undefined);
  db.close();
});

test("teamsForUser returns the user's teams in a company with their role, excluding others", () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  seedUser(db, 'u1', 'u1@x.y');
  const c1 = org.createCompany({ name: 'C1', slug: 'c1' });
  const c2 = org.createCompany({ name: 'C2', slug: 'c2' });
  org.addCompanyMember({ userId: 'u1', companyId: c1.id, role: 'member' });
  org.addCompanyMember({ userId: 'u1', companyId: c2.id, role: 'member' });
  const tA = org.createTeam({ companyId: c1.id, name: 'Alpha' });
  const tB = org.createTeam({ companyId: c1.id, name: 'Bravo' }); // user NOT a member
  const tC = org.createTeam({ companyId: c2.id, name: 'Charlie' }); // other company
  org.addTeamMember({ userId: 'u1', teamId: tA.id, role: 'lead' });
  org.addTeamMember({ userId: 'u1', teamId: tC.id, role: 'member' });

  const teams = org.teamsForUser('u1', c1.id);
  assert.deepEqual(teams, [{ id: tA.id, name: 'Alpha', role: 'lead' }]);
  assert.equal(
    teams.find((t) => t.id === tB.id),
    undefined,
  );
  assert.equal(
    teams.find((t) => t.id === tC.id),
    undefined,
  );
});

// --- Layer 3 console read helpers ---
test('addCompanyMember rejects the removed admin role', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  const c = org.createCompany({ name: 'Acme', slug: 'acme' });
  db.prepare("INSERT INTO users (id,email,is_admin,created_at) VALUES ('u1','u1@x',0,1)").run();
  assert.throws(
    () => org.addCompanyMember({ userId: 'u1', companyId: c.id, role: 'admin' }),
    /invalid_company_role/,
  );
  db.close();
});

test('adminCompaniesForUser returns only companies where the user is owner', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  const c = org.createCompany({ name: 'Acme', slug: 'acme' });
  db.prepare("INSERT INTO users (id,email,is_admin,created_at) VALUES ('owner','o@x',0,1)").run();
  db.prepare("INSERT INTO users (id,email,is_admin,created_at) VALUES ('mem','m@x',0,1)").run();
  org.addCompanyMember({ userId: 'owner', companyId: c.id, role: 'owner' });
  org.addCompanyMember({ userId: 'mem', companyId: c.id, role: 'member' });
  assert.equal(org.adminCompaniesForUser('owner').length, 1);
  assert.equal(org.adminCompaniesForUser('mem').length, 0);
  db.close();
});

test('listCompanyMembers returns members with hasLoggedIn derived from audit', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  seedUser(db, 'u1', 'owner@b.c');
  seedUser(db, 'u2', 'invited@b.c');
  const a = org.createCompany({ name: 'Acme', slug: 'acme' });
  org.addCompanyMember({ userId: 'u1', companyId: a.id, role: 'owner' });
  org.addCompanyMember({ userId: 'u2', companyId: a.id, role: 'member' });
  db.prepare('INSERT INTO audit_events (user_id,event_type,created_at) VALUES (?,?,?)').run(
    'u1',
    'session_created',
    Date.now(),
  );
  const rows = org.listCompanyMembers(a.id);
  assert.equal(rows.length, 2);
  const u1 = rows.find((r) => r.userId === 'u1');
  const u2 = rows.find((r) => r.userId === 'u2');
  assert.equal(u1.email, 'owner@b.c');
  assert.equal(u1.role, 'owner');
  assert.equal(u1.hasLoggedIn, true);
  assert.equal(u2.hasLoggedIn, false);
  db.close();
});

test('renameTeam updates the name; missing team throws', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  const a = org.createCompany({ name: 'Acme', slug: 'acme' });
  const t = org.createTeam({ companyId: a.id, name: 'Old' });
  org.renameTeam(t.id, 'New');
  assert.equal(org.getTeam(t.id).name, 'New');
  assert.throws(() => org.renameTeam('nope', 'X'), /team_not_found/);
  assert.throws(() => org.renameTeam(t.id, '  '), /name_required/);
  db.close();
});

test('listTeamMembers returns team members scoped to the team', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  seedUser(db, 'u1', 'u1@b.c');
  seedUser(db, 'u2', 'u2@b.c');
  const a = org.createCompany({ name: 'Acme', slug: 'acme' });
  org.addCompanyMember({ userId: 'u1', companyId: a.id, role: 'owner' });
  org.addCompanyMember({ userId: 'u2', companyId: a.id, role: 'member' });
  const t = org.createTeam({ companyId: a.id, name: 'Squad' });
  org.addTeamMember({ userId: 'u1', teamId: t.id, role: 'member' });
  const rows = org.listTeamMembers(t.id);
  assert.deepEqual(
    rows.map((r) => r.userId),
    ['u1'],
  );
  assert.equal(rows[0].email, 'u1@b.c');
  assert.equal(rows[0].hasLoggedIn, false); // no audit row yet
  db.prepare('INSERT INTO audit_events (user_id,event_type,created_at) VALUES (?,?,?)').run(
    'u1',
    'session_created',
    Date.now(),
  );
  assert.equal(org.listTeamMembers(t.id)[0].hasLoggedIn, true);
  db.close();
});

// --- inviteCompanyMember ---
test('inviteCompanyMember creates a dormant user + membership for a new email', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  const a = org.createCompany({ name: 'Acme', slug: 'acme' });
  // org.inviteCompanyMember does NOT lowercase — the route lowercases before
  // calling it (matches routes/admin.js). Pass an already-normalised email here.
  const r = org.inviteCompanyMember({ email: 'new@b.c', companyId: a.id, role: 'member' });
  assert.equal(r.alreadyMember, false);
  assert.equal(r.user.email, 'new@b.c');
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get('new@b.c');
  assert.ok(u);
  const m = db
    .prepare('SELECT role FROM company_members WHERE user_id=? AND company_id=?')
    .get(u.id, a.id);
  assert.equal(m.role, 'member');
  db.close();
});

test('inviteCompanyMember reuses an existing user', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  seedUser(db, 'u1', 'exists@b.c');
  const a = org.createCompany({ name: 'Acme', slug: 'acme' });
  const r = org.inviteCompanyMember({ email: 'exists@b.c', companyId: a.id, role: 'member' });
  assert.equal(r.alreadyMember, false);
  assert.equal(r.user.id, 'u1');
  const m = db
    .prepare('SELECT role FROM company_members WHERE user_id=? AND company_id=?')
    .get('u1', a.id);
  assert.equal(m.role, 'member');
  db.close();
});

test('inviteCompanyMember is a no-op for an existing member (no throw, role untouched)', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  seedUser(db, 'u1', 'exists@b.c');
  const a = org.createCompany({ name: 'Acme', slug: 'acme' });
  org.addCompanyMember({ userId: 'u1', companyId: a.id, role: 'owner' });
  const r = org.inviteCompanyMember({ email: 'exists@b.c', companyId: a.id, role: 'member' });
  assert.equal(r.alreadyMember, true);
  assert.equal(r.user.id, 'u1');
  const m = db
    .prepare('SELECT role FROM company_members WHERE user_id=? AND company_id=?')
    .get('u1', a.id);
  assert.equal(m.role, 'owner'); // unchanged
  db.close();
});

test('listAllCompanies returns every company with member counts', () => {
  const db = openDb(':memory:');
  const org = createOrg(db);
  const c = org.createCompany({ name: 'Acme', slug: 'acme' });
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run(
    'u1',
    'u1@a.com',
    Date.now(),
  );
  org.addCompanyMember({ userId: 'u1', companyId: c.id, role: 'owner' });
  const all = org.listAllCompanies();
  assert.equal(all.length, 1);
  assert.equal(all[0].slug, 'acme');
  assert.equal(all[0].memberCount, 1);
  db.close();
});
