// tests/no-inline-style.test.js
//
// The hub's CSP is `style-src 'self'` with no 'unsafe-inline', so a `style=`
// attribute on a served page is DROPPED BY THE BROWSER: the page renders wrong
// and nothing anywhere fails. Rendering each view is the only thing that catches
// it — the policy test in security-headers.test.js proves the header, not the
// markup it governs.
//
// A CSP nonce does not help. Nonces cover <style> ELEMENTS; style ATTRIBUTES need
// style-src-attr or 'unsafe-hashes', both of which re-open what this closed. The
// attributes have to go.
//
// The view list is read off DISK, not written out here, so a view added later is
// covered the day it lands: with no fixture it renders empty and either throws or
// is checked anyway, and either way the failure is loud. A hand-kept list would
// silently not cover it — the same fail-open shape this test exists to prevent.
//
// views/emails/ is deliberately out of scope. Those three templates are rendered
// into mail bodies by lib/email.js and never into an HTTP response, so no CSP
// reaches them — and mail clients strip <style> blocks, so their inline styles are
// load-bearing. views/partials/ is covered transitively: every page includes them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Eta } from 'eta';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewsDir = path.join(__dirname, '../views');
const eta = new Eta({ views: viewsDir, cache: false });

function pageViews(dir = viewsDir, prefix = '') {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        return name === 'emails' || name === 'partials'
          ? []
          : pageViews(path.join(dir, entry.name), name);
      }
      return entry.name.endsWith('.eta') ? [name.replace(/\.eta$/, '')] : [];
    })
    .sort();
}

const user = { email: 'admin@test', is_admin: 1 };
const company = { name: 'Acme Ltd', slug: 'acme' };

// Each fixture drives the branches that can HOLD a style attribute — the role
// <select> in console.eta sits inside the members loop, and team.eta's "Add to
// team" form only renders when availableMembers is non-empty. Fixtures with empty
// collections would render pages with nothing to find and pass without proving
// anything, so every list here carries at least one row.
const FIXTURES = {
  login: { returnTo: '/dashboard' },
  'check-email': { email: 'someone@test' },
  confirm: { token: 'tok' },
  error: { title: 'Not found', message: 'No such page', reqId: 'req-1', backHref: '/' },
  legal: { title: 'Terms' },
  license: {},
  privacy: {},
  'request-received': {},
  request: { error: 'Something went wrong', values: { email: 'a@test' } },
  landing: { requestUrl: '/request', signinUrl: '/login' },
  dashboard: {
    user,
    apps: [{ key: 'signal', name: 'Signal', desc: 'd', href: '/launch/signal', entitled: 1 }],
    manageable: [{ name: 'Acme Ltd', slug: 'acme', role: 'owner' }],
  },
  'admin/users': { user, users: [{ id: 1, email: 'u@test', session_count: 0 }] },
  'admin/audit': {
    user,
    events: [
      { created_at: 1, event_type: 'login', email: 'u@test', user_id: 1, app: 'hub', ip: '::1' },
    ],
  },
  'admin/sessions': {
    user,
    sessions: [{ id: 1, email: 'u@test', created_at: 1, last_heartbeat_at: 1, ip: '::1' }],
  },
  'admin/companies': {
    user,
    companies: [{ id: 1, name: 'Acme Ltd', slug: 'acme', status: 'active', memberCount: 2 }],
    requests: [
      {
        id: 1,
        contact_name: 'Someone',
        email: 'a@test',
        company_name: 'Acme Ltd',
        appsLabel: 'Signal',
        dupeEmail: false,
        existingCompany: null,
      },
    ],
    appsByCompany: { 1: ['signal'] },
  },
  'company/console': {
    user,
    company,
    companyRole: 'owner',
    members: [{ userId: 2, email: 'm@test', role: 'member', signalOn: 1, raidOn: 0 }],
    teams: [{ id: 3, name: 'Platform' }],
  },
  'company/team': {
    user,
    company,
    team: { id: 3, name: 'Platform' },
    teamMembers: [{ userId: 2, email: 'm@test' }],
    availableMembers: [{ userId: 4, email: 'other@test' }],
  },
};

for (const view of pageViews()) {
  test(`${view} renders no inline style attribute`, async () => {
    const html = await eta.renderAsync(view, FIXTURES[view] ?? {});
    const found = html.match(/\sstyle\s*=/g) || [];
    assert.equal(found.length, 0, `${view} still carries ${found.length} style= attribute(s)`);
  });
}
