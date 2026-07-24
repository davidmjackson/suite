// tests/launch.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAuthClient } = require('../index.js');
const { createHubApi } = require('../lib/hub-api.js');

function makeReq({ query = {}, path = '/auth/launch' } = {}) {
  return {
    query,
    path,
    originalUrl: path + '?' + new URLSearchParams(query).toString(),
    headers: {},
  };
}
function makeRes() {
  return {
    headers: {},
    statusCode: 200,
    status(s) {
      this.statusCode = s;
      return this;
    },
    redirect(c, l) {
      if (typeof c === 'string') {
        this.location = c;
        this.statusCode = 302;
      } else {
        this.statusCode = c;
        this.location = l;
      }
    },
    setHeader(n, v) {
      this.headers[n] = v;
    },
    send() {
      this.sent = true;
    },
  };
}

function buildClient(fetchImpl) {
  const client = createAuthClient({
    appName: 'raid',
    hubBaseUrl: 'https://hub.test',
    hubApiKey: 'k',
    cookieName: 'raid_session',
    dbPath: ':memory:',
  });
  client._ctx.hubApi = createHubApi({ baseUrl: 'https://hub.test', apiKey: 'k', fetchImpl });
  return client;
}

test('launch with missing token returns 400', async () => {
  const client = buildClient(async () => ({ status: 200, json: async () => ({}) }));
  const req = makeReq();
  const res = makeRes();
  await client.handleLaunch(req, res);
  assert.equal(res.statusCode, 400);
});

test('launch with valid token creates app_session and 302s', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/api/sessions/exchange')) {
      return {
        status: 200,
        json: async () => ({
          user: { id: 'u1', email: 'a@b', displayName: 'A' },
          central_session_id: 's1',
        }),
      };
    }
    return { status: 200, json: async () => ({}) };
  };
  const client = buildClient(fetchImpl);
  const req = makeReq({ query: { token: 'tok123' } });
  const res = makeRes();
  await client.handleLaunch(req, res);
  assert.equal(res.statusCode, 302);
  assert.match(res.headers['Set-Cookie'], /^raid_session=/);
  assert.equal(res.location, '/');
});

test('launch with valid token + same-host return_to redirects there', async () => {
  const fetchImpl = async () => ({
    status: 200,
    json: async () => ({ user: { id: 'u1', email: 'a@b' }, central_session_id: 's1' }),
  });
  const client = buildClient(fetchImpl);
  const req = makeReq({ query: { token: 'tok', return_to: 'https://app.test/page' } });
  req.headers.host = 'app.test';
  const res = makeRes();
  await client.handleLaunch(req, res);
  assert.equal(res.location, '/page');
});

test('launch with exchange failure returns 400', async () => {
  const fetchImpl = async () => ({ status: 400, json: async () => ({}) });
  const client = buildClient(fetchImpl);
  const req = makeReq({ query: { token: 'bad' } });
  const res = makeRes();
  await client.handleLaunch(req, res);
  assert.equal(res.statusCode, 400);
});

test('launch persists entitled+teams from the exchange onto the session', async () => {
  const calls = [];
  const ctx = {
    store: { create: (rec) => calls.push(rec) },
    hubApi: {
      exchange: async () => ({
        user: { id: 'u1' },
        central_session_id: 'c1',
        entitlement: { entitled: true },
        teams: [{ id: 't1', name: 'Alpha', role: 'lead' }],
      }),
    },
    cookieName: 'poker_session',
    cookieDomain: undefined,
    sessionMaxMs: 60_000,
  };
  const { createLaunchHandler } = require('../handlers/launch.js');
  const handleLaunch = createLaunchHandler(ctx);
  const req = { query: { token: 'tok' }, headers: {} };
  const res = { setHeader() {}, redirect() {} };

  await handleLaunch(req, res);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].entitled, true);
  assert.deepEqual(calls[0].teams, [{ id: 't1', name: 'Alpha', role: 'lead' }]);
});

test('launch persists company from the exchange onto the session', async () => {
  const calls = [];
  const ctx = {
    store: { create: (rec) => calls.push(rec) },
    hubApi: {
      exchange: async () => ({
        user: { id: 'u1' },
        central_session_id: 'c1',
        entitlement: { entitled: true },
        teams: [],
        company: { id: 'co1', name: 'Acme' },
      }),
    },
    cookieName: 'poker_session',
    cookieDomain: undefined,
    sessionMaxMs: 60_000,
  };
  const { createLaunchHandler } = require('../handlers/launch.js');
  const handleLaunch = createLaunchHandler(ctx);
  const req = { query: { token: 'tok' }, headers: {} };
  const res = { setHeader() {}, redirect() {} };

  await handleLaunch(req, res);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].company, { id: 'co1', name: 'Acme' });
});
