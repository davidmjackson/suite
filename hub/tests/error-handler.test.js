import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { buildTestApp, capture } from './helpers.js';
import { createLogger } from '../lib/logger.js';
import { makeRequestLogger } from '../middleware/requestLogger.js';
import { makeErrorHandler } from '../middleware/errorHandler.js';

const tick = () => new Promise((r) => setImmediate(r));

async function appWithBoom({ nodeEnv = 'production' } = {}) {
  const cap = capture();
  const logger = createLogger({ level: 'info', stream: cap.stream });
  // The capture logger goes into the shell: it IS the app's request logger, not a
  // second one layered on top (pino-http keeps the first req.log it finds).
  const { app } = await buildTestApp({ logger });
  app.get('/boom', () => {
    throw new Error('kaboom-secret-detail');
  });
  app.get('/api/boom', () => {
    throw new Error('kaboom-secret-detail');
  });
  app.use(makeErrorHandler({ logger, nodeEnv }));
  return { app, cap };
}

test('API/JSON error returns a clean 500 with a reqId and no internal detail', async () => {
  const { app } = await appWithBoom();
  const res = await request(app).get('/boom').set('Accept', 'application/json');
  assert.equal(res.status, 500);
  assert.equal(res.body.error, 'Internal Server Error');
  assert.ok(typeof res.body.reqId === 'string' && res.body.reqId.length > 0);
  assert.ok(!JSON.stringify(res.body).includes('kaboom-secret-detail'));
});

test('logs a structured error carrying the same reqId', async () => {
  const { app, cap } = await appWithBoom();
  const res = await request(app).get('/boom').set('Accept', 'application/json');
  await tick();
  const errRec = cap.records().find((r) => r.msg === 'unhandled error');
  assert.ok(errRec, "expected an 'unhandled error' log record");
  assert.equal(errRec.reqId, res.body.reqId);
});

test('HTML error renders the error page in prod without the stack', async () => {
  const { app } = await appWithBoom({ nodeEnv: 'production' });
  const res = await request(app).get('/boom');
  assert.equal(res.status, 500);
  assert.match(res.headers['content-type'], /html/);
  assert.ok(res.text.includes('Something went wrong'));
  assert.ok(!res.text.includes('kaboom-secret-detail'));
  assert.ok(res.headers['x-request-id']);
  assert.ok(res.text.includes(res.headers['x-request-id']));
  assert.ok(res.text.includes('Reference:'));
});

test('dev mode exposes the error message', async () => {
  const { app } = await appWithBoom({ nodeEnv: 'development' });
  const res = await request(app).get('/boom').set('Accept', 'application/json');
  assert.ok(JSON.stringify(res.body).includes('kaboom-secret-detail'));
});

test('/api/* errors return JSON even when the client asks for HTML', async () => {
  const { app } = await appWithBoom();
  const res = await request(app).get('/api/boom').set('Accept', 'text/html');
  assert.equal(res.status, 500);
  assert.match(res.headers['content-type'], /json/);
  assert.ok(!res.text.includes('kaboom-secret-detail'));
});

test('dev mode HTML error exposes the stack', async () => {
  const { app } = await appWithBoom({ nodeEnv: 'development' });
  const res = await request(app).get('/boom');
  assert.equal(res.status, 500);
  assert.match(res.headers['content-type'], /html/);
  assert.ok(res.text.includes('kaboom-secret-detail'));
});

test('error handler surfaces err.fields in the JSON body for /api routes', async () => {
  const cap = capture();
  const logger = createLogger({ level: 'info', stream: cap.stream });
  const { app } = await buildTestApp();
  app.use(makeRequestLogger(logger));
  app.post('/api/echo', (req, res, next) => {
    const err = new Error('validation_failed');
    err.status = 400;
    err.fields = { email: ['A valid email is required'] };
    next(err);
  });
  app.use(makeErrorHandler({ logger, nodeEnv: 'production' }));
  const res = await request(app).post('/api/echo').send({});
  assert.equal(res.status, 400);
  assert.deepEqual(res.body.fields, { email: ['A valid email is required'] });
});

test('falls back to plain text when the error view fails to render', async () => {
  const cap = capture();
  const logger = createLogger({ level: 'info', stream: cap.stream });
  const app = express(); // no view engine configured → render("error") fails
  app.use(makeRequestLogger(logger));
  app.get('/boom', () => {
    throw new Error('render-secret');
  });
  app.use(makeErrorHandler({ logger, nodeEnv: 'production' }));
  const res = await request(app).get('/boom');
  assert.equal(res.status, 500);
  assert.match(res.headers['content-type'], /text\/plain/);
  assert.ok(res.text.includes('An unexpected error occurred'));
  assert.ok(!res.text.includes('render-secret'));
});

/* A 4xx is a refused request, not a crash. Before this, every rejection was
   logged at ERROR under "unhandled error", so a foreign-origin probe and a broken
   route were the same line to on-call, and real 500s were buried among routine
   ones. */
async function appWithRefusal({ nodeEnv = 'production' } = {}) {
  const cap = capture();
  const logger = createLogger({ level: 'info', stream: cap.stream });
  const { app } = await buildTestApp({ logger });
  app.get('/refused', (_req, _res, next) => {
    const err = new Error('blocked cross-origin POST /admin/users (https://evil.example)');
    err.status = 403;
    err.code = 'csrf_blocked';
    err.public = { title: 'Request refused', message: 'That did not come from Sprint Suite.' };
    next(err);
  });
  app.use(makeErrorHandler({ logger, nodeEnv }));
  return { app, cap };
}

test('a 4xx is logged at warn under its own code, not as an unhandled error', async () => {
  const { app, cap } = await appWithRefusal();
  await request(app).get('/refused').set('Accept', 'application/json');
  await tick();
  const rec = cap.records().find((r) => r.msg === 'csrf_blocked');
  assert.ok(rec, `no csrf_blocked record; saw ${cap.records().map((r) => r.msg)}`);
  assert.equal(rec.level, 40, 'a refusal was logged at error level');
  assert.ok(
    !cap.records().some((r) => r.msg === 'unhandled error'),
    'the refusal was also logged as an unhandled error',
  );
});

test('a 5xx is still logged at error under "unhandled error"', async () => {
  const { app, cap } = await appWithBoom();
  await request(app).get('/boom').set('Accept', 'application/json');
  await tick();
  const rec = cap.records().find((r) => r.msg === 'unhandled error');
  assert.ok(rec, 'the crash lost its error record');
  assert.equal(rec.level, 50);
});

test('the offending detail reaches the logs even though it never reaches the user', async () => {
  const { app, cap } = await appWithRefusal();
  const res = await request(app).get('/refused');
  await tick();
  assert.match(cap.text(), /evil\.example/, 'the rejected origin is recorded nowhere');
  assert.ok(!res.text.includes('evil.example'), 'the rejected origin leaked into the response');
});

test('an error carrying public copy shows it in prod instead of the generic page', async () => {
  const { app } = await appWithRefusal();
  const html = await request(app).get('/refused');
  assert.equal(html.status, 403);
  assert.match(html.text, /Request refused/);
  assert.doesNotMatch(html.text, /An unexpected error occurred/);

  const json = await request(app).get('/refused').set('Accept', 'application/json');
  assert.equal(json.body.error, 'That did not come from Sprint Suite.');
});
