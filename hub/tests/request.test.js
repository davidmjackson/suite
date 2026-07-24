// tests/request.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp } from './helpers.js';

async function setup() {
  const { app, db } = await buildTestApp();
  const { mountRequest } = await import('../routes/request.js?t=' + Date.now());
  mountRequest(app, {});
  return { app, db };
}

test('GET /request renders the form', async () => {
  const { app } = await setup();
  const res = await request(app).get('/request');
  assert.equal(res.status, 200);
  assert.match(res.text, /company_name/);
  assert.match(res.text, /Request access/);
});

test('POST /request stores a pending request', async () => {
  const { app, db } = await setup();
  const res = await request(app)
    .post('/request')
    .type('form')
    .send({
      company_name: 'IBM',
      contact_name: 'James',
      email: 'james@ibm.com',
      job_title: 'Scrum Master',
      team_size: '11-50',
      apps: ['poker', 'retro'],
      message: 'hi',
    });
  assert.equal(res.status, 200);
  assert.match(res.text, /received/i);
  const row = db.prepare('SELECT * FROM access_requests WHERE email=?').get('james@ibm.com');
  assert.equal(row.company_name, 'IBM');
  assert.equal(row.status, 'pending');
  assert.equal(JSON.parse(row.apps_interest).length, 2);
});

test('POST /request rejects an invalid email with 400 and stores nothing', async () => {
  const { app, db } = await setup();
  const res = await request(app).post('/request').type('form').send({
    company_name: 'IBM',
    contact_name: 'James',
    email: 'not-an-email',
  });
  assert.equal(res.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM access_requests').get().n, 0);
});

test('POST /request silently drops bot submissions (honeypot filled)', async () => {
  const { app, db } = await setup();
  const res = await request(app).post('/request').type('form').send({
    company_name: 'IBM',
    contact_name: 'James',
    email: 'james@ibm.com',
    website: 'http://spam',
  });
  assert.equal(res.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM access_requests').get().n, 0);
});

test('POST /request rate-limits a flood from one IP', async () => {
  const { app } = await setup();
  let last;
  for (let i = 0; i < 7; i++) {
    last = await request(app)
      .post('/request')
      .type('form')
      .send({
        company_name: 'C' + i,
        contact_name: 'x',
        email: `x${i}@c.com`,
      });
  }
  assert.equal(last.status, 429);
});

test('POST /request with a bad email re-renders with entered values restored', async () => {
  const { app } = await setup();
  const res = await request(app)
    .post('/request')
    .type('form')
    .send({
      company_name: 'IBM',
      contact_name: 'James',
      email: 'bad',
      team_size: '11-50',
      apps: ['poker', 'signal'],
      message: 'keep me',
    });
  assert.equal(res.status, 400);
  assert.match(res.text, /value="IBM"/);
  assert.match(res.text, /value="11-50" selected/);
  assert.match(res.text, /value="poker" checked/);
  assert.match(res.text, /keep me/);
});

test('request form uses Instrument fields, select, checks and textarea', async () => {
  const { app } = await setup();
  const res = await request(app).get('/request');
  assert.equal(res.status, 200);
  assert.match(res.text, /class="field"/);
  assert.match(res.text, /class="checks"/);
  assert.match(res.text, /<select class="input" name="team_size"/);
  assert.match(res.text, /<textarea class="input" name="message"/);
  assert.match(res.text, /name="website"/); // honeypot preserved
});

test('request page wears the Instrument band header (signature wave chrome)', async () => {
  const { app } = await setup();
  const res = await request(app).get('/request');
  assert.match(res.text, /class="band"/);
  assert.match(res.text, /class="waves"/);
  assert.match(res.text, /<h1>Register your interest<\/h1>/);
  const h1s = res.text.match(/<h1[\s>]/g) || [];
  assert.equal(h1s.length, 1, 'exactly one h1 (from the band, not duplicated in the card)');
});

// --- operator email notification on new request ---
function fakeSender(calls) {
  return {
    sendAccessRequestNotification: async (a) => {
      calls.push(a);
    },
  };
}

test('POST /request notifies the operator when ADMIN_EMAIL is set', async () => {
  const calls = [];
  const { app } = await buildTestApp({ env: { ADMIN_EMAIL: 'ops@test.co' } });
  const { mountRequest } = await import('../routes/request.js?t=' + Date.now());
  mountRequest(app, { emailSender: fakeSender(calls) });
  const res = await request(app)
    .post('/request')
    .type('form')
    .send({
      company_name: 'IBM',
      contact_name: 'James',
      email: 'james@ibm.com',
      job_title: 'SM',
      team_size: '11-50',
      apps: ['poker', 'retro'],
      message: 'keen',
    });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, 'ops@test.co');
  assert.equal(calls[0].request.companyName, 'IBM');
  assert.equal(calls[0].request.email, 'james@ibm.com');
  assert.deepEqual(calls[0].request.apps, ['poker', 'retro']);
  assert.match(calls[0].reviewUrl, /\/admin\/companies$/);
});

test('POST /request does not notify when ADMIN_EMAIL is unset', async () => {
  const calls = [];
  const { app } = await buildTestApp({ env: { ADMIN_EMAIL: '' } });
  const { mountRequest } = await import('../routes/request.js?t=' + Date.now());
  mountRequest(app, { emailSender: fakeSender(calls) });
  const res = await request(app).post('/request').type('form').send({
    company_name: 'IBM',
    contact_name: 'James',
    email: 'james@ibm.com',
  });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

test('POST /request does not notify on honeypot or invalid submissions', async () => {
  const calls = [];
  const { app } = await buildTestApp({ env: { ADMIN_EMAIL: 'ops@test.co' } });
  const { mountRequest } = await import('../routes/request.js?t=' + Date.now());
  mountRequest(app, { emailSender: fakeSender(calls) });
  await request(app)
    .post('/request')
    .type('form')
    .send({ company_name: 'X', contact_name: 'Y', email: 'x@y.co', website: 'spam' });
  await request(app)
    .post('/request')
    .type('form')
    .send({ company_name: 'X', contact_name: 'Y', email: 'bad' });
  assert.equal(calls.length, 0);
});

test('POST /request still succeeds if the notification email throws', async () => {
  const { app, db } = await buildTestApp({ env: { ADMIN_EMAIL: 'ops@test.co' } });
  const { mountRequest } = await import('../routes/request.js?t=' + Date.now());
  mountRequest(app, {
    emailSender: {
      sendAccessRequestNotification: async () => {
        throw new Error('resend down');
      },
    },
  });
  const res = await request(app).post('/request').type('form').send({
    company_name: 'Acme',
    contact_name: 'Jo',
    email: 'jo@acme.co',
  });
  assert.equal(res.status, 200);
  assert.match(res.text, /received/i);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM access_requests WHERE email=?').get('jo@acme.co').n,
    1,
  );
});

test('POST /request normalizes email case + whitespace and stores cleaned values', async () => {
  const { app, db } = await setup();
  await request(app).post('/request').type('form').send({
    company_name: '  Acme  ',
    contact_name: ' Jo ',
    email: '  JO@ACME.COM ',
    apps: 'poker',
  });
  const row = db.prepare('SELECT * FROM access_requests WHERE email=?').get('jo@acme.com');
  assert.equal(row.company_name, 'Acme');
  assert.equal(row.contact_name, 'Jo');
  assert.equal(JSON.parse(row.apps_interest).length, 1);
});

test('request notification email renders and escapes user input', async () => {
  const { renderAccessRequestNotificationEmail } = await import('../lib/email.js?t=' + Date.now());
  const html = await renderAccessRequestNotificationEmail({
    request: {
      companyName: 'A&B <x>',
      contactName: 'Jo',
      email: 'jo@a.co',
      jobTitle: null,
      teamSize: null,
      apps: [],
      message: '<script>alert(1)</script>',
    },
    reviewUrl: 'https://sprintsuite.uk/admin/companies',
  });
  assert.match(html, /A&amp;B/); // ampersand escaped
  assert.doesNotMatch(html, /<script>/); // user input not injected raw
  assert.match(html, /href="https:\/\/sprintsuite\.uk\/admin\/companies"/);
  assert.match(html, /—/); // empty optional fields render an em-dash
});
