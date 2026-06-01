// tests/access-requests.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTestApp } from "./helpers.js";

test("003 migration creates access_requests with expected columns", async () => {
  const { db } = await buildTestApp();
  const cols = db.prepare("PRAGMA table_info(access_requests)").all().map((c) => c.name);
  for (const c of [
    "id", "company_name", "contact_name", "email", "job_title", "team_size",
    "apps_interest", "message", "status", "created_at", "reviewed_by",
    "reviewed_at", "review_note", "company_id",
  ]) {
    assert.ok(cols.includes(c), `missing column ${c}`);
  }
  const v = db.prepare("SELECT MAX(version) AS v FROM schema_version").get().v;
  assert.ok(v >= 3, "schema_version should be >= 3");
});
