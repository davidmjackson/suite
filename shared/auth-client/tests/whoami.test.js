// tests/whoami.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAuthClient } = require("../lib/factory.js");

function mk(cookieHeader) {
  const client = createAuthClient({
    appName: "raid", hubBaseUrl: "https://hub.example/", hubApiKey: "k",
    cookieName: "raid_session", dbPath: ":memory:",
  });
  const req = { headers: cookieHeader ? { cookie: cookieHeader } : {} };
  const captured = { status: 200, body: undefined, redirected: false };
  const res = {
    status(c) { captured.status = c; return res; },
    json(b) { captured.body = b; return res; },
    redirect() { captured.redirected = true; return res; },
  };
  return { client, req, res, captured };
}

test("whoami: no cookie -> 200 {authed:false}, no redirect", () => {
  const { client, req, res, captured } = mk(null);
  client.handleWhoami(req, res);
  assert.equal(captured.status, 200);
  assert.deepEqual(captured.body, { authed: false });
  assert.equal(captured.redirected, false);
});

test("whoami: unknown cookie -> 200 {authed:false}", () => {
  const { client, req, res, captured } = mk("raid_session=nope");
  client._ctx.store.get = () => null;
  client.handleWhoami(req, res);
  assert.equal(captured.status, 200);
  assert.deepEqual(captured.body, { authed: false });
});

test("whoami: valid session -> 200 {authed:true, dashboardUrl} (trailing slash stripped)", () => {
  const { client, req, res, captured } = mk("raid_session=abc");
  client._ctx.store.get = () => ({ id: "s1", central_session_id: "cs1", user_id: "u1" });
  client.handleWhoami(req, res);
  assert.equal(captured.status, 200);
  assert.deepEqual(captured.body, { authed: true, dashboardUrl: "https://hub.example/dashboard" });
  assert.equal(captured.redirected, false);
});
