// tests/magic.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { randomToken, now } from "../lib/tokens.js";

async function buildWithMagic() {
  const { app, db, config } = await buildTestApp();
  const { mountMagic } = await import("../routes/magic.js?t=" + Date.now());
  mountMagic(app);
  return { app, db, config };
}

test("valid magic token logs the user in and 302s to dashboard", async () => {
  const { app, db } = await buildWithMagic();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const tok = randomToken();
  db.prepare(`INSERT INTO magic_link_tokens (token,email,return_to,created_at,expires_at) VALUES (?,?,?,?,?)`)
    .run(tok, "a@b.c", null, now(), now() + 60_000);
  const res = await request(app).get(`/auth/magic?token=${tok}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "/dashboard");
  assert.match(res.headers["set-cookie"][0], /^hub_session=/);
  const session = db.prepare("SELECT * FROM central_sessions").get();
  assert.equal(session.user_id, "u1");
  const consumed = db.prepare("SELECT consumed_at FROM magic_link_tokens WHERE token = ?").get(tok);
  assert.ok(consumed.consumed_at);
});

test("expired token renders error", async () => {
  const { app, db } = await buildWithMagic();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const tok = randomToken();
  db.prepare(`INSERT INTO magic_link_tokens (token,email,return_to,created_at,expires_at) VALUES (?,?,?,?,?)`)
    .run(tok, "a@b.c", null, now() - 60_000, now() - 1);
  const res = await request(app).get(`/auth/magic?token=${tok}`);
  assert.equal(res.status, 400);
  assert.match(res.text, /expired|already used/i);
});

test("already-consumed token is rejected", async () => {
  const { app, db } = await buildWithMagic();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const tok = randomToken();
  db.prepare(`INSERT INTO magic_link_tokens (token,email,return_to,created_at,expires_at,consumed_at) VALUES (?,?,?,?,?,?)`)
    .run(tok, "a@b.c", null, now(), now() + 60_000, now());
  const res = await request(app).get(`/auth/magic?token=${tok}`);
  assert.equal(res.status, 400);
});

test("return_to bounces to launch flow", async () => {
  const { app, db } = await buildWithMagic();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const tok = randomToken();
  db.prepare(`INSERT INTO magic_link_tokens (token,email,return_to,created_at,expires_at) VALUES (?,?,?,?,?)`)
    .run(tok, "a@b.c", "https://sprintraid.uk/some-page", now(), now() + 60_000);
  const res = await request(app).get(`/auth/magic?token=${tok}`);
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /\/launch\/raid\?return_to=/);
});
