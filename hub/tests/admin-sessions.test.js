// tests/admin-sessions.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";

async function setup() {
  const { app, db, config } = await buildTestApp();
  const { mountAdmin } = await import("../routes/admin.js?t=" + Date.now());
  mountAdmin(app);
  db.prepare("INSERT INTO users (id,email,is_admin,created_at) VALUES (?,?,?,?)").run("admin1", "admin@test", 1, now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "admin1", now(), now(), now() + 60_000);
  return { app, db, sid };
}

test("GET /admin/sessions lists active sessions", async () => {
  const { app, sid } = await setup();
  const res = await request(app).get("/admin/sessions").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /admin@test/);
});

test("kill session removes it", async () => {
  const { app, db, sid } = await setup();
  const otherSid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(otherSid, "admin1", now(), now(), now() + 60_000);
  const res = await request(app).post(`/admin/sessions/${otherSid}/kill`).set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 302);
  const row = db.prepare("SELECT * FROM central_sessions WHERE id = ?").get(otherSid);
  assert.equal(row, undefined);
});

test("GET /admin/audit lists events", async () => {
  const { app, db, sid } = await setup();
  db.prepare("INSERT INTO audit_events (user_id,event_type,created_at) VALUES (?,?,?)").run("admin1", "test_event", now());
  const res = await request(app).get("/admin/audit").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /test_event/);
});
