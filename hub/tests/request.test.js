// tests/request.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";

async function setup() {
  const { app, db } = await buildTestApp();
  const { mountRequest } = await import("../routes/request.js?t=" + Date.now());
  mountRequest(app, {});
  return { app, db };
}

test("GET /request renders the form", async () => {
  const { app } = await setup();
  const res = await request(app).get("/request");
  assert.equal(res.status, 200);
  assert.match(res.text, /company_name/);
  assert.match(res.text, /Request access/);
});

test("POST /request stores a pending request", async () => {
  const { app, db } = await setup();
  const res = await request(app).post("/request").type("form").send({
    company_name: "IBM", contact_name: "James", email: "james@ibm.com",
    job_title: "Scrum Master", team_size: "11-50", apps: ["poker", "retro"], message: "hi",
  });
  assert.equal(res.status, 200);
  assert.match(res.text, /received/i);
  const row = db.prepare("SELECT * FROM access_requests WHERE email=?").get("james@ibm.com");
  assert.equal(row.company_name, "IBM");
  assert.equal(row.status, "pending");
  assert.equal(JSON.parse(row.apps_interest).length, 2);
});

test("POST /request rejects an invalid email with 400 and stores nothing", async () => {
  const { app, db } = await setup();
  const res = await request(app).post("/request").type("form").send({
    company_name: "IBM", contact_name: "James", email: "not-an-email",
  });
  assert.equal(res.status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM access_requests").get().n, 0);
});

test("POST /request silently drops bot submissions (honeypot filled)", async () => {
  const { app, db } = await setup();
  const res = await request(app).post("/request").type("form").send({
    company_name: "IBM", contact_name: "James", email: "james@ibm.com", website: "http://spam",
  });
  assert.equal(res.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM access_requests").get().n, 0);
});

test("POST /request rate-limits a flood from one IP", async () => {
  const { app } = await setup();
  let last;
  for (let i = 0; i < 7; i++) {
    last = await request(app).post("/request").type("form").send({
      company_name: "C" + i, contact_name: "x", email: `x${i}@c.com`,
    });
  }
  assert.equal(last.status, 429);
});

test("POST /request with a bad email re-renders with entered values restored", async () => {
  const { app } = await setup();
  const res = await request(app).post("/request").type("form").send({
    company_name: "IBM", contact_name: "James", email: "bad", team_size: "11-50",
    apps: ["poker", "signal"], message: "keep me",
  });
  assert.equal(res.status, 400);
  assert.match(res.text, /value="IBM"/);
  assert.match(res.text, /value="11-50" selected/);
  assert.match(res.text, /value="poker" checked/);
  assert.match(res.text, /keep me/);
});

test("request form uses Instrument fields, select, checks and textarea", async () => {
  const { app } = await setup();
  const res = await request(app).get("/request");
  assert.equal(res.status, 200);
  assert.match(res.text, /class="field"/);
  assert.match(res.text, /class="checks"/);
  assert.match(res.text, /<select class="input" name="team_size"/);
  assert.match(res.text, /<textarea class="input" name="message"/);
  assert.match(res.text, /name="website"/); // honeypot preserved
});
