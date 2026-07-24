// lib/entitlements.js
//
// Shape (the reference for splitting the other lib factories): the operations live
// at module scope taking `db` as their first argument, and createEntitlements(db)
// is reduced to binding them. Behaviour is unchanged — the returned object has the
// same six methods with the same signatures — but each operation is now readable,
// and measurable, on its own instead of being one 126-line closure.
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

function principalsForUser(db, userId) {
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
}

function grantEntitlement(
  db,
  { app, principalType, principalId, quotaLimit = null, quotaPeriod = null, grantedBy = null },
) {
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

function revokeEntitlement(db, { app, principalType, principalId }) {
  db.prepare(
    "UPDATE app_entitlements SET status='suspended' WHERE app=? AND principal_type=? AND principal_id=?",
  ).run(app, principalType, principalId);
}

// Takes the entitlement row rather than its three key columns: both call sites
// have the row in hand, and the split-out signature would otherwise want five
// arguments.
function usageCount(db, e, pk) {
  const row = db
    .prepare(
      'SELECT count FROM app_usage WHERE app=? AND principal_type=? AND principal_id=? AND period_key=?',
    )
    .get(e.app, e.principal_type, e.principal_id, pk);
  return row ? row.count : 0;
}

// Returns the chosen entitlement row + computed remaining (null when unlimited), or null when none.
function select(db, userId, app, t) {
  const matches = [];
  for (const p of principalsForUser(db, userId)) {
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
    const remaining = e.quota_limit - usageCount(db, e, periodKey(e.quota_period || 'month', t));
    if (best === null || remaining > best.remaining) best = { entitlement: e, remaining };
  }
  return best;
}

function resolveEntitlement(db, userId, app, t) {
  const sel = select(db, userId, app, t);
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

// The body of consume(). Always called inside db.transaction() — the read of the
// current count and the increment must not interleave with another consumer, or
// the quota is a suggestion.
function consumeOnce(db, userId, app, t) {
  const sel = select(db, userId, app, t);
  if (!sel) return { ok: false, reason: 'not_entitled' };
  const e = sel.entitlement;
  if (e.quota_limit == null) return { ok: true, remaining: null };
  const pk = periodKey(e.quota_period || 'month', t);
  const count = usageCount(db, e, pk);
  if (count >= e.quota_limit) return { ok: false, reason: 'quota_exceeded' };
  db.prepare(
    `
      INSERT INTO app_usage (app,principal_type,principal_id,period_key,count)
      VALUES (?,?,?,?,1)
      ON CONFLICT(app,principal_type,principal_id,period_key) DO UPDATE SET count = count + 1
    `,
  ).run(e.app, e.principal_type, e.principal_id, pk);
  return { ok: true, remaining: e.quota_limit - (count + 1) };
}

function listCompanyApps(db, companyId) {
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

export function createEntitlements(db) {
  const consumeTx = db.transaction((userId, app, t) => consumeOnce(db, userId, app, t));
  return {
    principalsForUser: (userId) => principalsForUser(db, userId),
    grantEntitlement: (grant) => grantEntitlement(db, grant),
    revokeEntitlement: (target) => revokeEntitlement(db, target),
    resolveEntitlement: (userId, app, t = now()) => resolveEntitlement(db, userId, app, t),
    consume: (userId, app, t = now()) => consumeTx(userId, app, t),
    listCompanyApps: (companyId) => listCompanyApps(db, companyId),
  };
}
