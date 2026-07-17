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

let started = false;

export function initGa(measurementId) {
  if (started || !measurementId) return;
  started = true;

  window.dataLayer = window.dataLayer || [];
  // Must be a real `arguments`-using function, not an arrow: gtag relies on the
  // arguments object being pushed, not an array.
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

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
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "granted",
  });

  const s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(measurementId);
  document.head.appendChild(s);

  gtag("js", new Date());
  // Belt-and-braces alongside the ad_storage denial above: still current and
  // undeprecated, and they keep signals off for analytics-internal use too.
  gtag("config", measurementId, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
}
