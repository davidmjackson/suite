// tests/security-headers.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makeSecurityHeaders, DEFAULT_CSP } from "../middleware/securityHeaders.js";
import { buildTestApp } from "./helpers.js";

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

test("headers are present on a real route response (landing /)", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["referrer-policy"], "strict-origin-when-cross-origin");
  assert.match(res.headers["content-security-policy"], /script-src 'self'/);
  assert.equal(res.headers["strict-transport-security"], "max-age=31536000; includeSubDomains");
  assert.match(res.headers["permissions-policy"], /camera=\(\)/);
});

test("form-action allows the app origins (launch + magic-link cross-origin redirects)", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  const csp = res.headers["content-security-policy"];
  // POST /launch/:app and POST /auth/magic 302-redirect into the app origins;
  // CSP form-action is enforced against redirect targets, so the app origins
  // must be allow-listed or the launch / magic-link sign-in is blocked.
  assert.match(csp, /form-action 'self'[^;]*https:\/\/sprintraid\.uk/);
  assert.match(csp, /form-action 'self'[^;]*https:\/\/sprintpoker\.uk/);
});

test("headers are present on a 404 (covers error responses)", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/no-such-path-xyz");
  assert.equal(res.status, 404);
  // Express's finalhandler sets its own CSP on unhandled 404s, but our other
  // headers (set before finalhandler runs) should still be present.
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.equal(res.headers["referrer-policy"], "strict-origin-when-cross-origin");
  assert.match(res.headers["permissions-policy"], /camera=\(\)/);
});
