// tests/email.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMagicLinkEmail, renderAccessApprovedEmail } from '../lib/email.js';

test('renderMagicLinkEmail produces HTML with the URL', async () => {
  const html = await renderMagicLinkEmail({ url: 'https://sprintsuite.uk/auth/magic?token=abc' });
  assert.match(html, /Sign in to Sprint Suite/);
  assert.match(html, /https:\/\/sprintsuite\.uk\/auth\/magic\?token=abc/);
});

test('renderAccessApprovedEmail includes the sign-in url', async () => {
  const html = await renderAccessApprovedEmail({ url: 'https://test/auth/magic?token=abc' });
  assert.match(html, /auth\/magic\?token=abc/);
  assert.match(html, /Sprint Suite/);
});
