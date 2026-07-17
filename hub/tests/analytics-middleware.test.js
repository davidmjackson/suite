// tests/analytics-middleware.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyticsLocals } from "../middleware/analytics.js";

// Minimal req/res doubles — the middleware touches only headers and res.locals.
const fakeReq = (cookie) => ({ headers: cookie ? { cookie } : {} });
const fakeRes = () => ({ locals: {} });

function run(config, cookie) {
  const req = fakeReq(cookie);
  const res = fakeRes();
  let nexted = false;
  analyticsLocals(config)(req, res, () => { nexted = true; });
  return { res, nexted };
}

test("exposes the measurement id and the visitor's decision", () => {
  const { res, nexted } = run({ gaMeasurementId: "G-TEST123" }, "ss_consent=granted");
  assert.deepEqual(res.locals.analytics, { gaId: "G-TEST123", consent: "granted" });
  assert.equal(nexted, true);
});

test("reports a null decision when no choice has been made", () => {
  const { res } = run({ gaMeasurementId: "G-TEST123" }, undefined);
  assert.deepEqual(res.locals.analytics, { gaId: "G-TEST123", consent: null });
});

test("carries denied through untouched", () => {
  const { res } = run({ gaMeasurementId: "G-TEST123" }, "ss_consent=denied");
  assert.equal(res.locals.analytics.consent, "denied");
});

test("gaId is null when GA_MEASUREMENT_ID is unconfigured — the kill switch", () => {
  for (const config of [{}, { gaMeasurementId: null }, { gaMeasurementId: "" }, null]) {
    const { res, nexted } = run(config, "ss_consent=granted");
    assert.equal(res.locals.analytics.gaId, null, "no id configured means no analytics");
    assert.equal(nexted, true);
  }
});

test("always calls next, even with a tampered cookie", () => {
  const { res, nexted } = run({ gaMeasurementId: "G-TEST123" }, "ss_consent=../../etc/passwd");
  assert.equal(res.locals.analytics.consent, null);
  assert.equal(nexted, true);
});
