import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { driftReport } from '../../shared/theme/check-theme-drift.mjs';

const hubRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test("hub's synced Instrument assets match the foundation source", () => {
  const r = driftReport(hubRoot);
  assert.deepEqual(r.missing, [], 'no missing synced assets');
  assert.deepEqual(r.mismatched, [], 'no drifted synced assets');
  assert.equal(r.ok, true);
});
