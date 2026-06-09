// middleware/requestLogger.js — per-request structured logging via pino-http.
import { pinoHttp } from "pino-http";
import { randomUUID } from "node:crypto";
import { safeUrl } from "../lib/logger.js";

export function makeRequestLogger(logger) {
  return pinoHttp({
    logger,
    genReqId(req, res) {
      const incoming = req.headers["x-request-id"];
      const trimmed = typeof incoming === "string" ? incoming.trim() : "";
      const id = trimmed && trimmed.length <= 128 ? trimmed : randomUUID();
      res.setHeader("X-Request-Id", id);
      return id;
    },
    customLogLevel(req, res, err) {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    serializers: {
      // Log only id/method/url — never request headers — so cookies/authorization can't leak.
      req(req) {
        return { id: req.id, method: req.method, url: safeUrl(req.url) };
      },
      // Log only the status — never response headers — so Set-Cookie (session id) can't leak.
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  });
}
