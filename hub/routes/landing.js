// routes/landing.js
import { parseCookies } from "../lib/cookies.js";
import { now } from "../lib/tokens.js";

export function mountLanding(app) {
  app.get("/", (req, res) => {
    const db = req.app.locals.db;
    const sid = parseCookies(req.headers.cookie).hub_session;
    if (sid) {
      const t = now();
      const idleCutoff = t - 30 * 60 * 1000;
      const row = db.prepare(`
        SELECT u.disabled_at
        FROM central_sessions cs
        JOIN users u ON u.id = cs.user_id
        WHERE cs.id = ? AND cs.expires_at > ? AND cs.last_heartbeat_at > ?
      `).get(sid, t, idleCutoff);
      if (row && !row.disabled_at) return res.redirect("/dashboard");
    }
    res.render("landing", { signinUrl: "/login", requestUrl: "/request" });
  });
}
