// tests/factory.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAuthClient } = require("../lib/factory.js");

test("client.consume delegates to hubApi.consume", async () => {
  const client = createAuthClient({
    appName: "raid",
    hubBaseUrl: "https://hub",
    hubApiKey: "k",
    cookieName: "raid_session",
    dbPath: ":memory:",
  });
  // inject a fake hubApi (same monkey-patch pattern the handler tests use)
  client._ctx.hubApi = { consume: async (csid) => ({ ok: true, remaining: 9, _csid: csid }) };
  const r = await client.consume("cs1");
  assert.deepEqual(r, { ok: true, remaining: 9, _csid: "cs1" });
});
