// server.js
import express from "express";
import { Eta } from "eta";
import path from "node:path";
import { fileURLToPath } from "node:url";
import config from "./config.js";
import { openDb } from "./db/index.js";
import { mountLanding } from "./routes/landing.js";
import { mountLogin } from "./routes/login.js";
import { mountMagic } from "./routes/magic.js";
import { mountDashboard } from "./routes/dashboard.js";
import { mountLaunch } from "./routes/launch.js";
import { mountApiSessions } from "./routes/api-sessions.js";
import { mountApiApps } from "./routes/api-apps.js";
import { mountLogout } from "./routes/logout.js";
import { mountAdmin } from "./routes/admin.js";
import { mountCompany } from "./routes/company.js";
import { mountRequest } from "./routes/request.js";
import { mountLegal } from "./routes/legal.js";
import { createEmailSender } from "./lib/email.js";
import logger from "./lib/logger.js";
import { makeRequestLogger } from "./middleware/requestLogger.js";
import { makeErrorHandler } from "./middleware/errorHandler.js";
import { makeSecurityHeaders, DEFAULT_CSP } from "./middleware/securityHeaders.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by");

// Behind Apache on 127.0.0.1: trust the loopback proxy so req.ip reflects the
// real client via X-Forwarded-For (per-IP rate limiting + accurate audit IPs).
// Mirrored in tests/helpers.js — keep both in sync.
app.set("trust proxy", "loopback");

// Security headers — mounted early so they cover static assets and error responses.
// form-action must allow the app origins: POST /launch/:app and POST /auth/magic
// (with an app return_to) 302-redirect cross-origin into the apps, and CSP
// form-action is enforced against redirect targets, not just the initial action.
const csp = DEFAULT_CSP.replace(
  "form-action 'self'",
  `form-action 'self' ${config.allowedAppDomains.join(" ")}`
);
app.use(makeSecurityHeaders({ contentSecurityPolicy: csp }));

// Views
const viewsDir = path.join(__dirname, "views");
const eta = new Eta({ views: viewsDir, cache: config.nodeEnv === "production" });
app.engine("eta", (filePath, opts, cb) => {
  const name = path.relative(viewsDir, filePath).replace(/\.eta$/, "");
  eta.renderAsync(name, opts).then(html => cb(null, html)).catch(cb);
});
app.set("view engine", "eta");
app.set("views", viewsDir);

// Static
app.use(express.static(path.join(__dirname, "public")));

// Request logging (skips static assets above; wraps all dynamic routes)
app.use(makeRequestLogger(logger));

// Body parsing
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// DB
const db = openDb(config.dbPath);
app.locals.db = db;
app.locals.config = config;

// Routes
const emailSender = createEmailSender({ apiKey: config.resendApiKey, from: config.fromEmail });
mountLanding(app);
mountLogin(app, { emailSender });
mountMagic(app);
mountDashboard(app);
mountLaunch(app);
mountApiSessions(app);
mountApiApps(app);
mountLogout(app);
mountAdmin(app, { emailSender });
mountCompany(app);
mountRequest(app, { emailSender });
mountLegal(app);
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Central error handler — must be last.
app.use(makeErrorHandler({ logger, nodeEnv: config.nodeEnv }));

app.listen(config.port, () => logger.info({ port: config.port }, "hub listening"));
