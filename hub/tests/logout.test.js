// tests/logout.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";

async function setup() {
  const { app, db, config } = await buildTestApp();
  const { mountLogout } = await import("../routes/logout.js?t=" + Date.now());
  mountLogout(app);
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  return { app, db, sid };
}

test("GET /logout clears central session and cookie, redirects to /", async () => {
  const { app, db, sid } = await setup();
  const res = await request(app).get("/logout").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "/");
  assert.match(res.headers["set-cookie"][0], /Max-Age=0/);
  const row = db.prepare("SELECT * FROM central_sessions WHERE id = ?").get(sid);
  assert.equal(row, undefined);
});
