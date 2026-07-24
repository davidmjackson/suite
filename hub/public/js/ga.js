// public/js/ga.js
// Loads Google Analytics 4.
//
// Called ONLY from consent-banner.js, and only in the granted branch — a visitor
// who has not accepted never reaches this module, so their browser never contacts
// Google at all. That is the whole point of the design; do not import this from
// anywhere else.
//
// This is Google's gtag snippet rewritten as a first-party module rather than
// pasted inline. The hub's CSP is `script-src 'self'` with no 'unsafe-inline'
// (middleware/securityHeaders.js), so an inline block would be blocked outright.
// The fix for that is never to add 'unsafe-inline' — it is this file.
//
// The window is injected rather than reached for, so the module can be exercised
// without a DOM (tests/consent-runtime.test.js). Every browser caller omits the
// argument and gets the real window, so behaviour there is unchanged.

// "Has GA been started on this window?" — kept on the window rather than in module
// scope because that is precisely what it describes, and it keeps the flag
// injectable alongside everything else it guards.
const STARTED = '__ssGaStarted';

function gtagFor(win) {
  win.dataLayer = win.dataLayer || [];
  if (!win.gtag) {
    // Must be a real `arguments`-using function, not an arrow: gtag relies on the
    // arguments object being pushed, not an array.
    win.gtag = function gtag() {
      win.dataLayer.push(arguments);
    };
  }
  return win.gtag;
}

// Google's documented opt-out flag. gtag.js checks it on every hit, which is the
// only way to stop analytics mid-page: once the script has been fetched it cannot
// be unloaded, so "stop sending" is the strongest guarantee available.
const disableKey = (measurementId) => `ga-disable-${measurementId}`;

// GA writes _ga on the registrable domain, not the host, so a host-only delete
// leaves the identifier sitting there. Clear the host and every parent level.
function cookieScopes(hostname) {
  const parts = hostname.split('.');
  const scopes = [''];
  for (let i = 0; i < parts.length - 1; i++) {
    scopes.push(`; Domain=.${parts.slice(i).join('.')}`);
  }
  return scopes;
}

function clearGaCookies(measurementId, win) {
  const names = ['_ga', `_ga_${measurementId.replace(/^G-/, '')}`];
  for (const name of names) {
    for (const scope of cookieScopes(win.location.hostname)) {
      win.document.cookie = `${name}=; Path=/; Max-Age=0${scope}`;
    }
  }
}

// Withdrawal. PECR requires this to be as easy as granting, which means it has to
// actually take effect — writing the choice to a cookie and hiding the bar is not
// withdrawal, it is bookkeeping.
export function revokeGa(measurementId, win = globalThis) {
  if (!measurementId) return;
  win[disableKey(measurementId)] = true;
  if (win[STARTED]) {
    gtagFor(win)('consent', 'update', { analytics_storage: 'denied' });
  }
  clearGaCookies(measurementId, win);
}

export function initGa(measurementId, win = globalThis) {
  if (!measurementId) return;

  if (win[STARTED]) {
    // Already loaded. If consent was withdrawn and is now given again, lift the
    // opt-out and re-grant — gtag.js cannot be fetched twice, so returning early
    // here (as this did before) left re-consent silently doing nothing.
    if (win[disableKey(measurementId)]) {
      win[disableKey(measurementId)] = false;
      gtagFor(win)('consent', 'update', { analytics_storage: 'granted' });
    }
    return;
  }
  win[STARTED] = true;

  const gtag = gtagFor(win);

  // Declared BEFORE the tag is appended below, so the command is queued in the
  // dataLayer before gtag.js can process anything — a consent default applied
  // after config is applied too late.
  //
  // From 2026-06-15 Google narrowed `allow_google_signals` to analytics-internal
  // use: whether GA4 data may reach Google Ads is now decided by Consent Mode's
  // ad_storage state, and an undeclared ad_storage reads as GRANTED. So these
  // three denials — not the config flags below — are what now carry the promise
  // in views/privacy.eta §§2/5/6 and the landing FAQ that analytics are never
  // used for advertising. Do not remove them without changing that copy first.
  //
  // This is NOT the denied-by-default Consent Mode pattern the design rejected
  // (see the spec): that one loads gtag for every visitor and pings Google even
  // for rejecters. We still only get here after an explicit Accept.
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'granted',
  });

  const s = win.document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(measurementId);
  win.document.head.appendChild(s);

  gtag('js', new Date());
  // Belt-and-braces alongside the ad_storage denial above: still current and
  // undeprecated, and they keep signals off for analytics-internal use too.
  gtag('config', measurementId, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
}
