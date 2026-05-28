// middleware/requireSession.js
import { parseCookies } from "../lib/cookies.js";
import { now } from "../lib/tokens.js";

export function createRequireSession(db, { cookieName = "hub_session", loginPath = "/login" } = {}) {
  const lookup = db.prepare(`
    SELECT cs.id AS session_id, u.id AS user_id, u.email, u.display_name, u.is_admin, u.disabled_at
    FROM central_sessions cs
    JOIN users u ON u.id = cs.user_id
    WHERE cs.id = ? AND cs.expires_at > ? AND cs.last_heartbeat_at > ?
  `);
  const touch = db.prepare(`UPDATE central_sessions SET last_heartbeat_at = ? WHERE id = ?`);

  return (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies[cookieName];
    if (!sid) {
      const returnTo = encodeURIComponent(req.originalUrl || req.url || "/");
      return res.redirect(`${loginPath}?return_to=${returnTo}`);
    }
    const t = now();
    const idleCutoff = t - (30 * 60 * 1000);
    const row = lookup.get(sid, t, idleCutoff);
    if (!row || row.disabled_at) {
      const returnTo = encodeURIComponent(req.originalUrl || req.url || "/");
      return res.redirect(`${loginPath}?return_to=${returnTo}`);
    }
    touch.run(t, sid);
    req.user = { id: row.user_id, email: row.email, displayName: row.display_name, isAdmin: !!row.is_admin };
    req.sessionId = row.session_id;
    next();
  };
}
