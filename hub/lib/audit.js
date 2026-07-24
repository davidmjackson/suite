// lib/audit.js
import { now } from './tokens.js';

export function createAuditLogger(db) {
  const stmt = db.prepare(`
    INSERT INTO audit_events (user_id, event_type, app, metadata, created_at, ip)
    VALUES (@userId, @eventType, @app, @metadata, @createdAt, @ip)
  `);
  return {
    log({ userId = null, eventType, app = null, metadata = null, ip = null }) {
      stmt.run({
        userId,
        eventType,
        app,
        metadata: metadata ? JSON.stringify(metadata) : null,
        createdAt: now(),
        ip,
      });
    },
  };
}
