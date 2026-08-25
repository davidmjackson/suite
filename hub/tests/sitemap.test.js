// tests/sitemap.test.js — /sitemap.xml, and the robots.txt line that points at it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildRealApp } from './helpers.js';

test('GET /sitemap.xml answers with an XML urlset', async () => {
  const { app } = await buildRealApp();
  const res = await request(app).get('/sitemap.xml');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /xml/);
  assert.match(res.text, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
});

test('every listed URL is absolute and derived from BASE_URL', async () => {
  const { app, config } = await buildRealApp();
  const res = await request(app).get('/sitemap.xml');
  const locs = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length >= 4, `expected the public pages, found ${locs.length}`);
  for (const loc of locs) {
    assert.ok(loc.startsWith(`${config.baseUrl}/`), `${loc} is not under ${config.baseUrl}`);
  }
});

test('the sitemap lists the public content pages', async () => {
  const { app, config } = await buildRealApp();
  const res = await request(app).get('/sitemap.xml');
  for (const path of ['/', '/request', '/privacy', '/license']) {
    assert.match(res.text, new RegExp(`<loc>${config.baseUrl}${path}</loc>`), `${path} is missing`);
  }
});

// The discriminating test, and it does not name the gated paths — it FETCHES every
// URL the sitemap advertises and requires each to answer 200 to a caller with no
// session. A deny-list of names was the first version and it was worthless: it
// false-passed on any path outside the six it happened to list. This fails on any
// gated path, named or not, because gated paths 302 to /login.
test('every advertised URL is reachable without signing in', async () => {
  const { app, config } = await buildRealApp();
  const res = await request(app).get('/sitemap.xml');
  const paths = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
    m[1].slice(config.baseUrl.length),
  );
  assert.ok(paths.length >= 4);
  for (const path of paths) {
    const page = await request(app).get(path);
    assert.equal(page.status, 200, `${path} is advertised but answers ${page.status} signed out`);
  }
});

// Two pages that ARE reachable signed out and still do not belong. Reachability is
// what the test above measures; this is the editorial half it cannot know.
test('the sitemap omits the sign-in page and the coming-soon stub', async () => {
  const { app } = await buildRealApp();
  const res = await request(app).get('/sitemap.xml');
  assert.doesNotMatch(res.text, /<loc>[^<]*\/terms</, '/terms still renders a placeholder');
  assert.doesNotMatch(res.text, /<loc>[^<]*\/login</, '/login is a utility page, not content');
});

// robots.txt is a static file in public/ — it cannot read config, so its Sitemap
// line is the one place the host is written out a second time. Nothing in here can
// prove that host is RIGHT: the suite runs as https://test and prod runs as
// sprintsuite.uk, so an equality check against config.baseUrl could only ever be
// satisfied by a robots.txt that is wrong in production.
//
// So this pins the half that is knowable — the line exists, and it is an absolute
// https URL for /sitemap.xml — and the host itself is checked against the REAL one
// by infrastructure/smoke-sprintsuite.sh, which runs off the box and knows it.
// Deleting the smoke check leaves this fact unguarded; the two are one control.
test('robots.txt declares an absolute sitemap URL', async () => {
  const { app } = await buildRealApp();
  const res = await request(app).get('/robots.txt');
  assert.equal(res.status, 200);
  const line = res.text.match(/^Sitemap: (.+)$/m);
  assert.ok(line, 'robots.txt does not point at the sitemap');
  assert.match(line[1].trim(), /^https:\/\/[^/]+\/sitemap\.xml$/);
});
