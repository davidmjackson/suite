import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";

// The shared header partial (used by every app sub-page: login, dashboard,
// legal, request, …) must ship the Instrument chrome. `/` is no longer a
// representative example — it is the standalone landing front door with its own
// page-specific stylesheet (covered by landing.test.js) — so this asserts the
// shared chrome on a partial-rendered page instead.
test("shared-partial pages render with the Instrument chrome", async () => {
  const { app } = await buildTestApp();
  const { mountLegal } = await import("../routes/legal.js?t=" + Date.now());
  mountLegal(app);
  const res = await request(app).get("/privacy");
  assert.equal(res.status, 200);
  assert.match(res.text, /<body class="ins"/);
  assert.match(res.text, /\/css\/instrument-core\.css/);
  assert.match(res.text, /\/hub\.css/);
  assert.match(res.text, /src="\/js\/oscilloscope\.js"/);
  assert.doesNotMatch(res.text, /\/styles\.css/);
});
