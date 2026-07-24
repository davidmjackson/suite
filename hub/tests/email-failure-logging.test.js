import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { Writable } from 'node:stream';
import { buildTestApp } from './helpers.js';
import { mountLogin } from '../routes/login.js';
import { createLogger } from '../lib/logger.js';
import { mountRequest } from '../routes/request.js';

// A throwing email sender exercises the catch block (best-effort logging path).
const throwingSender = {
  async sendMagicLink() {
    throw new Error('smtp down');
  },
};

test('login still succeeds when the magic-link email send throws', async () => {
  const { app, db } = await buildTestApp();
  // Insert shape mirrors tests/login.test.js (users.id is a required column).
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,?)').run(
    'u1',
    'known@test.com',
    Date.now(),
  );
  mountLogin(app, { emailSender: throwingSender });
  // The magic-link send only fires for an existing user, so this hits the catch.
  const res = await request(app).post('/login').type('form').send({ email: 'known@test.com' });
  // Existing behaviour: always render check-email (no user enumeration), 200.
  assert.equal(res.status, 200);
  assert.ok(res.text.length > 0);
});

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
    records: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
  };
}
const tick = () => new Promise((r) => setImmediate(r));

test('login logs a structured error (via req.log) when the email send throws', async () => {
  const cap = capture();
  // The capture logger goes into the shell: it IS the app's request logger, not a
  // second one layered on top (pino-http keeps the first req.log it finds).
  const { app, db } = await buildTestApp({
    logger: createLogger({ level: 'info', stream: cap.stream }),
  });
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,?)').run(
    'u2',
    'k2@test.com',
    Date.now(),
  );
  mountLogin(app, { emailSender: throwingSender });
  await request(app).post('/login').type('form').send({ email: 'k2@test.com' });
  await tick();
  assert.ok(cap.records().some((r) => r.msg === 'magic link send failed'));
});

test('request route logs a structured error when the notification email throws', async () => {
  const cap = capture();
  const { app } = await buildTestApp({
    env: { ADMIN_EMAIL: 'op@test' },
    logger: createLogger({ level: 'info', stream: cap.stream }),
  });
  const sender = {
    async sendAccessRequestNotification() {
      throw new Error('smtp down');
    },
  };
  mountRequest(app, { emailSender: sender });
  // Fields use snake_case to match the real route handler. Honeypot (website) left absent.
  const res = await request(app).post('/request').type('form').send({
    company_name: 'Acme',
    contact_name: 'Jo',
    email: 'jo@acme.com',
    job_title: 'PM',
    team_size: '5',
    apps: 'poker',
    message: 'hi',
  });
  await tick();
  assert.ok(res.status === 200 || res.status === 302);
  assert.ok(cap.records().some((r) => r.msg === 'access request notification failed'));
});
