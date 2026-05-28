// routes/dashboard.js
import { createRequireSession } from "../middleware/requireSession.js";

export function mountDashboard(app) {
  const db = app.locals.db;
  const requireSession = createRequireSession(db);
  app.get("/dashboard", requireSession, (req, res) => {
    res.render("dashboard", { user: req.user });
  });
}
