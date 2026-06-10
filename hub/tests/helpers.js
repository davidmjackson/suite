// tests/helpers.js — shared test app builder
import express from "express";
import { Eta } from "eta";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../db/index.js";
import { makeSecurityHeaders, DEFAULT_CSP } from "../middleware/securityHeaders.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildTestApp({ env = {} } = {}) {
  process.env.BASE_URL ??= "https://test";
  process.env.DB_PATH ??= ":memory:";
  process.env.RESEND_API_KEY ??= "test";
  process.env.FROM_EMAIL ??= "login@test";
  process.env.COOKIE_SECRET ??= "x";
  process.env.ALLOWED_APP_DOMAINS ??= "https://sprintraid.uk,https://sprintsignal.uk,https://sprintretro.uk,https://sprintpoker.uk";
  process.env.HUB_API_KEY_RAID ??= "k-raid";
  process.env.HUB_API_KEY_SIGNAL ??= "k-signal";
  process.env.HUB_API_KEY_RETRO ??= "k-retro";
  process.env.HUB_API_KEY_POKER ??= "k-poker";
  Object.assign(process.env, env);

  const { default: config } = await import("../config.js?t=" + Date.now());
  const app = express();
  app.set("trust proxy", "loopback"); // mirror server.js (real client IP via X-Forwarded-For)
  const csp = DEFAULT_CSP.replace(
    "form-action 'self'",
    `form-action 'self' ${config.allowedAppDomains.join(" ")}`
  );
  app.use(makeSecurityHeaders({ contentSecurityPolicy: csp }));
  const viewsDir = path.join(__dirname, "../views");
  const eta = new Eta({ views: viewsDir, cache: false });
  app.engine("eta", (fp, opts, cb) => {
    const name = path.relative(viewsDir, fp).replace(/\.eta$/, "");
    eta.renderAsync(name, opts).then(html => cb(null, html)).catch(cb);
  });
  app.set("view engine", "eta");
  app.set("views", path.join(__dirname, "../views"));
  app.use(express.static(path.join(__dirname, "../public")));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  const db = openDb(":memory:");
  app.locals.db = db;
  app.locals.config = config;
  const { mountLanding } = await import("../routes/landing.js?t=" + Date.now());
  mountLanding(app);
  return { app, db, config };
}
