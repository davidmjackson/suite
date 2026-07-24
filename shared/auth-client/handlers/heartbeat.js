// handlers/heartbeat.js
const { parseCookies, clearSessionCookie } = require('../lib/cookies.js');

function createHeartbeatHandler(ctx) {
  return async function handleHeartbeat(req, res) {
    const cookieVal = parseCookies(req.headers.cookie)[ctx.cookieName];
    if (!cookieVal) return res.status(401).json({ error: 'no_session' });
    const sess = ctx.store.get(cookieVal);
    if (!sess) return res.status(401).json({ error: 'no_session' });
    const result = await ctx.hubApi.heartbeat(sess.central_session_id);
    if (result === 'ok') {
      ctx.store.touch(cookieVal);
      return res.status(200).json({ ok: true });
    }
    if (result === 'expired') {
      ctx.store.delete(cookieVal);
      clearSessionCookie(res, { name: ctx.cookieName, domain: ctx.cookieDomain });
      return res.status(401).json({ error: 'expired' });
    }
    return res.status(503).json({ error: 'hub_unreachable' });
  };
}

module.exports = { createHeartbeatHandler };
