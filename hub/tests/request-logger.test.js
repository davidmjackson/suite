import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { Writable } from "node:stream";
import { createLogger } from "../lib/logger.js";
import { makeRequestLogger } from "../middleware/requestLogger.js";

function capture() {
  const chunks = [];
  const stream = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });
  return {
    stream,
    text: () => chunks.join(""),
    records: () => chunks.join("").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
  };
}

function buildApp() {
  const cap = capture();
  const logger = createLogger({ level: "info", stream: cap.stream });
  const app = express();
  app.use(makeRequestLogger(logger));
  app.get("/ok", (req, res) => res.json({ ok: true }));
  app.get("/missing", (req, res) => res.status(404).json({ no: true }));
  return { app, cap };
}

const tick = () => new Promise((r) => setImmediate(r));

test("generates a request id and echoes it in the X-Request-Id header", async () => {
  const { app } = buildApp();
  const res = await request(app).get("/ok");
  assert.equal(res.status, 200);
  assert.ok(res.headers["x-request-id"]);
});

test("honors an inbound X-Request-Id", async () => {
  const { app, cap } = buildApp();
  const res = await request(app).get("/ok").set("X-Request-Id", "abc-123");
  await tick();
  assert.equal(res.headers["x-request-id"], "abc-123");
  assert.ok(cap.records().some((r) => r.req && r.req.id === "abc-123"));
});

test("maps a 404 response to warn level", async () => {
  const { app, cap } = buildApp();
  await request(app).get("/missing");
  await tick();
  const rec = cap.records().find((r) => r.req && r.req.url === "/missing");
  assert.ok(rec);
  assert.equal(rec.level, 40); // pino warn
});

test("never logs request headers (cookie stays private)", async () => {
  const { app, cap } = buildApp();
  await request(app).get("/ok").set("Cookie", "hub_session=supersecretcookie");
  await tick();
  assert.ok(!cap.text().includes("supersecretcookie"));
});

test("masks sensitive query params in the logged url", async () => {
  const { app, cap } = buildApp();
  await request(app).get("/ok?token=topsecretquery");
  await tick();
  assert.ok(!cap.text().includes("topsecretquery"));
  assert.ok(cap.records().some((r) => r.req && r.req.url.startsWith("/ok")));
});
