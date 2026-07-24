// tests/admin-users.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp } from './helpers.js';
import { now, randomToken } from '../lib/tokens.js';

async function setup({ isAdmin = true } = {}) {
  const { app, db, config } = await buildTestApp();
  const { mountAdmin } = await import('../routes/admin.js?t=' + Date.now());
  mountAdmin(app);
  db.prepare(
    'INSERT INTO users (id,email,display_name,is_admin,created_at) VALUES (?,?,?,?,?)',
  ).run('admin1', 'admin@test', 'Admin', isAdmin ? 1 : 0, now());
  const sid = randomToken();
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(sid, 'admin1', now(), now(), now() + 60_000);
  return { app, db, sid };
}

test('non-admin gets 403', async () => {
  const { app, sid } = await setup({ isAdmin: false });
  const res = await request(app).get('/admin').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 403);
});

test('admin lists users', async () => {
  const { app, db, sid } = await setup();
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run(
    'u2',
    'other@test',
    now(),
  );
  const res = await request(app).get('/admin').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /admin@test/);
  assert.match(res.text, /other@test/);
});

test('POST /admin/users creates a user', async () => {
  const { app, db, sid } = await setup();
  const res = await request(app)
    .post('/admin/users')
    .type('form')
    .set('Cookie', `hub_session=${sid}`)
    .send({ email: 'new@test.com', display_name: 'New' });
  assert.equal(res.status, 302);
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get('new@test.com');
  assert.equal(row.display_name, 'New');
});

test('POST /admin/users/:id/disable kills all their sessions', async () => {
  const { app, db, sid } = await setup();
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run(
    'u2',
    'victim@test',
    now(),
  );
  const vsid = randomToken();
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(vsid, 'u2', now(), now(), now() + 60_000);
  const res = await request(app)
    .post('/admin/users/u2/disable')
    .set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 302);
  const sess = db.prepare('SELECT * FROM central_sessions WHERE user_id = ?').all('u2');
  assert.equal(sess.length, 0);
  const u = db.prepare('SELECT disabled_at FROM users WHERE id = ?').get('u2');
  assert.ok(u.disabled_at);
});

// Helper: create a victim user u2.
function makeVictim(db) {
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run(
    'u2',
    'victim@test',
    now(),
  );
}

test('delete: company_members reference does not block delete (prod FK repro)', async () => {
  const { app, db, sid } = await setup();
  makeVictim(db);
  db.prepare('INSERT INTO companies (id,name,slug,status,created_at) VALUES (?,?,?,?,?)').run(
    'c1',
    'Acme',
    'acme',
    'active',
    now(),
  );
  db.prepare(
    'INSERT INTO company_members (user_id,company_id,role,created_at) VALUES (?,?,?,?)',
  ).run('u2', 'c1', 'member', now());
  const res = await request(app).post('/admin/users/u2/delete').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 302);
  assert.equal(db.prepare('SELECT * FROM users WHERE id = ?').get('u2'), undefined);
  assert.equal(db.prepare('SELECT * FROM company_members WHERE user_id = ?').get('u2'), undefined);
});

test('delete: team_members reference is cleared and does not block', async () => {
  const { app, db, sid } = await setup();
  makeVictim(db);
  db.prepare('INSERT INTO companies (id,name,slug,status,created_at) VALUES (?,?,?,?,?)').run(
    'c1',
    'Acme',
    'acme',
    'active',
    now(),
  );
  db.prepare('INSERT INTO teams (id,company_id,name,created_at) VALUES (?,?,?,?)').run(
    't1',
    'c1',
    'Team A',
    now(),
  );
  db.prepare('INSERT INTO team_members (user_id,team_id,role,created_at) VALUES (?,?,?,?)').run(
    'u2',
    't1',
    'member',
    now(),
  );
  const res = await request(app).post('/admin/users/u2/delete').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 302);
  assert.equal(db.prepare('SELECT * FROM users WHERE id = ?').get('u2'), undefined);
  assert.equal(db.prepare('SELECT * FROM team_members WHERE user_id = ?').get('u2'), undefined);
});

test('delete: app_entitlements.granted_by is SET NULL and grant preserved', async () => {
  const { app, db, sid } = await setup();
  makeVictim(db);
  db.prepare('INSERT INTO companies (id,name,slug,status,created_at) VALUES (?,?,?,?,?)').run(
    'c1',
    'Acme',
    'acme',
    'active',
    now(),
  );
  db.prepare(
    'INSERT INTO app_entitlements (id,app,principal_type,principal_id,status,granted_by,granted_at) VALUES (?,?,?,?,?,?,?)',
  ).run('e1', 'raid', 'company', 'c1', 'active', 'u2', now());
  const res = await request(app).post('/admin/users/u2/delete').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 302);
  const ent = db.prepare('SELECT * FROM app_entitlements WHERE id = ?').get('e1');
  assert.ok(ent, 'entitlement should still exist');
  assert.equal(ent.granted_by, null);
});

test('delete: access_requests.reviewed_by is SET NULL and request preserved', async () => {
  const { app, db, sid } = await setup();
  makeVictim(db);
  db.prepare(
    'INSERT INTO access_requests (id,company_name,contact_name,email,status,created_at,reviewed_by) VALUES (?,?,?,?,?,?,?)',
  ).run('r1', 'Acme', 'Jane', 'jane@test', 'approved', now(), 'u2');
  const res = await request(app).post('/admin/users/u2/delete').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 302);
  const r = db.prepare('SELECT * FROM access_requests WHERE id = ?').get('r1');
  assert.ok(r, 'access_request should still exist');
  assert.equal(r.reviewed_by, null);
});

test('delete: user-principal entitlement + usage rows are fully cleaned up', async () => {
  const { app, db, sid } = await setup();
  makeVictim(db);
  db.prepare(
    'INSERT INTO app_entitlements (id,app,principal_type,principal_id,status,granted_at) VALUES (?,?,?,?,?,?)',
  ).run('e2', 'raid', 'user', 'u2', 'active', now());
  db.prepare(
    'INSERT INTO app_usage (app,principal_type,principal_id,period_key,count) VALUES (?,?,?,?,?)',
  ).run('raid', 'user', 'u2', '2026-06', 3);
  const res = await request(app).post('/admin/users/u2/delete').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 302);
  assert.equal(
    db
      .prepare("SELECT * FROM app_entitlements WHERE principal_type='user' AND principal_id=?")
      .get('u2'),
    undefined,
  );
  assert.equal(
    db.prepare("SELECT * FROM app_usage WHERE principal_type='user' AND principal_id=?").get('u2'),
    undefined,
  );
});

test('delete: combined prod-realistic scenario — whole cascade fires in one delete', async () => {
  const { app, db, sid } = await setup();
  makeVictim(db);

  // central_sessions (+ launch_tokens child) — exercises session cleanup path
  const vsid = randomToken();
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(vsid, 'u2', now(), now(), now() + 60_000);
  db.prepare(
    'INSERT INTO launch_tokens (token,central_session_id,target_app,created_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(randomToken(), vsid, 'raid', now(), now() + 60_000);

  // company_members (needs a company) + team_members (needs a team)
  db.prepare('INSERT INTO companies (id,name,slug,status,created_at) VALUES (?,?,?,?,?)').run(
    'c1',
    'Acme',
    'acme',
    'active',
    now(),
  );
  db.prepare(
    'INSERT INTO company_members (user_id,company_id,role,created_at) VALUES (?,?,?,?)',
  ).run('u2', 'c1', 'member', now());
  db.prepare('INSERT INTO teams (id,company_id,name,created_at) VALUES (?,?,?,?)').run(
    't1',
    'c1',
    'Team A',
    now(),
  );
  db.prepare('INSERT INTO team_members (user_id,team_id,role,created_at) VALUES (?,?,?,?)').run(
    'u2',
    't1',
    'member',
    now(),
  );

  // entitlement granted_by=u2 (must survive with granted_by NULL)
  db.prepare(
    'INSERT INTO app_entitlements (id,app,principal_type,principal_id,status,granted_by,granted_at) VALUES (?,?,?,?,?,?,?)',
  ).run('e1', 'raid', 'company', 'c1', 'active', 'u2', now());
  // access_request reviewed_by=u2 (must survive with reviewed_by NULL)
  db.prepare(
    'INSERT INTO access_requests (id,company_name,contact_name,email,status,created_at,reviewed_by) VALUES (?,?,?,?,?,?,?)',
  ).run('r1', 'Acme', 'Jane', 'jane@test', 'approved', now(), 'u2');

  // user-principal entitlement + usage (must be fully removed)
  db.prepare(
    'INSERT INTO app_entitlements (id,app,principal_type,principal_id,status,granted_at) VALUES (?,?,?,?,?,?)',
  ).run('e2', 'raid', 'user', 'u2', 'active', now());
  db.prepare(
    'INSERT INTO app_usage (app,principal_type,principal_id,period_key,count) VALUES (?,?,?,?,?)',
  ).run('raid', 'user', 'u2', '2026-06', 3);

  const res = await request(app).post('/admin/users/u2/delete').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 302);

  // user and its owned/membership/session rows are gone
  assert.equal(db.prepare('SELECT * FROM users WHERE id = ?').get('u2'), undefined);
  assert.equal(db.prepare('SELECT * FROM company_members WHERE user_id = ?').get('u2'), undefined);
  assert.equal(db.prepare('SELECT * FROM team_members WHERE user_id = ?').get('u2'), undefined);
  assert.equal(db.prepare('SELECT * FROM central_sessions WHERE user_id = ?').get('u2'), undefined);
  assert.equal(
    db.prepare('SELECT * FROM launch_tokens WHERE central_session_id = ?').get(vsid),
    undefined,
  );
  assert.equal(
    db
      .prepare("SELECT * FROM app_entitlements WHERE principal_type='user' AND principal_id=?")
      .get('u2'),
    undefined,
  );
  assert.equal(
    db.prepare("SELECT * FROM app_usage WHERE principal_type='user' AND principal_id=?").get('u2'),
    undefined,
  );

  // SET NULL rows survive
  const ent = db.prepare('SELECT * FROM app_entitlements WHERE id = ?').get('e1');
  assert.ok(ent, 'granted_by entitlement should still exist');
  assert.equal(ent.granted_by, null);
  const r = db.prepare('SELECT * FROM access_requests WHERE id = ?').get('r1');
  assert.ok(r, 'access_request should still exist');
  assert.equal(r.reviewed_by, null);
});

test('delete: audit trail is preserved (user_deleted event logged)', async () => {
  const { app, db, sid } = await setup();
  makeVictim(db);
  const res = await request(app).post('/admin/users/u2/delete').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 302);
  const ev = db.prepare('SELECT * FROM audit_events WHERE event_type = ?').get('user_deleted');
  assert.ok(ev, 'user_deleted audit event should exist');
});

test('delete: self-delete is refused (400) and user remains', async () => {
  const { app, db, sid } = await setup();
  const res = await request(app)
    .post('/admin/users/admin1/delete')
    .set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 400);
  assert.ok(db.prepare('SELECT * FROM users WHERE id = ?').get('admin1'), 'admin should remain');
});
