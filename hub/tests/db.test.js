// tests/db.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('openDb creates schema and exposes prepared statements', () => {
  const tmpPath = '/tmp/test-suite-' + Date.now() + '.db';
  process.env.DB_PATH = tmpPath;
  // re-import with fresh cache
  return import('../db/index.js?t=' + Date.now()).then(({ openDb }) => {
    const db = openDb(tmpPath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
    assert.ok(tables.includes('users'));
    assert.ok(tables.includes('central_sessions'));
    assert.ok(tables.includes('magic_link_tokens'));
    assert.ok(tables.includes('launch_tokens'));
    assert.ok(tables.includes('audit_events'));
    db.close();
    fs.unlinkSync(tmpPath);
  });
});
