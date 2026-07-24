// tests/requireCompanyRole.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp } from './helpers.js';
import { now, randomToken } from '../lib/tokens.js';
import { createOrg } from '../lib/org.js';

async function setup({ role } = {}) {
  const { app, db } = await buildTestApp();
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run('u1', 'a@b.c', now());
  const sid = randomToken();
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(sid, 'u1', now(), now(), now() + 60_000);
  const org = createOrg(db);
  const c = org.createCompany({ name: 'Acme', slug: 'acme' });
  if (role) org.addCompanyMember({ userId: 'u1', companyId: c.id, role });

  const { createRequireSession } = await import('../middleware/requireSession.js?t=' + Date.now());
  const { createRequireCompanyRole } = await import(
    '../middleware/requireCompanyRole.js?t=' + Date.now()
  );
  const requireSession = createRequireSession(db);
  const companyRole = createRequireCompanyRole(db);
  app.get('/company/:slug/probe', requireSession, companyRole(['owner']), (req, res) => {
    res.json({ company: req.company.slug, role: req.companyRole });
  });
  return { app, sid };
}

test('404 for an unknown company slug', async () => {
  const { app, sid } = await setup({ role: 'owner' });
  const res = await request(app).get('/company/nope/probe').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 404);
});

test('403 for a non-member', async () => {
  const { app, sid } = await setup({ role: null });
  const res = await request(app).get('/company/acme/probe').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 403);
});

test('403 for a plain member (role not allowed)', async () => {
  const { app, sid } = await setup({ role: 'member' });
  const res = await request(app).get('/company/acme/probe').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 403);
});

test('passes for an owner and attaches req.company + req.companyRole', async () => {
  const { app, sid } = await setup({ role: 'owner' });
  const res = await request(app).get('/company/acme/probe').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { company: 'acme', role: 'owner' });
});
