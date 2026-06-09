// tests/validate.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { validate } from "../lib/validate.js";

function run(mw, req) {
  return new Promise((resolve) => {
    const res = {};
    let nextErr = "no-next";
    mw(req, res, (err) => { nextErr = err; resolve({ req, res, nextErr }); });
    if (req._resolvedByOnInvalid) resolve({ req, res, nextErr });
  });
}

test("validate: on success replaces req.body with parsed/coerced data and calls next()", async () => {
  const schema = z.object({ email: z.preprocess((v) => String(v).trim().toLowerCase(), z.string()) });
  const { req, nextErr } = await run(validate(schema), { body: { email: "  A@B.COM ", extra: "x" } });
  assert.equal(nextErr, undefined); // next() with no arg
  assert.deepEqual(req.body, { email: "a@b.com" }); // unknown key "extra" stripped
});

test("validate: on failure with no onInvalid calls next(err) with status 400 and fields", async () => {
  const schema = z.object({ email: z.string().email() });
  const { nextErr } = await run(validate(schema), { body: { email: "nope" } });
  assert.equal(nextErr.status, 400);
  assert.ok(nextErr.fields.email, "fieldErrors include email");
});

test("validate: on failure with onInvalid calls it instead of next()", async () => {
  const schema = z.object({ email: z.string().email() });
  let called = false;
  const onInvalid = (req, res) => { called = true; req._resolvedByOnInvalid = true; };
  const { nextErr } = await run(validate(schema, { onInvalid }), { body: { email: "nope" } });
  assert.equal(called, true);
  assert.equal(nextErr, "no-next"); // next was never called
});
