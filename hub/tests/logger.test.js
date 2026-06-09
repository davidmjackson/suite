import { test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { createLogger, safeUrl } from "../lib/logger.js";

function capture() {
  const chunks = [];
  const stream = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });
  const records = () => chunks.join("").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { stream, records };
}

test("respects the configured level", () => {
  const cap = capture();
  const log = createLogger({ level: "warn", stream: cap.stream });
  log.info("ignored");
  log.warn("kept");
  const recs = cap.records();
  assert.equal(recs.length, 1);
  assert.equal(recs[0].msg, "kept");
});

test("emits JSON with base service field", () => {
  const cap = capture();
  const log = createLogger({ level: "info", stream: cap.stream });
  log.info("hello");
  assert.equal(cap.records()[0].service, "hub");
});

test("redacts token and password at top level and one nesting level", () => {
  const cap = capture();
  const log = createLogger({ level: "info", stream: cap.stream });
  log.info({ token: "abc", password: "pw", nested: { token: "zzz" } }, "m");
  const rec = cap.records()[0];
  assert.equal(rec.token, "[redacted]");
  assert.equal(rec.password, "[redacted]");
  assert.equal(rec.nested.token, "[redacted]");
});

test("safeUrl masks sensitive query params but keeps the path", () => {
  const out = safeUrl("/auth/magic?token=topsecretvalue&x=1");
  assert.ok(!out.includes("topsecretvalue"));
  assert.ok(out.startsWith("/auth/magic"));
  assert.ok(out.includes("x=1"));
  assert.ok(out.includes("token=[redacted]")); // key kept, sentinel readable (not %5B…%5D)
  assert.equal(safeUrl("/plain"), "/plain");
  assert.ok(!safeUrl("/x?password=topsecretpw").includes("topsecretpw"));
  assert.equal(safeUrl("/p?token=abc#frag"), "/p?token=[redacted]#frag");
});
