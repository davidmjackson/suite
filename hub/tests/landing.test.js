// tests/landing.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp } from './helpers.js';
import { now, randomToken } from '../lib/tokens.js';

test('GET / (anon) renders the marketing page', async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /Sign in/);
});

test('GET / redirects an authenticated user to /dashboard', async () => {
  const { app, db } = await buildTestApp();
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run('u1', 'a@b.c', now());
  const sid = randomToken();
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(sid, 'u1', now(), now(), now() + 60_000);
  const res = await request(app).get('/').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/dashboard');
});

test('GET / renders landing (not redirect) for a stale/idle session', async () => {
  const { app, db } = await buildTestApp();
  db.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').run('u2', 'c@d.e', now());
  const sid = randomToken();
  const stale = now() - 31 * 60 * 1000; // older than the 30-min idle cutoff
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(sid, 'u2', now(), stale, now() + 60_000);
  const res = await request(app).get('/').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 200);
});

test("GET / renders landing (not redirect) for a disabled user's session", async () => {
  const { app, db } = await buildTestApp();
  db.prepare('INSERT INTO users (id,email,created_at,disabled_at) VALUES (?,?,?,?)').run(
    'u3',
    'f@g.h',
    now(),
    now(),
  );
  const sid = randomToken();
  db.prepare(
    'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
  ).run(sid, 'u3', now(), now(), now() + 60_000);
  const res = await request(app).get('/').set('Cookie', `hub_session=${sid}`);
  assert.equal(res.status, 200);
});

test('landing head carries SEO essentials', async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get('/');
  assert.match(res.text, /<link rel="canonical" href="https:\/\/sprintsuite\.uk\/">/);
  assert.match(res.text, /property="og:title"/);
  assert.match(res.text, /"@type"\s*:\s*"SoftwareApplication"/);
  assert.match(res.text, /<link rel="stylesheet" href="\/css\/landing\.css">/);
});

test('landing has exactly one h1 and a sign-in CTA to /login', async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get('/');
  const h1s = res.text.match(/<h1[\s>]/g) || [];
  assert.equal(h1s.length, 1, 'exactly one <h1>');
  assert.match(res.text, /<h1>Your agile toolkit, one login\.<\/h1>/);
  assert.match(res.text, /href="\/login"[^>]*>\s*Sign in\s*</);
});

test('landing wires the hero trace module and respects reduced motion', async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get('/');
  assert.match(res.text, /<script type="module" src="\/js\/landing-hero\.js">/);
  assert.match(res.text, /<g class="waves-drift" id="scope">/);
  const css = await request(app).get('/css/instrument-core.css');
  assert.match(css.text, /prefers-reduced-motion/);
});

test('landing shows the four trust items', async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get('/');
  assert.match(res.text, /Passwordless sign-in/);
  assert.match(res.text, /Anonymous health checks/);
  assert.match(res.text, /Exports to Jira, CSV &amp; Markdown/);
  // GA4 (consent-gated) makes an absolute "no tracking" claim false. We keep the
  // claim we can defend: no advertising, ever.
  assert.match(res.text, /No ads, no clutter/);
  assert.doesNotMatch(res.text, /No tracking, no clutter/);
});

test('the data FAQ describes consent-gated analytics honestly', async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get('/');
  assert.doesNotMatch(res.text, /no third-party tracking/i, 'GA4 makes this false');
  assert.match(res.text, /only if you accept/i, 'consent is stated plainly');
  assert.match(res.text, /never sell/i);
  assert.match(res.text, /anonymous/i, 'health-check anonymity claim survives');
});

test('the landing footer offers a withdraw-consent control when analytics are on', async () => {
  const { app } = await buildTestApp({ env: { GA_MEASUREMENT_ID: 'G-TEST123' } });
  const res = await request(app).get('/');
  const footer = res.text.slice(res.text.indexOf('class="lp-footer"'));
  assert.match(footer, /data-consent-settings/, 'PECR: withdrawing must be as easy as granting');
  assert.match(footer, /Cookie settings/);
});

test('no dead control: the footer hides Cookie settings when analytics are off', async () => {
  // The [data-consent-settings] listener lives in consent-banner.js, which is not
  // loaded when gaId is null — so an ungated control would render and silently do
  // nothing. No analytics means no cookie to configure, so no control.
  const { app } = await buildTestApp({ env: { GA_MEASUREMENT_ID: '' } });
  const res = await request(app).get('/');
  assert.doesNotMatch(res.text, /data-consent-settings/);
  assert.doesNotMatch(res.text, /Cookie settings/);
});

test('app grid shows all six apps', async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get('/');
  for (const name of [
    'Sprintraid',
    'Sprintsignal',
    'Sprintretro',
    'Sprintpoker',
    'Sprintplan',
    'Sprintsight',
  ]) {
    assert.match(res.text, new RegExp(name));
  }
  assert.equal((res.text.match(/class="appcard"/g) || []).length, 6);
});

test('a tile links only when it has a page behind it', async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get('/');
  // @3742c58 made the tiles divs because pointing one at a login-gated app lies
  // about where it goes. Sprintsight is the first with a real public page, so it
  // is the first <a>. The rest are informational for now; the two CTAs carry
  // navigation. EXPECTED TO CHANGE: each app is getting a detail page, and as one
  // lands its tile becomes an <a> and joins this list. That is the design, not a
  // regression — move the name across, don't delete the assertion.
  const linked = ['sight'];
  const notLinked = ['raid', 'signal', 'retro', 'poker', 'plan'];

  // Matched by tag + data-app without pinning attribute order: rewriting the
  // element as <a href="…" class="appcard"> is not a defect and must not fail.
  const card = (slug) => {
    const m = res.text.match(new RegExp(`<(a|div)\\b[^>]*\\bdata-app="${slug}"[^>]*>`));
    assert.ok(m, `no tile found for ${slug}`);
    return { tag: m[1], html: m[0] };
  };

  for (const slug of linked) {
    const { tag, html } = card(slug);
    assert.equal(tag, 'a', `${slug} has a page, so its tile must be a link`);
    assert.match(html, /href="\//, `${slug} must link somewhere real`);
  }
  for (const slug of notLinked) {
    assert.equal(card(slug).tag, 'div', `${slug} has no page yet, so its tile must not be a link`);
  }
  // no tile may link to nowhere
  assert.doesNotMatch(res.text, /class="appcard"[^>]*href="#"/);
  assert.equal((res.text.match(/<a\b[^>]*class="appcard"/g) || []).length, linked.length);
});

test('the Sprintsight tile points at the live promo page, same tab', async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get('/');
  assert.match(res.text, /href="\/sprintsight-coming-soon\/intro\/"/);
  // same origin: forcing a new tab breaks the back button people expect
  assert.doesNotMatch(res.text, /class="appcard"[^>]*target="_blank"/);
});

test('the Sprintsight tile cannot be mistaken for a working tool', async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get('/');
  // The product does not exist. Every other tag names a capability (RAID,
  // Health, Retro...); this one names the STATE on purpose. If it ever ships,
  // this assertion is the thing that should stop a silent capability claim.
  const h3 = res.text.match(/<h3\b[^>]*>Sprintsight[\s\S]*?<\/h3>/)[0];
  assert.match(h3, /<span class="tag tag-sight">Coming soon<\/span>/);
  // and the state must be inside the accessible name, not merely nearby
  const anchor = res.text.match(/<a\b[^>]*data-app="sight"[^>]*>/)[0];
  const labelledby = anchor.match(/aria-labelledby="([^"]+)"/);
  assert.ok(labelledby, 'the tile names itself from its heading');
  assert.match(h3, new RegExp(`id="${labelledby[1]}"`), 'aria-labelledby points at that h3');
});

test('every published tool count matches the tools that exist', async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get('/');
  // These had said "four" since Sprintplan shipped, and its absence from
  // featureList went with it. Nobody reads a meta description, which is exactly
  // why it rotted — a section-by-section review misses it, a grep does not.
  // Five is the honest number: five apps are behind the sign-in. Sprintsight is
  // NOT counted and NOT in featureList — it does not exist, and featureList
  // means present features, not planned ones.
  assert.doesNotMatch(res.text, /four focused apps/, 'stale count in meta/og/JSON-LD');
  assert.match(res.text, /name="description" content="One sign-in, five focused apps/);
  assert.match(res.text, /og:description" content="One sign-in, five focused apps/);

  const ld = JSON.parse(
    res.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1],
  );
  assert.match(ld.description, /five focused apps/);
  assert.equal(ld.featureList.length, 5, 'one entry per app behind the login');
  assert.ok(
    !ld.featureList.some((f) => /sight|watermelon/i.test(f)),
    'Sprintsight must not be listed as a present feature',
  );
});

test('the footer Apps nav lists every app you can actually sign in to', async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get('/');
  const nav = res.text.match(/<nav class="lp-foot-col" aria-label="Apps">([\s\S]*?)<\/nav>/)[1];
  for (const name of ['Sprintraid', 'Sprintsignal', 'Sprintretro', 'Sprintpoker', 'Sprintplan']) {
    assert.match(nav, new RegExp(name), `${name} is usable, so it belongs here`);
  }
  // Sprintsight cannot be signed in to, so it must not sit among things that can.
  assert.doesNotMatch(nav, /Sprintsight/, 'Sprintsight is not a usable app yet');
});

test('the app-grid heading does not claim six working tools', async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get('/');
  // Five ARE behind the login. Sprintsight is not behind it at all — it has no
  // login, it is a public promo. "Six tools behind one login" would be false.
  assert.match(res.text, /Five tools behind one login\. A sixth on the way\./);
  assert.doesNotMatch(res.text, /Six tools behind one login/);
  // the hero eyebrow makes the same claim and is still true for the same reason
  assert.match(res.text, /Five tools · one passwordless login/);
});

test('FAQ frames access via register-your-interest and the closing CTA links to /login', async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get('/');
  // access framing: how to get in, then the honest usage limit, no "free" promise
  assert.match(res.text, /How do I get access\?<\/h3><p>Register your interest/);
  assert.match(res.text, /not unlimited/i);
  assert.doesNotMatch(res.text, /free/i);
  assert.match(res.text, /class="close"[\s\S]*href="\/login"/);
});

test('feature rows carry the SEO payload terms and real alt text', async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get('/');
  for (const term of ['RAID log', 'team health check', 'retrospective', 'scrum poker']) {
    assert.match(res.text, new RegExp(term, 'i'));
  }
  for (const alt of [
    'Sprintraid RAID log with risks, assumptions, issues and a flagged dependency conflict',
    'Sprintsignal health check radar chart and focus areas',
    'Sprintretro Start Stop Continue board with stat cards and timer',
    'Sprintpoker estimation room with face-up and face-down cards',
  ]) {
    assert.ok(res.text.includes(`alt="${alt}"`), `alt present: ${alt}`);
  }
  assert.doesNotMatch(res.text, /data:image\//, 'no base64 images in production template');
});

test('footer Apps links point to /login and legal links resolve', async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get('/');
  const footer = res.text.slice(res.text.indexOf('class="lp-footer"'));
  const appLinks = footer.match(/href="\/login"/g) || [];
  assert.ok(appLinks.length >= 4, 'four Apps links to /login in footer');
  assert.match(footer, /href="\/privacy"/);
  assert.match(footer, /href="\/terms"/);
  assert.match(footer, /href="\/license"/);
  assert.match(footer, /href="#features"/);
  assert.match(footer, /href="#faq"/);
});

test('landing offers a Register your interest path to /request for new businesses', async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get('/');
  // visible primary-journey CTA for cold prospects, in hero + closing card
  assert.match(res.text, /href="\/request"[^>]*>\s*Register your interest\s*</);
  // present at the hero, the closing CTA, and the footer
  const reqLinks = res.text.match(/href="\/request"/g) || [];
  assert.ok(
    reqLinks.length >= 3,
    `expected /request in hero, closing CTA and footer; saw ${reqLinks.length}`,
  );
});
