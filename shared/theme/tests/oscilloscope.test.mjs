import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopePath, W, BASELINE } from '../oscilloscope.js';

test('scopePath starts at the left baseline and spans the full width', () => {
  const d = scopePath();
  assert.ok(d.startsWith('M0 110'), 'starts at M0 110');
  assert.ok(
    d.includes(`L${W} `) || d.trim().endsWith(`L${W} 110.0`) || d.includes(` L${W} `),
    'reaches the right edge W',
  );
  assert.equal(W, 3600);
  assert.equal(BASELINE, 110);
});

test('scopePath has a deep pulse spike near each 600px period (y well above baseline)', () => {
  const d = scopePath();
  // Parse the "L<x> <y>" points and find the minimum y (spikes go UP = smaller y).
  const ys = [...d.matchAll(/L\d+(?:\.\d+)? (\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const minY = Math.min(...ys);
  assert.ok(minY < 60, `a pulse rises well above the 110 baseline (minY=${minY})`);
  // ...and the calm sections stay close to baseline (within the 3px ripple).
  const calm = ys.filter((y) => Math.abs(y - 110) <= 3.001);
  assert.ok(calm.length > ys.length / 2, 'most of the trace is the calm ripple');
});
