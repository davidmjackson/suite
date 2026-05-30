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

test("exchange includes an entitlement block scoped to the target app", async () => {
  const { app, db } = await buildWithApi();
  db.prepare("INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)")
    .run("u1", "a@b.c", "Alice", now());
  // grant raid to the user, unlimited
  const { createEntitlements } = await import("../lib/entitlements.js?t=" + Date.now());
  createEntitlements(db).grantEntitlement({ app: "raid", principalType: "user", principalId: "u1" });

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
  assert.equal(res.body.entitlement.entitled, true);
  assert.deepEqual(res.body.entitlement.principal, { type: "user", id: "u1" });
  assert.equal(res.body.entitlement.quota, null);
});

test("exchange returns entitled:false when the user has no grant for the app", async () => {
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
    .set("Authorization", "Bearer k-raid")
    .send({ launch_token: tok });

  assert.equal(res.status, 200);
  assert.equal(res.body.entitlement.entitled, false);
});

test("exchange returns the user's teams scoped to the per-company entitled app", async () => {
  const { app, db } = await buildWithApi();
  db.prepare("INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)")
    .run("u1", "a@b.c", "Alice", now());
  const { createEntitlements } = await import("../lib/entitlements.js?t=" + Date.now());
  const { createOrg } = await import("../lib/org.js?t=" + Date.now());
  const org = createOrg(db);
  const co = org.createCompany({ name: "Acme", slug: "acme" });
  org.addCompanyMember({ userId: "u1", companyId: co.id, role: "owner" });
  const team = org.createTeam({ companyId: co.id, name: "Alpha" });
  org.addTeamMember({ userId: "u1", teamId: team.id, role: "lead" });
  createEntitlements(db).grantEntitlement({ app: "poker", principalType: "company", principalId: co.id });

  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const tok = randomToken();
  db.prepare("INSERT INTO launch_tokens (token,central_session_id,target_app,created_at,expires_at) VALUES (?,?,?,?,?)")
    .run(tok, sid, "poker", now(), now() + 30_000);

  const res = await request(app)
    .post("/api/sessions/exchange")
    .set("Authorization", "Bearer k-poker")
    .send({ launch_token: tok });

  assert.equal(res.status, 200);
  assert.equal(res.body.entitlement.entitled, true);
  assert.deepEqual(res.body.teams, [{ id: team.id, name: "Alpha", role: "lead" }]);
});

test("exchange returns teams:[] when not entitled or principal is not a company", async () => {
  const { app, db } = await buildWithApi();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const tok = randomToken();
  db.prepare("INSERT INTO launch_tokens (token,central_session_id,target_app,created_at,expires_at) VALUES (?,?,?,?,?)")
    .run(tok, sid, "poker", now(), now() + 30_000);

  const res = await request(app)
    .post("/api/sessions/exchange")
    .set("Authorization", "Bearer k-poker")
    .send({ launch_token: tok });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.teams, []);
});
