// routes/login.js
import { randomToken, now } from "../lib/tokens.js";
import { createAuditLogger } from "../lib/audit.js";
import { createLimiter } from "../lib/rate-limit.js";
import logger from "../lib/logger.js";

const ipLimiter = createLimiter({ max: 5, windowMs: 60 * 1000 });
const emailLimiter = createLimiter({ max: 10, windowMs: 60 * 60 * 1000 });

function validateReturnTo(url, allowed) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const origin = `${u.protocol}//${u.host}`;
    return allowed.includes(origin) ? url : null;
  } catch { return null; }
}

export function mountLogin(app, { emailSender } = {}) {
  const db = app.locals.db;
  const config = app.locals.config;
  const audit = createAuditLogger(db);

  app.get("/login", (req, res) => {
    const returnTo = validateReturnTo(req.query.return_to, config.allowedAppDomains);
    res.render("login", { returnTo });
  });

  app.post("/login", async (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    const returnTo = validateReturnTo(req.body.return_to, config.allowedAppDomains);
    const ip = req.ip;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).render("error", { title: "Bad request", message: "Invalid email." });
    }
    if (!ipLimiter.check(ip) || !emailLimiter.check(email)) {
      return res.status(429).render("error", { title: "Too many requests", message: "Please wait a minute and try again." });
    }

    const user = db.prepare("SELECT id, disabled_at FROM users WHERE email = ?").get(email);
    if (user && !user.disabled_at) {
      const token = randomToken();
      const t = now();
      db.prepare(`
        INSERT INTO magic_link_tokens (token, email, return_to, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(token, email, returnTo, t, t + config.magicLinkTtlMs);

      const url = `${config.baseUrl}/auth/magic?token=${token}`;
      try {
        if (emailSender) await emailSender.sendMagicLink({ to: email, url });
      } catch (err) {
        (req.log || logger).error({ err }, "magic link send failed");
      }
      audit.log({ userId: user.id, eventType: "magic_link_sent", metadata: { email }, ip });
    }

    res.render("check-email", { email });
  });
}
