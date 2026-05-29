// tests/middleware.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createRequireAuth } = require("../middleware.js");
const { createSessionsStore } = require("../lib/sessions-db.js");

function makeReq(cookieHeader, host = "app.test") {
  return { headers: { cookie: cookieHeader, host }, originalUrl: "/protected" };
}
function makeRes() {
  return {
    statusCode: 200,
    status(s) { this.statusCode = s; return this; },
    redirect(c, l) { if (typeof c === "string") { this.location = c; this.statusCode = 302; } else { this.statusCode = c; this.location = l; } },
    setHeader(n, v) { this[n] = v; },
  };
}

function buildCtx({ heartbeatResult = "ok" } = {}) {
  const store = createSessionsStore(":memory:");
  let heartbeatCalls = 0;
  const hubApi = {
    async heartbeat() { heartbeatCalls++; return heartbeatResult; },
    async exchange() { return {}; },
    async deleteSession() {},
  };
  const ctx = {
    appName: "raid",
    hubBaseUrl: "https://hub.test",
    cookieName: "raid_session",
    cookieDomain: undefined,
    store, hubApi,
    cacheTtlMs: 60_000,
    graceMs: 5 * 60_000,
  };
  return { ctx, store, getCalls: () => heartbeatCalls };
}

test("requireAuth with no cookie bounces to hub /login", async () => {
  const { ctx } = buildCtx();
  const mw = createRequireAuth(ctx);
  const req = makeReq(undefined);
  const res = makeRes();
  let called = false;
  await mw(req, res, () => (called = true));
  assert.equal(res.statusCode, 302);
  assert.match(res.location, /^https:\/\/hub\.test\/login\?return_to=/);
  assert.equal(called, false);
});

test("requireAuth with unknown cookie bounces to hub /login", async () => {
  const { ctx } = buildCtx();
  const mw = createRequireAuth(ctx);
  const req = makeReq("raid_session=bogus");
  const res = makeRes();
  await mw(req, res, () => {});
  assert.equal(res.statusCode, 302);
  assert.match(res.location, /\/login\?return_to=/);
});

test("requireAuth with valid cached session calls next + populates req.user", async () => {
  const { ctx, store, getCalls } = buildCtx();
  store.create({ id: "c1", userId: "u1", centralSessionId: "s1", expiresAt: Date.now() + 60_000 });
  const mw = createRequireAuth(ctx);
  const req = makeReq("raid_session=c1");
  const res = makeRes();
  let called = false;
  await mw(req, res, () => (called = true));
  assert.equal(called, true);
  assert.equal(req.user.id, "u1");
  assert.equal(req.centralSessionId, "s1");
  assert.equal(getCalls(), 0, "fresh session within cacheTtl shouldn't hit hub");
});

test("requireAuth caches: 3 calls in quick succession → 0 heartbeats", async () => {
  const { ctx, store, getCalls } = buildCtx();
  store.create({ id: "c1", userId: "u1", centralSessionId: "s1", expiresAt: Date.now() + 60_000 });
  const mw = createRequireAuth(ctx);
  for (let i = 0; i < 3; i++) {
    const req = makeReq("raid_session=c1");
    const res = makeRes();
    await mw(req, res, () => {});
  }
  assert.ok(getCalls() <= 1, "should hit hub at most once for back-to-back requests");
});

test("requireAuth with stale cache + ok heartbeat → renews", async () => {
  const { ctx, store, getCalls } = buildCtx();
  store.create({ id: "c1", userId: "u1", centralSessionId: "s1", expiresAt: Date.now() + 60_000 });
  // Force stale: rewrite last_validated_at to 2 minutes ago via the underlying store; we don't expose that,
  // so simulate by setting cacheTtlMs = 0 instead.
  ctx.cacheTtlMs = 0;
  const mw = createRequireAuth(ctx);
  const req = makeReq("raid_session=c1");
  const res = makeRes();
  let called = false;
  await mw(req, res, () => (called = true));
  assert.equal(called, true);
  assert.equal(getCalls(), 1);
});

test("requireAuth with stale cache + expired heartbeat → 302 + clears cookie", async () => {
  const { ctx, store } = buildCtx({ heartbeatResult: "expired" });
  store.create({ id: "c1", userId: "u1", centralSessionId: "s1", expiresAt: Date.now() + 60_000 });
  ctx.cacheTtlMs = 0;
  const mw = createRequireAuth(ctx);
  const req = makeReq("raid_session=c1");
  const res = makeRes();
  await mw(req, res, () => {});
  assert.equal(res.statusCode, 302);
  assert.match(res.location, /\/login\?return_to=/);
  assert.match(res["Set-Cookie"], /Max-Age=0/);
});
