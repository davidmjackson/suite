// tests/app.test.js — guards the app wiring itself.
//
// server.js used to BE the wiring and was 0% covered: nothing executed it, and
// tests/helpers.js kept a hand-copy that had already drifted from it. The wiring
// now lives in app.js and this file builds the real thing, whole, the way the
// process does. A route dropped from mountRoutes(), a middleware in the wrong
// order, or an error handler that is no longer last fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildRealApp } from './helpers.js';

/* One row per mount call in app.js. The status is only there to prove the route
   exists and its middleware ran — the behaviour behind each is tested in its own
   file. A mount deleted or never added shows up here as a 404. */
const ROUTES = [
  { path: '/', status: 200, mount: 'mountLanding' },
  { path: '/login', status: 200, mount: 'mountLogin' },
  { path: '/auth/magic', status: 400, mount: 'mountMagic' },
  { path: '/dashboard', status: 302, mount: 'mountDashboard' },
  { path: '/launch/raid', status: 302, mount: 'mountLaunch' },
  { path: '/logout', status: 302, mount: 'mountLogout' },
  { path: '/admin', status: 302, mount: 'mountAdmin' },
  { path: '/company/acme', status: 302, mount: 'mountCompany' },
  { path: '/request', status: 200, mount: 'mountRequest' },
  { path: '/license', status: 200, mount: 'mountLegal' },
  { path: '/sitemap.xml', status: 200, mount: 'mountSitemap' },
  { path: '/healthz', status: 200, mount: 'healthz' },
];

for (const { path, status, mount } of ROUTES) {
  test(`createApp wires ${mount}: GET ${path} → ${status}`, async () => {
    const { app } = await buildRealApp();
    const res = await request(app).get(path);
    assert.equal(res.status, status, `${path} answered ${res.status}; is ${mount} still mounted?`);
  });
}

test('createApp answers /healthz with ok', async () => {
  const { app } = await buildRealApp();
  const res = await request(app).get('/healthz');
  assert.deepEqual(res.body, { ok: true });
});

test('an unknown path is a 404, not a hang or a 500', async () => {
  const { app } = await buildRealApp();
  assert.equal((await request(app).get('/no-such-page')).status, 404);
});

test('the shell wiring is in place: headers on, fingerprint off', async () => {
  const { app } = await buildRealApp();
  const res = await request(app).get('/');
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.ok(res.headers['content-security-policy'], 'no CSP — security headers unmounted');
  assert.ok(res.headers['x-request-id'], 'no X-Request-Id — request logger unmounted');
});

/* The error handler only works if nothing is registered behind it: Express picks
   the first 4-arity handler AFTER the throwing layer, so a route mounted below it
   would fall through to Express's default handler and leak a stack trace in prod. */
test('the central error handler is the last layer', async () => {
  const { app } = await buildRealApp();
  const last = app.router.stack.at(-1);
  assert.equal(last.handle.length, 4, 'the last layer is not an error handler');
  assert.equal(last.name, 'errorHandler');
});

test('the marketing CSP is applied per-route, so analytics stay off app pages', async () => {
  const { app } = await buildRealApp();
  const publicPage = await request(app).get('/');
  const appPage = await request(app).get('/dashboard');
  assert.match(publicPage.headers['content-security-policy'], /googletagmanager/);
  assert.doesNotMatch(appPage.headers['content-security-policy'], /googletagmanager/);
});

/* The CSRF guard has to sit above every route, not merely exist. A forged post
   that reaches a handler is not protected by a 403 rendered afterwards. */
test('the CSRF guard is mounted on the real app, above the routes', async () => {
  const { app } = await buildRealApp();
  const forged = await request(app)
    .post('/login')
    .type('form')
    .set('Origin', 'https://evil.example');
  assert.equal(forged.status, 403, 'a cross-origin post was not refused');
});

/* The guard exempts /api/* because those routes are Bearer-authed server-to-server
   calls that carry no Origin. That exemption is only safe while it stays true, so
   this walks the real router and proves every state-changing /api route still
   refuses an unauthenticated caller. Add a cookie-authed /api route and this fails. */
test('every state-changing /api route is Bearer-only, keeping the CSRF exemption honest', async () => {
  const { app } = await buildRealApp();
  const apiRoutes = app.router.stack
    .filter((l) => l.route?.path?.startsWith('/api/'))
    .flatMap((l) =>
      Object.keys(l.route.methods)
        .filter((m) => m !== 'get' && m !== 'head')
        .map((method) => ({ method, path: l.route.path })),
    );
  assert.ok(apiRoutes.length >= 4, `expected the four /api routes, found ${apiRoutes.length}`);

  for (const { method, path } of apiRoutes) {
    const probe = path.replace(/:[^/]+/g, 'x');
    const res = await request(app)[method](probe).type('form');
    assert.equal(res.status, 401, `${method.toUpperCase()} ${path} is not Bearer-only`);
  }
});
