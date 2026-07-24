// tests/consent-banner.test.js
// No jsdom in this repo (see tests/confirm-modal.test.js): assert the assets serve
// and that the source upholds the invariants the design depends on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { buildTestApp } from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = join(__dirname, '..', 'public');
const bannerSrc = readFileSync(join(pub, 'js', 'consent-banner.js'), 'utf8');
const gaSrc = readFileSync(join(pub, 'js', 'ga.js'), 'utf8');

// A formatting-agnostic view of a JS source, for the few invariants that live in
// code no test can execute. Whole-line comments are dropped (so prose can never
// satisfy an assertion), single-quoted string literals are rewritten with double
// quotes, and runs of whitespace collapse to one space. Nothing meaningful is
// removed: every token is still present, in order. This normalises what the
// assertions READ; it does not soften what they DEMAND.
function normalise(src) {
  return src
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:[^"\\\n]|\\.)*"|'((?:[^'\\\n]|\\.)*)'/g, (whole, single) =>
      single === undefined ? whole : `"${single.replace(/"/g, '\\"')}"`,
    )
    .replace(/\s+/g, ' ')
    .trim();
}
const bannerCode = normalise(bannerSrc);

// Slices of normalised source surrounding each mention of `word`.
const near = (code, word, span = 40) =>
  [...code.matchAll(new RegExp(word, 'g'))].map((m) =>
    code.slice(Math.max(0, m.index - span), m.index + word.length + span),
  );

for (const asset of ['/js/consent-banner.js', '/js/ga.js', '/css/consent.css']) {
  test(`GET ${asset} serves 200`, async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get(asset);
    assert.equal(res.status, 200);
  });
}

test('ga.js is the only place that reaches googletagmanager', () => {
  assert.match(gaSrc, /googletagmanager\.com\/gtag\/js/);
  assert.doesNotMatch(bannerSrc, /googletagmanager/, 'the banner must go through initGa()');
});

test('the banner never compares the consent state loosely', () => {
  // A prefix, case-folding, trimming or truthiness check here would load GA for a
  // tampered ss_consent cookie. That the gate REJECTS every near miss is asserted
  // executably against the real module in tests/consent-runtime.test.js — "only
  // the exact string granted starts analytics". Two gaps remain that no runtime
  // test can reach, and they are what this test covers — read over the normalised
  // source rather than the raw file, so re-quoting or reflowing cannot break it:
  //
  //  1. `==` instead of `===` is indistinguishable at runtime for two strings,
  //     so no input can expose it — but it is exactly the coercion this guard
  //     exists to forbid.
  //  2. start() reads the data-consent attribute and dispatches on it. It
  //     touches document, so it is not exported and not executable here.
  assert.match(bannerCode, /===\s*"granted"/, 'the granted state is compared strictly');

  const loose = /(?<![=!])==(?!=)|(?:startsWith|endsWith|includes|indexOf|search|match|test)\s*\(/;
  for (const context of near(bannerCode, 'granted')) {
    assert.doesNotMatch(context, loose, `loose handling of the granted state near: ${context}`);
  }

  // And the state that is acted on must be the state that was read: passing a
  // hard-coded "granted" on into a call would load GA for whatever the cookie
  // actually said. (choose("granted"), a single literal argument from the
  // Accept button, is deliberately not caught by this.)
  assert.doesNotMatch(
    bannerCode,
    /\(\s*"granted"\s*,/,
    'the granted state is read from the page, never hard-coded into a call',
  );
});

test('the banner writes the agreed cookie attributes', () => {
  assert.match(bannerSrc, /ss_consent/);
  assert.match(bannerSrc, /Path=\//);
  assert.match(bannerSrc, /SameSite=Lax/);
  assert.match(bannerSrc, /Secure/);
  assert.match(bannerSrc, /180 \* 24 \* 60 \* 60/, '180 days, in sync with lib/consent.js');
});

test('the banner offers a withdrawal hook and reads its config from data attributes', () => {
  assert.match(bannerSrc, /\[data-consent-settings\]/);
  assert.match(bannerSrc, /data-ga-id/);
  assert.match(bannerSrc, /data-consent/);
});

test('Esc does not dismiss the bar — dismissal is not a decision', () => {
  assert.doesNotMatch(bannerSrc, /Escape/);
});

test('consent.css gives Reject and Accept equal prominence', () => {
  const css = readFileSync(join(pub, 'css', 'consent.css'), 'utf8');
  assert.match(css, /\.consent-acts \.btn\{[^}]*min-width/, 'both buttons share a min-width');
  assert.doesNotMatch(
    css,
    /\.consent-no\{[^}]*(font-size|opacity|display:none)/,
    'reject is not diminished',
  );
});

test('the banner styles are hub-only, not in the synced foundation', () => {
  const core = readFileSync(join(pub, 'css', 'instrument-core.css'), 'utf8');
  assert.doesNotMatch(core, /\.consent/, 'instrument-core.css is synced across all five surfaces');
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
