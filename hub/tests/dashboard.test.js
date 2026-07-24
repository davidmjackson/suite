// tests/dashboard.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp } from './helpers.js';
import { now, randomToken } from '../lib/tokens.js';

async function buildWithDashboard() {
  const { app, db, config } = await buildTestApp();
  const { mountDashboard } = await import('../routes/dashboard.js?t=' + Date.now());
  mountDashboard(app);
  return { app, db, config };
}

test('logged-out user is redirected to /login', async () => {
  const { app } = await buildWithDashboard();
  const res = await request(app).get('/dashboard');
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /\/login/);
});

test('logged-in user sees all five app tiles', async () => {
  const { app, db } = await buildWithDashboard();
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run('u1', 'a@b.c', now());
  const sid = randomToken();
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(sid, 'u1', now(), now(), now() + 60_000);
  const res = await request(app).get('/dashboard').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /Sprintraid/);
  assert.match(res.text, /Sprintsignal/);
  assert.match(res.text, /Sprintretro/);
  assert.match(res.text, /Sprintpoker/);
  assert.match(res.text, /Sprintplan/);
});

test('Phase 2: Sprintplan is a launched app, no longer a free direct link', async () => {
  const { app, db } = await buildWithDashboard();
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run('u1', 'a@b.c', now());
  const sid = randomToken();
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(sid, 'u1', now(), now(), now() + 60_000);
  const res = await request(app).get('/dashboard').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 200);
  // The Brief 10 free-direct-link tile is gone (collaboration requires an account).
  assert.doesNotMatch(res.text, /href="https:\/\/sprintplan\.uk"/);
  // This user has no plan entitlement, so (like any gated app) no launch form yet —
  // it shows Request access until entitled, then /launch/plan appears.
  assert.doesNotMatch(res.text, /action="\/launch\/plan"/);
});

test('dashboard shows a Manage link for companies the user owns/admins', async () => {
  const { app, db } = await buildWithDashboard();
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run('u1', 'a@b.c', now());
  const sid = randomToken();
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(sid, 'u1', now(), now(), now() + 60_000);
  const { createOrg } = await import('../lib/org.js?t=' + Date.now());
  const org = createOrg(db);
  const c = org.createCompany({ name: 'Acme', slug: 'acme' });
  org.addCompanyMember({ userId: 'u1', companyId: c.id, role: 'owner' });

  const res = await request(app).get('/dashboard').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /href="\/company\/acme"/);
  assert.match(res.text, /Acme/);
});

test('dashboard leads with the band and renders glyph tiles', async () => {
  const { app, db } = await buildWithDashboard();
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run('u1', 'a@b.c', now());
  const sid = randomToken();
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(sid, 'u1', now(), now(), now() + 60_000);
  const res = await request(app).get('/dashboard').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /class="band"/);
  assert.match(res.text, /class="applist"/);
});

test('dashboard renders a launchable tile only for entitled apps', async () => {
  const { app, db } = await buildWithDashboard();
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run('u1', 'a@b.c', now());
  const sid = randomToken();
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(sid, 'u1', now(), now(), now() + 60_000);
  const { createEntitlements } = await import('../lib/entitlements.js?t=' + Date.now());
  createEntitlements(db).grantEntitlement({
    app: 'raid',
    principalType: 'user',
    principalId: 'u1',
  });

  const res = await request(app).get('/dashboard').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 200);
  // raid is entitled -> launch form present
  assert.match(res.text, /action="\/launch\/raid"/);
  // signal is NOT entitled -> no launch form, shows Request access
  assert.doesNotMatch(res.text, /action="\/launch\/signal"/);
  assert.match(res.text, /Request access/);
});
