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

  app.post("/company/:slug/members", ...manage, (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    const role = req.body.role || "member";
    if (!EMAIL_RE.test(email)) {
      return res.status(400).render("error", { title: "Bad request", message: "Invalid email." });
    }
    if (!["owner", "admin", "member"].includes(role)) {
      return res.status(400).render("error", { title: "Bad request", message: "Invalid role." });
    }
    if (req.companyRole === "admin" && role === "owner") {
      return res.status(403).render("error", { title: "Forbidden", message: "Only an owner can grant the owner role." });
    }
    const r = org.inviteCompanyMember({ email, companyId: req.company.id, role });
    if (!r.alreadyMember) {
      audit.log({ userId: req.user.id, eventType: "company_member_invited", metadata: { company: req.company.slug, email, role }, ip: req.ip });
    }
    res.redirect("/company/" + req.company.slug);
  });
}
