// tests/confirm-modal.test.js
// The reusable confirm modal replaces all native confirm() dialogs in the hub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import request from 'supertest';
import { buildTestApp } from './helpers.js';
import { now, randomToken } from '../lib/tokens.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewsDir = join(__dirname, '..', 'views');

async function setup() {
  const { app, db, config } = await buildTestApp();
  const { mountAdmin } = await import('../routes/admin.js?t=' + Date.now());
  mountAdmin(app);
  db.prepare(
    'INSERT INTO users (id,email,display_name,is_admin,created_at) VALUES (?,?,?,?,?)',
  ).run('admin1', 'admin@test', 'Admin', 1, now());
  const sid = randomToken();
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(sid, 'admin1', now(), now(), now() + 60_000);
  return { app, db, sid };
}

test('GET /js/confirm-modal.js serves 200', async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get('/js/confirm-modal.js');
  assert.equal(res.status, 200);
});

test('admin users page uses data-confirm and no native confirm()', async () => {
  const { app, db, sid } = await setup();
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run(
    'u2',
    'victim@test',
    now(),
  );
  const res = await request(app).get('/admin').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /data-confirm=/, 'delete form has data-confirm');
  assert.ok(!res.text.includes('onsubmit="return confirm('), 'no native confirm() in HTML');
});

test('header wires the confirm-modal script on the admin page', async () => {
  const { app, sid } = await setup();
  const res = await request(app).get('/admin').set('Cookie', `hub_session=${sid}`);
  assert.match(res.text, /\/js\/confirm-modal\.js/, 'confirm-modal.js script tag present');
});

// Regression guard: none of the three converted views may keep onsubmit confirm().
test('the three converted views have no onsubmit confirm() and use data-confirm', () => {
  const targets = ['admin/users.eta', 'company/console.eta', 'admin/companies.eta'];
  for (const rel of targets) {
    const src = readFileSync(join(viewsDir, rel), 'utf8');
    assert.ok(
      !src.includes('onsubmit="return confirm'),
      `${rel} should not use onsubmit confirm()`,
    );
    assert.ok(src.includes('data-confirm'), `${rel} should use data-confirm`);
  }
});
