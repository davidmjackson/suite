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
].join("; ");

export function makeSecurityHeaders({ contentSecurityPolicy = DEFAULT_CSP } = {}) {
  return function securityHeaders(_req, res, next) {
    res.setHeader("Content-Security-Policy", contentSecurityPolicy);
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=()");
    next();
  };
}
