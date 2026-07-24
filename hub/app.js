// app.js — builds the Express app. server.js only opens the door (config, db,
// logger, listen); everything about how the app is wired lives here.
//
// It exists because tests/helpers.js used to hand-copy this wiring under three
// "mirror server.js" comments, and had already drifted from it — no request
// logger, no error handler, and an app-domain list a domain short. The whole
// point is that there is now one wiring, and the suite exercises it.
import express from 'express';
import { Eta } from 'eta';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountLanding } from './routes/landing.js';
import { mountLogin } from './routes/login.js';
import { mountMagic } from './routes/magic.js';
import { mountDashboard } from './routes/dashboard.js';
import { mountLaunch } from './routes/launch.js';
import { mountApiSessions } from './routes/api-sessions.js';
import { mountApiApps } from './routes/api-apps.js';
import { mountLogout } from './routes/logout.js';
import { mountAdmin } from './routes/admin.js';
import { mountCompany } from './routes/company.js';
import { mountRequest } from './routes/request.js';
import { mountLegal } from './routes/legal.js';
import { makeRequestLogger } from './middleware/requestLogger.js';
import { makeErrorHandler } from './middleware/errorHandler.js';
import {
  makeSecurityHeaders,
  DEFAULT_CSP,
  MARKETING_CSP,
  withAppDomains,
} from './middleware/securityHeaders.js';
import { analyticsLocals } from './middleware/analytics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function configureViews(app, { cache }) {
  const viewsDir = path.join(__dirname, 'views');
  const eta = new Eta({ views: viewsDir, cache });
  app.engine('eta', (filePath, opts, cb) => {
    const name = path.relative(viewsDir, filePath).replace(/\.eta$/, '');
    eta
      .renderAsync(name, opts)
      .then((html) => cb(null, html))
      .catch(cb);
  });
  app.set('view engine', 'eta');
  app.set('views', viewsDir);
}

// Public pages (/, /request, /privacy) only: a wider CSP that permits GA4, plus the
// consent state for the view. Applied at the route — never app.use("/"), which
// prefix-matches every path and would leak analytics onto /dashboard and /admin.
export function marketingMiddleware(config) {
  return [
    makeSecurityHeaders({
      contentSecurityPolicy: withAppDomains(MARKETING_CSP, config.allowedAppDomains),
    }),
    analyticsLocals(config),
  ];
}

// Everything up to the routes: the part a route test needs before it mounts the
// one route under test. Exported so tests build the real shell rather than a copy.
export function createAppShell({ config, db, logger }) {
  const app = express();
  app.disable('x-powered-by');

  // Behind Apache on 127.0.0.1: trust the loopback proxy so req.ip reflects the
  // real client via X-Forwarded-For (per-IP rate limiting + accurate audit IPs).
  app.set('trust proxy', 'loopback');

  // Security headers — mounted early so they cover static assets and error responses.
  // form-action must allow the app origins: POST /launch/:app and POST /auth/magic
  // (with an app return_to) 302-redirect cross-origin into the apps, and CSP
  // form-action is enforced against redirect targets, not just the initial action.
  app.use(
    makeSecurityHeaders({
      contentSecurityPolicy: withAppDomains(DEFAULT_CSP, config.allowedAppDomains),
    }),
  );

  configureViews(app, { cache: config.nodeEnv === 'production' });
  app.use(express.static(path.join(__dirname, 'public')));
  // Request logging (skips the static assets above; wraps all dynamic routes)
  app.use(makeRequestLogger(logger));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.locals.db = db;
  app.locals.config = config;
  return app;
}

function mountRoutes(app, { emailSender, marketing }) {
  mountLanding(app, { marketing });
  mountLogin(app, { emailSender });
  mountMagic(app);
  mountDashboard(app);
  mountLaunch(app);
  mountApiSessions(app);
  mountApiApps(app);
  mountLogout(app);
  mountAdmin(app, { emailSender });
  mountCompany(app);
  mountRequest(app, { emailSender, marketing });
  mountLegal(app, { marketing });
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
}

export function createApp({ config, db, logger, emailSender }) {
  const app = createAppShell({ config, db, logger });
  mountRoutes(app, { emailSender, marketing: marketingMiddleware(config) });
  // Central error handler — must be last.
  app.use(makeErrorHandler({ logger, nodeEnv: config.nodeEnv }));
  return app;
}
