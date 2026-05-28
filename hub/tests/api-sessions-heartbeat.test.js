// tests/api-sessions-heartbeat.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";

async function setup() {
  const { app, db, config } = await buildTestApp();
  const { mountApiSessions } = await import("../routes/api-sessions.js?t=" + Date.now());
  mountApiSessions(app);
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 24 * 60 * 60 * 1000);
  return { app, db, sid };
}

test("heartbeat updates last_heartbeat_at and returns 200", async () => {
  const { app, db, sid } = await setup();
  const before = db.prepare("SELECT last_heartbeat_at FROM central_sessions WHERE id = ?").get(sid);
  await new Promise(r => setTimeout(r, 5));
  const res = await request(app)
    .post(`/api/sessions/${sid}/heartbeat`)
    .set("Authorization", "Bearer k-raid");
  assert.equal(res.status, 200);
  const after = db.prepare("SELECT last_heartbeat_at FROM central_sessions WHERE id = ?").get(sid);
  assert.ok(after.last_heartbeat_at > before.last_heartbeat_at);
});

test("heartbeat on unknown session returns 404", async () => {
  const { app } = await setup();
  const res = await request(app)
    .post(`/api/sessions/nope/heartbeat`)
    .set("Authorization", "Bearer k-raid");
  assert.equal(res.status, 404);
});

test("heartbeat on idle-expired session returns 404", async () => {
  const { app, db, sid } = await setup();
  const longAgo = now() - 60 * 60 * 1000;
  db.prepare("UPDATE central_sessions SET last_heartbeat_at = ? WHERE id = ?").run(longAgo, sid);
  const res = await request(app)
    .post(`/api/sessions/${sid}/heartbeat`)
    .set("Authorization", "Bearer k-raid");
  assert.equal(res.status, 404);
});

test("delete session removes row, future heartbeat returns 404", async () => {
  const { app, db, sid } = await setup();
  const del = await request(app)
    .delete(`/api/sessions/${sid}`)
    .set("Authorization", "Bearer k-raid");
  assert.equal(del.status, 204);
  const row = db.prepare("SELECT * FROM central_sessions WHERE id = ?").get(sid);
  assert.equal(row, undefined);
});
