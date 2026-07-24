// tests/rate-limit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from '../lib/rate-limit.js';

test('allows up to N requests then blocks', () => {
  const lim = createLimiter({ max: 3, windowMs: 60000 });
  assert.equal(lim.check('ip1'), true);
  assert.equal(lim.check('ip1'), true);
  assert.equal(lim.check('ip1'), true);
  assert.equal(lim.check('ip1'), false);
});

test('isolates buckets by key', () => {
  const lim = createLimiter({ max: 1, windowMs: 60000 });
  assert.equal(lim.check('a'), true);
  assert.equal(lim.check('b'), true);
  assert.equal(lim.check('a'), false);
});

test('resets after window', async () => {
  const lim = createLimiter({ max: 1, windowMs: 50 });
  assert.equal(lim.check('a'), true);
  assert.equal(lim.check('a'), false);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(lim.check('a'), true);
});
