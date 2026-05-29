// tests/hub-api.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHubApi } = require("../lib/hub-api.js");

function mockFetch(handlers) {
  return async (url, opts = {}) => {
    const u = new URL(url);
    const key = `${opts.method || "GET"} ${u.pathname}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    return handler(opts);
  };
}

test("exchange POSTs launch_token and returns user info", async () => {
  const f = mockFetch({
    "POST /api/sessions/exchange": async (opts) => {
      assert.equal(opts.headers.Authorization, "Bearer test-key");
      assert.match(opts.body, /launch_token/);
      return { status: 200, json: async () => ({ user: { id: "u1", email: "a@b" }, central_session_id: "s1" }) };
    },
  });
  const api = createHubApi({ baseUrl: "https://hub.test", apiKey: "test-key", fetchImpl: f });
  const r = await api.exchange("tok123");
  assert.deepEqual(r.user, { id: "u1", email: "a@b" });
  assert.equal(r.central_session_id, "s1");
});

test("heartbeat returns ok for 200, expired for 404", async () => {
  const f = mockFetch({
    "POST /api/sessions/s1/heartbeat": async () => ({ status: 200, json: async () => ({ ok: true }) }),
    "POST /api/sessions/s2/heartbeat": async () => ({ status: 404, json: async () => ({}) }),
  });
  const api = createHubApi({ baseUrl: "https://hub.test", apiKey: "test-key", fetchImpl: f });
  assert.equal(await api.heartbeat("s1"), "ok");
  assert.equal(await api.heartbeat("s2"), "expired");
});

test("heartbeat returns 'unreachable' on network error", async () => {
  const f = async () => { throw new Error("ECONNREFUSED"); };
  const api = createHubApi({ baseUrl: "https://hub.test", apiKey: "k", fetchImpl: f });
  assert.equal(await api.heartbeat("s1"), "unreachable");
});

test("delete sends DELETE to hub", async () => {
  let called = false;
  const f = mockFetch({
    "DELETE /api/sessions/s1": async () => { called = true; return { status: 204, json: async () => ({}) }; },
  });
  const api = createHubApi({ baseUrl: "https://hub.test", apiKey: "k", fetchImpl: f });
  await api.deleteSession("s1");
  assert.ok(called);
});
