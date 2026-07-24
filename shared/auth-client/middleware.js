// middleware.js
const { parseCookies, clearSessionCookie } = require('./lib/cookies.js');

function createRequireAuth(ctx) {
  const { store, hubApi, cookieName, cookieDomain, hubBaseUrl, cacheTtlMs, graceMs } = ctx;

  return async function requireAuth(req, res, next) {
    const cookies = parseCookies(req.headers.cookie);
    const cookieVal = cookies[cookieName];
    if (!cookieVal) return bounceToHub(req, res);
    const sess = store.get(cookieVal);
    if (!sess) return bounceToHub(req, res);

    const t = Date.now();
    const age = t - sess.last_validated_at;
    if (age < cacheTtlMs) {
      attachUser(req, sess);
      return next();
    }

    const result = await hubApi.heartbeat(sess.central_session_id);
    if (result === 'ok') {
      store.touch(cookieVal);
      attachUser(req, sess);
      return next();
    }
    if (result === 'expired') {
      store.delete(cookieVal);
      clearSessionCookie(res, { name: cookieName, domain: cookieDomain });
      return bounceToHub(req, res);
    }
    if (age < cacheTtlMs + graceMs) {
      attachUser(req, sess);
      return next();
    }
    store.delete(cookieVal);
    clearSessionCookie(res, { name: cookieName, domain: cookieDomain });
    return bounceToHub(req, res);
  };

  function bounceToHub(req, res) {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const returnTo = encodeURIComponent(`${proto}://${host}${req.originalUrl || req.url || '/'}`);
    res.redirect(302, `${hubBaseUrl}/login?return_to=${returnTo}`);
  }

  function attachUser(req, sess) {
    req.user = {
      id: sess.user_id,
      entitled: !!sess.entitled,
      teams: sess.teams || [],
      company: sess.company ?? null,
    };
    req.appSessionId = sess.id;
    req.centralSessionId = sess.central_session_id;
  }
}

module.exports = { createRequireAuth };
