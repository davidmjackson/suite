// tests/helpers.js — shared test app builder.
//
// Builds the REAL app shell from app.js (headers, views, static, request logging,
// body parsing, locals) and leaves the routes to the caller, so each route test
// mounts only the route under test. This file used to hand-copy that wiring under
// three "mirror server.js" comments and had drifted from it; the copies are gone.
import { openDb } from '../db/index.js';
import { createAppShell, marketingMiddleware } from '../app.js';
import { createLogger } from '../lib/logger.js';

// All five launched apps. This had drifted to four (no sprintplan.uk), which is
// what blinded the suite to a Sprintplan magic link landing on /dashboard: the
// return-domain guard in magic.test.js walks THIS list, so a domain missing here
// is a domain nothing checks. It mirrors PROD deliberately — the value lives in an
// unversioned .env, so no test can read the real one.
const APP_DOMAINS = [
  'https://sprintraid.uk',
  'https://sprintsignal.uk',
  'https://sprintretro.uk',
  'https://sprintpoker.uk',
  'https://sprintplan.uk',
].join(',');

// Silent by default: the shell mounts the real request logger, and a test run
// should not emit a log line per request. A test that wants to READ what the app
// logs passes its own capture logger in — pino-http claims req.log with
// `if (!req.log)`, so stacking a second makeRequestLogger after this one is
// silently ignored and captures nothing.
const testLogger = createLogger({ level: 'silent' });

// The minimum env config.js demands. Defaults only — an already-set value wins, so
// a test that needs a different one sets it before the first buildTestApp().
const TEST_ENV = {
  BASE_URL: 'https://test',
  DB_PATH: ':memory:',
  RESEND_API_KEY: 'test',
  FROM_EMAIL: 'login@test',
  COOKIE_SECRET: 'x',
  ALLOWED_APP_DOMAINS: APP_DOMAINS,
  HUB_API_KEY_RAID: 'k-raid',
  HUB_API_KEY_SIGNAL: 'k-signal',
  HUB_API_KEY_RETRO: 'k-retro',
  HUB_API_KEY_POKER: 'k-poker',
  HUB_API_KEY_PLAN: 'k-plan',
};

function seedTestEnv(env) {
  for (const [key, value] of Object.entries(TEST_ENV)) process.env[key] ??= value;
  Object.assign(process.env, env);
}

export async function buildTestApp({ env = {}, logger = testLogger } = {}) {
  seedTestEnv(env);
  const { default: config } = await import('../config.js?t=' + Date.now());
  const db = openDb(':memory:');
  const app = createAppShell({ config, db, logger });
  const marketing = marketingMiddleware(config);
  const { mountLanding } = await import('../routes/landing.js?t=' + Date.now());
  mountLanding(app, { marketing });
  return { app, db, config, marketing };
}
