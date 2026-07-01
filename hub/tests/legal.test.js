// tests/legal.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";

async function buildWithLegal() {
  const { app, db, config } = await buildTestApp();
  const { mountLegal } = await import("../routes/legal.js?t=" + Date.now());
  mountLegal(app);
  return { app, db, config };
}

for (const p of ["/terms"]) {
  test(`GET ${p} returns a coming-soon stub`, async () => {
    const { app } = await buildWithLegal();
    const res = await request(app).get(p);
    assert.equal(res.status, 200);
    assert.match(res.text, /Sprint Suite/);
    assert.match(res.text, /being finalised/);
  });
}

test("GET /privacy renders the Data & Privacy Note (Version 1.0)", async () => {
  const { app } = await buildWithLegal();
  const res = await request(app).get("/privacy");
  assert.equal(res.status, 200);
  assert.match(res.text, /Data &amp; Privacy Note/);
  assert.match(res.text, /Version 1\.0/);
  assert.match(res.text, /David Jackson/);              // names the controller
  assert.match(res.text, /nirvanadesign@msn\.com/);     // real contact address
  assert.match(res.text, /Anthropic/);                  // discloses RAID AI processing
  assert.match(res.text, /href="\/license"/);           // links back to the licence
  assert.doesNotMatch(res.text, /being finalised/);     // not the stub
  assert.doesNotMatch(res.text, /\[[A-Z][^\]]*\]/);     // no leftover [BRACKET] placeholders
});

test("GET /license renders the Free Use Licence (Version 1.0)", async () => {
  const { app } = await buildWithLegal();
  const res = await request(app).get("/license");
  assert.equal(res.status, 200);
  assert.match(res.text, /Free Use Licence/);
  assert.match(res.text, /Version 1\.0/);
  assert.match(res.text, /Grant of licence/);
  assert.match(res.text, /Limitation of liability/);
  assert.match(res.text, /England and Wales/);
  assert.match(res.text, /href="\/privacy"/);          // links to the privacy note
  assert.doesNotMatch(res.text, /being finalised/);     // not the stub
  assert.doesNotMatch(res.text, /\[[A-Z][^\]]*\]/);     // no leftover [BRACKET] placeholders
});
