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

function insertUser(db, id = "u1", email = "a@b.c") {
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run(id, email, now());
}

function insertToken(db, tok, { email = "a@b.c", returnTo = null, expiresAt = now() + 60_000, consumedAt = null } = {}) {
  db.prepare(`INSERT INTO magic_link_tokens (token,email,return_to,created_at,expires_at,consumed_at) VALUES (?,?,?,?,?,?)`)
    .run(tok, email, returnTo, now(), expiresAt, consumedAt);
}

// --- GET is side-effect-free: it must NOT consume the token or create a session.
// This is what defeats mailbox link-scanners (e.g. Microsoft Safe Links) that
// blindly GET every URL in an email.

test("GET with valid token renders a confirm page and does NOT consume the token", async () => {
  const { app, db } = await buildWithMagic();
  insertUser(db);
  const tok = randomToken();
  insertToken(db, tok);

  const res = await request(app).get(`/auth/magic?token=${tok}`);

  assert.equal(res.status, 200);
  // page must contain a form that POSTs back with the token
  assert.match(res.text, /<form[^>]*method=["']?post["']?/i);
  assert.match(res.text, new RegExp(`name=["']?token["']?[^>]*value=["']?${tok}`, "i"));
  // token still unconsumed, no session created
  assert.equal(db.prepare("SELECT consumed_at FROM magic_link_tokens WHERE token = ?").get(tok).consumed_at, null);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM central_sessions").get().c, 0);
  assert.equal(res.headers["set-cookie"], undefined);
});

test("GET with expired token renders error (no confirm form)", async () => {
  const { app, db } = await buildWithMagic();
  insertUser(db);
  const tok = randomToken();
  insertToken(db, tok, { expiresAt: now() - 1 });

  const res = await request(app).get(`/auth/magic?token=${tok}`);
  assert.equal(res.status, 400);
  assert.match(res.text, /expired|already used/i);
});

test("GET with already-consumed token renders error", async () => {
  const { app, db } = await buildWithMagic();
  insertUser(db);
  const tok = randomToken();
  insertToken(db, tok, { consumedAt: now() });

  const res = await request(app).get(`/auth/magic?token=${tok}`);
  assert.equal(res.status, 400);
  assert.match(res.text, /expired|already used/i);
});

// --- POST performs the actual login: consume token + create session.

test("POST with valid token logs the user in and 302s to dashboard", async () => {
  const { app, db } = await buildWithMagic();
  insertUser(db);
  const tok = randomToken();
  insertToken(db, tok);

  const res = await request(app).post("/auth/magic").type("form").send({ token: tok });

  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "/dashboard");
  assert.match(res.headers["set-cookie"][0], /^hub_session=/);
  assert.equal(db.prepare("SELECT user_id FROM central_sessions").get().user_id, "u1");
  assert.ok(db.prepare("SELECT consumed_at FROM magic_link_tokens WHERE token = ?").get(tok).consumed_at);
});

test("POST is single-use: a second POST with the same token is rejected", async () => {
  const { app, db } = await buildWithMagic();
  insertUser(db);
  const tok = randomToken();
  insertToken(db, tok);

  const first = await request(app).post("/auth/magic").type("form").send({ token: tok });
  assert.equal(first.status, 302);
  const second = await request(app).post("/auth/magic").type("form").send({ token: tok });
  assert.equal(second.status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM central_sessions").get().c, 1);
});

test("POST with expired token is rejected", async () => {
  const { app, db } = await buildWithMagic();
  insertUser(db);
  const tok = randomToken();
  insertToken(db, tok, { expiresAt: now() - 1 });

  const res = await request(app).post("/auth/magic").type("form").send({ token: tok });
  assert.equal(res.status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM central_sessions").get().c, 0);
});

test("POST with missing token is rejected", async () => {
  const { app } = await buildWithMagic();
  const res = await request(app).post("/auth/magic").type("form").send({});
  assert.equal(res.status, 400);
});

test("POST with return_to bounces to the launch flow", async () => {
  const { app, db } = await buildWithMagic();
  insertUser(db);
  const tok = randomToken();
  insertToken(db, tok, { returnTo: "https://sprintraid.uk/some-page" });

  const res = await request(app).post("/auth/magic").type("form").send({ token: tok });
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /\/launch\/raid\?return_to=/);
});
