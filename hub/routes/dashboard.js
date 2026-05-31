// routes/dashboard.js
import { createRequireSession } from "../middleware/requireSession.js";
import { createEntitlements } from "../lib/entitlements.js";
import { createOrg } from "../lib/org.js";

const APPS = [
  { key: "raid", name: "Sprintraid", icon: "🛡", desc: "Risks/Issues" },
  { key: "signal", name: "Sprintsignal", icon: "📡", desc: "Team signals" },
  { key: "retro", name: "Sprintretro", icon: "🔄", desc: "Retrospectives" },
  { key: "poker", name: "Sprintpoker", icon: "🎴", desc: "Planning poker" },
];

export function mountDashboard(app) {
  const db = app.locals.db;
  const requireSession = createRequireSession(db);
  const entitlements = createEntitlements(db);
  const org = createOrg(db);
  app.get("/dashboard", requireSession, (req, res) => {
    const apps = APPS.map((a) => ({
      ...a,
      entitled: entitlements.resolveEntitlement(req.user.id, a.key).entitled,
    }));
    const manageable = org.adminCompaniesForUser(req.user.id);
    res.render("dashboard", { user: req.user, apps, manageable });
  });
}
