// lib/logger.js — structured logging for the hub (pino).
//
// Reads NODE_ENV / LOG_LEVEL from the environment directly (NOT config.js) so
// importing this module never triggers config.js's required() throws.
import { pino } from 'pino';

// Field paths redacted everywhere as defense-in-depth. Request headers are not
// logged at all (see middleware/requestLogger.js), so cookies/authorization
// never reach a log record; these paths catch app-level logs that include a
// token/password field.
export const REDACT_PATHS = ['token', '*.token', 'password', '*.password'];

// Query-string keys whose values are masked by safeUrl (e.g. magic-link tokens).
const SENSITIVE_QUERY = new Set(['token', 'password']);

// Mask sensitive query param values in a URL while preserving the path,
// every other param byte-for-byte, and any #fragment. Uses targeted
// replacement (not a URLSearchParams round-trip) so the sentinel stays
// readable as "[redacted]" and nothing else is re-encoded.
export function safeUrl(url) {
  if (typeof url !== 'string') return url;
  const q = url.indexOf('?');
  if (q === -1) return url;
  const path = url.slice(0, q);
  const query = url.slice(q + 1);
  const masked = query.replace(/([^&=#?]+)=([^&#]*)/g, (match, key, _val) =>
    SENSITIVE_QUERY.has(decodeURIComponent(key).toLowerCase()) ? `${key}=[redacted]` : match,
  );
  return `${path}?${masked}`;
}

export function createLogger({ level, pretty = false, stream } = {}) {
  const opts = {
    level: level ?? process.env.LOG_LEVEL ?? 'info',
    base: { service: 'hub' },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  };
  // `stream` takes precedence over `pretty` (used by tests for log capture).
  if (stream) return pino(opts, stream);
  if (pretty) return pino({ ...opts, transport: { target: 'pino-pretty' } });
  return pino(opts);
}

const logger = createLogger({ pretty: process.env.NODE_ENV === 'development' });
export default logger;
