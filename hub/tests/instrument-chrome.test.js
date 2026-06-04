import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";

test("pages render with the Instrument chrome", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
  assert.match(res.text, /<body class="ins"/);
  assert.match(res.text, /\/css\/instrument-core\.css/);
  // `/` is now the standalone Instrument landing front door: it ships its own
  // page-specific stylesheet and a hero-trace ES module instead of the shared
  // launcher chrome (hub.css + global oscilloscope.js script tag).
  assert.match(res.text, /\/css\/landing\.css/);
  assert.doesNotMatch(res.text, /\/styles\.css/);
});
