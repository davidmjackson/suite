// routes/admin.js
import { createRequireSession } from "../middleware/requireSession.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { randomId, now } from "../lib/tokens.js";
import { createAuditLogger } from "../lib/audit.js";

export function mountAdmin(app) {
  const db = app.locals.db;
  const requireSession = createRequireSession(db);
  const audit = createAuditLogger(db);

  app.get("/admin", requireSession, requireAdmin, (req, res) => {
    const users = db.prepare(`
      SELECT u.id, u.email, u.display_name, u.is_admin, u.disabled_at,
             (SELECT COUNT(*) FROM central_sessions cs WHERE cs.user_id = u.id) AS session_count
      FROM users u ORDER BY u.email
    `).all();
    res.render("admin/users", { user: req.user, users });
  });

  app.post("/admin/users", requireSession, requireAdmin, (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    const displayName = (req.body.display_name || "").trim() || null;
    const isAdmin = req.body.is_admin === "1" ? 1 : 0;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).render("error", { title: "Bad request", message: "Invalid email." });
    }
    try {
      const id = randomId();
      db.prepare("INSERT INTO users (id,email,display_name,is_admin,created_at) VALUES (?,?,?,?,?)")
        .run(id, email, displayName, isAdmin, now());
      audit.log({ userId: req.user.id, eventType: "user_created", metadata: { email }, ip: req.ip });
    } catch (e) {
      if (/UNIQUE/.test(e.message)) {
        return res.status(400).render("error", { title: "Already exists", message: "A user with that email already exists." });
      }
      throw e;
    }
    res.redirect("/admin");
  });

  app.post("/admin/users/:id/disable", requireSession, requireAdmin, (req, res) => {
    const id = req.params.id;
    db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(now(), id);
    db.prepare("DELETE FROM central_sessions WHERE user_id = ?").run(id);
    audit.log({ userId: req.user.id, eventType: "user_disabled", metadata: { target: id }, ip: req.ip });
    res.redirect("/admin");
  });

  app.post("/admin/users/:id/enable", requireSession, requireAdmin, (req, res) => {
    db.prepare("UPDATE users SET disabled_at = NULL WHERE id = ?").run(req.params.id);
    res.redirect("/admin");
  });

  app.post("/admin/users/:id/delete", requireSession, requireAdmin, (req, res) => {
    const id = req.params.id;
    if (id === req.user.id) return res.status(400).render("error", { title: "Can't delete self", message: "Use another admin account." });
    db.prepare("DELETE FROM central_sessions WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    audit.log({ userId: req.user.id, eventType: "user_deleted", metadata: { target: id }, ip: req.ip });
    res.redirect("/admin");
  });
}
