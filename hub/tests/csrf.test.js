// tests/csrf.test.js — the CSRF guard's truth table, and its behaviour once wired.
//
// The decision this file pins hardest is the one that is tempting to get wrong:
// a state-changing request with NO Origin and NO Sec-Fetch-Site is REFUSED. The
// alternative — allowing it — keeps fixtures green and makes the control
// decorative, because any non-browser caller can then skip the check by simply
// omitting a header.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeCsrfGuard, trustedOrigins } from '../middleware/csrf.js';
import { buildTestApp, TEST_ORIGIN } from './helpers.js';

const HUB = 'https://sprintsuite.uk';

// Drives the guard with a hand-built request double and reports what it decided.
function decide({ method = 'POST', path = '/admin/users', headers = {} } = {}, origins = [HUB]) {
  const guard = makeCsrfGuard({ allowedOrigins: origins });
  let outcome = 'never called next';
  guard({ method, path, headers }, {}, (err) => {
    outcome = err ? err.status : 'pass';
  });
  return outcome;
}

test('trustedOrigins accepts both the apex and the www alias, and nothing else', () => {
  assert.deepEqual(trustedOrigins('https://sprintsuite.uk'), [HUB, 'https://www.sprintsuite.uk']);
  // Derived the same way whichever host baseUrl names, so the pair cannot drift.
  assert.deepEqual(trustedOrigins('https://www.sprintsuite.uk'), [
    HUB,
    'https://www.sprintsuite.uk',
  ]);
  // The scheme is carried through, so an http baseUrl never blesses https and back.
  assert.deepEqual(trustedOrigins('http://localhost:3004'), [
    'http://localhost:3004',
    'http://www.localhost:3004',
  ]);
});

test('an allow-listed Origin passes', () => {
  assert.equal(decide({ headers: { origin: HUB } }), 'pass');
  assert.equal(
    decide({ headers: { origin: 'https://www.sprintsuite.uk' } }, trustedOrigins(HUB)),
    'pass',
  );
});

/* The negatives here are all NEAR MISSES, deliberately. A distant origin like
   evil.example is refused by a correct exact-match guard and by every common way
   of writing one wrongly, so it discriminates nothing. Each case below dies only
   if the comparison is exact origin equality. */
test('a foreign Origin is refused with 403', () => {
  assert.equal(decide({ headers: { origin: 'https://evil.example' } }), 403);
  // Prefix matching would admit these — the attacker registers the longer name.
  assert.equal(decide({ headers: { origin: 'https://sprintsuite.uk.evil.example' } }), 403);
  assert.equal(decide({ headers: { origin: 'https://sprintsuite.ukevil.example' } }), 403);
  // A host-only comparison would admit a downgraded scheme.
  assert.equal(decide({ headers: { origin: 'http://sprintsuite.uk' } }), 403);
  // Stripping the port would admit any other service on the same host.
  assert.equal(decide({ headers: { origin: 'https://sprintsuite.uk:8443' } }), 403);
});

/* The four holes in SameSite=Lax that this guard exists to close. A sibling host
   on the same registrable domain is same-SITE but not same-ORIGIN, so it must be
   refused: accepting it would readmit exactly what Lax already lets through. */
test('a same-site sibling host is refused — same-site is not same-origin', () => {
  assert.equal(decide({ headers: { origin: 'https://evil.sprintsuite.uk' } }), 403);
  assert.equal(decide({ headers: { 'sec-fetch-site': 'same-site' } }), 403);
});

/* Origin: null is a VALUE, not an absence — a sandboxed iframe or a POST
   redirected across origins sends it. Reading it as "no Origin" would turn the
   sandboxed-iframe attack into a bypass. */
test('Origin: null is refused, not treated as absent', () => {
  assert.equal(decide({ headers: { origin: 'null' } }), 403);
  // The discriminating case. Skipping a "null" Origin to the fetch-metadata
  // branch also ends in a 403 when no metadata is present, so only a request
  // carrying BOTH tells the two apart — and lets the bypass through.
  assert.equal(decide({ headers: { origin: 'null', 'sec-fetch-site': 'same-origin' } }), 403);
  // An empty Origin is a value too, and dies to the same shape.
  assert.equal(decide({ headers: { origin: '', 'sec-fetch-site': 'same-origin' } }), 403);
});

test('with no Origin, Sec-Fetch-Site: same-origin is accepted', () => {
  assert.equal(decide({ headers: { 'sec-fetch-site': 'same-origin' } }), 'pass');
});

test('with no Origin and no fetch metadata the request is refused — fail closed', () => {
  assert.equal(decide({ headers: {} }), 403);
  assert.equal(decide({ headers: { 'sec-fetch-site': 'cross-site' } }), 403);
  assert.equal(decide({ headers: { 'sec-fetch-site': 'none' } }), 403);
});

test('safe methods pass untouched, whatever they carry', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(decide({ method, headers: {} }), 'pass', `${method} was refused`);
    assert.equal(decide({ method, headers: { origin: 'https://evil.example' } }), 'pass');
  }
});

test('every state-changing method is covered, not just POST', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(decide({ method, headers: {} }), 403, `${method} slipped through`);
  }
});

/* /api/* is server-to-server with a Bearer key and no cookie, so it sends no
   Origin and cannot be forged. Exempt BY PATH — never by "no Origin ⇒ allow",
   which would hand the same pass to the 19 cookie-authed routes. */
test('/api/ is exempt by path, and the exemption does not leak to look-alikes', () => {
  assert.equal(decide({ path: '/api/sessions/exchange', headers: {} }), 'pass');
  assert.equal(decide({ method: 'DELETE', path: '/api/sessions/s1', headers: {} }), 'pass');
  assert.equal(decide({ path: '/apidocs', headers: {} }), 403);
  assert.equal(decide({ path: '/company/api/members', headers: {} }), 403);
});

test('the guard refuses a forged post to a real route once wired', async () => {
  const { app } = await buildTestApp();
  app.post('/csrf-probe', (_req, res) => res.json({ ok: true }));

  const forged = await request(app).post('/csrf-probe').set('Origin', 'https://evil.example');
  assert.equal(forged.status, 403);

  const genuine = await request(app).post('/csrf-probe').set('Origin', TEST_ORIGIN);
  assert.equal(genuine.status, 200);
});

/* A refusal must still be a well-formed hub response: the security headers are
   mounted above the guard precisely so error responses keep them. */
test('a refused request still carries the security headers', async () => {
  const { app } = await buildTestApp();
  app.post('/csrf-probe', (_req, res) => res.json({ ok: true }));
  const res = await request(app).post('/csrf-probe').set('Origin', 'https://evil.example');
  assert.ok(res.headers['content-security-policy'], 'refusal lost the CSP');
  assert.equal(res.headers['x-frame-options'], 'DENY');
});

/* The guard runs before the routes, so a forged request must never reach the
   handler — a 403 rendered after the work happened would be no protection. */
test('a refused request never reaches the route handler', async () => {
  const { app } = await buildTestApp();
  let reached = false;
  app.post('/csrf-probe', (_req, res) => {
    reached = true;
    res.json({ ok: true });
  });
  await request(app).post('/csrf-probe').set('Origin', 'https://evil.example');
  assert.equal(reached, false, 'the handler ran despite the refusal');
});

/* The decision table above proves the guard's behaviour given an allow-list. This
   proves the allow-list the SHELL actually builds — a different claim, and the one
   a wiring mistake breaks. Widening app.js to bless config.allowedAppDomains makes
   every hub post forgeable from five same-site siblings, which is precisely what
   this control exists to prevent, and nothing else in the suite would notice. */
test('the shell is wired with the hub origins only, never the app domains', async () => {
  const { app, config } = await buildTestApp();
  app.post('/csrf-probe', (_req, res) => res.json({ ok: true }));

  assert.equal(config.allowedAppDomains.length, 5, 'expected the five app origins');
  for (const origin of config.allowedAppDomains) {
    const res = await request(app).post('/csrf-probe').set('Origin', origin);
    assert.equal(res.status, 403, `${origin} was accepted — app origins are not this origin`);
  }

  const genuine = await request(app).post('/csrf-probe').set('Origin', TEST_ORIGIN);
  assert.equal(genuine.status, 200, 'the hub origin itself was refused');
});
