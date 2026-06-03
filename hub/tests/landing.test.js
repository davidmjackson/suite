// tests/landing.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";

test("GET / renders landing page with all four apps", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
  assert.match(res.text, /Sprintraid/);
  assert.match(res.text, /Sprintsignal/);
  assert.match(res.text, /Sprintretro/);
  assert.match(res.text, /Sprintpoker/);
  assert.match(res.text, /Sign in/);
});

test("landing uses the band and app glyphs", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
  assert.match(res.text, /class="band"/);
  assert.match(res.text, /glyph-raid/);
  assert.match(res.text, /class="card apptile"/);
});
