// middleware/errorHandler.js — central error handler. Mount LAST, after routes.
import { STATUS_CODES } from "node:http";
export function makeErrorHandler({ logger, nodeEnv }) {
  const isProd = nodeEnv === "production";
  return function errorHandler(err, req, res, next) {
    const log = req.log || logger;
    const reqId = req.id;
    if (res.headersSent) {
      log.warn({ err, reqId }, "error after headers sent");
      return next(err);
    }
    log.error({ err, reqId }, "unhandled error");

    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(status);

    const wantsJson =
      (typeof req.path === "string" && req.path.startsWith("/api")) ||
      (typeof req.accepts === "function" && req.accepts(["html", "json"]) === "json");

    if (wantsJson) {
      const body = { error: isProd ? STATUS_CODES[status] || "Error" : err.message || "Error", reqId };
      if (err.fields) body.fields = err.fields;
      return res.json(body);
    }
    try {
      return res.render(
        "error",
        {
          title: "Something went wrong",
          message: isProd ? "An unexpected error occurred." : err.stack || err.message || "Error",
          reqId,
          backHref: "/",
        },
        (renderErr, html) => {
          if (renderErr) {
            log.warn({ err: renderErr, reqId }, "error view render failed");
            return res.type("text/plain").send(`An unexpected error occurred. (ref: ${reqId})`);
          }
          res.send(html);
        }
      );
    } catch (renderErr) {
      log.warn({ err: renderErr, reqId }, "error view render failed");
      return res.type("text/plain").send(`An unexpected error occurred. (ref: ${reqId})`);
    }
  };
}
