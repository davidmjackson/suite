// middleware/csrf.js — refuses state-changing requests that did not come from
// this site. Mounted once in the app shell, above every route.
//
// It FAILS CLOSED: a request carrying neither Origin nor Sec-Fetch-Site is
// refused, so a non-browser client cannot skip the check by omitting a header.
// `Origin: null` — a sandboxed iframe, or a POST redirected across origins — is
// refused along with everything else off the allow-list; it is a value, not an
// absence, and must never be read as one.
//
// Safe methods pass untouched, which leaves two state-changing GETs uncovered:
// GET /logout and GET /launch/:app. Both are known gaps, recorded deliberately
// rather than closed here — closing them means converting routes to POST and
// reworking the magic-link redirect chain.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// The four /api/* routes are server-to-server: the apps call them from Node with
// a Bearer key and no cookie, so they send no Origin and cannot be CSRF-ed. They
// are exempt BY PATH and never by "no Origin ⇒ allow" — that rule would hand the
// same free pass to the 19 cookie-authed routes. The test that every /api/ route
// still refuses an unauthenticated caller is what keeps this exemption honest.
export const EXEMPT_PREFIX = '/api/';

// Apache serves the hub on the apex and on the www alias with no canonicalising
// redirect, so a visitor who lands on www stays there and every form post carries
// the www Origin. Both are derived from baseUrl so neither can drift out of an
// unversioned .env.
export function trustedOrigins(baseUrl) {
  const { protocol, host } = new URL(baseUrl);
  const bare = host.startsWith('www.') ? host.slice(4) : host;
  return [`${protocol}//${bare}`, `${protocol}//www.${bare}`];
}

// The message carries the offending origin for the logs; `public` is what the
// person who hit it sees. Without both, a refusal reaches the central error
// handler indistinguishable from a crash — logged as "unhandled error" and
// rendered as the generic 500 page.
function refuse(req, detail) {
  const err = new Error(`blocked cross-origin ${req.method} ${req.path} (${detail})`);
  err.status = 403;
  err.code = 'csrf_blocked';
  err.public = {
    title: 'Request refused',
    message:
      'That request did not come from Sprint Suite, so it was not carried out. ' +
      'Return to the site and try again.',
  };
  return err;
}

export function makeCsrfGuard({ allowedOrigins }) {
  const allowed = new Set(allowedOrigins);

  return function csrfGuard(req, _res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.path.startsWith(EXEMPT_PREFIX)) return next();

    const origin = req.headers.origin;
    if (origin !== undefined) {
      return allowed.has(origin) ? next() : next(refuse(req, origin));
    }

    // No Origin at all. Some browsers still omit it on same-origin form posts, so
    // accept the fetch-metadata equivalent — and only `same-origin`: `same-site`
    // would readmit every *.sprintsuite.uk host, which is the exact hole that
    // makes SameSite=Lax insufficient on its own.
    const site = req.headers['sec-fetch-site'];
    if (site === 'same-origin') return next();
    return next(refuse(req, site ? `sec-fetch-site: ${site}` : 'no origin, no fetch metadata'));
  };
}
