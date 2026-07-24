// public/js/consent-banner.js
// The analytics consent bar. One bar, one purpose (analytics), no vendor SDK.
//
// Contract — the server renders exactly one tag carrying the state:
//   <script type="module" src="/js/consent-banner.js"
//           data-ga-id="G-XXXX" data-consent="granted|denied|"></script>
// data-consent is the ss_consent cookie as read server-side (lib/consent.js);
// empty means no choice has been made yet.
//
// Branches:
//   "granted" -> load GA immediately, no bar
//   ""        -> show the bar, contact nobody
//   "denied"  -> do nothing at all
//
// Accept and Reject write the cookie and hide the bar. Accept also initializes GA
// on the spot, so the pageview that earned the consent is not lost.
//
// Any [data-consent-settings] element reopens the bar: PECR requires withdrawing
// to be as easy as granting.
//
// Deliberately NOT a focus-trapping modal like confirm-modal.js: this bar must not
// block the page, and Esc must not dismiss it — dismissal is not a decision.
import { initGa, revokeGa } from './ga.js';

const COOKIE = 'ss_consent';
const MAX_AGE = 180 * 24 * 60 * 60; // keep in sync with CONSENT_MAX_AGE_SEC in lib/consent.js

let bar = null;
let gaId = null;

function writeConsent(value) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    COOKIE + '=' + value + '; Path=/; Max-Age=' + MAX_AGE + '; SameSite=Lax' + secure;
}

// The consent decision, separated from the DOM that collects it: "granted" starts
// analytics, anything else stops them. Exported so the decision can be tested
// without a browser — the branch that was wrong here was untestable before.
export function applyConsent(value, measurementId, win = globalThis) {
  if (!measurementId) return;
  if (value === 'granted') initGa(measurementId, win);
  else revokeGa(measurementId, win);
}

function choose(value) {
  writeConsent(value);
  if (bar) bar.hidden = true;
  applyConsent(value, gaId);
}

function build() {
  const el = document.createElement('section');
  el.className = 'consent';
  el.hidden = true;
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Analytics consent');
  el.innerHTML =
    '<div class="consent-in">' +
    '<div class="consent-copy">' +
    '<p class="consent-eyebrow">Analytics</p>' +
    '<p class="consent-msg">We would like to count visits to our public pages, so we can see ' +
    'which ones people find useful. Nothing runs unless you accept, we never use it for ads, ' +
    'and you can change your mind at any time. ' +
    '<a class="consent-lnk" href="/privacy">Privacy note</a></p>' +
    '</div>' +
    '<div class="consent-acts">' +
    '<button type="button" class="btn btn-ghost consent-no">Reject</button>' +
    '<button type="button" class="btn btn-pri consent-yes">Accept</button>' +
    '</div>' +
    '</div>';
  document.body.appendChild(el);
  el.querySelector('.consent-no').addEventListener('click', function () {
    choose('denied');
  });
  el.querySelector('.consent-yes').addEventListener('click', function () {
    choose('granted');
  });
  return el;
}

function open() {
  if (!bar) bar = build();
  bar.hidden = false;
}

function start() {
  const tag = document.querySelector('script[data-ga-id]');
  if (!tag) return; // analytics not wired on this page — nothing to consent to
  gaId = tag.getAttribute('data-ga-id') || null;
  if (!gaId) return;

  const consent = tag.getAttribute('data-consent') || '';
  if (consent === 'granted') applyConsent(consent, gaId);
  else if (consent !== 'denied') open();

  // Withdraw / re-consent, from the landing footer and the /privacy note.
  document.addEventListener('click', function (e) {
    const t = e.target.closest ? e.target.closest('[data-consent-settings]') : null;
    if (!t) return;
    e.preventDefault();
    open();
  });
}

// type="module" is deferred, so the DOM is parsed by the time this runs. The
// readyState guard is belt-and-braces for a non-deferred load.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}
