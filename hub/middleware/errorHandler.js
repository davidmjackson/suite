// middleware/errorHandler.js — central error handler. Mount LAST, after routes.
import { STATUS_CODES } from 'node:http';
export function makeErrorHandler({ logger, nodeEnv }) {
  const isProd = nodeEnv === 'production';
  return function errorHandler(err, req, res, next) {
    const log = req.log || logger;
    const reqId = req.id;
    if (res.headersSent) {
      log.warn({ err, reqId }, 'error after headers sent');
      return next(err);
    }

    const status =
      Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    // A refused request is not a crash. Logging every 4xx at ERROR under one
    // message buries real 500s among routine rejections, and leaves on-call
    // unable to tell a CSRF probe from a broken route.
    const isServerError = status >= 500;
    // A refusal's stack is this file and the router, identical every time. The 404
    // catch-all sends every unmatched path down here and nothing rate-limits those,
    // so keeping the frames would let a path scanner roll real records out of the
    // journal on-call reads. The message stays: csrf.js writes the offending origin
    // into it, and notFound.js the method and path.
    log[isServerError ? 'error' : 'warn'](
      { err: isServerError ? err : { message: err.message }, reqId },
      err.code || (isServerError ? 'unhandled error' : 'request refused'),
    );
    res.status(status);

    const wantsJson =
      (typeof req.path === 'string' && req.path.startsWith('/api')) ||
      (typeof req.accepts === 'function' && req.accepts(['html', 'json']) === 'json');

    // An error carrying `public` has copy written for the person who hit it, and
    // is safe to show in prod. Everything else stays generic so internals never leak.
    const publicMessage = err.public?.message;

    if (wantsJson) {
      const body = {
        error: publicMessage || (isProd ? STATUS_CODES[status] || 'Error' : err.message || 'Error'),
        reqId,
      };
      if (err.fields) body.fields = err.fields;
      return res.json(body);
    }
    try {
      return res.render(
        'error',
        {
          title: err.public?.title || 'Something went wrong',
          message:
            publicMessage || (isProd ? 'An unexpected error occurred.' : err.stack || err.message),
          reqId,
          backHref: '/',
        },
        (renderErr, html) => {
          if (renderErr) {
            log.warn({ err: renderErr, reqId }, 'error view render failed');
            return res.type('text/plain').send(`An unexpected error occurred. (ref: ${reqId})`);
          }
          res.send(html);
        },
      );
    } catch (renderErr) {
      log.warn({ err: renderErr, reqId }, 'error view render failed');
      return res.type('text/plain').send(`An unexpected error occurred. (ref: ${reqId})`);
    }
  };
}
