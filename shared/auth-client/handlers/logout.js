// handlers/logout.js
const { parseCookies, clearSessionCookie } = require('../lib/cookies.js');

function createLogoutHandler(ctx) {
  return async function handleLogout(req, res) {
    const cookieVal = parseCookies(req.headers.cookie)[ctx.cookieName];
    if (cookieVal) {
      const sess = ctx.store.get(cookieVal);
      if (sess) {
        await ctx.hubApi.deleteSession(sess.central_session_id);
        ctx.store.delete(cookieVal);
      }
    }
    clearSessionCookie(res, { name: ctx.cookieName, domain: ctx.cookieDomain });
    res.redirect(302, `${ctx.hubBaseUrl}/`);
  };
}

module.exports = { createLogoutHandler };
