// lib/sessions-db.js
const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");

function createSessionsStore(dbPath) {
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      central_session_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_validated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_app_sessions_central ON app_sessions(central_session_id);
  `);
  return {
    create({ id, userId, centralSessionId, expiresAt }) {
      const t = Date.now();
      db.prepare(`INSERT INTO app_sessions (id,user_id,central_session_id,created_at,last_validated_at,expires_at) VALUES (?,?,?,?,?,?)`)
        .run(id, userId, centralSessionId, t, t, expiresAt);
    },
    get(id) {
      return db.prepare("SELECT * FROM app_sessions WHERE id = ? AND expires_at > ?").get(id, Date.now());
    },
    touch(id) {
      db.prepare("UPDATE app_sessions SET last_validated_at = ? WHERE id = ?").run(Date.now(), id);
    },
    delete(id) {
      db.prepare("DELETE FROM app_sessions WHERE id = ?").run(id);
    },
    deleteExpired() {
      return db.prepare("DELETE FROM app_sessions WHERE expires_at <= ?").run(Date.now()).changes;
    },
  };
}

module.exports = { createSessionsStore };
