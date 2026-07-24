// tests/prune.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { now, randomToken } from '../lib/tokens.js';
import { prune } from '../scripts/prune.js';

test('prune deletes expired sessions and old audit events', () => {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run('u1', 'a@b.c', now());
  // expired session
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(randomToken(), 'u1', now() - 1000, now() - 1000, now() - 1);
  // valid session
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(randomToken(), 'u1', now(), now(), now() + 60_000);
  // old audit
  db.prepare('INSERT INTO audit_events (user_id,event_type,created_at) VALUES (?,?,?)').run(
    'u1',
    'old',
    now() - 91 * 24 * 60 * 60 * 1000,
  );
  // recent audit
  db.prepare('INSERT INTO audit_events (user_id,event_type,created_at) VALUES (?,?,?)').run(
    'u1',
    'recent',
    now(),
  );

  const result = prune(db, { auditTtlMs: 90 * 24 * 60 * 60 * 1000 });
  assert.equal(result.sessionsDeleted, 1);
  assert.equal(result.auditDeleted, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM central_sessions').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM audit_events').get().c, 1);
});

test('prune deletes an expired session that still has a launch_token (no FK error)', () => {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run('u1', 'a@b.c', now());
  const sid = randomToken();
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(sid, 'u1', now() - 1000, now() - 1000, now() - 1);
  // A launch_token still references the expiring session.
  db.prepare(
    'INSERT INTO launch_tokens (token,central_session_id,target_app,created_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(randomToken(), sid, 'retro', now() - 1000, now() - 1);

  const result = prune(db);
  assert.equal(result.sessionsDeleted, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM central_sessions').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM launch_tokens').get().c, 0);
});
