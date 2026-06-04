// tests/legal.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";

async function buildWithLegal() {
  const { app, db, config } = await buildTestApp();
  const { mountLegal } = await import("../routes/legal.js?t=" + Date.now());
  mountLegal(app);
  return { app, db, config };
}

for (const p of ["/privacy", "/terms", "/license"]) {
  test(`GET ${p} returns 200`, async () => {
    const { app } = await buildWithLegal();
    const res = await request(app).get(p);
    assert.equal(res.status, 200);
    assert.match(res.text, /Sprint Suite/);
    assert.match(res.text, /being finalised/);
  });
}
