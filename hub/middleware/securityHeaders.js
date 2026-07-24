// middleware/securityHeaders.js
// Pure, static HTTP security headers set on every response. Mounted early in
// server.js (and mirrored in tests/helpers.js) so it covers static assets and
// error responses too. See docs/superpowers/specs/2026-06-10-suite-security-headers-design.md.

export const DEFAULT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

// The public marketing pages (/, /request, /privacy) may load Google Analytics —
// but only once the visitor has explicitly accepted (lib/consent.js). CSP is a
// ceiling, not a trigger: this policy is constant on those routes, while whether
// the tag renders at all is decided by consent. Deliberately NOT applied to
// /dashboard, /admin, /company or the API, which keep DEFAULT_CSP.
//
// Wildcards, not bare hosts: gtag.js does not always talk to
// www.google-analytics.com. For EEA/UK visitors it routes the collection
// beacon through a regional subdomain instead — e.g.
// https://region1.google-analytics.com/g/collect — to keep data in-region.
// Bare `https://www.google-analytics.com` does NOT match that, so it would
// fail CSP silently: the consent bar and cookie still work, but the beacon
// never reaches Google and the property stays empty. Google's own docs
// prescribe the `https://*.google-analytics.com` / `https://*.googletagmanager.com`
// wildcards for exactly this reason — do not "tidy" these back to exact hosts.
export const MARKETING_CSP = DEFAULT_CSP.replace(
  "script-src 'self'",
  "script-src 'self' https://*.googletagmanager.com",
)
  .replace(
    "img-src 'self' data:",
    "img-src 'self' data: https://*.google-analytics.com https://*.googletagmanager.com",
  )
  .replace(
    "connect-src 'self'",
    "connect-src 'self' https://*.google-analytics.com https://*.googletagmanager.com",
  );

// CSP form-action is enforced against redirect TARGETS, not just the initial
// action: POST /launch/:app and POST /auth/magic 302 cross-origin into the apps,
// so both policies must carry the app origins or those posts break. Deriving both
// through this one helper is what stops them drifting apart.
export function withAppDomains(csp, appDomains) {
  return csp.replace("form-action 'self'", `form-action 'self' ${appDomains.join(' ')}`);
}

export function makeSecurityHeaders({ contentSecurityPolicy = DEFAULT_CSP } = {}) {
  return function securityHeaders(_req, res, next) {
    res.setHeader('Content-Security-Policy', contentSecurityPolicy);
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
    next();
  };
}
