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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initGa, revokeGa } from '../public/js/ga.js';
import { applyConsent } from '../public/js/consent-banner.js';

const GA_ID = 'G-6FJLV7EE1X';

// A browser stub that records what the module did to it.
function stubWin({ hostname = 'sprintsuite.uk' } = {}) {
  const written = [];
  const appended = [];
  const win = {
    document: {
      set cookie(v) {
        written.push(v);
      },
      get cookie() {
        return '';
      },
      createElement: () => ({}),
      head: { appendChild: (el) => appended.push(el) },
    },
    location: { hostname, protocol: 'https:' },
  };
  win.__written = written;
  win.__appended = appended;
  return win;
}

const commands = (win) => (win.dataLayer || []).map((a) => Array.from(a));
const find = (win, name, sub) =>
  commands(win).find((c) => c[0] === name && (sub === undefined || c[1] === sub));

test('initGa appends the gtag script exactly once, however often it is called', () => {
  const win = stubWin();

  initGa(GA_ID, win);
  initGa(GA_ID, win);

  assert.equal(win.__appended.length, 1);
});

test('initGa denies every ads-related consent signal', () => {
  // Guards the published "never used for advertising" promise (views/privacy.eta
  // §§2/5/6 and the landing FAQ) as BEHAVIOUR, not as a regex over the source.
  const win = stubWin();

  initGa(GA_ID, win);

  const dflt = find(win, 'consent', 'default');
  assert.ok(dflt, 'a consent default is queued');
  assert.equal(dflt[2].ad_storage, 'denied');
  assert.equal(dflt[2].ad_user_data, 'denied');
  assert.equal(dflt[2].ad_personalization, 'denied');
});

test('initGa grants analytics_storage, since it only runs after explicit consent', () => {
  const win = stubWin();

  initGa(GA_ID, win);

  assert.equal(find(win, 'consent', 'default')[2].analytics_storage, 'granted');
});

test('the consent default is queued before config, or gtag applies it too late', () => {
  const win = stubWin();

  initGa(GA_ID, win);

  const order = commands(win).map((c) => `${c[0]}:${c[1]}`);
  const consentAt = order.indexOf('consent:default');
  const configAt = order.indexOf(`config:${GA_ID}`);
  assert.ok(consentAt > -1 && configAt > -1, `both queued, got ${order.join(' ')}`);
  assert.ok(consentAt < configAt, `consent precedes config, got ${order.join(' ')}`);
});

test('initGa keeps google signals off for analytics-internal use too', () => {
  const win = stubWin();

  initGa(GA_ID, win);

  const config = find(win, 'config', GA_ID);
  assert.equal(config[2].allow_google_signals, false);
  assert.equal(config[2].allow_ad_personalization_signals, false);
});

test('initGa does nothing without a measurement id', () => {
  const win = stubWin();

  initGa(null, win);

  assert.equal(win.__appended.length, 0);
  assert.equal(win.dataLayer, undefined);
});

// --- Withdrawal -------------------------------------------------------------
// PECR requires withdrawing consent to be as easy as giving it. Before this,
// clicking Reject after Accept wrote the cookie and hid the bar, and that was
// all: gtag kept sending for the rest of the page view and the _ga identifier
// cookies stayed on the browser until they expired two years later.

test("withdrawing consent sets Google's opt-out flag, so gtag sends nothing further", () => {
  const win = stubWin();
  initGa(GA_ID, win);
  assert.notEqual(win[`ga-disable-${GA_ID}`], true, 'not disabled while consent stands');

  revokeGa(GA_ID, win);

  assert.equal(win[`ga-disable-${GA_ID}`], true, 'ga-disable-<id> is the documented kill switch');
});

test('withdrawing consent updates Consent Mode to deny analytics_storage', () => {
  const win = stubWin();
  initGa(GA_ID, win);

  revokeGa(GA_ID, win);

  const update = find(win, 'consent', 'update');
  assert.ok(update, 'a consent update is queued on withdrawal');
  assert.equal(update[2].analytics_storage, 'denied');
});

test('withdrawing consent deletes the _ga identifier cookies', () => {
  const win = stubWin({ hostname: 'sprintsuite.uk' });
  initGa(GA_ID, win);
  win.__written.length = 0;

  revokeGa(GA_ID, win);

  const cleared = win.__written.join('\n');
  assert.match(cleared, /(^|\n)_ga=/, '_ga, the client id, is cleared');
  assert.match(cleared, /(^|\n)_ga_6FJLV7EE1X=/, 'the per-container cookie is cleared');
});

test('the cleared cookies are expired at the path and domain GA set them on', () => {
  // A host-only delete silently misses _ga, which GA writes on the registrable
  // domain — the cookie would survive a withdrawal that reported success.
  const win = stubWin({ hostname: 'www.sprintsuite.uk' });
  initGa(GA_ID, win);
  win.__written.length = 0;

  revokeGa(GA_ID, win);

  for (const c of win.__written) {
    assert.match(c, /Max-Age=0/, `expired immediately: ${c}`);
    assert.match(c, /Path=\//, `cleared at GA's path: ${c}`);
  }
  const domains = win.__written.map((c) => (c.match(/Domain=([^;]+)/) || [])[1]);
  assert.ok(domains.includes('.sprintsuite.uk'), `registrable domain covered: ${domains}`);
});

test('withdrawing before GA ever loaded is safe and still denies', () => {
  // A visitor who rejects at the bar never called initGa. Revoke must not throw,
  // and must still leave the page in a denied state.
  const win = stubWin();

  revokeGa(GA_ID, win);

  assert.equal(win[`ga-disable-${GA_ID}`], true);
});

test('re-accepting after a withdrawal turns analytics back on', () => {
  // initGa's write-once guard meant Accept -> Reject -> Accept left the page
  // permanently disabled, so re-consent silently did nothing.
  const win = stubWin();
  initGa(GA_ID, win);
  revokeGa(GA_ID, win);

  initGa(GA_ID, win);

  assert.notEqual(win[`ga-disable-${GA_ID}`], true, 'the opt-out flag is lifted');
  const updates = commands(win).filter((c) => c[0] === 'consent' && c[1] === 'update');
  assert.equal(updates.at(-1)[2].analytics_storage, 'granted', 'analytics_storage re-granted');
});

test('re-accepting does not append a second gtag script', () => {
  const win = stubWin();
  initGa(GA_ID, win);
  revokeGa(GA_ID, win);

  initGa(GA_ID, win);

  assert.equal(win.__appended.length, 1, 'gtag.js is already loaded; re-consent re-enables it');
});

// --- The banner's decision, independent of its DOM --------------------------

test('choosing Reject revokes analytics rather than only writing the cookie', () => {
  const win = stubWin();
  initGa(GA_ID, win);

  applyConsent('denied', GA_ID, win);

  assert.equal(win[`ga-disable-${GA_ID}`], true, 'Reject must stop GA, not just record the choice');
});

test('choosing Accept starts analytics', () => {
  const win = stubWin();

  applyConsent('granted', GA_ID, win);

  assert.equal(win.__appended.length, 1);
});

test('only the exact string "granted" starts analytics, never a near miss', () => {
  // The single gate in front of GA on the public pages: the server hands the
  // client the ss_consent cookie as data-consent, and only the exact string
  // "granted" may start GA. A cookie value that is not exactly the granted state
  // must leave the visitor with no contact with Google — a prefix, case-folding,
  // trimming or truthiness check would load gtag.js for a tampered ss_consent,
  // breaking the UK-PECR design and the published /privacy + landing-FAQ promise
  // that "nothing runs unless you accept".
  //
  // This used to be `assert.match(bannerSrc, /=== "granted"/)` over in
  // tests/consent-banner.test.js — a grep for characters, which said nothing
  // about what those characters do (and broke on a re-quote). applyConsent() is
  // the exported gate in front of initGa(), so drive the real module instead and
  // watch whether it reaches for Google.
  const tampered = [
    'granted-ish',
    'grantedx',
    'granted ',
    ' granted',
    'granted; ok',
    'Granted',
    'GRANTED',
    'gr',
    'true',
    '1',
    'yes',
    'denied',
    '',
  ];

  for (const value of tampered) {
    const win = stubWin();
    const shown = JSON.stringify(value);

    applyConsent(value, GA_ID, win);

    assert.equal(win.__appended.length, 0, `${shown} must not load gtag.js`);
    assert.equal(win.dataLayer, undefined, `${shown} must queue no gtag command`);
    assert.equal(win[`ga-disable-${GA_ID}`], true, `${shown} must leave GA disabled`);
  }

  // Positive control. Without it every assertion above is satisfied by an
  // applyConsent() gutted into a no-op, and the guard would report a safety it
  // no longer provides.
  const accepted = stubWin();
  applyConsent('granted', GA_ID, accepted);
  assert.equal(accepted.__appended.length, 1, 'an exact accept still starts GA');
  assert.notEqual(accepted[`ga-disable-${GA_ID}`], true, 'an exact accept is not disabled');
});

test('choosing Reject never loads gtag in the first place', () => {
  // The design's central promise: a visitor who does not accept has no contact
  // with Google at all, so the rejecting path must never append the script.
  const win = stubWin();

  applyConsent('denied', GA_ID, win);

  assert.equal(win.__appended.length, 0);
});
