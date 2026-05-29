// tests/heartbeat.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAuthClient } = require("../index.js");
const { createHubApi } = require("../lib/hub-api.js");

function buildClient(heartbeatStatus = 200) {
  const fetchImpl = async () => ({ status: heartbeatStatus, json: async () => (heartbeatStatus === 200 ? { ok: true } : {}) });
  const client = createAuthClient({
    appName: "raid", hubBaseUrl: "https://hub.test", hubApiKey: "k",
    cookieName: "raid_session", dbPath: ":memory:",
  });
  client._ctx.hubApi = createHubApi({ baseUrl: "https://hub.test", apiKey: "k", fetchImpl });
  return client;
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    status(s) { this.statusCode = s; return this; },
    json(o) { this.body = o; },
    end() {},
    setHeader(n, v) { this.headers[n] = v; },
  };
}

test("heartbeat with no cookie returns 401", async () => {
  const client = buildClient(200);
  const req = { headers: {} };
  const res = makeRes();
  await client.handleHeartbeat(req, res);
  assert.equal(res.statusCode, 401);
});

test("heartbeat with valid session returns 200", async () => {
  const client = buildClient(200);
  client._ctx.store.create({ id: "c1", userId: "u1", centralSessionId: "s1", expiresAt: Date.now() + 60000 });
  const req = { headers: { cookie: "raid_session=c1" } };
  const res = makeRes();
  await client.handleHeartbeat(req, res);
  assert.equal(res.statusCode, 200);
});

test("heartbeat with expired central session returns 401 and clears cookie", async () => {
  const client = buildClient(404);
  client._ctx.store.create({ id: "c1", userId: "u1", centralSessionId: "s1", expiresAt: Date.now() + 60000 });
  const req = { headers: { cookie: "raid_session=c1" } };
  const res = makeRes();
  await client.handleHeartbeat(req, res);
  assert.equal(res.statusCode, 401);
  assert.match(res.headers["Set-Cookie"], /Max-Age=0/);
});
