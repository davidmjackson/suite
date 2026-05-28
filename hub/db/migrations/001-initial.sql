-- 001-initial.sql
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  disabled_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS central_sessions (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id),
  created_at          INTEGER NOT NULL,
  last_heartbeat_at   INTEGER NOT NULL,
  expires_at          INTEGER NOT NULL,
  user_agent          TEXT,
  ip                  TEXT
);
CREATE INDEX IF NOT EXISTS idx_central_sessions_user ON central_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_central_sessions_expires ON central_sessions(expires_at);

CREATE TABLE IF NOT EXISTS magic_link_tokens (
  token         TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  return_to     TEXT,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  consumed_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mlt_email ON magic_link_tokens(email);

CREATE TABLE IF NOT EXISTS launch_tokens (
  token                 TEXT PRIMARY KEY,
  central_session_id    TEXT NOT NULL REFERENCES central_sessions(id),
  target_app            TEXT NOT NULL,
  created_at            INTEGER NOT NULL,
  expires_at            INTEGER NOT NULL,
  consumed_at           INTEGER
);

CREATE TABLE IF NOT EXISTS audit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT,
  event_type  TEXT NOT NULL,
  app         TEXT,
  metadata    TEXT,
  created_at  INTEGER NOT NULL,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
INSERT INTO schema_version (version, applied_at) VALUES (1, strftime('%s','now')*1000)
  ON CONFLICT(version) DO NOTHING;
