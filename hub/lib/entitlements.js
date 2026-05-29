// lib/entitlements.js
import { randomId, now } from "./tokens.js";

const PRINCIPAL_TYPES = new Set(["company", "team", "user"]);

export function periodKey(period, t) {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  if (period === "day") {
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return `${y}-${m}`; // month (default)
}

export function createEntitlements(db) {
  const principalsForUser = (userId) => {
    const principals = [{ type: "user", id: userId }];
    for (const r of db.prepare("SELECT team_id FROM team_members WHERE user_id=?").all(userId)) {
      principals.push({ type: "team", id: r.team_id });
    }
    for (const r of db.prepare("SELECT company_id FROM company_members WHERE user_id=?").all(userId)) {
      principals.push({ type: "company", id: r.company_id });
    }
    return principals;
  };

  function grantEntitlement({ app, principalType, principalId, quotaLimit = null, quotaPeriod = null, grantedBy = null }) {
    if (!PRINCIPAL_TYPES.has(principalType)) throw new Error("invalid_principal_type");
    db.prepare(`
      INSERT INTO app_entitlements (id,app,principal_type,principal_id,status,quota_limit,quota_period,granted_by,granted_at)
      VALUES (?,?,?,?, 'active', ?,?,?,?)
      ON CONFLICT(app,principal_type,principal_id) DO UPDATE SET
        status='active',
        quota_limit=excluded.quota_limit,
        quota_period=excluded.quota_period,
        granted_by=excluded.granted_by,
        granted_at=excluded.granted_at
    `).run(randomId(), app, principalType, principalId, quotaLimit, quotaPeriod, grantedBy, now());
    return db.prepare("SELECT * FROM app_entitlements WHERE app=? AND principal_type=? AND principal_id=?")
      .get(app, principalType, principalId);
  }

  function revokeEntitlement({ app, principalType, principalId }) {
    db.prepare("UPDATE app_entitlements SET status='suspended' WHERE app=? AND principal_type=? AND principal_id=?")
      .run(app, principalType, principalId);
  }

  return { principalsForUser, grantEntitlement, revokeEntitlement };
}
