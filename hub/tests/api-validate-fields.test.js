// tests/api-validate-fields.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { z } from "zod";
import { buildTestApp } from "./helpers.js";
import { validate } from "../lib/validate.js";
import { makeErrorHandler } from "../middleware/errorHandler.js";

test("generic validate() -> central handler returns 400 JSON with fields for /api", async () => {
  const { app, config } = await buildTestApp();
  app.post("/api/demo", validate(z.object({ email: z.string().email() })), (req, res) => res.json({ ok: true }));
  app.use(makeErrorHandler({ logger: { error() {}, warn() {} }, nodeEnv: config.nodeEnv }));
  const res = await request(app).post("/api/demo").send({ email: "nope" });
  assert.equal(res.status, 400);
  assert.ok(res.body.fields.email);
});
