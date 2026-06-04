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
  assert.match(res.text, /Sign in/);
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

test("GET / renders landing (not redirect) for a stale/idle session", async () => {
  const { app, db } = await buildTestApp();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "c@d.e", now());
  const sid = randomToken();
  const stale = now() - 31 * 60 * 1000; // older than the 30-min idle cutoff
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u2", now(), stale, now() + 60_000);
  const res = await request(app).get("/").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 200);
});

test("GET / renders landing (not redirect) for a disabled user's session", async () => {
  const { app, db } = await buildTestApp();
  db.prepare("INSERT INTO users (id,email,created_at,disabled_at) VALUES (?,?,?,?)").run("u3", "f@g.h", now(), now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u3", now(), now(), now() + 60_000);
  const res = await request(app).get("/").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 200);
});

test("landing head carries SEO essentials", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.match(res.text, /<link rel="canonical" href="https:\/\/sprintsuite\.uk\/">/);
  assert.match(res.text, /property="og:title"/);
  assert.match(res.text, /"@type"\s*:\s*"SoftwareApplication"/);
  assert.match(res.text, /<link rel="stylesheet" href="\/css\/landing\.css">/);
});

test("landing has exactly one h1 and a sign-in CTA to /login", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  const h1s = res.text.match(/<h1[\s>]/g) || [];
  assert.equal(h1s.length, 1, "exactly one <h1>");
  assert.match(res.text, /Agile tools for teams that ship/);
  assert.match(res.text, /href="\/login"[^>]*>\s*Sign in to get started/);
});

test("landing wires the hero trace module and respects reduced motion", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.match(res.text, /<script type="module" src="\/js\/landing-hero\.js">/);
  assert.match(res.text, /<g class="waves-drift" id="scope">/);
  const css = await request(app).get("/css/instrument-core.css");
  assert.match(css.text, /prefers-reduced-motion/);
});

test("landing shows the four trust items", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.match(res.text, /Passwordless sign-in/);
  assert.match(res.text, /Anonymous health checks/);
  assert.match(res.text, /Exports to Jira, CSV &amp; Markdown/);
  assert.match(res.text, /No tracking, no clutter/);
});

test("app grid shows four cards all linking to /login", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  for (const name of ["Sprintraid", "Sprintsignal", "Sprintretro", "Sprintpoker"]) {
    assert.match(res.text, new RegExp(name));
  }
  const cardLinks = (res.text.match(/class="appcard"[^>]*href="\/login"/g) || []);
  assert.equal(cardLinks.length, 4, "four app cards link to /login");
});

test("feature rows carry the SEO payload terms and real alt text", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  for (const term of ["RAID log", "team health check", "retrospective", "scrum poker"]) {
    assert.match(res.text, new RegExp(term, "i"));
  }
  assert.match(res.text, /alt="Sprintraid RAID log with risks, assumptions, issues and a flagged dependency conflict"/);
  assert.doesNotMatch(res.text, /data:image\//, "no base64 images in production template");
});
