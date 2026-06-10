// tests/security-headers.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSecurityHeaders, DEFAULT_CSP } from "../middleware/securityHeaders.js";

// Minimal res double that records setHeader calls.
function fakeRes() {
  const headers = {};
  return { setHeader: (k, v) => { headers[k] = v; }, headers };
}

test("sets the full default header block and calls next", () => {
  const mw = makeSecurityHeaders();
  const res = fakeRes();
  let nexted = false;
  mw({}, res, () => { nexted = true; });

  assert.equal(res.headers["Content-Security-Policy"], DEFAULT_CSP);
  assert.equal(res.headers["Strict-Transport-Security"], "max-age=31536000; includeSubDomains");
  assert.equal(res.headers["X-Frame-Options"], "DENY");
  assert.equal(res.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(res.headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(res.headers["Permissions-Policy"], "geolocation=(), camera=(), microphone=(), payment=()");
  assert.equal(nexted, true);
});

test("DEFAULT_CSP keeps script-src strict and styles inline", () => {
  assert.match(DEFAULT_CSP, /script-src 'self'(;|$)/);
  assert.match(DEFAULT_CSP, /style-src 'self' 'unsafe-inline'/);
  assert.match(DEFAULT_CSP, /frame-ancestors 'none'/);
  assert.match(DEFAULT_CSP, /object-src 'none'/);
  assert.doesNotMatch(DEFAULT_CSP, /script-src[^;]*unsafe-inline/);
});

test("contentSecurityPolicy override replaces the CSP value only", () => {
  const custom = "default-src 'self'; connect-src 'self' wss:";
  const mw = makeSecurityHeaders({ contentSecurityPolicy: custom });
  const res = fakeRes();
  mw({}, res, () => {});
  assert.equal(res.headers["Content-Security-Policy"], custom);
  // Other headers unchanged by the override.
  assert.equal(res.headers["X-Frame-Options"], "DENY");
});
