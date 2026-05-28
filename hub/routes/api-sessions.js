// routes/api-sessions.js
import { now } from "../lib/tokens.js";
import { createRequireApiKey } from "../middleware/requireApiKey.js";
import { createAuditLogger } from "../lib/audit.js";

export function mountApiSessions(app) {
  const db = app.locals.db;
  const config = app.locals.config;
  const requireApiKey = createRequireApiKey(config);
  const audit = createAuditLogger(db);

  app.post("/api/sessions/exchange", requireApiKey, (req, res) => {
    const { launch_token } = req.body || {};
    if (!launch_token) return res.status(400).json({ error: "missing_launch_token" });
    const t = now();
    const consumed = db.prepare(`
      UPDATE launch_tokens SET consumed_at = ?
      WHERE token = ? AND consumed_at IS NULL AND expires_at > ?
    `).run(t, launch_token, t);
    if (consumed.changes === 0) return res.status(400).json({ error: "token_invalid_or_expired" });
    const row = db.prepare(`
      SELECT lt.target_app, lt.central_session_id, u.id AS user_id, u.email, u.display_name, u.disabled_at
      FROM launch_tokens lt
      JOIN central_sessions cs ON cs.id = lt.central_session_id
      JOIN users u ON u.id = cs.user_id
      WHERE lt.token = ?
    `).get(launch_token);
    if (!row) return res.status(400).json({ error: "token_invalid" });
    if (row.target_app !== req.callingApp) return res.status(403).json({ error: "wrong_app" });
    if (row.disabled_at) return res.status(403).json({ error: "user_disabled" });
    audit.log({ userId: row.user_id, eventType: "session_exchanged", app: req.callingApp, ip: req.ip });
    res.json({
      user: { id: row.user_id, email: row.email, displayName: row.display_name },
      central_session_id: row.central_session_id,
    });
  });

  app.post("/api/sessions/:id/heartbeat", requireApiKey, (req, res) => {
    const sid = req.params.id;
    const t = now();
    const idleCutoff = t - config.sessionIdleMs;
    const r = db.prepare(`
      UPDATE central_sessions SET last_heartbeat_at = ?
      WHERE id = ? AND expires_at > ? AND last_heartbeat_at > ?
    `).run(t, sid, t, idleCutoff);
    if (r.changes === 0) return res.status(404).json({ error: "session_not_found" });
    res.status(200).json({ ok: true });
  });

  app.delete("/api/sessions/:id", requireApiKey, (req, res) => {
    const sid = req.params.id;
    const sess = db.prepare("SELECT user_id FROM central_sessions WHERE id = ?").get(sid);
    db.prepare("DELETE FROM central_sessions WHERE id = ?").run(sid);
    if (sess) audit.log({ userId: sess.user_id, eventType: "logged_out", app: req.callingApp, ip: req.ip });
    res.status(204).end();
  });
}
