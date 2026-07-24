// middleware/analytics.js
// Exposes the visitor's analytics-consent state to the view layer, for the public
// pages only (/, /request, /privacy — see server.js).
//
// Applied PER ROUTE, never via app.use("/"): Express prefix-matches "/" against
// every path, which would mount analytics on /dashboard and /admin — the precise
// leak this design exists to prevent.
//
// Why res.locals and not a render argument: routes/request.js renders from four
// call sites (GET, 400-invalid, honeypot, POST success). Express merges res.locals
// into render options, so every site — including any added later — picks this up
// without being threaded through by hand.
import { readConsent } from '../lib/consent.js';

export function analyticsLocals(config) {
  // Resolved once at mount: unset GA_MEASUREMENT_ID is the kill switch, and it
  // means the analytics partial renders nothing at all.
  const gaId = (config && config.gaMeasurementId) || null;

  return function analytics(req, res, next) {
    res.locals.analytics = { gaId, consent: readConsent(req.headers.cookie) };
    next();
  };
}
