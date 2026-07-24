// tests/sessions-db.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSessionsStore } = require('../lib/sessions-db.js');

test('create + get + touch + delete round-trip', () => {
  const store = createSessionsStore(':memory:');
  store.create({ id: 'c1', userId: 'u1', centralSessionId: 's1', expiresAt: Date.now() + 60_000 });
  const got = store.get('c1');
  assert.equal(got.user_id, 'u1');
  assert.equal(got.central_session_id, 's1');
  const before = got.last_validated_at;
  store.touch('c1');
  assert.ok(store.get('c1').last_validated_at >= before);
  store.delete('c1');
  assert.equal(store.get('c1'), undefined);
});

test('create persists entitled+teams and get returns them parsed', () => {
  const store = createSessionsStore(':memory:');
  store.create({
    id: 's1',
    userId: 'u1',
    centralSessionId: 'c1',
    expiresAt: Date.now() + 60_000,
    entitled: true,
    teams: [{ id: 't1', name: 'Alpha', role: 'lead' }],
  });
  const s = store.get('s1');
  assert.equal(s.entitled, true);
  assert.deepEqual(s.teams, [{ id: 't1', name: 'Alpha', role: 'lead' }]);
});

test('create defaults entitled=false and teams=[] when omitted (back-compat)', () => {
  const store = createSessionsStore(':memory:');
  store.create({ id: 's2', userId: 'u2', centralSessionId: 'c2', expiresAt: Date.now() + 60_000 });
  const s = store.get('s2');
  assert.equal(s.entitled, false);
  assert.deepEqual(s.teams, []);
});

test('sessions-db round-trips company (defaults to null)', () => {
  const store = createSessionsStore(':memory:');
  store.create({ id: 's1', userId: 'u1', centralSessionId: 'c1', expiresAt: Date.now() + 60_000 });
  assert.equal(store.get('s1').company, null);

  store.create({
    id: 's2',
    userId: 'u2',
    centralSessionId: 'c2',
    expiresAt: Date.now() + 60_000,
    company: { id: 'co1', name: 'Acme' },
  });
  assert.deepEqual(store.get('s2').company, { id: 'co1', name: 'Acme' });

  store.create({
    id: 's3',
    userId: 'u3',
    centralSessionId: 'c3',
    expiresAt: Date.now() + 60_000,
    company: null,
  });
  assert.equal(store.get('s3').company, null);
});
