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

  app.post("/company/:slug/members/:userId/role", ...manage, (req, res) => {
    const role = req.body.role;
    const targetId = req.params.userId;
    if (!["owner", "admin", "member"].includes(role)) {
      return res.status(400).render("error", { title: "Bad request", message: "Invalid role." });
    }
    const target = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?")
      .get(targetId, req.company.id);
    if (!target) {
      return res.status(404).render("error", { title: "Not found", message: "Not a member of this company." });
    }
    if (req.companyRole === "admin" && (role === "owner" || target.role === "owner")) {
      return res.status(403).render("error", { title: "Forbidden", message: "Only an owner can manage owners." });
    }
    try {
      org.setCompanyMemberRole({ userId: targetId, companyId: req.company.id, role });
    } catch (e) {
      if (e.message === "last_owner") {
        return res.status(400).render("error", { title: "Can't change role", message: "A company must keep at least one owner." });
      }
      throw e;
    }
    audit.log({ userId: req.user.id, eventType: "company_member_role_changed", metadata: { company: req.company.slug, target: targetId, role }, ip: req.ip });
    res.redirect("/company/" + req.company.slug);
  });

  app.post("/company/:slug/members/:userId/remove", ...manage, (req, res) => {
    const targetId = req.params.userId;
    const target = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?")
      .get(targetId, req.company.id);
    if (!target) {
      return res.status(404).render("error", { title: "Not found", message: "Not a member of this company." });
    }
    if (req.companyRole === "admin" && target.role === "owner") {
      return res.status(403).render("error", { title: "Forbidden", message: "Only an owner can remove an owner." });
    }
    try {
      org.removeCompanyMember({ userId: targetId, companyId: req.company.id });
    } catch (e) {
      if (e.message === "last_owner") {
        return res.status(400).render("error", { title: "Can't remove", message: "A company must keep at least one owner." });
      }
      throw e;
    }
    audit.log({ userId: req.user.id, eventType: "company_member_removed", metadata: { company: req.company.slug, target: targetId }, ip: req.ip });
    res.redirect("/company/" + req.company.slug);
  });
}
