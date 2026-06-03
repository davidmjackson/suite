import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncTo } from "../sync-theme.mjs";
import { driftReport } from "../check-theme-drift.mjs";

test("a freshly synced surface reports no drift", () => {
  const target = mkdtempSync(join(tmpdir(), "theme-drift-"));
  syncTo(target);
  const r = driftReport(target);
  assert.equal(r.ok, true);
  assert.deepEqual(r.mismatched, []);
  assert.deepEqual(r.missing, []);
});

test("a mutated copy is flagged as drifted", () => {
  const target = mkdtempSync(join(tmpdir(), "theme-drift-"));
  syncTo(target);
  appendFileSync(join(target, "public", "css", "instrument-core.css"), "\n/* local edit */\n");
  const r = driftReport(target);
  assert.equal(r.ok, false);
  assert.ok(r.mismatched.includes("css/instrument-core.css"));
});

test("a missing copy is flagged", () => {
  const empty = mkdtempSync(join(tmpdir(), "theme-drift-"));
  const r = driftReport(empty);
  assert.equal(r.ok, false);
  assert.ok(r.missing.length > 0);
});
