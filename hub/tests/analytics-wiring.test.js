// tests/analytics-wiring.test.js
// The gate: Google must be reachable from the page only when consent is granted,
// and only on the public pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";

const GA = { GA_MEASUREMENT_ID: "G-TEST123" };
const OFF = { GA_MEASUREMENT_ID: "" };

async function withRoutes(env) {
  const { app, db, config, marketing } = await buildTestApp({ env });
  const { mountRequest } = await import("../routes/request.js?t=" + Date.now());
  const { mountLegal } = await import("../routes/legal.js?t=" + Date.now());
  const { mountDashboard } = await import("../routes/dashboard.js?t=" + Date.now());
  mountRequest(app, { marketing });
  mountLegal(app, { marketing });
  mountDashboard(app);
  return { app, db, config };
}

test("no choice yet: the bar is wired but Google is never referenced", async () => {
  const { app } = await withRoutes(GA);
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.text, /googletagmanager/, "no Google reference before consent");
  assert.match(res.text, /src="\/js\/consent-banner\.js"/);
  assert.match(res.text, /data-ga-id="G-TEST123"/);
  assert.match(res.text, /data-consent=""/, "empty means: ask");
});

test("granted: state reaches the client so the banner can load GA", async () => {
  const { app } = await withRoutes(GA);
  const res = await request(app).get("/").set("Cookie", "ss_consent=granted");
  assert.match(res.text, /data-consent="granted"/);
});

test("denied: state reaches the client and stays denied", async () => {
  const { app } = await withRoutes(GA);
  const res = await request(app).get("/").set("Cookie", "ss_consent=denied");
  assert.match(res.text, /data-consent="denied"/);
  assert.doesNotMatch(res.text, /googletagmanager/);
});

test("a tampered cookie re-asks rather than failing open", async () => {
  const { app } = await withRoutes(GA);
  const res = await request(app).get("/").set("Cookie", "ss_consent=GRANTED");
  assert.match(res.text, /data-consent=""/);
});

test("kill switch: no GA_MEASUREMENT_ID means no banner, no stylesheet, no script", async () => {
  const { app } = await withRoutes(OFF);
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.text, /consent-banner\.js/);
  assert.doesNotMatch(res.text, /consent\.css/);
  assert.doesNotMatch(res.text, /googletagmanager/);
});

test("every public page carries the bar", async () => {
  const { app } = await withRoutes(GA);
  for (const p of ["/", "/request", "/privacy"]) {
    const res = await request(app).get(p);
    assert.equal(res.status, 200, `${p} renders`);
    assert.match(res.text, /consent-banner\.js/, `${p} wires the consent bar`);
  }
});

test("the 400-invalid re-render keeps the bar (the res.locals regression guard)", async () => {
  const { app } = await withRoutes(GA);
  const res = await request(app).post("/request").type("form").send({ company_name: "", email: "nope" });
  assert.equal(res.status, 400);
  assert.match(res.text, /consent-banner\.js/, "validation-error page is a live public page too");
});

test("POST /request success renders request-received with the bar", async () => {
  const { app } = await withRoutes(GA);
  const res = await request(app).post("/request").type("form").send({
    company_name: "Acme", contact_name: "A Person", email: "a@example.com",
  });
  assert.equal(res.status, 200);
  assert.match(res.text, /consent-banner\.js/);
});

test("analytics never leak past the login door", async () => {
  const { app, db } = await withRoutes(GA);
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u9", "z@z.z", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u9", now(), now(), now() + 60_000);

  const res = await request(app).get("/dashboard").set("Cookie", `hub_session=${sid}; ss_consent=granted`);
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.text, /consent-banner\.js/, "no bar on signed-in pages");
  assert.doesNotMatch(res.text, /googletagmanager/, "Google never sees signed-in usage");
});

test("/license and /terms stay inert — no analytics, so no bar", async () => {
  const { app } = await withRoutes(GA);
  for (const p of ["/license", "/terms"]) {
    const res = await request(app).get(p);
    assert.doesNotMatch(res.text, /consent-banner\.js/, `${p} carries no analytics`);
  }
});

test("CSP: public pages allow Google, app pages do not", async () => {
  const { app, db } = await withRoutes(GA);
  for (const p of ["/", "/request", "/privacy"]) {
    const res = await request(app).get(p);
    assert.match(res.headers["content-security-policy"], /googletagmanager/, `${p} allows GA`);
  }
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u8", "y@y.y", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u8", now(), now(), now() + 60_000);
  const dash = await request(app).get("/dashboard").set("Cookie", `hub_session=${sid}`);
  assert.doesNotMatch(dash.headers["content-security-policy"], /googletagmanager/, "app pages stay strict");
});

test("CSP: form-action app domains survive on the marketing policy", async () => {
  const { app } = await withRoutes(GA);
  const res = await request(app).get("/");
  assert.match(res.headers["content-security-policy"], /form-action 'self' https:\/\/sprintraid\.uk/);
});
