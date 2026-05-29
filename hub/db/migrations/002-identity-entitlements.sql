-- 002-identity-entitlements.sql
CREATE TABLE IF NOT EXISTS companies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS company_members (
  user_id     TEXT NOT NULL REFERENCES users(id),
  company_id  TEXT NOT NULL REFERENCES companies(id),
  role        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, company_id)
);

CREATE TABLE IF NOT EXISTS team_members (
  user_id     TEXT NOT NULL REFERENCES users(id),
  team_id     TEXT NOT NULL REFERENCES teams(id),
  role        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_teams_company       ON teams(company_id);
CREATE INDEX IF NOT EXISTS idx_company_members_co  ON company_members(company_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team   ON team_members(team_id);

CREATE TABLE IF NOT EXISTS app_entitlements (
  id              TEXT PRIMARY KEY,
  app             TEXT NOT NULL,
  principal_type  TEXT NOT NULL,
  principal_id    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  quota_limit     INTEGER,
  quota_period    TEXT,
  granted_by      TEXT REFERENCES users(id),
  granted_at      INTEGER NOT NULL,
  UNIQUE(app, principal_type, principal_id)
);
CREATE INDEX IF NOT EXISTS idx_entitlements_principal ON app_entitlements(principal_type, principal_id);
CREATE INDEX IF NOT EXISTS idx_entitlements_app       ON app_entitlements(app);

CREATE TABLE IF NOT EXISTS app_usage (
  app             TEXT NOT NULL,
  principal_type  TEXT NOT NULL,
  principal_id    TEXT NOT NULL,
  period_key      TEXT NOT NULL,
  count           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (app, principal_type, principal_id, period_key)
);

INSERT INTO schema_version (version, applied_at) VALUES (2, strftime('%s','now')*1000)
  ON CONFLICT(version) DO NOTHING;
