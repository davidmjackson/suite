// routes/api-apps.js
import { createRequireApiKey } from "../middleware/requireApiKey.js";
import { createEntitlements } from "../lib/entitlements.js";
import { createAuditLogger } from "../lib/audit.js";

export function mountApiApps(app) {
  const db = app.locals.db;
  const config = app.locals.config;
  const requireApiKey = createRequireApiKey(config);
  const entitlements = createEntitlements(db);
  const audit = createAuditLogger(db);

  app.post("/api/apps/:app/consume", requireApiKey, (req, res) => {
    const appName = req.params.app;
    if (appName !== req.callingApp) return res.status(403).json({ ok: false, reason: "wrong_app" });
    const { central_session_id } = req.body || {};
    if (!central_session_id) return res.status(400).json({ ok: false, reason: "missing_central_session_id" });
    const sess = db.prepare("SELECT user_id FROM central_sessions WHERE id = ?").get(central_session_id);
    if (!sess) return res.status(404).json({ ok: false, reason: "session_not_found" });

    const result = entitlements.consume(sess.user_id, appName);
    if (result.ok) {
      audit.log({ userId: sess.user_id, eventType: "app_consume", app: appName, ip: req.ip });
      return res.status(200).json({ ok: true, remaining: result.remaining });
    }
    if (result.reason === "quota_exceeded") return res.status(402).json(result);
    return res.status(403).json(result); // not_entitled
  });
}
