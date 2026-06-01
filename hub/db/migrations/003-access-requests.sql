-- 003-access-requests.sql
CREATE TABLE IF NOT EXISTS access_requests (
  id            TEXT PRIMARY KEY,
  company_name  TEXT NOT NULL,
  contact_name  TEXT NOT NULL,
  email         TEXT NOT NULL,
  job_title     TEXT,
  team_size     TEXT,
  apps_interest TEXT,
  message       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    INTEGER NOT NULL,
  reviewed_by   TEXT REFERENCES users(id),
  reviewed_at   INTEGER,
  review_note   TEXT,
  company_id    TEXT REFERENCES companies(id)
);
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);

INSERT INTO schema_version (version, applied_at) VALUES (3, strftime('%s','now')*1000)
  ON CONFLICT(version) DO NOTHING;
