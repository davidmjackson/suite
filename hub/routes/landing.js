// routes/landing.js
import { parseCookies } from "../lib/cookies.js";

export function mountLanding(app) {
  app.get("/", (req, res) => {
    const db = req.app.locals.db;
    const sid = parseCookies(req.headers.cookie).hub_session;
    let user = null;
    if (sid) {
      const row = db.prepare(`
        SELECT u.email FROM central_sessions cs
        JOIN users u ON u.id = cs.user_id
        WHERE cs.id = ? AND cs.expires_at > ?
      `).get(sid, Date.now());
      if (row) user = { email: row.email };
    }
    res.render("landing", { user });
  });
}
