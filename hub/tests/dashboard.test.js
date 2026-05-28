// tests/dashboard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";

async function buildWithDashboard() {
  const { app, db, config } = await buildTestApp();
  const { mountDashboard } = await import("../routes/dashboard.js?t=" + Date.now());
  mountDashboard(app);
  return { app, db, config };
}

test("logged-out user is redirected to /login", async () => {
  const { app } = await buildWithDashboard();
  const res = await request(app).get("/dashboard");
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /\/login/);
});

test("logged-in user sees four tiles", async () => {
  const { app, db } = await buildWithDashboard();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const res = await request(app).get("/dashboard").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /Sprintraid/);
  assert.match(res.text, /Sprintsignal/);
  assert.match(res.text, /Sprintretro/);
  assert.match(res.text, /Sprintpoker/);
});
