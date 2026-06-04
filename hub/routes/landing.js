// routes/landing.js
import { parseCookies } from "../lib/cookies.js";

export function mountLanding(app) {
  app.get("/", (req, res) => {
    const db = req.app.locals.db;
    const sid = parseCookies(req.headers.cookie).hub_session;
    if (sid) {
      const row = db.prepare(`
        SELECT 1 FROM central_sessions cs
        WHERE cs.id = ? AND cs.expires_at > ?
      `).get(sid, Date.now());
      if (row) return res.redirect("/dashboard");
    }
    res.render("landing", { signinUrl: "/login" });
  });
}
