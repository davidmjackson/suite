// tests/audit.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.js";
import { createAuditLogger } from "../lib/audit.js";

test("audit.log inserts a row with correct fields", () => {
  const db = openDb(":memory:");
  const audit = createAuditLogger(db);
  audit.log({ userId: "u1", eventType: "login_sent", app: null, metadata: { email: "a@b.c" }, ip: "1.2.3.4" });
  const row = db.prepare("SELECT * FROM audit_events").get();
  assert.equal(row.user_id, "u1");
  assert.equal(row.event_type, "login_sent");
  assert.equal(JSON.parse(row.metadata).email, "a@b.c");
  assert.equal(row.ip, "1.2.3.4");
  assert.ok(row.created_at > 0);
  db.close();
});
