// tests/security-headers.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makeSecurityHeaders, DEFAULT_CSP, MARKETING_CSP, withAppDomains } from "../middleware/securityHeaders.js";
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

test("does not leak the X-Powered-By header", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
  assert.equal(res.headers["x-powered-by"], undefined);
});

test("serves robots.txt from public/ with 200", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/robots.txt");
  assert.equal(res.status, 200);
  assert.match(res.text, /User-agent: \*/);
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

// --- Marketing CSP (consent-gated GA4) -------------------------------------
test("MARKETING_CSP allows exactly the Google origins GA4 needs", () => {
  assert.match(MARKETING_CSP, /script-src 'self' https:\/\/www\.googletagmanager\.com/);
  assert.match(MARKETING_CSP, /img-src 'self' data: https:\/\/www\.google-analytics\.com/);
  assert.match(MARKETING_CSP, /connect-src 'self' https:\/\/www\.google-analytics\.com https:\/\/analytics\.google\.com/);
});

test("MARKETING_CSP keeps every other protection from the default", () => {
  assert.match(MARKETING_CSP, /frame-ancestors 'none'/);
  assert.match(MARKETING_CSP, /object-src 'none'/);
  assert.match(MARKETING_CSP, /base-uri 'self'/);
  // The invariant the whole design protects: no inline script, ever.
  assert.doesNotMatch(MARKETING_CSP, /script-src[^;]*unsafe-inline/);
});

test("DEFAULT_CSP is untouched — Google is not allowed on app pages", () => {
  assert.doesNotMatch(DEFAULT_CSP, /googletagmanager/);
  assert.doesNotMatch(DEFAULT_CSP, /google-analytics/);
});

test("withAppDomains adds the app origins to form-action in both policies", () => {
  const domains = ["https://sprintraid.uk", "https://sprintpoker.uk"];
  for (const [name, csp] of [["default", DEFAULT_CSP], ["marketing", MARKETING_CSP]]) {
    const out = withAppDomains(csp, domains);
    assert.match(
      out,
      /form-action 'self' https:\/\/sprintraid\.uk https:\/\/sprintpoker\.uk/,
      `${name} policy must carry the app domains — CSP form-action is enforced on redirect targets`
    );
  }
});

test("withAppDomains changes form-action only", () => {
  const out = withAppDomains(DEFAULT_CSP, ["https://x.uk"]);
  assert.equal(out.replace(" https://x.uk", ""), DEFAULT_CSP);
});
