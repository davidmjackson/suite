const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSessionsStore } = require("../lib/sessions-db.js");
const { createVerifySession } = require("../lib/verify-session.js");

function ctxWith(store, heartbeat = async () => "ok") {
  return { store, hubApi: { heartbeat }, cookieName: "poker_session", cacheTtlMs: 60_000, graceMs: 300_000 };
}

test("returns context for a fresh session (no hub call)", async () => {
  const store = createSessionsStore(":memory:");
  store.create({ id: "s1", userId: "u1", centralSessionId: "c1", expiresAt: Date.now() + 60_000, entitled: true, teams: [{ id: "t1", name: "Alpha", role: "lead" }] });
  let called = false;
  const verifySession = createVerifySession(ctxWith(store, async () => { called = true; return "ok"; }));
  const res = await verifySession("poker_session=s1");
  assert.deepEqual(res, { userId: "u1", entitled: true, teams: [{ id: "t1", name: "Alpha", role: "lead" }], company: null });
  assert.equal(called, false);
});

test("returns null when cookie missing or session unknown", async () => {
  const store = createSessionsStore(":memory:");
  const verifySession = createVerifySession(ctxWith(store));
  assert.equal(await verifySession(undefined), null);
  assert.equal(await verifySession("poker_session=nope"), null);
});

test("returns null when the central session is expired", async () => {
  const store = createSessionsStore(":memory:");
  store.create({ id: "s1", userId: "u1", centralSessionId: "c1", expiresAt: Date.now() + 60_000 });
  store.touch("s1");
  const ctx = ctxWith(store, async () => "expired");
  ctx.cacheTtlMs = -1; // force age >= cacheTtlMs so the heartbeat path runs
  const verifySession = createVerifySession(ctx);
  assert.equal(await verifySession("poker_session=s1"), null);
});

test("returns context when hub is unavailable but session is within grace", async () => {
  const store = createSessionsStore(":memory:");
  store.create({ id: "s1", userId: "u1", centralSessionId: "c1", expiresAt: Date.now() + 60_000, entitled: false, teams: [] });
  const ctx = ctxWith(store, async () => "error"); // unknown result = hub unreachable
  ctx.cacheTtlMs = -1;       // force heartbeat path (age >= cacheTtlMs)
  ctx.graceMs = 300_000;     // generous grace window
  const verifySession = createVerifySession(ctx);
  const res = await verifySession("poker_session=s1");
  assert.ok(res !== null);
  assert.equal(res.userId, "u1");
});

test("returns null when hub is unavailable and grace period has passed", async () => {
  const store = createSessionsStore(":memory:");
  store.create({ id: "s1", userId: "u1", centralSessionId: "c1", expiresAt: Date.now() + 60_000 });
  const ctx = ctxWith(store, async () => "error");
  ctx.cacheTtlMs = -300_001;  // age > cacheTtlMs + graceMs
  ctx.graceMs = 0;
  const verifySession = createVerifySession(ctx);
  assert.equal(await verifySession("poker_session=s1"), null);
});

test("verifySession includes company from the stored session", async () => {
  const store = createSessionsStore(":memory:");
  store.create({ id: "sid", userId: "u1", centralSessionId: "c1", expiresAt: Date.now() + 60_000, entitled: true, company: { id: "co1", name: "Acme" } });
  const verifySession = createVerifySession(ctxWith(store));
  const result = await verifySession("poker_session=sid");
  assert.deepEqual(result.company, { id: "co1", name: "Acme" });
});
