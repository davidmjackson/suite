// tests/not-found.test.js — the catch-all in middleware/notFound.js.
//
// An unmatched path used to fall through to Express's finalhandler: an unbranded
// page naming the framework, echoing the path back, under its own `default-src
// 'none'` CSP. That CSP was STRICTER than ours, so this was never a security fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildRealApp } from './helpers.js';

test('an unmatched path renders the hub error page, not the framework default', async () => {
  const { app } = await buildRealApp();
  const res = await request(app).get('/no-such-page');
  assert.equal(res.status, 404);
  assert.doesNotMatch(res.text, /Cannot GET/, 'still falling through to finalhandler');
  assert.match(res.text, /Sprint Suite/);
  assert.match(res.text, /hub\.css/, 'the page did not come from our layout');
});

test('the 404 carries the hub CSP, not finalhandler default-src none', async () => {
  const { app } = await buildRealApp();
  const res = await request(app).get('/no-such-page');
  assert.match(res.headers['content-security-policy'], /default-src 'self'/);
  assert.doesNotMatch(res.headers['content-security-policy'], /default-src 'none'/);
});

// The discriminating test. An implementation that renders the path into the page —
// `message: req.originalUrl`, the obvious first draft — passes both tests above and
// fails only this one. Eta escapes on output, so the marker would land escaped
// rather than executable, but a page that reflects any attacker-chosen string is a
// worse answer than one that reflects none.
test('the 404 page does not echo the requested path back', async () => {
  const { app } = await buildRealApp();
  const res = await request(app).get('/zzmarkerzz-<script>alert(1)</script>');
  assert.equal(res.status, 404);
  assert.doesNotMatch(res.text, /zzmarkerzz/, 'the requested path was reflected into the page');
  assert.doesNotMatch(res.text, /alert\(1\)/);
});

// Express answers OPTIONS itself, by wrapping the router's done callback with a
// handler that computes Allow from the methods a path defines. A catch-all mounted
// as a router layer runs BEFORE done and takes that request away: the reply becomes
// a 404 page and Allow is never computed. Nothing else in the suite sends OPTIONS,
// so this is the only thing standing between that and a silent regression.
test('OPTIONS on a real route still answers with its method list', async () => {
  const { app } = await buildRealApp();
  const res = await request(app).options('/login');
  assert.equal(res.status, 200);
  assert.equal(res.headers.allow, 'GET, HEAD, POST');
});

test('OPTIONS on a path with no route is still a 404', async () => {
  const { app } = await buildRealApp();
  assert.equal((await request(app).options('/no-such-page')).status, 404);
});
