# Sprint Suite Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the launcher-style `/` in the hub with an SEO-bearing Instrument marketing front door whose single CTA is passwordless sign-in.

**Architecture:** A standalone server-rendered Eta template (`views/landing.eta`) with its own `<head>` (SEO/JSON-LD/OG) and a page-specific stylesheet (`public/css/landing.css`). It reuses the existing synced Instrument foundation **by reference only** — tokens via `class="ins"` + `/css/instrument-core.css`, glyphs via the `/illos/glyphs.svg` sprite, and the scope-trace geometry via `import { scopePath }` from `/js/oscilloscope.js`. The `shared/theme/` foundation is **not edited** (it is drift-tested and synced to four other apps). Authenticated visitors are redirected to `/dashboard`.

**Tech Stack:** Node + Express, Eta templates, `node:test` + supertest, vanilla CSS (oklch tokens), vanilla ES-module JS, `cwebp` (WebP) and `rsvg-convert` (PNG raster) for the one-time asset build.

**Authoritative references (already on disk, the executor MUST open them):**
- Spec: `docs/superpowers/specs/2026-06-04-suite-landing-page-design.md`
- Build spec (verbatim component CSS, copy, alt text, glyph SVGs): `project-design-docs/new-landing-page/landing-page-build-spec.md`
- Approved prototype (visual source of truth): `project-design-docs/new-landing-page/A2-final.html`
- Source screenshots: `project-design-docs/new-landing-page/shot-{raid,signal,retro,poker}.png`

**Conventions in this repo (verified):**
- Tests live in `hub/tests/`, run with `npm test` (= `node --test tests/`) from `hub/`.
- `buildTestApp()` (in `tests/helpers.js`) builds an Express app with views + `public/` static + an in-memory DB, and mounts **only** `mountLanding`. Tests needing other routes import and mount them (see `tests/dashboard.test.js`).
- Seed an authenticated session: insert into `users` then `central_sessions`, send cookie `hub_session=<sid>`. Use `now()` + `randomToken()` from `lib/tokens.js`.
- All paths below are relative to `/var/www/suite/hub/` unless noted. Run all commands from `/var/www/suite/hub/`.
- Git staging in this repo is **explicit-paths only** — never `git add -A`/`.`. `project-design-docs/` is gitignored.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `routes/landing.js` | MODIFY — authed → redirect `/dashboard`; anon → render | 1 |
| `routes/legal.js` | NEW — mount `GET /privacy /terms /license`, render stub | 2 |
| `views/legal.eta` | NEW — shared "coming soon" stub (uses header/footer partials) | 2 |
| `server.js` | MODIFY — import + `mountLegal(app)` | 2 |
| `views/landing.eta` | REWRITE — standalone marketing template, built section by section | 3–9 |
| `public/css/landing.css` | NEW — page-specific layout/components, built section by section. ZERO colour tokens. | 3–9 |
| `public/js/landing-hero.js` | NEW — import `scopePath()`; mount hero trace at 0.3/0.7/0.1 | 4 |
| `public/img/shot-*.png` | NEW — PNG fallbacks copied from source | 7 |
| `public/img/shot-*.webp` (+@2x) | NEW — converted assets | 10 |
| `public/favicon.svg`, `og.svg` | NEW — hand-authored SVG | 10 |
| `public/favicon-32.png`, `apple-touch-icon.png`, `public/img/og.png` | NEW — rasterized | 10 |
| `tests/landing.test.js` | REWRITE — new HTML/route contract, extended per section | 1,3,5,6,7,8,9 |
| `tests/legal.test.js` | NEW — stub routes return 200 | 2 |

**Note on TDD for a server-rendered page:** the honest automated surface is route/HTML assertions (status codes, hrefs, SEO tags, copy, absence of base64). Those are written test-first. Pure visual styling (spacing, colour, motion) is **not** faked into unit tests — it is verified manually in Task 11 against `A2-final.html`. CSS for each section is written alongside its markup in the same task.

---

## Task 1: Landing route — redirect authed users, render anon

**Files:**
- Modify: `routes/landing.js`
- Test: `tests/landing.test.js` (rewrite — the old `apptile`/"Sign in" assertions no longer hold)

- [ ] **Step 1: Replace the landing test with the route contract**

Overwrite `tests/landing.test.js` with:

```js
// tests/landing.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";

test("GET / (anon) renders the marketing page", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
});

test("GET / redirects an authenticated user to /dashboard", async () => {
  const { app, db } = await buildTestApp();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const res = await request(app).get("/").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "/dashboard");
});
```

- [ ] **Step 2: Run the tests to verify the redirect test fails**

Run: `npm test -- --test-name-pattern="redirects an authenticated"` (or `npm test`)
Expected: FAIL — current `routes/landing.js` renders for authed users (200) instead of redirecting.

- [ ] **Step 3: Update the route to redirect authed users**

Overwrite `routes/landing.js` with:

```js
// routes/landing.js
import { parseCookies } from "../lib/cookies.js";

export function mountLanding(app) {
  app.get("/", (req, res) => {
    const db = req.app.locals.db;
    const sid = parseCookies(req.headers.cookie).hub_session;
    if (sid) {
      const row = db.prepare(`
        SELECT 1 FROM central_sessions cs
        WHERE cs.id = ? AND cs.expires_at > ?
      `).get(sid, Date.now());
      if (row) return res.redirect("/dashboard");
    }
    res.render("landing", { signinUrl: "/login" });
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="GET /"`
Expected: PASS (both tests). The anon test renders the *current* `landing.eta` — that's fine; it is rewritten in Task 3.

- [ ] **Step 5: Commit**

```bash
git add routes/landing.js tests/landing.test.js
git commit -m "feat(landing): redirect authenticated users to /dashboard"
```

---

## Task 2: Legal stub routes + view

**Files:**
- Create: `routes/legal.js`, `views/legal.eta`, `tests/legal.test.js`
- Modify: `server.js`

- [ ] **Step 1: Write the failing test**

Create `tests/legal.test.js`:

```js
// tests/legal.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";

async function buildWithLegal() {
  const { app, db, config } = await buildTestApp();
  const { mountLegal } = await import("../routes/legal.js?t=" + Date.now());
  mountLegal(app);
  return { app, db, config };
}

for (const p of ["/privacy", "/terms", "/license"]) {
  test(`GET ${p} returns 200`, async () => {
    const { app } = await buildWithLegal();
    const res = await request(app).get(p);
    assert.equal(res.status, 200);
    assert.match(res.text, /Sprint Suite/);
  });
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="GET /privacy"`
Expected: FAIL — `routes/legal.js` does not exist (import throws).

- [ ] **Step 3: Create the stub view**

Create `views/legal.eta`:

```eta
<%~ include("partials/header", { title: it.title + " — Sprint Suite", user: it.user, band: { eyebrow: "Sprint Suite", title: it.title, sub: "This page is coming soon." } }) %>
<section class="card">
  <p class="lede"><%= it.title %> terms for Sprint Suite are being finalised. In the meantime, contact us and we'll answer any questions directly.</p>
  <p style="margin-top:14px"><a class="lnk" href="/">Back to home</a></p>
</section>
<%~ include("partials/footer") %>
```

- [ ] **Step 4: Create the route**

Create `routes/legal.js`:

```js
// routes/legal.js
// Placeholder legal pages so footer links resolve. Real copy lands with the
// licence/consent work (blocked on lawyer-reviewed text).
const PAGES = {
  "/privacy": "Privacy",
  "/terms": "Terms",
  "/license": "License",
};

export function mountLegal(app) {
  for (const [path, title] of Object.entries(PAGES)) {
    app.get(path, (req, res) => res.render("legal", { title }));
  }
}
```

- [ ] **Step 5: Mount it in `server.js`**

Add the import alongside the others (after the `mountRequest` import line):

```js
import { mountLegal } from "./routes/legal.js";
```

Add the mount call alongside the others (after `mountRequest(app, { emailSender });`):

```js
mountLegal(app);
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -- --test-name-pattern="GET /privacy|GET /terms|GET /license"`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add routes/legal.js views/legal.eta tests/legal.test.js server.js
git commit -m "feat(legal): stub /privacy /terms /license pages"
```

---

## Task 3: Standalone template — head, topbar, hero band shell

Builds the above-the-fold standalone page: SEO `<head>`, `<body class="ins">`, bespoke topbar, and the hero band with eyebrow / single `<h1>` / lede / CTA / scrim and an empty scope `<svg>` shell (trace JS arrives in Task 4). Creates `landing.css` with base, topbar, band, scrim, `.btn-lg`, and CTA-hover rules.

**Files:**
- Rewrite: `views/landing.eta`
- Create: `public/css/landing.css`
- Test: `tests/landing.test.js` (extend)

- [ ] **Step 1: Extend the test with the head + hero contract**

Append to `tests/landing.test.js`:

```js
test("landing head carries SEO essentials", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.match(res.text, /<link rel="canonical" href="https:\/\/sprintsuite\.uk\/">/);
  assert.match(res.text, /property="og:title"/);
  assert.match(res.text, /"@type"\s*:\s*"SoftwareApplication"/);
  assert.match(res.text, /<link rel="stylesheet" href="\/css\/landing\.css">/);
});

test("landing has exactly one h1 and a sign-in CTA to /login", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  const h1s = res.text.match(/<h1[\s>]/g) || [];
  assert.equal(h1s.length, 1, "exactly one <h1>");
  assert.match(res.text, /Agile tools for teams that ship/);
  assert.match(res.text, /href="\/login"[^>]*>\s*Sign in to get started/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="SEO essentials|exactly one h1"`
Expected: FAIL — current template has no canonical/JSON-LD/landing.css and wrong CTA.

- [ ] **Step 3: Rewrite `views/landing.eta` (head + topbar + hero)**

Overwrite `views/landing.eta` with the standalone shell below. (Sections 5–9 append before `</main>` / before `</body>` in later tasks.)

```eta
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sprint Suite — Agile tools for teams that ship</title>
<meta name="description" content="One sign-in, four focused apps for scrum masters and delivery leads. RAID logs, team health checks, retrospectives and planning poker.">
<link rel="canonical" href="https://sprintsuite.uk/">
<meta property="og:title" content="Sprint Suite — Agile tools for teams that ship">
<meta property="og:description" content="One sign-in, four focused apps for scrum masters and delivery leads.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://sprintsuite.uk/">
<meta property="og:image" content="https://sprintsuite.uk/img/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/css/instrument-core.css">
<link rel="stylesheet" href="/css/landing.css">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Sprint Suite","applicationCategory":"BusinessApplication","operatingSystem":"Web","description":"One sign-in, four focused apps for scrum masters and delivery leads.","url":"https://sprintsuite.uk/","offers":{"@type":"Offer","price":"0","priceCurrency":"GBP"},"featureList":["RAID log","Team health check","Sprint retrospective","Scrum planning poker"]}
</script>
<script type="module" src="/js/landing-hero.js"></script>
</head>
<body class="ins">

<header class="topbar lp-topbar">
  <a class="brand" href="/"><svg class="mk" width="22" height="22" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-suite"/></svg> <span>Sprint<span class="brand-suite">Suite</span></span></a>
  <a class="btn btn-pri" href="<%= it.signinUrl %>">Sign in to get started</a>
</header>

<section class="band lp-band">
  <div class="waves" aria-hidden="true"><svg viewBox="0 0 2400 200" preserveAspectRatio="none" width="100%" height="100%"><g class="waves-drift" id="scope"></g></svg></div>
  <div class="band-scrim" aria-hidden="true"></div>
  <div class="band-in lp-hero">
    <p class="eyebrow">One sign-in · four focused apps</p>
    <h1>Agile tools for teams that ship.</h1>
    <p class="lede lp-lede">RAID logs, health checks, retros and planning poker. Four sharp tools for scrum masters and delivery leads, behind a single passwordless login. No setup, no sprawl.</p>
    <div class="cta-row">
      <a class="btn btn-pri btn-lg" href="<%= it.signinUrl %>">Sign in to get started</a>
      <span class="cta-note">Passwordless magic-link · free to try</span>
    </div>
  </div>
</section>

<main class="wrap">
</main>

</body>
</html>
```

- [ ] **Step 4: Create `public/css/landing.css` (base, topbar, band, scrim, btn-lg, hover)**

Create `public/css/landing.css`:

```css
/* landing.css — page-specific layout for sprintsuite.uk front door.
   Tokens/components come from instrument-core.css; introduce NO colour tokens here. */

.wrap{max-width:1120px;margin:0 auto;padding:0 40px}

/* topbar: the standalone landing reuses .topbar but pins the brand wordmark */
.lp-topbar{position:sticky;top:0;z-index:10}
.brand-suite{color:var(--green)}

/* hero band: tall editorial hero with a readability scrim over the trace */
.lp-band .waves{opacity:0.55}
.band-scrim{position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(90deg,
    var(--panel) 0%,
    var(--panel) 30%,
    oklch(0.996 0.002 240 / 0.82) 48%,
    oklch(0.996 0.002 240 / 0) 72%);}
.lp-hero{padding:64px 40px 58px}
.lp-hero h1{font-size:52px;line-height:1.02;margin:10px 0 14px;max-width:18ch}
.lp-lede{font-size:17px;max-width:60ch}
.cta-row{display:flex;align-items:center;gap:16px;margin-top:26px;flex-wrap:wrap}
.cta-note{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0.12em;
  text-transform:uppercase;color:var(--faint);font-weight:600}

/* page-local button extras (not in the synced foundation) */
.ins .btn-lg{padding:13px 22px;font-size:15px}
.ins .btn-pri:hover{background:color-mix(in oklab,var(--green) 88%,black)}

/* focus visibility (foundation has no global focus ring on links) */
.ins a:focus-visible,.ins .btn:focus-visible{outline:none;box-shadow:0 0 0 3px var(--greenwash)}

@media (max-width:720px){
  .wrap{padding:0 18px}
  .lp-hero{padding:44px 18px 40px}
  .lp-hero h1{font-size:34px}
  .lp-lede{font-size:15px}
}
```

- [ ] **Step 5: Run to verify the tests pass**

Run: `npm test -- --test-name-pattern="SEO essentials|exactly one h1|GET / \(anon\)"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add views/landing.eta public/css/landing.css tests/landing.test.js
git commit -m "feat(landing): standalone template head, topbar and hero band"
```

---

## Task 4: Hero trace JS (foundation-free, prototype opacities)

**Files:**
- Create: `public/js/landing-hero.js`
- Test: `tests/landing.test.js` (extend — assert the module is wired + reduced-motion rule served)

- [ ] **Step 1: Extend the test**

Append to `tests/landing.test.js`:

```js
test("landing wires the hero trace module and respects reduced motion", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.match(res.text, /<script type="module" src="\/js\/landing-hero\.js">/);
  assert.match(res.text, /<g class="waves-drift" id="scope">/);
  const css = await request(app).get("/css/instrument-core.css");
  assert.match(css.text, /prefers-reduced-motion/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="hero trace module"`
Expected: PASS for the script-tag/scope-group asserts (added in Task 3) but this confirms wiring; if Task 3 markup is correct it passes. If it fails, the `<script>`/`#scope` markup is missing — fix the template. (This task's real deliverable is the JS file in Step 3; the test guards the wiring.)

- [ ] **Step 3: Create `public/js/landing-hero.js`**

The geometry comes from the synced foundation; only the per-path opacities differ from `oscilloscope.js`'s default `scopeSvg()` (which is 0.4/0.9/0.12). Match the approved prototype: teal baseline 0.3, green trace 0.7, teal glow 0.1, with the `.waves` container at 0.55 (set in landing.css).

```js
// landing-hero.js — mount the hero scope trace at the approved prototype opacities
// (0.3 / 0.7 / 0.1). Reuses the foundation's path geometry; does NOT edit it.
import { scopePath, W, BASELINE } from "/js/oscilloscope.js";

function mountHero() {
  const g = document.getElementById("scope");
  if (!g || g.querySelector("path")) return; // already mounted
  const ns = "http://www.w3.org/2000/svg";
  const mk = (d, stroke, sw, op) => {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", stroke);
    p.setAttribute("stroke-width", sw);
    p.setAttribute("opacity", op);
    p.setAttribute("stroke-linecap", "round");
    return p;
  };
  const d = scopePath();
  g.appendChild(mk(`M0 ${BASELINE} L${W} ${BASELINE}`, "var(--teal)", 1, 0.3));
  g.appendChild(mk(d, "var(--green)", 2.2, 0.7));
  g.appendChild(mk(d, "var(--teal)", 6, 0.1));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountHero);
} else {
  mountHero();
}
```

Note: importing `oscilloscope.js` runs its auto-`mountWaves()` side effect, which targets `.band .waves` only when the container has no `<svg>`. Our hero `.waves` already contains an `<svg>`, so it is skipped — no double render.

- [ ] **Step 4: Run the full suite**

Run: `npm test -- --test-name-pattern="hero trace module"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/js/landing-hero.js tests/landing.test.js
git commit -m "feat(landing): hero scope trace at prototype opacities"
```

---

## Task 5: Trust strip

**Files:**
- Modify: `views/landing.eta` (insert `.trust` between `</section>` of the band and `<main class="wrap">`)
- Modify: `public/css/landing.css`
- Test: `tests/landing.test.js` (extend)

- [ ] **Step 1: Extend the test**

Append to `tests/landing.test.js`:

```js
test("landing shows the four trust items", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.match(res.text, /Passwordless sign-in/);
  assert.match(res.text, /Anonymous health checks/);
  assert.match(res.text, /Exports to Jira, CSV &amp; Markdown/);
  assert.match(res.text, /No tracking, no clutter/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="four trust items"`
Expected: FAIL — trust strip not yet in template.

- [ ] **Step 3: Add the trust markup**

In `views/landing.eta`, insert immediately after the band `</section>` and before `<main class="wrap">`:

```eta
<div class="trust">
  <div class="trust-in">
    <span class="trust-item"><span class="dot"></span> Passwordless sign-in</span>
    <span class="trust-item"><span class="dot"></span> Anonymous health checks</span>
    <span class="trust-item"><span class="dot"></span> Exports to Jira, CSV &amp; Markdown</span>
    <span class="trust-item"><span class="dot"></span> No tracking, no clutter</span>
  </div>
</div>
```

- [ ] **Step 4: Add the trust CSS**

Append to `public/css/landing.css`:

```css
.trust{background:var(--bone);border-bottom:1px solid var(--line2)}
.trust-in{max-width:1120px;margin:0 auto;display:flex;flex-wrap:wrap;gap:34px;
  padding:16px 40px;font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;
  letter-spacing:0.12em;text-transform:uppercase;color:var(--faint)}
.trust-item{display:inline-flex;align-items:center;gap:8px}
.trust .dot{width:6px;height:6px;border-radius:50%;background:var(--green);flex:0 0 auto}
@media (max-width:720px){.trust-in{padding:14px 18px;gap:18px}}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- --test-name-pattern="four trust items"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add views/landing.eta public/css/landing.css tests/landing.test.js
git commit -m "feat(landing): trust strip"
```

---

## Task 6: App card grid (2×2, all cards → sign-in)

**Files:**
- Modify: `views/landing.eta` (inside `<main class="wrap">`)
- Modify: `public/css/landing.css`
- Test: `tests/landing.test.js` (extend)

- [ ] **Step 1: Extend the test**

Append to `tests/landing.test.js`:

```js
test("app grid shows four cards all linking to /login", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  for (const name of ["Sprintraid", "Sprintsignal", "Sprintretro", "Sprintpoker"]) {
    assert.match(res.text, new RegExp(name));
  }
  const cardLinks = (res.text.match(/class="appcard"[^>]*href="\/login"/g) || []);
  assert.equal(cardLinks.length, 4, "four app cards link to /login");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="four cards all linking"`
Expected: FAIL — no app cards yet.

- [ ] **Step 3: Add the app-grid markup**

In `views/landing.eta`, replace the empty `<main class="wrap">\n</main>` with the grid (more sections append before `</main>` later):

```eta
<main class="wrap">

<section class="section appgrid-section">
  <h2 class="sec-h">Four tools, one workflow.</h2>
  <div class="appgrid">
    <a class="appcard" data-app="raid" href="<%= it.signinUrl %>">
      <span class="tile"><svg width="26" height="26" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-raid"/></svg></span>
      <div class="appcard-body">
        <h3>Sprintraid <span class="tag tag-raid">RAID</span></h3>
        <p>Risks, assumptions, issues and dependencies — paste in email or Teams text, get a structured RAID log.</p>
      </div>
    </a>
    <a class="appcard" data-app="signal" href="<%= it.signinUrl %>">
      <span class="tile"><svg width="26" height="26" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-signal"/></svg></span>
      <div class="appcard-body">
        <h3>Sprintsignal <span class="tag tag-signal">Health</span></h3>
        <p>Run a team health check and surface what's working and what isn't — anonymously.</p>
      </div>
    </a>
    <a class="appcard" data-app="retro" href="<%= it.signinUrl %>">
      <span class="tile"><svg width="26" height="26" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-retro"/></svg></span>
      <div class="appcard-body">
        <h3>Sprintretro <span class="tag tag-retro">Retro</span></h3>
        <p>Fast sprint retrospectives with Start / Stop / Continue boards and a built-in timer.</p>
      </div>
    </a>
    <a class="appcard" data-app="poker" href="<%= it.signinUrl %>">
      <span class="tile"><svg width="26" height="26" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-poker"/></svg></span>
      <div class="appcard-body">
        <h3>Sprintpoker <span class="tag tag-poker">Estimate</span></h3>
        <p>Planning poker for estimating your backlog together — no accounts needed for guests.</p>
      </div>
    </a>
  </div>
</section>

</main>
```

- [ ] **Step 4: Add the app-grid CSS**

Append to `public/css/landing.css`:

```css
.section{padding:54px 0}
.sec-h{font-size:28px;margin-bottom:24px}
.appgrid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.appcard{display:flex;gap:18px;background:var(--panel);border:1px solid var(--line2);
  border-radius:10px;padding:24px 26px;text-decoration:none;color:var(--ink);
  transition:border-color .12s,transform .12s}
.appcard:hover{border-color:var(--green);transform:translateY(-2px)}
.appcard .tile{width:52px;height:52px;flex:0 0 auto;border-radius:12px;background:var(--bone);
  border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;color:var(--accent)}
/* per-card accent overrides the body-level --accent (foundation maps green on .ins root) */
.appcard[data-app="raid"]{--accent:var(--amber)}
.appcard[data-app="signal"]{--accent:var(--green)}
.appcard[data-app="retro"]{--accent:var(--teal)}
.appcard[data-app="poker"]{--accent:var(--ink)}
.appcard h3{font-size:21px;display:flex;align-items:center;gap:9px}
.appcard p{color:var(--soft);font-size:14px;margin-top:7px}
.tag{font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;letter-spacing:0.06em;
  text-transform:uppercase;padding:3px 7px;border-radius:5px}
.tag-raid{background:var(--amberwash);color:oklch(0.5 0.12 60)}
.tag-signal{background:var(--greenwash);color:var(--green)}
.tag-retro{background:var(--tealwash);color:var(--teal)}
.tag-poker{background:oklch(0.93 0.006 250);color:var(--faint)}
@media (max-width:720px){.appgrid{grid-template-columns:1fr}}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- --test-name-pattern="four cards all linking"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add views/landing.eta public/css/landing.css tests/landing.test.js
git commit -m "feat(landing): app card grid linking to sign-in"
```

---

## Task 7: Feature rows + screenshot frames (SEO body copy + PNG assets)

Adds the four alternating feature rows with framed screenshots. Copies the source PNGs into `public/img/` as the initial `<img>` source (WebP `<picture>` wrapping comes in Task 10). Carries the SEO payload terms in real body copy.

**Files:**
- Modify: `views/landing.eta`, `public/css/landing.css`
- Create: `public/img/shot-{raid,signal,retro,poker}.png`
- Test: `tests/landing.test.js` (extend)

- [ ] **Step 1: Copy the source screenshots into the repo**

```bash
mkdir -p public/img
cp ../project-design-docs/new-landing-page/shot-raid.png public/img/shot-raid.png
cp ../project-design-docs/new-landing-page/shot-signal.png public/img/shot-signal.png
cp ../project-design-docs/new-landing-page/shot-retro.png public/img/shot-retro.png
cp ../project-design-docs/new-landing-page/shot-poker.png public/img/shot-poker.png
```

- [ ] **Step 2: Extend the test (SEO terms + verbatim alt text + no base64)**

Append to `tests/landing.test.js`:

```js
test("feature rows carry the SEO payload terms and real alt text", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  for (const term of ["RAID log", "team health check", "retrospective", "scrum poker"]) {
    assert.match(res.text, new RegExp(term, "i"));
  }
  assert.match(res.text, /alt="Sprintraid RAID log with risks, assumptions, issues and a flagged dependency conflict"/);
  assert.doesNotMatch(res.text, /data:image\//, "no base64 images in production template");
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- --test-name-pattern="SEO payload terms"`
Expected: FAIL — feature rows not present.

- [ ] **Step 4: Add the feature-rows markup**

In `views/landing.eta`, insert before `</main>` (after the app-grid `</section>`). Use the verbatim `alt` text from build spec §6. Image `width`/`height` use the source crop dimensions (build spec §6) to reserve layout space:

```eta
<section class="features" id="features">
  <div class="frow" data-app="raid">
    <div class="ftext">
      <p class="frow-eyebrow">Sprintraid</p>
      <h3>Turn meeting noise into a clean RAID log.</h3>
      <p>Paste an email or Teams thread and Sprintraid extracts a structured RAID log — risks, assumptions, issues and dependencies — so nothing slips between sprints.</p>
      <ul class="flist">
        <li>Auto-classify risks, assumptions, issues &amp; dependencies</li>
        <li>Flags dependency conflicts across workstreams</li>
        <li>Export to Jira, CSV or Markdown</li>
      </ul>
    </div>
    <figure class="shot">
      <div class="chrome"><i></i><i></i><i></i><span class="url">sprintraid.uk</span></div>
      <img src="/img/shot-raid.png" width="1180" height="865" loading="lazy" decoding="async"
        alt="Sprintraid RAID log with risks, assumptions, issues and a flagged dependency conflict">
    </figure>
  </div>

  <div class="frow" data-app="signal">
    <div class="ftext">
      <p class="frow-eyebrow">Sprintsignal</p>
      <h3>Run a team health check in minutes.</h3>
      <p>Sprintsignal turns an anonymous team health check into a radar of focus areas, so you can see where the team is thriving and where it needs support.</p>
      <ul class="flist">
        <li>Anonymous submissions, honest signal</li>
        <li>Radar chart of focus areas over time</li>
        <li>Share read-only results with stakeholders</li>
      </ul>
    </div>
    <figure class="shot">
      <div class="chrome"><i></i><i></i><i></i><span class="url">sprintsignal.uk</span></div>
      <img src="/img/shot-signal.png" width="1090" height="475" loading="lazy" decoding="async"
        alt="Sprintsignal health check radar chart and focus areas">
    </figure>
  </div>

  <div class="frow" data-app="retro">
    <div class="ftext">
      <p class="frow-eyebrow">Sprintretro</p>
      <h3>Retrospectives that don't drag.</h3>
      <p>Sprintretro runs a focused retrospective with a Start / Stop / Continue board, live stat cards and a timer to keep the conversation moving and end with clear actions.</p>
      <ul class="flist">
        <li>Start / Stop / Continue board</li>
        <li>Live stat cards and a built-in timer</li>
        <li>Disposable rooms — share a link, no accounts for guests</li>
      </ul>
    </div>
    <figure class="shot">
      <div class="chrome"><i></i><i></i><i></i><span class="url">sprintretro.uk</span></div>
      <img src="/img/shot-retro.png" width="1200" height="517" loading="lazy" decoding="async"
        alt="Sprintretro Start Stop Continue board with stat cards and timer">
    </figure>
  </div>

  <div class="frow" data-app="poker">
    <div class="ftext">
      <p class="frow-eyebrow">Sprintpoker</p>
      <h3>Estimate together with scrum poker.</h3>
      <p>Sprintpoker runs planning poker for your backlog — everyone votes face-down, then reveals together, so estimates stay honest and the discussion stays focused.</p>
      <ul class="flist">
        <li>Face-down voting, reveal together</li>
        <li>Guests join with a link, no account needed</li>
        <li>Bring your own backlog items</li>
      </ul>
    </div>
    <figure class="shot">
      <div class="chrome"><i></i><i></i><i></i><span class="url">sprintpoker.uk</span></div>
      <img src="/img/shot-poker.png" width="738" height="220" loading="lazy" decoding="async"
        alt="Sprintpoker estimation room with face-up and face-down cards">
    </figure>
  </div>
</section>
```

- [ ] **Step 5: Add the feature-rows CSS**

Append to `public/css/landing.css`:

```css
.features{padding-bottom:20px}
.frow{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;
  padding:48px 0;border-top:1px solid var(--line)}
.frow:nth-child(even) .ftext{order:2}
.frow-eyebrow{font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;
  letter-spacing:0.2em;text-transform:uppercase;color:var(--accent)}
.frow[data-app="raid"]{--accent:var(--amber)}
.frow[data-app="signal"]{--accent:var(--green)}
.frow[data-app="retro"]{--accent:var(--teal)}
.frow[data-app="poker"]{--accent:var(--ink)}
.ftext h3{font-size:26px;line-height:1.1;margin:8px 0 12px}
.ftext>p{color:var(--soft);font-size:15px}
.flist{list-style:none;margin-top:16px;display:flex;flex-direction:column;gap:9px}
.flist li{display:flex;gap:9px;font-size:14px;color:var(--soft)}
.flist li::before{content:"◇";color:var(--teal);flex:0 0 auto}
.shot{border:1px solid var(--line2);border-radius:12px;overflow:hidden;background:var(--panel);
  box-shadow:0 24px 60px -34px oklch(0.2 0.02 250 / 0.55)}
.shot .chrome{display:flex;align-items:center;gap:7px;padding:11px 14px;
  border-bottom:1px solid var(--line);background:var(--bone)}
.shot .chrome i{width:9px;height:9px;border-radius:50%;background:var(--line2)}
.shot .chrome .url{margin-left:10px;font-family:'IBM Plex Mono',monospace;font-size:10.5px;
  color:var(--faint);letter-spacing:.04em}
.shot img{display:block;width:100%;height:auto}
@media (max-width:820px){
  .frow{grid-template-columns:1fr;gap:24px}
  .frow:nth-child(even) .ftext{order:0}
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -- --test-name-pattern="SEO payload terms"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add views/landing.eta public/css/landing.css tests/landing.test.js public/img/shot-raid.png public/img/shot-signal.png public/img/shot-retro.png public/img/shot-poker.png
git commit -m "feat(landing): feature rows with framed screenshots"
```

---

## Task 8: FAQ + closing CTA

**Files:**
- Modify: `views/landing.eta`, `public/css/landing.css`
- Test: `tests/landing.test.js` (extend)

- [ ] **Step 1: Extend the test**

Append to `tests/landing.test.js`:

```js
test("FAQ uses 'free to try' framing and the closing CTA links to /login", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.match(res.text, /free to try/i);
  assert.doesNotMatch(res.text, /free forever/i);
  assert.match(res.text, /class="close"[\s\S]*href="\/login"/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="free to try"`
Expected: FAIL — FAQ/closing CTA absent.

- [ ] **Step 3: Add FAQ + closing-CTA markup**

In `views/landing.eta`, insert before `</main>` (after the `.features` section):

```eta
<section class="faq" id="faq">
  <h2 class="sec-h">Questions</h2>
  <div class="qa"><h4>Is it really free?</h4><p>Sprint Suite is free to try as a showcase. Some apps cap usage or AI calls, so it's not unlimited — but you can sign in and use all four tools without paying.</p></div>
  <div class="qa"><h4>Do I need a password?</h4><p>No. Sign-in is a passwordless magic link sent to your email. The same link both signs you up and signs you in.</p></div>
  <div class="qa"><h4>Do my guests need accounts?</h4><p>No. Retrospectives and planning poker rooms can be shared with a link, so guests join without creating an account.</p></div>
  <div class="qa"><h4>Where does my data go?</h4><p>Your data stays in Sprint Suite. There's no third-party tracking, and health-check submissions are anonymous.</p></div>
  <div class="qa"><h4>Can I export?</h4><p>Yes. RAID logs export to Jira, CSV and Markdown so your work doesn't get stuck in another tool.</p></div>
</section>

<section class="close">
  <h2>Four sharp tools, one passwordless login.</h2>
  <p>Sign in to get started — no setup, no sprawl.</p>
  <a class="btn btn-pri btn-lg" href="<%= it.signinUrl %>">Sign in to get started</a>
</section>
```

- [ ] **Step 4: Add the CSS**

Append to `public/css/landing.css`:

```css
.faq{border-top:1px solid var(--line);padding:54px 0}
.qa{padding:20px 0;border-top:1px solid var(--line)}
.qa:last-child{border-bottom:1px solid var(--line)}
.qa h4{font-family:'Hanken Grotesk',sans-serif;font-weight:600;font-size:16px}
.qa p{color:var(--soft);font-size:14.5px;max-width:70ch;margin-top:6px}
.close{text-align:center;background:var(--panel);border:1px solid var(--line2);
  border-radius:16px;padding:40px;margin:20px 0 60px}
.close h2{font-size:30px}
.close p{color:var(--soft);margin:10px 0 22px}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- --test-name-pattern="free to try"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add views/landing.eta public/css/landing.css tests/landing.test.js
git commit -m "feat(landing): FAQ and closing CTA"
```

---

## Task 9: Footer (4-column + bottom bar)

**Files:**
- Modify: `views/landing.eta` (insert after `</main>`, before `</body>`), `public/css/landing.css`
- Test: `tests/landing.test.js` (extend)

- [ ] **Step 1: Extend the test**

Append to `tests/landing.test.js`:

```js
test("footer Apps links point to /login and legal links resolve", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  const footer = res.text.slice(res.text.indexOf('class="lp-footer"'));
  const appLinks = (footer.match(/href="\/login"/g) || []);
  assert.ok(appLinks.length >= 4, "four Apps links to /login in footer");
  assert.match(footer, /href="\/privacy"/);
  assert.match(footer, /href="\/terms"/);
  assert.match(footer, /href="\/license"/);
  assert.match(footer, /href="#features"/);
  assert.match(footer, /href="#faq"/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="footer Apps links"`
Expected: FAIL — footer not present.

- [ ] **Step 3: Add the footer markup**

In `views/landing.eta`, insert after `</main>` and before `</body>`:

```eta
<footer class="lp-footer">
  <div class="lp-footer-in">
    <div class="lp-foot-lead">
      <a class="brand" href="/"><svg class="mk" width="20" height="20" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-suite"/></svg> <span>Sprint<span class="brand-suite">Suite</span></span></a>
      <p>Four focused agile tools for scrum masters and delivery leads, behind one passwordless login.</p>
    </div>
    <nav class="lp-foot-col">
      <h5>Apps</h5>
      <a href="<%= it.signinUrl %>">Sprintraid</a>
      <a href="<%= it.signinUrl %>">Sprintsignal</a>
      <a href="<%= it.signinUrl %>">Sprintretro</a>
      <a href="<%= it.signinUrl %>">Sprintpoker</a>
    </nav>
    <nav class="lp-foot-col">
      <h5>Product</h5>
      <a href="#features">Features</a>
      <a href="#faq">FAQ</a>
      <a href="<%= it.signinUrl %>">Sign in</a>
    </nav>
    <nav class="lp-foot-col">
      <h5>Legal</h5>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/license">License</a>
    </nav>
  </div>
  <div class="lp-foot-bar">
    <span>© 2026 Sprint Suite</span>
    <span class="mono">sprintsuite.uk</span>
  </div>
</footer>
```

- [ ] **Step 4: Add the footer CSS**

Append to `public/css/landing.css`:

```css
.lp-footer{border-top:1px solid var(--line2);background:var(--panel)}
.lp-footer-in{max-width:1120px;margin:0 auto;padding:48px 40px 36px;
  display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:40px}
.lp-foot-lead p{color:var(--faint);font-size:13px;margin-top:12px;max-width:34ch}
.lp-foot-col h5{font-family:'IBM Plex Mono',monospace;font-size:10.5px;font-weight:600;
  letter-spacing:0.14em;text-transform:uppercase;color:var(--faint);margin-bottom:12px}
.lp-foot-col a{display:block;color:var(--soft);font-size:14px;text-decoration:none;padding:4px 0}
.lp-foot-col a:hover{color:var(--green)}
.lp-foot-bar{max-width:1120px;margin:0 auto;padding:16px 40px;border-top:1px solid var(--line);
  display:flex;justify-content:space-between;color:var(--faint);font-size:13px}
.lp-foot-bar .mono{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0.08em}
@media (max-width:820px){
  .lp-footer-in{grid-template-columns:1fr 1fr;gap:28px}
  .lp-footer-in,.lp-foot-bar{padding-left:18px;padding-right:18px}
}
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — all landing, legal, and pre-existing hub tests (theme-drift included) green.

- [ ] **Step 6: Commit**

```bash
git add views/landing.eta public/css/landing.css tests/landing.test.js
git commit -m "feat(landing): footer with apps, product and legal columns"
```

---

## Task 10: Asset pipeline — WebP, favicon, OG (operator-assisted)

Converts the four screenshots to WebP @1×/@2×, wraps the feature `<img>`s in `<picture>` (WebP source + PNG fallback), and generates the favicon + OG image from the suite glyph. **Tooling is not installed** — Steps 1–2 are run by the operator (sudo); the agent performs the conversions and edits.

**Files:**
- Create: `public/img/shot-*.webp`, `public/img/shot-*@2x.webp`, `public/favicon.svg`, `public/og.svg` (source), `public/favicon-32.png`, `public/apple-touch-icon.png`, `public/img/og.png`
- Modify: `views/landing.eta` (wrap feature images in `<picture>`; head favicon/og links already added in Task 3)

- [ ] **Step 1: Install tooling (OPERATOR — sudo)**

Walk the operator through, one command at a time:

```bash
sudo apt-get install -y webp librsvg2-bin
```

Verify: `cwebp -version` and `rsvg-convert --version` both print a version.

- [ ] **Step 2: Convert screenshots to WebP @1× and @2×**

The source PNGs (Task 7) are the @2× assets; the @1× is half-width. From `hub/`:

```bash
cd public/img
for a in raid signal retro poker; do cwebp -q 82 shot-$a.png -o shot-$a@2x.webp; done
```

Then produce @1× (half the source pixel width) — run per app using the source widths (raid 1180, signal 1090, retro 1200, poker 738 → halve each):

```bash
cwebp -q 82 -resize 590 0 shot-raid.png -o shot-raid.webp
cwebp -q 82 -resize 545 0 shot-signal.png -o shot-signal.webp
cwebp -q 82 -resize 600 0 shot-retro.png -o shot-retro.webp
cwebp -q 82 -resize 369 0 shot-poker.png -o shot-poker.webp
```

Verify each `.webp` is < 120KB: `ls -l *.webp`. If any exceed it, lower quality (`-q 72`) and re-run that one. Return to `hub/`: `cd ../..` (you should be back in `hub/`).

- [ ] **Step 3: Wrap feature images in `<picture>`**

In `views/landing.eta`, replace each feature `<img …>` (4 of them) with a `<picture>` that serves WebP with the PNG as fallback. Example for raid (apply the analogous change to signal/retro/poker, keeping each file's existing `width`/`height`/`alt`):

```eta
<picture>
  <source type="image/webp" srcset="/img/shot-raid.webp 1x, /img/shot-raid@2x.webp 2x">
  <img src="/img/shot-raid.png" width="1180" height="865" loading="lazy" decoding="async"
    alt="Sprintraid RAID log with risks, assumptions, issues and a flagged dependency conflict">
</picture>
```

- [ ] **Step 4: Author the favicon SVG**

Create `public/favicon.svg` (suite glyph in `--green` = `oklch(0.45 0.077 162)`, on transparent ground):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
  <g fill="oklch(0.45 0.077 162)">
    <rect x="3" y="3" width="7.5" height="7.5" rx="2"/>
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" opacity="0.55"/>
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" opacity="0.55"/>
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>
  </g>
</svg>
```

- [ ] **Step 5: Author the OG source SVG**

Create `public/og.svg` (1200×630, `--bone` ground, wordmark + tagline + faint baseline). Colours inlined from tokens (rsvg-convert does not resolve CSS vars):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="oklch(0.964 0.004 240)"/>
  <path d="M0 470 H1200" stroke="oklch(0.58 0.088 206)" stroke-width="2" opacity="0.25"/>
  <g transform="translate(96,250)">
    <g fill="oklch(0.45 0.077 162)" transform="scale(2.4)">
      <rect x="0" y="0" width="7.5" height="7.5" rx="2"/>
      <rect x="10.5" y="0" width="7.5" height="7.5" rx="2" opacity="0.55"/>
      <rect x="0" y="10.5" width="7.5" height="7.5" rx="2" opacity="0.55"/>
      <rect x="10.5" y="10.5" width="7.5" height="7.5" rx="2"/>
    </g>
  </g>
  <text x="170" y="290" font-family="Bricolage Grotesque, sans-serif" font-weight="700" font-size="56" fill="oklch(0.235 0.013 250)">Sprint<tspan fill="oklch(0.45 0.077 162)">Suite</tspan></text>
  <text x="96" y="380" font-family="Bricolage Grotesque, sans-serif" font-weight="700" font-size="52" fill="oklch(0.235 0.013 250)">Agile tools for teams that ship.</text>
</svg>
```

- [ ] **Step 6: Rasterize favicon + OG PNGs**

From `hub/public/`:

```bash
rsvg-convert -w 32 -h 32 favicon.svg -o favicon-32.png
rsvg-convert -w 180 -h 180 favicon.svg -o apple-touch-icon.png
rsvg-convert -w 1200 -h 630 og.svg -o img/og.png
```

(If `og.png` text renders in a fallback font because Bricolage isn't installed system-wide, that's acceptable for a share image; note it for the QA pass. Return to `hub/`.)

- [ ] **Step 7: Run the suite + confirm no base64**

Run: `npm test`
Expected: PASS — including the Task 7 `doesNotMatch(/data:image\//)` assertion (still true: `<picture>`/`<img>` reference files, not base64).

- [ ] **Step 8: Commit**

```bash
git add views/landing.eta public/favicon.svg public/og.svg public/favicon-32.png public/apple-touch-icon.png public/img/og.png public/img/shot-raid.webp public/img/shot-raid@2x.webp public/img/shot-signal.webp public/img/shot-signal@2x.webp public/img/shot-retro.webp public/img/shot-retro@2x.webp public/img/shot-poker.webp public/img/shot-poker@2x.webp
git commit -m "feat(landing): WebP screenshots, favicon and OG image"
```

---

## Task 11: Final QA pass (manual, against the prototype)

No code unless a defect is found. Verifies the page matches `A2-final.html` and meets the build spec's accessibility + performance bar.

- [ ] **Step 1: Full automated suite is green**

Run: `npm test`
Expected: all tests pass, including `theme-drift.test.js` (proves the shared foundation was not edited).

- [ ] **Step 2: Serve the hub locally and open `/`**

Start the hub (per its usual dev command, e.g. `npm start` from `hub/`) and open `http://localhost:<port>/` in a browser. The agent may drive a headless browser if available; otherwise hand the URL to the operator.

- [ ] **Step 3: Visual + behavioural checklist (build spec §10 / §11)**

Confirm each, fixing the relevant task's markup/CSS if any fails (then re-commit):
- Hero trace animates and the drift loops seamlessly (no visible seam every 600px); headline is fully legible over the scrim.
- App cards, feature rows, FAQ, closing CTA and footer match `A2-final.html` layout at 1120px.
- Per-app accents correct: Raid amber, Signal green, Retro teal, Poker ink; CTA always green.
- Mobile at 390px: hero H1 34px, app grid single column, feature rows stack image-under-text, footer 2 columns.
- Keyboard: every link/button reachable in logical order with a visible green focus ring.
- `prefers-reduced-motion: reduce` (toggle in dev tools) stops the trace; page stays legible.
- Authenticated visit to `/` redirects to `/dashboard`; the four legal links resolve to stub pages.
- No layout shift as screenshots load (explicit `width`/`height` reserve space).

- [ ] **Step 4: Lighthouse**

Run Lighthouse (or equivalent) on `/`. Targets: SEO ≥ 95, Accessibility ≥ 95, no CLS from images. Record the scores in the finish-branch summary; address any a11y/SEO failure before merge.

- [ ] **Step 5: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to merge to `main` (local-merge model; push the feature branch to origin first as backup, per repo convention). Deployment to prod (`git pull` on the box + restart `suite-hub`) is a separate operator step, walked one command at a time.

---

## Self-Review

**Spec coverage:**
- Standalone template / SEO head / JSON-LD / OG → Task 3 ✓
- Authed → /dashboard (D1) → Task 1 ✓
- Hero band + scrim + prototype-opacity trace (foundation untouched) → Tasks 3–4 ✓
- Trust strip → Task 5 ✓; App cards all → /login (D5) → Task 6 ✓
- Feature rows + framed shots + SEO body terms + verbatim alt → Task 7 ✓
- FAQ "free to try" framing + closing CTA → Task 8 ✓
- Footer 4-col + legal links → Task 9 ✓; Legal stubs (D3) → Task 2 ✓
- WebP @1×/@2× pipeline (D2) + favicon + OG → Task 10 ✓
- A11y / contrast / reduced-motion / responsive / Lighthouse → Task 11 ✓
- DoD "no new colour tokens" → landing.css uses only `var(--…)` + the spec-sanctioned `oklch(0.996 0.002 240 / α)` scrim and the `oklch(...)` literals already present in instrument-core.css for tag washes; hover via `color-mix` on `var(--green)` ✓
- DoD "foundation untouched / drift green" → verified by Task 11 Step 1 ✓

**Placeholder scan:** none — every step has concrete code/commands. The only deliberately deferred content is the legal-page body copy (blocked on lawyer text; stub explicitly says "coming soon").

**Type/name consistency:** route render passes `{ signinUrl: "/login" }`; template reads `it.signinUrl` throughout (Tasks 3,6,8,9). `mountLegal` exported (Task 2) and imported in `server.js` + `legal.test.js`. `landing-hero.js` imports `scopePath, W, BASELINE` — all three are real named exports of `oscilloscope.js` (verified). CSS class names (`lp-band`, `lp-hero`, `appcard`, `frow`, `shot`, `lp-footer`) are used consistently across markup and CSS.
