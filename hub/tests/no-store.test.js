// tests/no-store.test.js — Cache-Control: no-store, scoped to responses that
// carry a person's data or live auth material.
//
// The scope is the whole point. A blanket no-store would pass every positive
// test here and still be wrong, so the public-page test at the bottom is what
// actually discriminates this implementation from that one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp } from './helpers.js';
import { now, randomToken } from '../lib/tokens.js';

function seedSession(db, userId = 'u1') {
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

test('a session-gated page is not stored', async () => {
  const { app, db } = await buildTestApp();
  const { mountDashboard } = await import('../routes/dashboard.js?t=' + Date.now());
  mountDashboard(app);
  const sid = seedSession(db);

  const res = await request(app).get('/dashboard').set('Cookie', `hub_session=${sid}`);

  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
});

// The header is set before the cookie is read, not after: this redirect is the
// answer "you are not signed in", and a cache that keeps it serves it back to a
// browser that since has signed in.
test('the redirect to /login from a session-gated page is not stored', async () => {
  const { app } = await buildTestApp();
  const { mountDashboard } = await import('../routes/dashboard.js?t=' + Date.now());
  mountDashboard(app);

  const res = await request(app).get('/dashboard');

  assert.equal(res.status, 302);
  assert.equal(res.headers['cache-control'], 'no-store');
});

// The confirm page embeds an unconsumed sign-in token in a hidden input, and is
// a plain 200 that a shared cache may keep on heuristics alone.
test('the magic-link confirm page carrying a live token is not stored', async () => {
  const { app, db } = await buildTestApp();
  const { mountMagic } = await import('../routes/magic.js?t=' + Date.now());
  mountMagic(app);
  const tok = randomToken();
  db.prepare(
    'INSERT INTO magic_link_tokens (token,email,return_to,created_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(tok, 'a@b.c', null, now(), now() + 60_000);

  const res = await request(app).get(`/auth/magic?token=${tok}`);

  assert.equal(res.status, 200);
  assert.ok(res.text.includes(tok));
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('sign-out is not stored', async () => {
  const { app, db } = await buildTestApp();
  const { mountLogout } = await import('../routes/logout.js?t=' + Date.now());
  mountLogout(app);
  const sid = seedSession(db);

  const res = await request(app).get('/logout').set('Cookie', `hub_session=${sid}`);

  assert.equal(res.status, 302);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('a key-authenticated API response is not stored', async () => {
  const { app, db } = await buildTestApp();
  const { mountApiApps } = await import('../routes/api-apps.js?t=' + Date.now());
  mountApiApps(app);
  const sid = seedSession(db);

  const res = await request(app)
    .post('/api/apps/raid/consume')
    .set('Authorization', 'Bearer k-raid')
    .send({ central_session_id: sid });

  assert.equal(res.status, 403); // seeded user has no raid entitlement
  assert.equal(res.headers['cache-control'], 'no-store');
});

// THE DISCRIMINATOR. /login is the nearest miss there is: same app, same view
// engine, one hop from every page above, and the page ZAP actually flagged. It
// holds no secret, so no-store here buys nothing and costs the cache. A blanket
// implementation passes every test above and fails this one.
test('a public page is still cacheable', async () => {
  const { app } = await buildTestApp();
  const { mountLogin } = await import('../routes/login.js?t=' + Date.now());
  mountLogin(app, {});

  const res = await request(app).get('/login');

  assert.equal(res.status, 200);
  assert.doesNotMatch(res.headers['cache-control'] ?? '', /no-store/);
});
