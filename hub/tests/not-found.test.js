// tests/not-found.test.js
//
// An unmatched path used to fall through to Express's finalhandler, which answers
// with `<pre>Cannot GET /whatever</pre>` under its OWN `default-src 'none'` CSP.
// That is not a security hole — 'none' is STRICTER than ours — but it is an
// unbranded page that names the framework, and it echoes the requested path.
//
// The handler that replaces it is the one layer here that could be WORSE than what
// it replaces, in exactly one way: rendering the requested path into HTML would put
// attacker-controlled text on a page we serve. So it renders a fixed message and
// the marker test below is what holds it to that.
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

// finalhandler is what runs when nothing else answers, so a handler mounted BELOW
// the error handler would never see the request. Order is the whole control.
test('the error handler is still the last layer, with the 404 handler above it', async () => {
  const { app } = await buildRealApp();
  const last = app.router.stack.at(-1);
  assert.equal(last.name, 'errorHandler', 'the 404 handler was mounted below the error handler');
  assert.equal(last.handle.length, 4);
});
