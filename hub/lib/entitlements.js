// lib/entitlements.js
import { randomId, now } from './tokens.js';

const PRINCIPAL_TYPES = new Set(['company', 'team', 'user']);

export function periodKey(period, t) {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  if (period === 'day') {
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return `${y}-${m}`; // month (default)
}

export function createEntitlements(db) {
  const principalsForUser = (userId) => {
    const principals = [{ type: 'user', id: userId }];
    for (const r of db.prepare('SELECT team_id FROM team_members WHERE user_id=?').all(userId)) {
      principals.push({ type: 'team', id: r.team_id });
    }
    for (const r of db
      .prepare('SELECT company_id FROM company_members WHERE user_id=?')
      .all(userId)) {
      principals.push({ type: 'company', id: r.company_id });
    }
    return principals;
  };

  function grantEntitlement({
    app,
    principalType,
    principalId,
    quotaLimit = null,
    quotaPeriod = null,
    grantedBy = null,
  }) {
    if (!PRINCIPAL_TYPES.has(principalType)) throw new Error('invalid_principal_type');
    db.prepare(
      `
      INSERT INTO app_entitlements (id,app,principal_type,principal_id,status,quota_limit,quota_period,granted_by,granted_at)
      VALUES (?,?,?,?, 'active', ?,?,?,?)
      ON CONFLICT(app,principal_type,principal_id) DO UPDATE SET
        status='active',
        quota_limit=excluded.quota_limit,
        quota_period=excluded.quota_period,
        granted_by=excluded.granted_by,
        granted_at=excluded.granted_at
    `,
    ).run(randomId(), app, principalType, principalId, quotaLimit, quotaPeriod, grantedBy, now());
    return db
      .prepare('SELECT * FROM app_entitlements WHERE app=? AND principal_type=? AND principal_id=?')
      .get(app, principalType, principalId);
  }

  function revokeEntitlement({ app, principalType, principalId }) {
    db.prepare(
      "UPDATE app_entitlements SET status='suspended' WHERE app=? AND principal_type=? AND principal_id=?",
    ).run(app, principalType, principalId);
  }

  const usageCount = (app, principalType, principalId, pk) => {
    const row = db
      .prepare(
        'SELECT count FROM app_usage WHERE app=? AND principal_type=? AND principal_id=? AND period_key=?',
      )
      .get(app, principalType, principalId, pk);
    return row ? row.count : 0;
  };

  // Returns the chosen entitlement row + computed remaining (null when unlimited), or null when none.
  const select = (userId, app, t) => {
    const principals = principalsForUser(userId);
    const matches = [];
    for (const p of principals) {
      const e = db
        .prepare(
          "SELECT * FROM app_entitlements WHERE app=? AND principal_type=? AND principal_id=? AND status='active'",
        )
        .get(app, p.type, p.id);
      if (e) matches.push(e);
    }
    if (matches.length === 0) return null;
    const unlimited = matches.find((e) => e.quota_limit == null);
    if (unlimited) return { entitlement: unlimited, remaining: null };
    let best = null;
    for (const e of matches) {
      const pk = periodKey(e.quota_period || 'month', t);
      const remaining = e.quota_limit - usageCount(e.app, e.principal_type, e.principal_id, pk);
      if (best === null || remaining > best.remaining) best = { entitlement: e, remaining };
    }
    return best;
  };

  function resolveEntitlement(userId, app, t = now()) {
    const sel = select(userId, app, t);
    if (!sel) return { entitled: false, principal: null, quota: null };
    const e = sel.entitlement;
    const principal = { type: e.principal_type, id: e.principal_id };
    if (e.quota_limit == null) return { entitled: true, principal, quota: null };
    return {
      entitled: true,
      principal,
      quota: { limit: e.quota_limit, period: e.quota_period, remaining: sel.remaining },
    };
  }

  const consumeTx = db.transaction((userId, app, t) => {
    const sel = select(userId, app, t);
    if (!sel) return { ok: false, reason: 'not_entitled' };
    const e = sel.entitlement;
    if (e.quota_limit == null) return { ok: true, remaining: null };
    const pk = periodKey(e.quota_period || 'month', t);
    const count = usageCount(e.app, e.principal_type, e.principal_id, pk);
    if (count >= e.quota_limit) return { ok: false, reason: 'quota_exceeded' };
    db.prepare(
      `
      INSERT INTO app_usage (app,principal_type,principal_id,period_key,count)
      VALUES (?,?,?,?,1)
      ON CONFLICT(app,principal_type,principal_id,period_key) DO UPDATE SET count = count + 1
    `,
    ).run(e.app, e.principal_type, e.principal_id, pk);
    return { ok: true, remaining: e.quota_limit - (count + 1) };
  });

  function consume(userId, app, t = now()) {
    return consumeTx(userId, app, t);
  }

  function listCompanyApps(companyId) {
    return db
      .prepare(
        `
      SELECT app FROM app_entitlements
      WHERE principal_type = 'company' AND principal_id = ? AND status = 'active'
      ORDER BY app
    `,
      )
      .all(companyId)
      .map((r) => r.app);
  }

  return {
    principalsForUser,
    grantEntitlement,
    revokeEntitlement,
    resolveEntitlement,
    consume,
    listCompanyApps,
  };
}
