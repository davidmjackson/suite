// tests/trust-proxy.test.js
// The hub sits behind Apache on 127.0.0.1, so it must trust the loopback proxy
// and read the client IP from X-Forwarded-For. Otherwise req.ip is always
// 127.0.0.1 and the per-IP login limiter degrades into a single global bucket
// (a self-DoS vector) and audit logs lose the real client IP.
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";

async function buildWithLogin() {
  const { app, db, config } = await buildTestApp();
  const { mountLogin } = await import("../routes/login.js?t=" + Date.now());
  mountLogin(app);
  return { app, db, config };
}

// Unique unknown emails per request so the per-email limiter (10/hr) never trips
// and only the per-IP limiter (5/min) is under test. Unknown emails send no mail
// and create no token, but still pass through both rate-limit checks.
test("login per-IP limit keys off X-Forwarded-For, not a shared global bucket", async () => {
  const { app } = await buildWithLogin();
  const ipA = "203.0.113.10";
  const ipB = "203.0.113.20";

  // 5 requests from ipA exhaust its bucket (max 5 / 60s).
  for (let i = 0; i < 5; i++) {
    const res = await request(app).post("/login").type("form")
      .set("X-Forwarded-For", ipA).send({ email: `a${i}@example.com` });
    assert.equal(res.status, 200, `ipA request ${i} should pass`);
  }
  // 6th from ipA is rate-limited.
  const sixth = await request(app).post("/login").type("form")
    .set("X-Forwarded-For", ipA).send({ email: "a5@example.com" });
  assert.equal(sixth.status, 429, "6th ipA request should be limited");

  // A different client (ipB) still gets through — proves per-IP bucketing.
  // Without trust proxy this would be 429 too (everything shares 127.0.0.1).
  const other = await request(app).post("/login").type("form")
    .set("X-Forwarded-For", ipB).send({ email: "b0@example.com" });
  assert.equal(other.status, 200, "different forwarded client should not be limited");
});
