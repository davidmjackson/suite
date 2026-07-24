// tests/consent.test.js
// The consent reader is the single source of truth for "has this visitor agreed
// to analytics?". Its one hard rule: it must never fail open to "granted".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConsent, CONSENT_COOKIE, CONSENT_MAX_AGE_SEC } from '../lib/consent.js';

test('cookie name and lifetime are the agreed values', () => {
  assert.equal(CONSENT_COOKIE, 'ss_consent');
  assert.equal(CONSENT_MAX_AGE_SEC, 180 * 24 * 60 * 60, '180 days — re-ask ~twice a year');
});

test('reads an exact granted cookie', () => {
  assert.equal(readConsent('ss_consent=granted'), 'granted');
});

test('reads an exact denied cookie', () => {
  assert.equal(readConsent('ss_consent=denied'), 'denied');
});

test('returns null when there is no cookie header at all', () => {
  assert.equal(readConsent(undefined), null);
  assert.equal(readConsent(''), null);
});

test('returns null when ss_consent is absent among other cookies', () => {
  assert.equal(readConsent('hub_session=abc123'), null);
});

test('finds ss_consent alongside the session cookie, in either order', () => {
  assert.equal(readConsent('hub_session=abc123; ss_consent=granted'), 'granted');
  assert.equal(readConsent('ss_consent=denied; hub_session=abc123'), 'denied');
});

test('never fails open on unknown, empty or tampered values', () => {
  for (const v of [
    '',
    'GRANTED',
    'Granted',
    'true',
    '1',
    'yes',
    'grantedx',
    '{}',
    'null',
    'denied2',
  ]) {
    assert.equal(
      readConsent(`ss_consent=${v}`),
      null,
      `must not accept ${JSON.stringify(v)} as a decision`,
    );
  }
});
