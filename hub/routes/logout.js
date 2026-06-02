// routes/logout.js
import { parseCookies, clearSessionCookie } from "../lib/cookies.js";
import { createAuditLogger } from "../lib/audit.js";
import { deleteCentralSession } from "../lib/sessions.js";

export function mountLogout(app) {
  const db = app.locals.db;
  const audit = createAuditLogger(db);

  app.get("/logout", (req, res) => {
    const sid = parseCookies(req.headers.cookie).hub_session;
    if (sid) {
      const sess = db.prepare("SELECT user_id FROM central_sessions WHERE id = ?").get(sid);
      deleteCentralSession(db, sid);
      if (sess) audit.log({ userId: sess.user_id, eventType: "hub_logout", ip: req.ip });
    }
    clearSessionCookie(res, "hub_session");
    res.redirect("/");
  });
}
