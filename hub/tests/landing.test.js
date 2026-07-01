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
  assert.match(res.text, /<h1>Your agile toolkit, one login\.<\/h1>/);
  assert.match(res.text, /href="\/login"[^>]*>\s*Sign in\s*</);
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

test("app grid shows five non-clickable info cards", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  for (const name of ["Sprintraid", "Sprintsignal", "Sprintretro", "Sprintpoker", "Sprintplan"]) {
    assert.match(res.text, new RegExp(name));
  }
  // tiles are informational ("spider food"), not links — the two CTAs carry navigation
  const cardLinks = (res.text.match(/class="appcard"[^>]*href=/g) || []);
  assert.equal(cardLinks.length, 0, "no app cards are links");
});

test("FAQ frames access via register-your-interest and the closing CTA links to /login", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  // access framing: how to get in, then the honest usage limit, no "free" promise
  assert.match(res.text, /How do I get access\?<\/h3><p>Register your interest/);
  assert.match(res.text, /not unlimited/i);
  assert.doesNotMatch(res.text, /free/i);
  assert.match(res.text, /class="close"[\s\S]*href="\/login"/);
});

test("feature rows carry the SEO payload terms and real alt text", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  for (const term of ["RAID log", "team health check", "retrospective", "scrum poker"]) {
    assert.match(res.text, new RegExp(term, "i"));
  }
  for (const alt of [
    "Sprintraid RAID log with risks, assumptions, issues and a flagged dependency conflict",
    "Sprintsignal health check radar chart and focus areas",
    "Sprintretro Start Stop Continue board with stat cards and timer",
    "Sprintpoker estimation room with face-up and face-down cards",
  ]) {
    assert.ok(res.text.includes(`alt="${alt}"`), `alt present: ${alt}`);
  }
  assert.doesNotMatch(res.text, /data:image\//, "no base64 images in production template");
});

test("footer Apps links point to /login and legal links resolve", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  const footer = res.text.slice(res.text.indexOf('class="lp-footer"'));
  const appLinks = (footer.match(/href="\/login"/g) || []);
  assert.ok(appLinks.length >= 4, "four Apps links to /login in footer");
  assert.match(footer, /href="\/privacy"/);
  assert.match(footer, /href="\/terms"/);
  assert.match(footer, /href="\/license"/);
  assert.match(footer, /href="#features"/);
  assert.match(footer, /href="#faq"/);
});

test("landing offers a Register your interest path to /request for new businesses", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  // visible primary-journey CTA for cold prospects, in hero + closing card
  assert.match(res.text, /href="\/request"[^>]*>\s*Register your interest\s*</);
  // present at the hero, the closing CTA, and the footer
  const reqLinks = (res.text.match(/href="\/request"/g) || []);
  assert.ok(reqLinks.length >= 3, `expected /request in hero, closing CTA and footer; saw ${reqLinks.length}`);
});
