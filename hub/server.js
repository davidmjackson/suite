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
import { mountLogout } from "./routes/logout.js";
import { mountAdmin } from "./routes/admin.js";
import { createEmailSender } from "./lib/email.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

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
mountLogout(app);
mountAdmin(app);
app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(config.port, () => console.log(`hub listening on ${config.port}`));
