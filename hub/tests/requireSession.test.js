// tests/requireSession.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { createRequireSession } from '../middleware/requireSession.js';
import { now, randomToken } from '../lib/tokens.js';

function makeReq(cookieHeader) {
  return { headers: { cookie: cookieHeader } };
}
function makeRes() {
  return {
    status(s) {
      this.statusCode = s;
      return this;
    },
    redirect(loc) {
      this.location = loc;
      this.statusCode = 302;
    },
    setHeader() {},
  };
}

test('no cookie → 302 to /login', () => {
  const db = openDb(':memory:');
  const mw = createRequireSession(db);
  const req = makeReq(undefined);
  const res = makeRes();
  let nextCalled = false;
  mw(req, res, () => (nextCalled = true));
  assert.equal(res.statusCode, 302);
  assert.match(res.location, /\/login/);
  assert.equal(nextCalled, false);
  db.close();
});

test('valid cookie → next() with req.user populated', () => {
  const db = openDb(':memory:');
  const userId = 'u1';
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run(userId, 'a@b.c', now());
  const sid = randomToken();
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(sid, userId, now(), now(), now() + 60_000);
  const mw = createRequireSession(db);
  const req = makeReq(`hub_session=${sid}`);
  const res = makeRes();
  let nextCalled = false;
  mw(req, res, () => (nextCalled = true));
  assert.equal(nextCalled, true);
  assert.equal(req.user.id, userId);
  db.close();
});
