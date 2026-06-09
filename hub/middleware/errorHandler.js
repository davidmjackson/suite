// middleware/errorHandler.js — central error handler. Mount LAST, after routes.
export function makeErrorHandler({ logger, nodeEnv }) {
  const isProd = nodeEnv === "production";
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);
    const log = req.log || logger;
    const reqId = req.id;
    log.error({ err, reqId }, "unhandled error");

    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(status);

    const wantsJson =
      (typeof req.path === "string" && req.path.startsWith("/api")) ||
      (typeof req.accepts === "function" && req.accepts(["html", "json"]) === "json");

    if (wantsJson) {
      return res.json({ error: isProd ? "Internal Server Error" : err.message || "Error", reqId });
    }
    return res.render("error", {
      title: "Something went wrong",
      message: isProd ? "An unexpected error occurred. Please try again." : err.stack || err.message || "Error",
      reqId,
      backHref: "/",
    });
  };
}
