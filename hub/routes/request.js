// routes/request.js
import { createAccessRequests } from "../lib/access-requests.js";
import { createLimiter } from "../lib/rate-limit.js";
import { createAuditLogger } from "../lib/audit.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const APP_KEYS = ["poker", "retro", "signal", "raid"];
const ipLimiter = createLimiter({ max: 5, windowMs: 60 * 60 * 1000 });

export function mountRequest(app, { emailSender } = {}) {
  const db = app.locals.db;
  const reqs = createAccessRequests(db);
  const audit = createAuditLogger(db);

  app.get("/request", (req, res) => {
    res.render("request", { error: null, values: {} });
  });

  app.post("/request", (req, res) => {
    // Honeypot: a hidden field bots tend to fill. Real users leave it empty.
    if ((req.body.website || "").trim() !== "") {
      return res.render("request-received", {});
    }
    if (!ipLimiter.check(req.ip)) {
      return res.status(429).render("error", { title: "Too many requests", message: "Please wait a little while and try again." });
    }

    const companyName = (req.body.company_name || "").trim();
    const contactName = (req.body.contact_name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const jobTitle = (req.body.job_title || "").trim() || null;
    const teamSize = (req.body.team_size || "").trim() || null;
    const message = (req.body.message || "").trim() || null;

    let apps = req.body.apps;
    if (typeof apps === "string") apps = [apps];
    apps = Array.isArray(apps) ? apps.filter((a) => APP_KEYS.includes(a)) : [];

    if (!companyName || !contactName || !EMAIL_RE.test(email)) {
      return res.status(400).render("request", {
        error: "Please provide a company, your name, and a valid email.",
        values: { company_name: companyName, contact_name: contactName, email, job_title: jobTitle, team_size: teamSize, message },
      });
    }

    reqs.createRequest({ companyName, contactName, email, jobTitle, teamSize, appsInterest: apps, message });
    audit.log({ userId: null, eventType: "access_requested", metadata: { company: companyName, email }, ip: req.ip });
    res.render("request-received", {});
  });
}
