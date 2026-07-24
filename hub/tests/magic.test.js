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

test("POST with a Sprintplan return_to bounces to the launch flow, not the dashboard", async () => {
  const { app, db } = await buildWithMagic();
  insertUser(db);
  const tok = randomToken();
  insertToken(db, tok, { returnTo: "https://sprintplan.uk/board/42" });

  const res = await request(app).post("/auth/magic").type("form").send({ token: tok });
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /^\/launch\/plan\?return_to=/);
});

/* The invariant that actually broke. login.js accepts a return_to for ANY domain
   in config.allowedAppDomains and stores it on the token; magic.js is what turns
   it back into a launch. So every domain the hub ACCEPTS must resolve to an app,
   or the user is silently dropped on /dashboard having asked for somewhere else —
   no error, nothing logged, nothing to see. sprintplan.uk was exactly that: an
   allowed return domain, absent from magic.js's own table.

   The domains are derived from config rather than listed here on purpose. A list
   in this file would be another copy of the same fact and could be just as wrong
   — the copy in launch.test.js is, which is why no test saw this. */
test("every allowed app domain resolves to a launch, so no accepted return_to is dropped", async () => {
  const { app, db, config } = await buildWithMagic();
  const domains = config.allowedAppDomains;
  assert.ok(domains.length >= 2, "the allowlist fixture must hold the real domains to guard anything");

  const resolved = new Map();
  for (const [i, domain] of domains.entries()) {
    const email = `u${i}@b.c`;
    insertUser(db, `u${i}`, email);
    const tok = randomToken();
    insertToken(db, tok, { email, returnTo: `${domain}/deep/link` });

    const res = await request(app).post("/auth/magic").type("form").send({ token: tok });
    assert.equal(res.status, 302);
    const launched = res.headers.location.match(/^\/launch\/([a-z]+)\?return_to=/);
    assert.ok(
      launched,
      `${domain} is an allowed return_to, but magic.js dropped it to ${res.headers.location}`
    );
    resolved.set(domain, launched[1]);
  }

  // ...and no two domains may resolve to the same app, which is what a mis-paired
  // entry looks like from out here — spotted without a registry to compare against.
  assert.equal(
    new Set(resolved.values()).size,
    resolved.size,
    `two domains resolve to one app: ${JSON.stringify([...resolved])}`
  );
});
