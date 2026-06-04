// tests/landing.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";

test("GET / (anon) renders the marketing page", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
});

test("GET / redirects an authenticated user to /dashboard", async () => {
  const { app, db } = await buildTestApp();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const res = await request(app).get("/").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "/dashboard");
});
