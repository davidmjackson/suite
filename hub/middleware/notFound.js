// middleware/notFound.js — answers anything the routes did not. Mount AFTER every
// route and BEFORE the central error handler: above the routes it steals their
// requests, below the error handler it never runs.
//
// It raises rather than renders, so the error view, the JSON negotiation for
// /api/*, the render-failure fallback and the logging stay in errorHandler.
//
// The copy names no path. Reflecting req.originalUrl would hand an attacker a
// string on a page we serve — and note reqId already is one: genReqId echoes a
// caller-supplied X-Request-Id, which Eta escapes but nothing strips.
export function makeNotFound() {
  return function notFound(req, _res, next) {
    // Express builds the OPTIONS Allow header in a wrapper around the router's
    // done callback, which this layer runs before. Swallowing OPTIONS loses it.
    if (req.method === 'OPTIONS') return next();
    const err = new Error(`no route for ${req.method} ${req.path}`);
    err.status = 404;
    err.code = 'not_found';
    err.public = {
      title: 'Page not found',
      message:
        'That page does not exist. It may have moved, or the link that brought you ' +
        'here may be out of date.',
    };
    next(err);
  };
}
