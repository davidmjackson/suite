// tests/admin-users.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";

async function setup({ isAdmin = true } = {}) {
  const { app, db, config } = await buildTestApp();
  const { mountAdmin } = await import("../routes/admin.js?t=" + Date.now());
  mountAdmin(app);
  db.prepare("INSERT INTO users (id,email,display_name,is_admin,created_at) VALUES (?,?,?,?,?)")
    .run("admin1", "admin@test", "Admin", isAdmin ? 1 : 0, now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "admin1", now(), now(), now() + 60_000);
  return { app, db, sid };
}

test("non-admin gets 403", async () => {
  const { app, sid } = await setup({ isAdmin: false });
  const res = await request(app).get("/admin").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 403);
});

test("admin lists users", async () => {
  const { app, db, sid } = await setup();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "other@test", now());
  const res = await request(app).get("/admin").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /admin@test/);
  assert.match(res.text, /other@test/);
});

test("POST /admin/users creates a user", async () => {
  const { app, db, sid } = await setup();
  const res = await request(app)
    .post("/admin/users").type("form")
    .set("Cookie", `hub_session=${sid}`)
    .send({ email: "new@test.com", display_name: "New" });
  assert.equal(res.status, 302);
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get("new@test.com");
  assert.equal(row.display_name, "New");
});

test("POST /admin/users/:id/disable kills all their sessions", async () => {
  const { app, db, sid } = await setup();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "victim@test", now());
  const vsid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(vsid, "u2", now(), now(), now() + 60_000);
  const res = await request(app).post("/admin/users/u2/disable").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 302);
  const sess = db.prepare("SELECT * FROM central_sessions WHERE user_id = ?").all("u2");
  assert.equal(sess.length, 0);
  const u = db.prepare("SELECT disabled_at FROM users WHERE id = ?").get("u2");
  assert.ok(u.disabled_at);
});
