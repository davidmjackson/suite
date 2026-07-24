// tests/logout.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAuthClient } = require('../index.js');
const { createHubApi } = require('../lib/hub-api.js');

test('logout clears cookie, calls hub DELETE, 302 to hub', async () => {
  let deleteCalled = false;
  const fetchImpl = async (url, opts) => {
    if (opts.method === 'DELETE') {
      deleteCalled = true;
      return { status: 204, json: async () => ({}) };
    }
    return { status: 200, json: async () => ({}) };
  };
  const client = createAuthClient({
    appName: 'raid',
    hubBaseUrl: 'https://hub.test',
    hubApiKey: 'k',
    cookieName: 'raid_session',
    dbPath: ':memory:',
  });
  client._ctx.hubApi = createHubApi({ baseUrl: 'https://hub.test', apiKey: 'k', fetchImpl });
  client._ctx.store.create({
    id: 'c1',
    userId: 'u1',
    centralSessionId: 's1',
    expiresAt: Date.now() + 60000,
  });

  const req = { headers: { cookie: 'raid_session=c1' } };
  const res = {
    headers: {},
    setHeader(n, v) {
      this.headers[n] = v;
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
    status() {
      return this;
    },
  };
  await client.handleLogout(req, res);
  assert.equal(res.statusCode, 302);
  assert.match(res.location, /^https:\/\/hub\.test/);
  assert.match(res.headers['Set-Cookie'], /Max-Age=0/);
  assert.ok(deleteCalled);
});

test('logout with no cookie still clears + redirects (no hub call)', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { status: 204, json: async () => ({}) };
  };
  const client = createAuthClient({
    appName: 'raid',
    hubBaseUrl: 'https://hub.test',
    hubApiKey: 'k',
    cookieName: 'raid_session',
    dbPath: ':memory:',
  });
  client._ctx.hubApi = createHubApi({ baseUrl: 'https://hub.test', apiKey: 'k', fetchImpl });
  const req = { headers: {} };
  const res = {
    headers: {},
    setHeader(n, v) {
      this.headers[n] = v;
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
    status() {
      return this;
    },
  };
  await client.handleLogout(req, res);
  assert.equal(res.statusCode, 302);
  assert.equal(called, false, 'no hub call when no cookie');
});
