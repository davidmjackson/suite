import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { Writable } from 'node:stream';
import { buildTestApp } from './helpers.js';
import { createLogger } from '../lib/logger.js';
import { makeRequestLogger } from '../middleware/requestLogger.js';
import { makeErrorHandler } from '../middleware/errorHandler.js';

function capture() {
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
