// tests/cookies.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSessionCookie, clearSessionCookie, parseCookies } from '../lib/cookies.js';

test('parseCookies parses cookie header', () => {
  assert.deepEqual(parseCookies('a=1; b=two; c='), { a: '1', b: 'two', c: '' });
  assert.deepEqual(parseCookies(undefined), {});
});

test('setSessionCookie sets correct attributes', () => {
  const res = {
    setHeader(name, val) {
      this.h = { name, val };
    },
  };
  setSessionCookie(res, 'hub_session', 'abc123', { secure: true });
  assert.match(res.h.val, /^hub_session=abc123;/);
  assert.match(res.h.val, /HttpOnly/);
  assert.match(res.h.val, /Secure/);
  assert.match(res.h.val, /SameSite=Lax/);
  assert.match(res.h.val, /Path=\//);
  assert.match(res.h.val, /Max-Age=2592000/);
});

test('clearSessionCookie expires the cookie', () => {
  const res = {
    setHeader(name, val) {
      this.h = { name, val };
    },
  };
  clearSessionCookie(res, 'hub_session');
  assert.match(res.h.val, /Max-Age=0/);
});
