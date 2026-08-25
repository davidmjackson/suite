// tests/sitemap.test.js
//
// /sitemap.xml 404'd, so nothing told a crawler which pages are worth having. It
// is a ROUTE rather than a file in public/ because every <loc> has to be absolute:
// a static file would hard-code the host, and the host already lives in BASE_URL,
// where config.js and the CSRF allow-list both read it. One source, derived.
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

// The discriminating test. A sitemap built by walking the router — the obvious
// implementation — would sweep up /dashboard, /admin and /login and hand a crawler
// a map of the authenticated surface. /terms is excluded for a different reason:
// it renders a "coming soon" stub, and inviting Google to index a placeholder is
// worse than not being listed.
test('the sitemap lists nothing gated, and no placeholder page', async () => {
  const { app } = await buildRealApp();
  const res = await request(app).get('/sitemap.xml');
  for (const path of ['/dashboard', '/admin', '/company', '/launch', '/logout', '/auth']) {
    assert.doesNotMatch(res.text, new RegExp(`<loc>[^<]*${path}`), `${path} is in the sitemap`);
  }
  assert.doesNotMatch(res.text, /<loc>[^<]*\/terms</, '/terms is a stub and should not be listed');
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
