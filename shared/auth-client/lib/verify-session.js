// lib/verify-session.js — connection-layer session check (e.g. WebSocket upgrade).
// Mirrors requireAuth's cache/grace freshness logic but returns data instead of
// redirecting. Returns { userId, entitled, teams, company } or null.
const { parseCookies } = require('./cookies.js');

function createVerifySession(ctx) {
  const { store, hubApi, cookieName, cacheTtlMs, graceMs } = ctx;

  function context(sess) {
    return {
      userId: sess.user_id,
      entitled: !!sess.entitled,
      teams: sess.teams || [],
      company: sess.company ?? null,
    };
  }

  // On a null result the caller is responsible for clearing the session cookie (this has no res).
  return async function verifySession(cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    const cookieVal = cookies[cookieName];
    if (!cookieVal) return null;
    const sess = store.get(cookieVal);
    if (!sess) return null;

    // NOTE: keep this freshness logic in sync with requireAuth in middleware.js
    const age = Date.now() - sess.last_validated_at;
    if (age < cacheTtlMs) return context(sess);

    const result = await hubApi.heartbeat(sess.central_session_id);
    if (result === 'ok') {
      store.touch(cookieVal);
      return context(sess);
    }
    if (result === 'expired') {
      store.delete(cookieVal);
      return null;
    }
    if (age < cacheTtlMs + graceMs) return context(sess);
    store.delete(cookieVal);
    return null;
  };
}

module.exports = { createVerifySession };
