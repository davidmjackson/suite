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
      expires_at INTEGER NOT NULL,
      entitled INTEGER NOT NULL DEFAULT 0,
      teams TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_app_sessions_central ON app_sessions(central_session_id);
  `);
  const cols = db.prepare("PRAGMA table_info(app_sessions)").all().map((c) => c.name);
  if (!cols.includes("entitled")) db.exec("ALTER TABLE app_sessions ADD COLUMN entitled INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes("teams")) db.exec("ALTER TABLE app_sessions ADD COLUMN teams TEXT NOT NULL DEFAULT '[]'");
  return {
    create({ id, userId, centralSessionId, expiresAt, entitled = false, teams = [] }) {
      const t = Date.now();
      db.prepare(`INSERT INTO app_sessions (id,user_id,central_session_id,created_at,last_validated_at,expires_at,entitled,teams) VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, userId, centralSessionId, t, t, expiresAt, entitled ? 1 : 0, JSON.stringify(teams));
    },
    get(id) {
      const row = db.prepare("SELECT * FROM app_sessions WHERE id = ? AND expires_at > ?").get(id, Date.now());
      if (!row) return undefined;
      let teams;
      try { teams = JSON.parse(row.teams || "[]"); } catch { teams = []; }
      return { ...row, entitled: !!row.entitled, teams };
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
