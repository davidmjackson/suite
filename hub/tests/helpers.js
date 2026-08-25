// tests/helpers.js — shared test app builder.
//
// Builds the REAL app shell from app.js (headers, views, static, request logging,
// body parsing, locals) and leaves the routes to the caller, so each route test
// mounts only the route under test. This file used to hand-copy that wiring under
// three "mirror server.js" comments and had drifted from it; the copies are gone.
import request from 'supertest';
import { Writable } from 'node:stream';
import { openDb } from '../db/index.js';
import { createApp, createAppShell, marketingMiddleware } from '../app.js';
import { createLogger } from '../lib/logger.js';

// The origin a test browser posts from. DERIVED from TEST_BASE_URL, not written
// out a second time: the CSRF allow-list is built from BASE_URL, so two hand-kept
// copies of the same fact would let the fixtures drift into asserting nothing.
const TEST_BASE_URL = 'https://test';
export const TEST_ORIGIN = TEST_BASE_URL;

// Same-origin request builders. The CSRF guard (middleware/csrf.js) fails closed,
// so a state-changing request with no Origin is refused — supertest sends none by
// default, and a real browser always does. Use these for anything that changes
// state; reach for request(app) directly only to test the refusal itself, or for
// the /api/* routes, which are called server-to-server with no Origin at all.
export const post = (app, path) => request(app).post(path).set('Origin', TEST_ORIGIN);
export const del = (app, path) => request(app).delete(path).set('Origin', TEST_ORIGIN);

// Captures what the app logs. Lives here rather than in one test file because
// two suites now assert on log records, and a second hand-rolled copy is how the
// two drift into asserting different things.
export function capture() {
  const chunks = [];
  const stream = new Writable({
    write(c, _e, cb) {
      chunks.push(c.toString());
      cb();
    },
  });
  return {
    stream,
    text: () => chunks.join(''),
    records: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
  };
}

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
  BASE_URL: TEST_BASE_URL,
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

// The REAL app, whole, the way server.js builds it — routes, the 404 handler and
// the error handler all mounted in production order. buildTestApp() above stops at
// the shell so a route test can mount only its own route; anything asserting on
// WIRING (what answers an unmatched path, what sits last in the stack) has to come
// through here instead. It lived as a private copy inside app.test.js until a
// second suite needed it; two copies of the real wiring is the drift that file's
// own header warns about.
export async function buildRealApp() {
  seedTestEnv({});
  const { default: config } = await import('../config.js?t=' + Date.now());
  const db = openDb(':memory:');
  const app = createApp({ config, db, logger: testLogger, emailSender: noopSender });
  return { app, db, config };
}

const noopSender = {
  async sendMagicLink() {},
  async sendAccessRequestNotification() {},
};
