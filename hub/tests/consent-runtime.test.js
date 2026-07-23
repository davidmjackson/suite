// tests/consent-runtime.test.js
// Executable tests for the analytics consent runtime.
//
// The rest of the consent suite (tests/consent-banner.test.js) greps the source,
// because there is no jsdom here and these modules touch window/document. Those
// greps pin the FORM of the implementation rather than its behaviour, which is a
// weak guarantee: every one of them passed while the runtime was wrong.
//
// So ga.js takes its window as an injected argument (defaulting to globalThis,
// which IS window in the browser), and these tests drive the real module against
// a stub browser. No jsdom, and nothing mocks the unit under test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initGa } from "../public/js/ga.js";

const GA_ID = "G-6FJLV7EE1X";

// A browser stub that records what the module did to it.
function stubWin({ hostname = "sprintsuite.uk" } = {}) {
  const written = [];
  const appended = [];
  const win = {
    document: {
      set cookie(v) {
        written.push(v);
      },
      get cookie() {
        return "";
      },
      createElement: () => ({}),
      head: { appendChild: (el) => appended.push(el) },
    },
    location: { hostname, protocol: "https:" },
  };
  win.__written = written;
  win.__appended = appended;
  return win;
}

const commands = (win) => (win.dataLayer || []).map((a) => Array.from(a));
const find = (win, name, sub) =>
  commands(win).find((c) => c[0] === name && (sub === undefined || c[1] === sub));

test("initGa appends the gtag script exactly once, however often it is called", () => {
  const win = stubWin();

  initGa(GA_ID, win);
  initGa(GA_ID, win);

  assert.equal(win.__appended.length, 1);
});

test("initGa denies every ads-related consent signal", () => {
  // Guards the published "never used for advertising" promise (views/privacy.eta
  // §§2/5/6 and the landing FAQ) as BEHAVIOUR, not as a regex over the source.
  const win = stubWin();

  initGa(GA_ID, win);

  const dflt = find(win, "consent", "default");
  assert.ok(dflt, "a consent default is queued");
  assert.equal(dflt[2].ad_storage, "denied");
  assert.equal(dflt[2].ad_user_data, "denied");
  assert.equal(dflt[2].ad_personalization, "denied");
});

test("initGa grants analytics_storage, since it only runs after explicit consent", () => {
  const win = stubWin();

  initGa(GA_ID, win);

  assert.equal(find(win, "consent", "default")[2].analytics_storage, "granted");
});

test("the consent default is queued before config, or gtag applies it too late", () => {
  const win = stubWin();

  initGa(GA_ID, win);

  const order = commands(win).map((c) => `${c[0]}:${c[1]}`);
  const consentAt = order.indexOf("consent:default");
  const configAt = order.indexOf(`config:${GA_ID}`);
  assert.ok(consentAt > -1 && configAt > -1, `both queued, got ${order.join(" ")}`);
  assert.ok(consentAt < configAt, `consent precedes config, got ${order.join(" ")}`);
});

test("initGa keeps google signals off for analytics-internal use too", () => {
  const win = stubWin();

  initGa(GA_ID, win);

  const config = find(win, "config", GA_ID);
  assert.equal(config[2].allow_google_signals, false);
  assert.equal(config[2].allow_ad_personalization_signals, false);
});

test("initGa does nothing without a measurement id", () => {
  const win = stubWin();

  initGa(null, win);

  assert.equal(win.__appended.length, 0);
  assert.equal(win.dataLayer, undefined);
});
