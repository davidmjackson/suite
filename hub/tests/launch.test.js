// tests/launch.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp } from './helpers.js';
import { now, randomToken } from '../lib/tokens.js';

// All five launched apps. `plan` was missing, so /launch/plan had no test at all —
// the same four-of-five drift that let a Sprintplan magic link land on /dashboard.
const APP_DOMAIN = {
  raid: 'https://sprintraid.uk',
  signal: 'https://sprintsignal.uk',
  retro: 'https://sprintretro.uk',
  poker: 'https://sprintpoker.uk',
  plan: 'https://sprintplan.uk',
};

async function buildWithLaunch() {
  const { app, db, config } = await buildTestApp();
  const { mountLaunch } = await import('../routes/launch.js?t=' + Date.now());
  mountLaunch(app);
  return { app, db, config };
}

async function loggedInCookie(db) {
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run('u1', 'a@b.c', now());
  const sid = randomToken();
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(sid, 'u1', now(), now(), now() + 60_000);
  return sid;
}

for (const appName of Object.keys(APP_DOMAIN)) {
  test(`POST /launch/${appName} generates token and 302s to app domain`, async () => {
    const { app, db } = await buildWithLaunch();
    const sid = await loggedInCookie(db);
    const res = await request(app).post(`/launch/${appName}`).set('Cookie', `hub_session=${sid}`);
    assert.equal(res.status, 302);
    assert.ok(res.headers.location.startsWith(`${APP_DOMAIN[appName]}/auth/launch?token=`));
    const launchTok = db.prepare('SELECT * FROM launch_tokens').get();
    assert.equal(launchTok.target_app, appName);
    assert.equal(launchTok.central_session_id, sid);
  });
}

test('POST /launch/unknown returns 404', async () => {
  const { app, db } = await buildWithLaunch();
  const sid = await loggedInCookie(db);
  const res = await request(app).post(`/launch/unknown`).set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 404);
});

test('GET /launch/:app (used after magic-link return_to) also works', async () => {
  const { app, db } = await buildWithLaunch();
  const sid = await loggedInCookie(db);
  const res = await request(app)
    .get(`/launch/raid?return_to=${encodeURIComponent('https://sprintraid.uk/some-page')}`)
    .set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /https:\/\/sprintraid\.uk\/auth\/launch\?token=/);
  assert.match(res.headers.location, /return_to=/);
});
