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
  assert.match(res.text, /\/hub\.css/);
  assert.match(res.text, /src="\/js\/oscilloscope\.js"/);
  assert.doesNotMatch(res.text, /\/styles\.css/);
});
