import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { mountLogin } from "../routes/login.js";

// A throwing email sender exercises the catch block (best-effort logging path).
const throwingSender = {
  async sendMagicLink() { throw new Error("smtp down"); },
};

test("login still succeeds when the magic-link email send throws", async () => {
  const { app, db } = await buildTestApp();
  // Insert shape mirrors tests/login.test.js (users.id is a required column).
  db.prepare("INSERT INTO users (id, email, created_at) VALUES (?,?,?)").run("u1", "known@test.com", Date.now());
  mountLogin(app, { emailSender: throwingSender });
  // The magic-link send only fires for an existing user, so this hits the catch.
  const res = await request(app).post("/login").type("form").send({ email: "known@test.com" });
  // Existing behaviour: always render check-email (no user enumeration), 200.
  assert.equal(res.status, 200);
  assert.ok(res.text.length > 0);
});
