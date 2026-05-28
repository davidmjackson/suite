// scripts/prune.js
import { now } from "../lib/tokens.js";

export function prune(db, { auditTtlMs = 90 * 24 * 60 * 60 * 1000 } = {}) {
  const t = now();
  const sess = db.prepare("DELETE FROM central_sessions WHERE expires_at <= ?").run(t);
  const mlt = db.prepare("DELETE FROM magic_link_tokens WHERE expires_at <= ?").run(t - 60_000);
  const lt = db.prepare("DELETE FROM launch_tokens WHERE expires_at <= ?").run(t - 60_000);
  const ae = db.prepare("DELETE FROM audit_events WHERE created_at < ?").run(t - auditTtlMs);
  return { sessionsDeleted: sess.changes, magicLinksDeleted: mlt.changes, launchTokensDeleted: lt.changes, auditDeleted: ae.changes };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const { default: config } = await import("../config.js");
  const { openDb } = await import("../db/index.js");
  const db = openDb(config.dbPath);
  const r = prune(db);
  console.log(`[${new Date().toISOString()}] prune:`, r);
  db.close();
}
