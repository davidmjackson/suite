// middleware/notFound.js — answers anything the routes did not. Mount AFTER every
// route and BEFORE the central error handler.
//
// Without it, Express's finalhandler replies with `<pre>Cannot GET /path</pre>`
// under its own `default-src 'none'` CSP. That policy is stricter than ours, not
// weaker — the problem is an unbranded page that names the framework and echoes
// the requested path back to whoever asked for it.
//
// This does NOT render. It raises a 404 the way middleware/csrf.js raises a 403
// and lets errorHandler answer, which is what keeps one rendering path: the JSON
// negotiation for /api/*, the render-failure fallback and the request logging all
// already live there, and a second renderer here would be a second copy of each.
//
// The `public` copy is FIXED and mentions no path. Rendering req.originalUrl would
// put an attacker-chosen string on a page we serve — the one way this could be
// worse than the finalhandler page it replaces. tests/not-found.test.js holds it
// to that with a marker the naive implementation would echo.
export function makeNotFound() {
  return function notFound(req, _res, next) {
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
