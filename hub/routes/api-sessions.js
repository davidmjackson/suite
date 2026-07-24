// routes/api-sessions.js
//
// Shape (the reference for splitting the other route factories): handlers live at
// module scope as named functions taking `(deps, req, res)`, and mountX is reduced
// to the dependency wiring plus a table of route → handler. Nothing about the
// behaviour changes; what changes is that each handler can be read, and measured,
// on its own.
import { now } from '../lib/tokens.js';
import { createRequireApiKey } from '../middleware/requireApiKey.js';
import { createAuditLogger } from '../lib/audit.js';
import { createEntitlements } from '../lib/entitlements.js';
import { createOrg } from '../lib/org.js';
import { deleteCentralSession } from '../lib/sessions.js';
import { exchangeSchema } from '../schemas/api.js';

// Consume first: this is the atomic step, and it is what makes a launch token
// one-shot. A token that loses the race must reveal nothing about whether it ever
// existed, so the caller answers the same either way.
function consumeLaunchToken(db, token) {
  const t = now();
  const consumed = db
    .prepare(
      `
      UPDATE launch_tokens SET consumed_at = ?
      WHERE token = ? AND consumed_at IS NULL AND expires_at > ?
    `,
    )
    .run(t, token, t);
  return consumed.changes > 0;
}

function loadLaunchContext(db, token) {
  return db
    .prepare(
      `
      SELECT lt.target_app, lt.central_session_id, u.id AS user_id, u.email, u.display_name, u.disabled_at
      FROM launch_tokens lt
      JOIN central_sessions cs ON cs.id = lt.central_session_id
      JOIN users u ON u.id = cs.user_id
      WHERE lt.token = ?
    `,
    )
    .get(token);
}

// Company context comes from membership, not only from a company-typed
// entitlement — Signal/RAID are granted per-user yet still belong to a company.
// TODO(multi-tenancy): per-user entitlements carry no company scope, so this
// picks an arbitrary membership. Correct while every user is single-company;
// when a user can belong to 2+ companies, scope this to the launch context.
function companyIdFor(db, userId, entitlement) {
  if (entitlement.entitled && entitlement.principal?.type === 'company') {
    return entitlement.principal.id;
  }
  return (
    db.prepare('SELECT company_id FROM company_members WHERE user_id = ?').get(userId)
      ?.company_id ?? null
  );
}

function teamsFor(org, userId, companyId, company) {
  if (!companyId) return [];
  return org.teamsForUser(userId, companyId).map((t) => ({ ...t, company: company?.name || null }));
}

function exchangeSession({ db, org, entitlements, audit }, req, res) {
  const parsed = exchangeSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'missing_launch_token' });
  if (!consumeLaunchToken(db, parsed.data.launch_token)) {
    return res.status(400).json({ error: 'token_invalid_or_expired' });
  }
  const row = loadLaunchContext(db, parsed.data.launch_token);
  if (!row) return res.status(400).json({ error: 'token_invalid' });
  if (row.target_app !== req.callingApp) return res.status(403).json({ error: 'wrong_app' });
  if (row.disabled_at) return res.status(403).json({ error: 'user_disabled' });

  const entitlement = entitlements.resolveEntitlement(row.user_id, row.target_app);
  const companyId = companyIdFor(db, row.user_id, entitlement);
  const company = companyId ? org.getCompany(companyId) : null;
  audit.log({
    userId: row.user_id,
    eventType: 'session_exchanged',
    app: req.callingApp,
    ip: req.ip,
  });
  res.json({
    user: { id: row.user_id, email: row.email, displayName: row.display_name },
    central_session_id: row.central_session_id,
    entitlement,
    teams: teamsFor(org, row.user_id, companyId, company),
    company: company ? { id: company.id, name: company.name } : null,
  });
}

function heartbeat({ db, config }, req, res) {
  const t = now();
  const r = db
    .prepare(
      `
      UPDATE central_sessions SET last_heartbeat_at = ?
      WHERE id = ? AND expires_at > ? AND last_heartbeat_at > ?
    `,
    )
    .run(t, req.params.id, t, t - config.sessionIdleMs);
  if (r.changes === 0) return res.status(404).json({ error: 'session_not_found' });
  res.status(200).json({ ok: true });
}

function endSession({ db, audit }, req, res) {
  const sid = req.params.id;
  const sess = db.prepare('SELECT user_id FROM central_sessions WHERE id = ?').get(sid);
  deleteCentralSession(db, sid);
  if (sess) {
    audit.log({ userId: sess.user_id, eventType: 'logged_out', app: req.callingApp, ip: req.ip });
  }
  res.status(204).end();
}

export function mountApiSessions(app) {
  const db = app.locals.db;
  const config = app.locals.config;
  const deps = {
    db,
    config,
    audit: createAuditLogger(db),
    entitlements: createEntitlements(db),
    org: createOrg(db),
  };
  const requireApiKey = createRequireApiKey(config);

  app.post('/api/sessions/exchange', requireApiKey, (req, res) => exchangeSession(deps, req, res));
  app.post('/api/sessions/:id/heartbeat', requireApiKey, (req, res) => heartbeat(deps, req, res));
  app.delete('/api/sessions/:id', requireApiKey, (req, res) => endSession(deps, req, res));
}
