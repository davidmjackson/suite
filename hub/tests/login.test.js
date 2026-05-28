// tests/login.test.js
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

test("GET /login renders the email form", async () => {
  const { app } = await buildWithLogin();
  const res = await request(app).get("/login");
  assert.equal(res.status, 200);
  assert.match(res.text, /Sign in to Sprint Suite/);
  assert.match(res.text, /name="email"/);
});

test("POST /login with unknown email still renders check-email (no leak)", async () => {
  const { app, db } = await buildWithLogin();
  const res = await request(app).post("/login").type("form").send({ email: "unknown@test.com.com" });
  assert.equal(res.status, 200);
  assert.match(res.text, /Check your email/);
  const tokens = db.prepare("SELECT COUNT(*) AS c FROM magic_link_tokens").get();
  assert.equal(tokens.c, 0, "no token should be created for unknown email");
});

test("POST /login with known email creates a token", async () => {
  const { app, db } = await buildWithLogin();
  db.prepare("INSERT INTO users (id, email, created_at) VALUES (?,?,?)").run("u1", "known@test.com", Date.now());
  const res = await request(app).post("/login").type("form").send({ email: "known@test.com" });
  assert.equal(res.status, 200);
  const tokens = db.prepare("SELECT * FROM magic_link_tokens").all();
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].email, "known@test.com");
});
