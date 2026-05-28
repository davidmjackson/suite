// tests/api-sessions-exchange.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";

async function buildWithApi() {
  const { app, db, config } = await buildTestApp();
  const { mountApiSessions } = await import("../routes/api-sessions.js?t=" + Date.now());
  mountApiSessions(app);
  return { app, db, config };
}

test("rejects request without bearer key", async () => {
  const { app } = await buildWithApi();
  const res = await request(app).post("/api/sessions/exchange").send({ launch_token: "x" });
  assert.equal(res.status, 401);
});

test("exchanges valid launch token for session info", async () => {
  const { app, db } = await buildWithApi();
  db.prepare("INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)")
    .run("u1", "a@b.c", "Alice", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const tok = randomToken();
  db.prepare("INSERT INTO launch_tokens (token,central_session_id,target_app,created_at,expires_at) VALUES (?,?,?,?,?)")
    .run(tok, sid, "raid", now(), now() + 30_000);

  const res = await request(app)
    .post("/api/sessions/exchange")
    .set("Authorization", "Bearer k-raid")
    .send({ launch_token: tok });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.user, { id: "u1", email: "a@b.c", displayName: "Alice" });
  assert.equal(res.body.central_session_id, sid);

  const consumed = db.prepare("SELECT consumed_at FROM launch_tokens WHERE token = ?").get(tok);
  assert.ok(consumed.consumed_at);
});

test("rejects token addressed to a different app", async () => {
  const { app, db } = await buildWithApi();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const tok = randomToken();
  db.prepare("INSERT INTO launch_tokens (token,central_session_id,target_app,created_at,expires_at) VALUES (?,?,?,?,?)")
    .run(tok, sid, "raid", now(), now() + 30_000);

  const res = await request(app)
    .post("/api/sessions/exchange")
    .set("Authorization", "Bearer k-signal")
    .send({ launch_token: tok });

  assert.equal(res.status, 403);
});

test("rejects already-consumed token", async () => {
  const { app, db } = await buildWithApi();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const tok = randomToken();
  db.prepare("INSERT INTO launch_tokens (token,central_session_id,target_app,created_at,expires_at,consumed_at) VALUES (?,?,?,?,?,?)")
    .run(tok, sid, "raid", now(), now() + 30_000, now());

  const res = await request(app)
    .post("/api/sessions/exchange")
    .set("Authorization", "Bearer k-raid")
    .send({ launch_token: tok });

  assert.equal(res.status, 400);
});
