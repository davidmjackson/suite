// tests/tokens.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomToken, randomId } from "../lib/tokens.js";

test("randomToken returns 64-char hex (32 bytes)", () => {
  const t = randomToken();
  assert.match(t, /^[0-9a-f]{64}$/);
});

test("randomId returns 32-char hex (16 bytes)", () => {
  const id = randomId();
  assert.match(id, /^[0-9a-f]{32}$/);
});

test("randomToken is non-repeating across many calls", () => {
  const set = new Set();
  for (let i = 0; i < 1000; i++) set.add(randomToken());
  assert.equal(set.size, 1000);
});
