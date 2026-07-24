// tests/api-apps-consume.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp } from './helpers.js';
import { now, randomToken } from '../lib/tokens.js';

async function buildWithApps() {
  const { app, db, config } = await buildTestApp();
  const { mountApiApps } = await import('../routes/api-apps.js?t=' + Date.now());
  mountApiApps(app);
  return { app, db, config };
}

async function seedSession(db, userId = 'u1') {
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run(
    userId,
    userId + '@b.c',
    now(),
  );
  const sid = randomToken();
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(sid, userId, now(), now(), now() + 60_000);
  return sid;
}

test('consume requires a bearer key', async () => {
  const { app } = await buildWithApps();
  const res = await request(app).post('/api/apps/raid/consume').send({ central_session_id: 'x' });
  assert.equal(res.status, 401);
});

test('consume rejects when :app does not match the calling key', async () => {
  const { app, db } = await buildWithApps();
  const sid = await seedSession(db);
  const res = await request(app)
    .post('/api/apps/raid/consume')
    .set('Authorization', 'Bearer k-signal') // signal key on a raid path
    .send({ central_session_id: sid });
  assert.equal(res.status, 403);
  assert.equal(res.body.reason, 'wrong_app');
});

test('consume returns 403 not_entitled when the user has no grant', async () => {
  const { app, db } = await buildWithApps();
  const sid = await seedSession(db);
  const res = await request(app)
    .post('/api/apps/raid/consume')
    .set('Authorization', 'Bearer k-raid')
    .send({ central_session_id: sid });
  assert.equal(res.status, 403);
  assert.equal(res.body.reason, 'not_entitled');
});

test('consume returns 200 and decrements remaining; 402 when exhausted', async () => {
  const { app, db } = await buildWithApps();
  const sid = await seedSession(db);
  const { createEntitlements } = await import('../lib/entitlements.js?t=' + Date.now());
  createEntitlements(db).grantEntitlement({
    app: 'raid',
    principalType: 'user',
    principalId: 'u1',
    quotaLimit: 1,
    quotaPeriod: 'month',
  });

  const ok = await request(app)
    .post('/api/apps/raid/consume')
    .set('Authorization', 'Bearer k-raid')
    .send({ central_session_id: sid });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.remaining, 0);

  const exhausted = await request(app)
    .post('/api/apps/raid/consume')
    .set('Authorization', 'Bearer k-raid')
    .send({ central_session_id: sid });
  assert.equal(exhausted.status, 402);
  assert.equal(exhausted.body.reason, 'quota_exceeded');
});

test('consume returns 404 for an unknown session', async () => {
  const { app } = await buildWithApps();
  const res = await request(app)
    .post('/api/apps/raid/consume')
    .set('Authorization', 'Bearer k-raid')
    .send({ central_session_id: 'nope' });
  assert.equal(res.status, 404);
});

test('consume returns 400 when central_session_id is missing', async () => {
  const { app } = await buildWithApps();
  const res = await request(app)
    .post('/api/apps/raid/consume')
    .set('Authorization', 'Bearer k-raid')
    .send({});
  assert.equal(res.status, 400);
});
