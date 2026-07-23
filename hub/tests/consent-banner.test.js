// tests/consent-banner.test.js
// No jsdom in this repo (see tests/confirm-modal.test.js): assert the assets serve
// and that the source upholds the invariants the design depends on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { buildTestApp } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = join(__dirname, "..", "public");
const bannerSrc = readFileSync(join(pub, "js", "consent-banner.js"), "utf8");
const gaSrc = readFileSync(join(pub, "js", "ga.js"), "utf8");

for (const asset of ["/js/consent-banner.js", "/js/ga.js", "/css/consent.css"]) {
  test(`GET ${asset} serves 200`, async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get(asset);
    assert.equal(res.status, 200);
  });
}

test("ga.js is the only place that reaches googletagmanager", () => {
  assert.match(gaSrc, /googletagmanager\.com\/gtag\/js/);
  assert.doesNotMatch(bannerSrc, /googletagmanager/, "the banner must go through initGa()");
});

test("the banner matches the granted state exactly, never loosely", () => {
  // A prefix or truthiness check here would load GA for a tampered cookie value.
  // The old form of this test also counted initGa( call sites, which pinned the
  // shape of the implementation rather than its behaviour and went stale the
  // moment the decision moved into applyConsent(). What it was really guarding —
  // GA starts on accept, never on reject — is asserted executably in
  // tests/consent-runtime.test.js against the real module.
  assert.match(bannerSrc, /=== "granted"/);
});

test("the banner writes the agreed cookie attributes", () => {
  assert.match(bannerSrc, /ss_consent/);
  assert.match(bannerSrc, /Path=\//);
  assert.match(bannerSrc, /SameSite=Lax/);
  assert.match(bannerSrc, /Secure/);
  assert.match(bannerSrc, /180 \* 24 \* 60 \* 60/, "180 days, in sync with lib/consent.js");
});

test("the banner offers a withdrawal hook and reads its config from data attributes", () => {
  assert.match(bannerSrc, /\[data-consent-settings\]/);
  assert.match(bannerSrc, /data-ga-id/);
  assert.match(bannerSrc, /data-consent/);
});

test("Esc does not dismiss the bar — dismissal is not a decision", () => {
  assert.doesNotMatch(bannerSrc, /Escape/);
});

test("consent.css gives Reject and Accept equal prominence", () => {
  const css = readFileSync(join(pub, "css", "consent.css"), "utf8");
  assert.match(css, /\.consent-acts \.btn\{[^}]*min-width/, "both buttons share a min-width");
  assert.doesNotMatch(css, /\.consent-no\{[^}]*(font-size|opacity|display:none)/, "reject is not diminished");
});

test("the banner styles are hub-only, not in the synced foundation", () => {
  const core = readFileSync(join(pub, "css", "instrument-core.css"), "utf8");
  assert.doesNotMatch(core, /\.consent/, "instrument-core.css is synced across all five surfaces");
});

// --- What used to be asserted here -----------------------------------------
// Four tests that regex-matched ga.js's SOURCE now live in tests/consent-runtime.js
// as executable assertions against the real module:
//
//   ad_storage / ad_user_data / ad_personalization denied  (the /privacy §§2/5/6
//     and landing-FAQ "never used for advertising" promise)
//   analytics_storage granted
//   allow_google_signals / allow_ad_personalization_signals false
//   consent default queued before config
//
// They are not dropped — they are strictly stronger there, because they check the
// values gtag actually receives rather than the characters in the file, and so
// still hold if a value is ever computed instead of written as a literal. The
// source-level checks that remain above are the ones with no runtime equivalent.
