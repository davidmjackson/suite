// routes/admin.js
import { createRequireSession } from "../middleware/requireSession.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { randomId, now } from "../lib/tokens.js";
import { createAuditLogger } from "../lib/audit.js";
import { createOrg } from "../lib/org.js";
import { createEntitlements } from "../lib/entitlements.js";
import { createAccessRequests } from "../lib/access-requests.js";
import { createProvisioner } from "../lib/provisioning.js";
import { deleteCentralSession, deleteCentralSessionsForUser } from "../lib/sessions.js";
import { deleteUser } from "../lib/users.js";
import logger from "../lib/logger.js";

function safeAppsLabel(json) {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) && arr.length ? arr.join(", ") : null;
  } catch {
    return null;
  }
}

export function mountAdmin(app, { emailSender } = {}) {
  const db = app.locals.db;
  const requireSession = createRequireSession(db);
  const audit = createAuditLogger(db);
  const config = app.locals.config;
  const org = createOrg(db);
  const ent = createEntitlements(db);
  const reqs = createAccessRequests(db);
  const provisioner = createProvisioner(db, { inviteTtlMs: config.inviteTtlMs });

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
    deleteCentralSessionsForUser(db, id);
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
    deleteUser(db, id);
    audit.log({ userId: req.user.id, eventType: "user_deleted", metadata: { target: id }, ip: req.ip });
    res.redirect("/admin");
  });

  app.get("/admin/sessions", requireSession, requireAdmin, (req, res) => {
    const sessions = db.prepare(`
      SELECT cs.id, cs.created_at, cs.last_heartbeat_at, cs.ip, u.email
      FROM central_sessions cs JOIN users u ON u.id = cs.user_id
      ORDER BY cs.last_heartbeat_at DESC
    `).all();
    res.render("admin/sessions", { user: req.user, sessions });
  });

  app.post("/admin/sessions/:id/kill", requireSession, requireAdmin, (req, res) => {
    deleteCentralSession(db, req.params.id);
    audit.log({ userId: req.user.id, eventType: "session_killed", metadata: { target: req.params.id }, ip: req.ip });
    res.redirect("/admin/sessions");
  });

  app.get("/admin/audit", requireSession, requireAdmin, (req, res) => {
    const events = db.prepare(`
      SELECT ae.id, ae.user_id, ae.event_type, ae.app, ae.ip, ae.created_at, u.email
      FROM audit_events ae LEFT JOIN users u ON u.id = ae.user_id
      ORDER BY ae.id DESC LIMIT 200
    `).all();
    res.render("admin/audit", { user: req.user, events });
  });

  app.get("/admin/companies", requireSession, requireAdmin, (req, res) => {
    const companies = org.listAllCompanies();
    const appsByCompany = {};
    for (const c of companies) appsByCompany[c.id] = ent.listCompanyApps(c.id);
    const pending = reqs.listByStatus("pending");
    // Flag likely-duplicate requests so the operator doesn't provision a second
    // company for the same person/name: same email across pending requests, or a
    // requested company name that already matches an existing company.
    const norm = (s) => (s || "").trim().toLowerCase();
    const emailCounts = new Map();
    for (const r of pending) {
      const k = norm(r.email);
      if (k) emailCounts.set(k, (emailCounts.get(k) || 0) + 1);
    }
    const existingNames = new Set(companies.map((c) => norm(c.name)));
    const requests = pending.map((r) => ({
      ...r,
      appsLabel: r.apps_interest ? safeAppsLabel(r.apps_interest) : null,
      dupeEmail: !!norm(r.email) && emailCounts.get(norm(r.email)) > 1,
      existingCompany: !!norm(r.company_name) && existingNames.has(norm(r.company_name)),
    }));
    res.render("admin/companies", { user: req.user, companies, appsByCompany, requests });
  });

  app.post("/admin/requests/:id/approve", requireSession, requireAdmin, async (req, res) => {
    const result = provisioner.approve({ requestId: req.params.id, grantedBy: req.user.id });
    if (!result.ok) {
      const message = result.reason === "not_pending"
        ? "That request has already been handled."
        : "Request not found.";
      return res.status(400).render("error", { title: "Can't approve", message });
    }
    audit.log({ userId: req.user.id, eventType: "access_request_approved", metadata: { company: result.company.slug, email: result.user.email }, ip: req.ip });
    const url = `${config.baseUrl}/auth/magic?token=${result.token}`;
    try {
      if (emailSender) await emailSender.sendAccessApproved({ to: result.user.email, url });
    } catch (err) {
      (req.log || logger).error({ err }, "access-approved email send failed");
    }
    res.redirect("/admin/companies");
  });

  app.post("/admin/requests/:id/reject", requireSession, requireAdmin, (req, res) => {
    const note = (req.body.review_note || "").trim() || null;
    const r = reqs.getRequest(req.params.id);
    if (!r || r.status !== "pending") {
      return res.status(400).render("error", { title: "Can't reject", message: "That request has already been handled." });
    }
    reqs.markReviewed({ id: req.params.id, status: "rejected", reviewedBy: req.user.id, note });
    audit.log({ userId: req.user.id, eventType: "access_request_rejected", metadata: { email: r.email }, ip: req.ip });
    res.redirect("/admin/companies");
  });
}
