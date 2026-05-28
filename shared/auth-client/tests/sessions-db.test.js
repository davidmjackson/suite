// tests/sessions-db.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionsStore } from "../lib/sessions-db.js";

test("create + get + touch + delete round-trip", () => {
  const store = createSessionsStore(":memory:");
  store.create({ id: "c1", userId: "u1", centralSessionId: "s1", expiresAt: Date.now() + 60_000 });
  const got = store.get("c1");
  assert.equal(got.user_id, "u1");
  assert.equal(got.central_session_id, "s1");
  const before = got.last_validated_at;
  store.touch("c1");
  assert.ok(store.get("c1").last_validated_at >= before);
  store.delete("c1");
  assert.equal(store.get("c1"), undefined);
});
