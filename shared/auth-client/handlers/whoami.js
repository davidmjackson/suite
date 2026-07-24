// handlers/whoami.js
// GET /auth/whoami — reports whether the caller holds a valid app session and,
// if so, the hub dashboard URL. NEVER redirects (unlike requireAuth) and makes
// NO hub round-trip — a cheap, synchronous local store lookup (intentionally not async) safe to call on every page load.
const { parseCookies } = require('../lib/cookies.js');

function createWhoamiHandler(ctx) {
  return function handleWhoami(req, res) {
    const cookieVal = parseCookies(req.headers.cookie)[ctx.cookieName];
    const sess = cookieVal ? ctx.store.get(cookieVal) : null;
    if (!sess) return res.status(200).json({ authed: false });
    const base = String(ctx.hubBaseUrl || '').replace(/\/+$/, '');
    return res.status(200).json({ authed: true, dashboardUrl: base + '/dashboard' });
  };
}

module.exports = { createWhoamiHandler };
