// The promo page is served by an Apache Alias, not by the hub, so nothing in
// hub/ applies its security headers — the vhost has to. That makes the policy a
// fact written in three places: securityHeaders.js, the vhost mirror here, and
// the live vhost on prod. Apache cannot import from JavaScript, so these tests
// assert the two in-repo copies agree. Only smoke-sprintsuite.sh can speak for prod.
//
// Everything here reads the headers from INSIDE the <Directory> block that the
// Alias actually targets, never from the file at large. Scope is the whole point:
// the same six Header lines hoisted to vhost scope would apply to proxied hub
// responses too, and because `always` merges rather than replaces, every hub page
// would carry TWO CSP headers. Browsers enforce the intersection, which would
// strip the app origins off form-action and break the launch/magic-link redirects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DEFAULT_CSP, makeSecurityHeaders } from '../../hub/middleware/securityHeaders.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const VHOST = read('../../infrastructure/apache/sprintsuite.uk.conf');
const PAGE = read('../public/sprintsight-coming-soon/intro/index.html');

// The directory the Alias points at — read from the Alias line rather than
// hardcoded, so a <Directory> block guarding some OTHER path cannot satisfy these
// tests while the aliased page ships bare.
const aliasTarget = VHOST.match(/^\s*Alias\s+\S+\s+(\S+)\s*$/m)?.[1];

function directoryBlock(path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return VHOST.match(new RegExp(`<Directory\\s+${escaped}\\s*>([\\s\\S]*?)</Directory>`))?.[1];
}

const BLOCK = aliasTarget && directoryBlock(aliasTarget);

// Every `Header always set X "Y"` inside that block, as a map.
const headers = Object.fromEntries(
  [...(BLOCK ?? '').matchAll(/^\s*Header always set\s+(\S+)\s+"([^"]*)"/gm)].map((m) => [
    m[1],
    m[2],
  ]),
);

// What the hub sets on its own pages, captured by running the real middleware.
function hubHeaders() {
  const out = {};
  makeSecurityHeaders()({}, { setHeader: (k, v) => (out[k] = v) }, () => {});
  return out;
}

// Recomputed from the page every run, so the block and the hash cannot drift apart.
function noscriptStyleHash() {
  const block = PAGE.match(/<noscript><style>(.*?)<\/style><\/noscript>/s);
  assert.ok(block, 'the noscript style block is gone — the CSP hash is now dead weight, remove it');
  return `sha256-${createHash('sha256').update(block[1], 'utf8').digest('base64')}`;
}

test('the Alias is guarded by a <Directory> block for the path it actually serves', () => {
  assert.ok(
    aliasTarget,
    'no Alias line found — the promo page is not being served from here at all',
  );
  assert.ok(
    BLOCK,
    `no <Directory ${aliasTarget}> block. A typo here, or hoisting the Header lines to vhost ` +
      `scope, ships the page bare while apache2ctl still reports Syntax OK.`,
  );
});

test('the block sets every header the hub middleware sets', () => {
  for (const name of Object.keys(hubHeaders())) {
    assert.ok(headers[name], `vhost is missing ${name} — the promo page would ship without it`);
  }
});

test('the non-CSP headers match the hub byte for byte', () => {
  for (const [name, value] of Object.entries(hubHeaders())) {
    if (name === 'Content-Security-Policy') continue;
    assert.equal(headers[name], value, `${name} has drifted from securityHeaders.js`);
  }
});

test("the promo CSP is the hub's, deviating only in style-src", () => {
  const hubDirectives = DEFAULT_CSP.split('; ');
  const promoDirectives = headers['Content-Security-Policy'].split('; ');

  assert.equal(
    promoDirectives.length,
    hubDirectives.length,
    'directive count differs from DEFAULT_CSP',
  );
  const differing = promoDirectives.filter((d, i) => d !== hubDirectives[i]);
  assert.equal(
    differing.length,
    1,
    `expected exactly one deviation from DEFAULT_CSP, got: ${differing.join(' | ')}`,
  );

  // Equality, not a prefix. `style-src 'none' '<hash>'` starts with "style-src "
  // too, and would block instrument-core.css and sight.css outright — the page
  // renders unstyled while a prefix check calls it fine.
  assert.equal(differing[0], `style-src 'self' '${noscriptStyleHash()}'`);
});

test('the promo CSP does not permit unsafe-inline styles', () => {
  // The whole point of the deviation. If someone "aligns" it back to the hub's
  // policy this goes red, rather than the page quietly rejoining the ZAP finding.
  assert.doesNotMatch(headers['Content-Security-Policy'], /'unsafe-(inline|hashes)'/);
});
