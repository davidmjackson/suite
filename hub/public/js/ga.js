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

  const s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(measurementId);
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  // Must be a real `arguments`-using function, not an arrow: gtag relies on the
  // arguments object being pushed, not an array.
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag("js", new Date());
  gtag("config", measurementId);
}
