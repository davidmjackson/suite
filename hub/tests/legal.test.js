// tests/legal.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";

async function buildWithLegal(env = {}) {
  const { app, db, config, marketing } = await buildTestApp({ env });
  const { mountLegal } = await import("../routes/legal.js?t=" + Date.now());
  mountLegal(app, { marketing });
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

test("GET /privacy renders the Data & Privacy Note (Version 1.1)", async () => {
  const { app } = await buildWithLegal();
  const res = await request(app).get("/privacy");
  assert.equal(res.status, 200);
  assert.match(res.text, /Data &amp; Privacy Note/);
  assert.match(res.text, /Version 1\.1/);
  assert.match(res.text, /David Jackson/);              // names the controller
  assert.match(res.text, /nirvanadesign@msn\.com/);     // real contact address
  assert.match(res.text, /Anthropic/);                  // discloses RAID AI processing
  assert.match(res.text, /href="\/license"/);           // links back to the licence
  assert.doesNotMatch(res.text, /being finalised/);     // not the stub
  assert.doesNotMatch(res.text, /\[[A-Z][^\]]*\]/);     // no leftover [BRACKET] placeholders
});

test("/privacy no longer claims it uses no analytics trackers (section 2)", async () => {
  const { app } = await buildWithLegal({ GA_MEASUREMENT_ID: "G-TEST123" });
  const res = await request(app).get("/privacy");
  // The v1.0 §2 line "We do not use advertising or analytics trackers" is false once
  // GA4 ships. The advertising half of the claim survives; the analytics half must not.
  assert.doesNotMatch(res.text, /not<\/strong> use advertising or analytics trackers/);
  assert.match(res.text, /not<\/strong> use advertising trackers/);
});

test("/privacy discloses Google Analytics accurately and drops the false claim", async () => {
  const { app } = await buildWithLegal({ GA_MEASUREMENT_ID: "G-TEST123" });
  const res = await request(app).get("/privacy");
  // The v1.0 promise that consent-gated GA4 makes false.
  assert.doesNotMatch(res.text, /there are no third-party tracking cookies/i);
  assert.match(res.text, /Google/, "Google is named as a processor");
  assert.match(res.text, /_ga/, "the actual cookies are named");
  assert.match(res.text, /ss_consent/, "the consent cookie is disclosed too");
  assert.match(res.text, /only .{0,20}(if|when) you (accept|consent)/i);
  assert.match(res.text, /data-consent-settings/, "withdrawal control is present");
});

test("no dead control: /privacy hides the withdraw button when analytics are off", async () => {
  // consent-banner.js (which owns the click listener) is not loaded when gaId is
  // null, so an ungated button would render dead. The surrounding prose stands on
  // its own — it describes the production service, so it must not dangle.
  const { app } = await buildWithLegal({ GA_MEASUREMENT_ID: "" });
  const res = await request(app).get("/privacy");
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.text, /data-consent-settings/);
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
