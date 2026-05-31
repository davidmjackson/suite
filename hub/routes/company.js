// routes/company.js
import { createRequireSession } from "../middleware/requireSession.js";
import { createRequireCompanyRole } from "../middleware/requireCompanyRole.js";
import { createOrg } from "../lib/org.js";
import { createAuditLogger } from "../lib/audit.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function mountCompany(app) {
  const db = app.locals.db;
  const requireSession = createRequireSession(db);
  const companyRole = createRequireCompanyRole(db);
  const org = createOrg(db);
  const audit = createAuditLogger(db);
  const manage = [requireSession, companyRole(["owner", "admin"])];

  app.get("/company/:slug", ...manage, (req, res) => {
    const members = org.listCompanyMembers(req.company.id);
    const teams = org.listTeams(req.company.id);
    res.render("company/console", {
      user: req.user,
      company: req.company,
      companyRole: req.companyRole,
      members,
      teams,
    });
  });
}
