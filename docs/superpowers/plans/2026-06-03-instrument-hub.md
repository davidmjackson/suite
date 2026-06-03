# Instrument Hub + Auth Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin every browser-rendered hub view to the Instrument `.ins` design system — oscilloscope band on landing+dashboard, auth split card, tables/pills/buttons everywhere else — with no route or logic changes.

**Architecture:** The hub consumes the already-merged `suite/shared/theme/` foundation via `sync-theme.mjs`. Two CSS layers: the synced, drift-checked `instrument-core.css` (source of truth, gains a `.table` + form-control primitives in this plan) plus a small hub-owned `hub.css` for the app-launcher grid and operator sub-nav. Views are Eta templates; only markup/classes change.

**Tech Stack:** Node ≥20 (ESM), Express 5, Eta 3, better-sqlite3, `node:test` + supertest. Dependency-free foundation tooling under `shared/theme/`.

**Conventions (from project memory):** Explicit git staging only — never `git add -A`/`.` in `/var/www/suite`; `git status` before each commit. Branch `feat/instrument-hub`, push to origin as backup, merge to `main` locally; prod pulls `main`. Co-author trailer on commits: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Paths:** suite root `/var/www/suite`; foundation `/var/www/suite/shared/theme`; hub `/var/www/suite/hub`. Run hub tests from `hub/` with `npm test` (`node --test tests/`). Run foundation tests from `shared/theme/` with `node --test tests/`.

---

## Task 0: Branch setup

**Files:** none (git only)

- [ ] **Step 1: Create the feature branch**

```bash
cd /var/www/suite
git switch -c feat/instrument-hub
git status
```
Expected: `On branch feat/instrument-hub`, working tree clean.

- [ ] **Step 2: Push as off-machine backup**

```bash
git push -u origin feat/instrument-hub
```
Expected: branch created on origin.

---

## Task 1: Foundation — add `.table` + form-control primitives

**Files:**
- Modify: `shared/theme/instrument-core.css` (append after the last rule, line 74)
- Modify: `shared/theme/preview.html` (add a demo section)
- Test: `shared/theme/tests/instrument-core-css.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `shared/theme/tests/instrument-core-css.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../instrument-core.css"), "utf8");

test("defines a table component", () => {
  assert.match(css, /\.ins table\.table\b/);
  assert.match(css, /\.ins \.table-wrap\b/);
});

test("styles select, textarea and checkbox-list form controls", () => {
  assert.match(css, /\.ins select\.input\b/);
  assert.match(css, /\.ins textarea\.input\b/);
  assert.match(css, /\.ins \.checks\b/);
  assert.match(css, /\.ins \.check\b/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/shared/theme && node --test tests/instrument-core-css.test.mjs`
Expected: FAIL — 2 failing assertions (selectors not yet present).

- [ ] **Step 3: Append the new CSS to `instrument-core.css`**

Add at the end of the file (after line 74):

```css
  /* tables */
  .ins .table-wrap{overflow-x:auto;}
  .ins table.table{width:100%; border-collapse:collapse; font-size:14px;}
  .ins .table th,.ins .table td{text-align:left; padding:11px 14px; border-bottom:1px solid var(--line); vertical-align:middle;}
  .ins .table th{font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:var(--faint); font-weight:600; background:var(--bone); border-bottom:1px solid var(--line2);}
  .ins .table tbody tr:last-child td{border-bottom:none;}
  /* form controls (extend .input to select/textarea; checkbox list) */
  .ins select.input{appearance:none; -webkit-appearance:none; cursor:pointer; padding-right:34px; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2 4l4 4 4-4' fill='none' stroke='%2364748b' stroke-width='1.6'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 12px center;}
  .ins textarea.input{min-height:84px; resize:vertical; line-height:1.5;}
  .ins .checks{display:flex; flex-direction:column; gap:9px;}
  .ins .check{display:flex; align-items:center; gap:9px; font-size:14px; color:var(--ink); cursor:pointer;}
  .ins .check input{width:16px; height:16px; accent-color:var(--green);}
```

- [ ] **Step 4: Add a demo section to `preview.html`**

Read `preview.html` and insert this `<section>` as a new block inside the `.ins` page body (e.g. immediately before the closing of the main content / footer):

```html
    <section class="card">
      <h2>Tables & form controls</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Company</th><th>Status</th><th>Members</th><th></th></tr></thead>
        <tbody>
          <tr><td>Acme</td><td><span class="pill pill-ok">active</span></td><td>12</td><td><div class="tbacts"><button class="btn btn-ghost btn-sm">Edit</button><button class="btn btn-danger btn-sm">Remove</button></div></td></tr>
          <tr><td>Globex</td><td><span class="pill pill-closed">disabled</span></td><td>3</td><td><div class="tbacts"><button class="btn btn-ghost btn-sm">Edit</button></div></td></tr>
        </tbody>
      </table></div>
      <div style="display:flex;flex-direction:column;gap:14px;max-width:420px;margin-top:18px;">
        <div class="field"><label class="label">Team size</label>
          <select class="input"><option>Select…</option><option>1–10</option><option>11–50</option></select></div>
        <div class="field"><label class="label">Apps</label>
          <div class="checks">
            <label class="check"><input type="checkbox" checked> Sprintpoker</label>
            <label class="check"><input type="checkbox"> Sprintretro</label>
          </div></div>
        <div class="field"><label class="label">Notes</label><textarea class="input" rows="3"></textarea></div>
      </div>
    </section>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /var/www/suite/shared/theme && node --test tests/`
Expected: PASS — all foundation tests green (was 9, now 11).

- [ ] **Step 6: Visual check of preview**

Run: `cd /var/www/suite/shared/theme && python3 -m http.server 8799` then open `http://127.0.0.1:8799/preview.html`. Confirm the table (header row, pills, action buttons), the styled select (with caret), checkboxes, and textarea render in the Instrument style. Ctrl-C the server when done.

- [ ] **Step 7: Commit**

```bash
cd /var/www/suite
git add shared/theme/instrument-core.css shared/theme/preview.html shared/theme/tests/instrument-core-css.test.mjs
git status
git commit -m "feat(theme): add .table + select/textarea/checkbox form controls

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Sync the foundation into the hub + drift guard

**Files:**
- Create (via sync): `hub/public/css/instrument-core.css`, `hub/public/js/oscilloscope.js`, `hub/public/illos/glyphs.svg`, `hub/public/fonts/*.woff2`
- Test: `hub/tests/theme-drift.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `hub/tests/theme-drift.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { driftReport } from "../../shared/theme/check-theme-drift.mjs";

const hubRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("hub's synced Instrument assets match the foundation source", () => {
  const r = driftReport(hubRoot);
  assert.deepEqual(r.missing, [], "no missing synced assets");
  assert.deepEqual(r.mismatched, [], "no drifted synced assets");
  assert.equal(r.ok, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/theme-drift.test.js`
Expected: FAIL — `missing` lists `css/instrument-core.css`, `js/oscilloscope.js`, `illos/glyphs.svg`, and the `fonts/*.woff2` (not synced yet).

- [ ] **Step 3: Run the sync**

```bash
node /var/www/suite/shared/theme/sync-theme.mjs /var/www/suite/hub
```
Expected: `synced N assets -> /var/www/suite/hub` (N = 3 static + 8 fonts = 11).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/theme-drift.test.js`
Expected: PASS.

- [ ] **Step 5: Commit the synced assets + test**

```bash
cd /var/www/suite
git add hub/public/css hub/public/js hub/public/illos hub/public/fonts hub/tests/theme-drift.test.js
git status
git commit -m "feat(hub): sync Instrument foundation assets + drift guard test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Shared chrome — partials, hub.css, delete old styles

**Files:**
- Modify: `hub/views/partials/header.eta` (full rewrite)
- Modify: `hub/views/partials/footer.eta` (full rewrite)
- Create: `hub/views/partials/admin-nav.eta`
- Create: `hub/public/hub.css`
- Delete: `hub/public/styles.css`
- Test: `hub/tests/instrument-chrome.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `hub/tests/instrument-chrome.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";

test("pages render with the Instrument chrome", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
  assert.match(res.text, /<body class="ins"/);
  assert.match(res.text, /\/css\/instrument-core\.css/);
  assert.match(res.text, /\/hub\.css/);
  assert.match(res.text, /src="\/js\/oscilloscope\.js"/);
  assert.doesNotMatch(res.text, /\/styles\.css/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/instrument-chrome.test.js`
Expected: FAIL — body lacks `class="ins"`, still links `/styles.css`.

- [ ] **Step 3: Rewrite `hub/views/partials/header.eta`**

```html
<!-- views/partials/header.eta -->
<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title><%= it.title || "Sprint Suite" %></title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/css/instrument-core.css">
<link rel="stylesheet" href="/hub.css">
<script type="module" src="/js/oscilloscope.js"></script>
</head>
<body class="ins">
<% if (!it.bare) { %>
<header class="topbar">
  <a href="/" class="brand"><svg class="mk" width="22" height="22" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-suite"/></svg> Sprint Suite</a>
  <nav class="tbacts">
  <% if (it.user) { %>
    <span class="micro"><%= it.user.email %></span> <a class="btn btn-ghost btn-sm" href="/logout">Sign out</a>
  <% } else { %>
    <a class="btn btn-ghost btn-sm" href="/login">Sign in</a>
  <% } %>
  </nav>
</header>
<% if (it.band) { %>
<div class="band"><div class="waves"></div><div class="band-in">
  <% if (it.band.eyebrow) { %><div class="eyebrow"><%= it.band.eyebrow %></div><% } %>
  <h1><%= it.band.title %></h1>
  <% if (it.band.sub) { %><p class="sub"><%= it.band.sub %></p><% } %>
</div></div>
<% } %>
<main class="page">
<% } else { %>
<main class="authwrap">
<% } %>
```

- [ ] **Step 4: Rewrite `hub/views/partials/footer.eta`**

```html
<!-- views/partials/footer.eta -->
</main>
<footer class="footer">Sprint Suite</footer>
</body></html>
```

- [ ] **Step 5: Create `hub/views/partials/admin-nav.eta`**

```html
<!-- views/partials/admin-nav.eta -->
<nav class="subnav">
<a class="lnk" href="/dashboard">← Dashboard</a>
<a class="lnk" href="/admin">Users</a>
<a class="lnk" href="/admin/sessions">Active sessions</a>
<a class="lnk" href="/admin/audit">Audit log</a>
<a class="lnk" href="/admin/companies">Companies &amp; requests</a>
</nav>
```

- [ ] **Step 6: Create `hub/public/hub.css`**

```css
/* hub.css — hub-specific composition layered over instrument-core.css */
.ins .applist{display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:16px;}
.ins .apptile{display:flex; flex-direction:column; gap:8px; text-decoration:none; color:var(--ink); transition:border-color .15s;}
.ins .apptile:hover{border-color:var(--green);}
.ins .apptile h3{display:flex; align-items:center; gap:10px; font-size:18px;}
.ins .apptile .glyph{color:var(--green); flex-shrink:0;}
.ins .apptile p{color:var(--soft); font-size:14px;}
.ins .apptile.is-locked{opacity:0.62;}
.ins .apptile.is-locked:hover{border-color:var(--line2);}
.ins button.apptile{width:100%; text-align:left; cursor:pointer; font-family:inherit;}
.ins form.tileform{margin:0;}
.ins .subnav{display:flex; flex-wrap:wrap; gap:16px; align-items:center; font-size:14px;}
.ins ul.plain{list-style:none; display:flex; flex-direction:column; gap:8px;}
.ins ul.plain li{display:flex; align-items:center; gap:10px;}
.ins .authwrap{min-height:78vh;}
```

- [ ] **Step 7: Delete the old stylesheet**

```bash
git rm /var/www/suite/hub/public/styles.css
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/instrument-chrome.test.js`
Expected: PASS.

- [ ] **Step 9: Run the full hub suite (nothing regressed)**

Run: `cd /var/www/suite/hub && npm test`
Expected: all tests pass. (Existing tests assert page text that is unchanged; views not yet rewritten still render inside the new chrome.)

- [ ] **Step 10: Commit**

```bash
cd /var/www/suite
git add hub/views/partials/header.eta hub/views/partials/footer.eta hub/views/partials/admin-nav.eta hub/public/hub.css hub/tests/instrument-chrome.test.js
git status
git commit -m "feat(hub): Instrument chrome — topbar/band partials, hub.css, drop styles.css

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Landing page

**Files:**
- Modify: `hub/views/landing.eta` (full rewrite)
- Test: `hub/tests/landing.test.js` (extend)

- [ ] **Step 1: Add failing assertions to `hub/tests/landing.test.js`**

Append to the existing test (after the `Sign in` assertion), or add a second test:

```js
test("landing uses the band and app glyphs", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
  assert.match(res.text, /class="band"/);
  assert.match(res.text, /glyph-raid/);
  assert.match(res.text, /class="card apptile"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/landing.test.js`
Expected: FAIL — no `class="band"` / `glyph-raid` yet.

- [ ] **Step 3: Rewrite `hub/views/landing.eta`**

```html
<%~ include("partials/header", { title: "Sprint Suite", user: it.user, band: { eyebrow: "Sprint Suite", title: "Agile tools for teams that ship.", sub: "One sign-in, four focused apps." } }) %>
<% if (!it.user) { %><p><a class="btn btn-pri" href="/login">Sign in</a></p><% } %>
<section class="applist">
<a class="card apptile" href="https://sprintraid.uk"><h3><svg class="glyph" width="26" height="26" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-raid"/></svg> Sprintraid</h3><p>Risks, Assumptions, Issues, Dependencies — pipe in email/Teams text, get a structured RAID log.</p></a>
<a class="card apptile" href="https://sprintsignal.uk"><h3><svg class="glyph" width="26" height="26" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-signal"/></svg> Sprintsignal</h3><p>Team health signals — surface what's working and what isn't.</p></a>
<a class="card apptile" href="https://sprintretro.uk"><h3><svg class="glyph" width="26" height="26" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-retro"/></svg> Sprintretro</h3><p>Retrospectives that don't drag.</p></a>
<a class="card apptile" href="https://sprintpoker.uk"><h3><svg class="glyph" width="26" height="26" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-poker"/></svg> Sprintpoker</h3><p>Planning poker with your Jira tickets.</p></a>
</section>
<%~ include("partials/footer") %>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/landing.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite
git add hub/views/landing.eta hub/tests/landing.test.js
git status
git commit -m "feat(hub): Instrument landing — band + glyph app tiles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Dashboard

**Files:**
- Modify: `hub/views/dashboard.eta` (full rewrite)
- Test: `hub/tests/dashboard.test.js` (extend)

Note: `it.apps[]` items have `key`, `name`, `desc`, `entitled` (the launch form posts to `/launch/<key>`). Glyph id = `glyph-<key>` (keys: raid/signal/retro/poker).

- [ ] **Step 1: Add a failing assertion to `hub/tests/dashboard.test.js`**

Add a test (reuse the `buildWithDashboard` helper + logged-in session pattern already in the file):

```js
test("dashboard leads with the band and renders glyph tiles", async () => {
  const { app, db } = await buildWithDashboard();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const res = await request(app).get("/dashboard").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /class="band"/);
  assert.match(res.text, /class="applist"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/dashboard.test.js`
Expected: FAIL — no `class="band"`.

- [ ] **Step 3: Rewrite `hub/views/dashboard.eta`**

```html
<%~ include("partials/header", { title: "Dashboard", user: it.user, band: { eyebrow: "Dashboard", title: "Your apps" } }) %>
<section class="applist">
<% it.apps.forEach(function (a) { %>
  <% if (a.entitled) { %>
  <form class="tileform" method="POST" action="/launch/<%= a.key %>"><button class="card apptile" type="submit"><h3><svg class="glyph" width="26" height="26" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-<%= a.key %>"/></svg> <%= a.name %></h3><p><%= a.desc %></p></button></form>
  <% } else { %>
  <div class="card apptile is-locked"><h3><svg class="glyph" width="26" height="26" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-<%= a.key %>"/></svg> <%= a.name %></h3><p><%= a.desc %></p><p><span class="pill pill-closed">Request access</span></p></div>
  <% } %>
<% }); %>
</section>
<% if (it.manageable && it.manageable.length) { %>
<section class="card">
<h2>Manage</h2>
<ul class="plain">
<% it.manageable.forEach(function (c) { %>
<li><a class="lnk" href="/company/<%= c.slug %>"><%= c.name %></a> <span class="micro"><%= c.role %></span></li>
<% }); %>
</ul>
</section>
<% } %>
<% if (it.user.isAdmin) { %><p><a class="lnk" href="/admin">Admin console →</a></p><% } %>
<%~ include("partials/footer") %>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/dashboard.test.js`
Expected: PASS (existing four-tile and Manage-link tests still pass).

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite
git add hub/views/dashboard.eta hub/tests/dashboard.test.js
git status
git commit -m "feat(hub): Instrument dashboard — band + entitlement-aware glyph tiles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Auth pages (login, check-email, confirm)

**Files:**
- Modify: `hub/views/login.eta`, `hub/views/check-email.eta`, `hub/views/confirm.eta` (full rewrites)
- Test: `hub/tests/login.test.js` (extend)

All three use `bare: true` (no topbar/band) and render the `.authcard` split. The oscilloscope auto-mounts into `.authleft .waves`.

- [ ] **Step 1: Add a failing assertion to `hub/tests/login.test.js`**

```js
test("login renders the Instrument auth card", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/login");
  assert.equal(res.status, 200);
  assert.match(res.text, /class="authcard"/);
  assert.match(res.text, /class="authleft"/);
  assert.match(res.text, /name="email"/);
});
```
(If `login.test.js` doesn't already mount login, mirror the file's existing setup — e.g. `const { mountLogin } = await import("../routes/login.js?t=" + Date.now()); mountLogin(app, { emailSender: { async sendMagicLink(){} } });` Check the file's existing pattern and reuse it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/login.test.js`
Expected: FAIL — no `authcard`.

- [ ] **Step 3: Rewrite `hub/views/login.eta`**

```html
<%~ include("partials/header", { title: "Sign in", bare: true }) %>
<div class="authcard">
  <div class="authleft">
    <div class="waves"></div>
    <div class="brand" style="color:#fff"><svg class="mk" width="22" height="22" aria-hidden="true" style="color:#fff"><use href="/illos/glyphs.svg#glyph-suite"/></svg> Sprint Suite</div>
    <div><div class="eyebrow" style="color:rgba(255,255,255,.85)">Sign in</div><p style="font-size:20px;font-family:'Bricolage Grotesque',sans-serif;margin-top:6px;">One sign-in, four focused apps.</p></div>
  </div>
  <div class="authright">
    <h1 style="font-size:26px;">Sign in to Sprint Suite</h1>
    <form method="POST" action="/login">
      <% if (it.returnTo) { %><input type="hidden" name="return_to" value="<%= it.returnTo %>"><% } %>
      <div class="field"><label class="label" for="email">Email address</label><input class="input" id="email" name="email" type="email" required autofocus></div>
      <p style="margin-top:16px;"><button class="btn btn-pri" type="submit">Send magic link</button></p>
      <p class="helper">We'll email you a link. No password needed.</p>
    </form>
  </div>
</div>
<%~ include("partials/footer") %>
```

- [ ] **Step 4: Rewrite `hub/views/check-email.eta`**

```html
<%~ include("partials/header", { title: "Check your email", bare: true }) %>
<div class="authcard">
  <div class="authleft"><div class="waves"></div><div class="brand" style="color:#fff"><svg class="mk" width="22" height="22" style="color:#fff" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-suite"/></svg> Sprint Suite</div><div><p style="font-size:20px;font-family:'Bricolage Grotesque',sans-serif;">Almost there.</p></div></div>
  <div class="authright">
    <h1 style="font-size:24px;">Check your email</h1>
    <div class="notice">A sign-in link is on its way to <strong><%= it.email %></strong>. It expires in 15 minutes.</div>
    <p><a class="lnk" href="/login">Use a different email</a></p>
  </div>
</div>
<%~ include("partials/footer") %>
```

- [ ] **Step 5: Rewrite `hub/views/confirm.eta`**

```html
<%~ include("partials/header", { title: "Confirm sign in", bare: true }) %>
<div class="authcard">
  <div class="authleft"><div class="waves"></div><div class="brand" style="color:#fff"><svg class="mk" width="22" height="22" style="color:#fff" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-suite"/></svg> Sprint Suite</div><div><p style="font-size:20px;font-family:'Bricolage Grotesque',sans-serif;">Welcome back.</p></div></div>
  <div class="authright">
    <h1 style="font-size:24px;">Confirm sign in</h1>
    <p class="helper">Click below to finish signing in to Sprint Suite.</p>
    <form method="POST" action="/auth/magic"><input type="hidden" name="token" value="<%= it.token %>"><p style="margin-top:8px;"><button class="btn btn-pri" type="submit">Sign in</button></p></form>
  </div>
</div>
<%~ include("partials/footer") %>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /var/www/suite/hub && node --test tests/login.test.js tests/magic.test.js`
Expected: PASS. (`magic.test.js` exercises confirm/`/auth/magic`; the form action, hidden `token`, and "Confirm sign in" / "Sign in" text are preserved, so its assertions still hold. If it asserts removed markup, update those assertions to the new text.)

- [ ] **Step 7: Commit**

```bash
cd /var/www/suite
git add hub/views/login.eta hub/views/check-email.eta hub/views/confirm.eta hub/tests/login.test.js
git status
git commit -m "feat(hub): Instrument auth pages — split authcard with waves panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Request / request-received / error

**Files:**
- Modify: `hub/views/request.eta`, `hub/views/request-received.eta`, `hub/views/error.eta` (full rewrites)
- Test: `hub/tests/request.test.js` (extend)

Preserve exactly: form `action="/request"`, all `name` attributes, `it.values.*` repopulation, the honeypot `<input name="website">` in the off-screen div, and the `it.error` branch.

- [ ] **Step 1: Add a failing assertion to `hub/tests/request.test.js`**

```js
test("request form uses Instrument fields, select, checks and textarea", async () => {
  const { app } = await buildTestApp();
  const { mountRequest } = await import("../routes/request.js?t=" + Date.now());
  mountRequest(app, { emailSender: { async sendAccessApproved(){} } });
  const res = await request(app).get("/request");
  assert.equal(res.status, 200);
  assert.match(res.text, /class="field"/);
  assert.match(res.text, /class="checks"/);
  assert.match(res.text, /<select class="input" name="team_size"/);
  assert.match(res.text, /<textarea class="input" name="message"/);
  assert.match(res.text, /name="website"/); // honeypot preserved
});
```
(If `request.test.js` already builds the app with the request route, reuse that setup instead of re-mounting.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/request.test.js`
Expected: FAIL — no `class="field"` / `class="checks"`.

- [ ] **Step 3: Rewrite `hub/views/request.eta`**

```html
<%~ include("partials/header", { title: "Request free access", user: null }) %>
<section class="card" style="max-width:560px;margin:0 auto;">
<h1 style="font-size:28px;">Request free access</h1>
<p class="lede">Tell us about your team and we'll set you up.</p>
<% if (it.error) { %><div class="notice" style="border-color:color-mix(in oklab, oklch(0.5 0.13 25) 45%, var(--line2));"><%= it.error %></div><% } %>
<form method="POST" action="/request" style="display:flex;flex-direction:column;gap:14px;margin-top:10px;">
  <div class="field"><label class="label">Company / group</label><input class="input" type="text" name="company_name" required value="<%= it.values.company_name || '' %>"></div>
  <div class="field"><label class="label">Your name</label><input class="input" type="text" name="contact_name" required value="<%= it.values.contact_name || '' %>"></div>
  <div class="field"><label class="label">Work email</label><input class="input" type="email" name="email" required value="<%= it.values.email || '' %>"></div>
  <div class="field"><label class="label">Job title <span class="helper">(optional)</span></label><input class="input" type="text" name="job_title" value="<%= it.values.job_title || '' %>"></div>
  <div class="field"><label class="label">Team size <span class="helper">(optional)</span></label>
    <select class="input" name="team_size">
      <option value="">Select…</option>
      <option value="1-10" <%= it.values.team_size === '1-10' ? 'selected' : '' %>>1–10</option>
      <option value="11-50" <%= it.values.team_size === '11-50' ? 'selected' : '' %>>11–50</option>
      <option value="51-200" <%= it.values.team_size === '51-200' ? 'selected' : '' %>>51–200</option>
      <option value="200+" <%= it.values.team_size === '200+' ? 'selected' : '' %>>200+</option>
    </select>
  </div>
  <div class="field"><label class="label">Apps you're interested in</label>
    <div class="checks">
      <label class="check"><input type="checkbox" name="apps" value="poker" <%= (it.values.apps || []).includes('poker') ? 'checked' : '' %>> Sprintpoker</label>
      <label class="check"><input type="checkbox" name="apps" value="retro" <%= (it.values.apps || []).includes('retro') ? 'checked' : '' %>> Sprintretro</label>
      <label class="check"><input type="checkbox" name="apps" value="signal" <%= (it.values.apps || []).includes('signal') ? 'checked' : '' %>> Sprintsignal</label>
      <label class="check"><input type="checkbox" name="apps" value="raid" <%= (it.values.apps || []).includes('raid') ? 'checked' : '' %>> Sprintraid</label>
    </div>
  </div>
  <div class="field"><label class="label">Anything else? <span class="helper">(optional)</span></label><textarea class="input" name="message" rows="3"><%= it.values.message || '' %></textarea></div>
  <div style="position:absolute;left:-9999px;" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>
  <p><button class="btn btn-pri" type="submit">Request access</button></p>
</form>
</section>
<%~ include("partials/footer") %>
```

- [ ] **Step 4: Rewrite `hub/views/request-received.eta`**

```html
<%~ include("partials/header", { title: "Request received", user: null }) %>
<section class="card" style="max-width:520px;margin:0 auto;text-align:center;">
<h1 style="font-size:26px;">Thanks — request received</h1>
<div class="notice" style="justify-content:center;">We'll review your request and email you a sign-in link once you're approved.</div>
<p style="margin-top:18px;"><a class="btn btn-pri" href="/">Back to home</a></p>
</section>
<%~ include("partials/footer") %>
```

- [ ] **Step 5: Rewrite `hub/views/error.eta`**

```html
<%~ include("partials/header", { title: it.title || "Error" }) %>
<section class="card" style="max-width:520px;margin:0 auto;">
<h1 style="font-size:26px;"><%= it.title || "Something went wrong" %></h1>
<p class="lede"><%= it.message %></p>
<% if (it.backHref) { %><p><a class="lnk" href="<%= it.backHref %>">Back</a></p><% } %>
</section>
<%~ include("partials/footer") %>
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/request.test.js`
Expected: PASS (existing POST/validation/honeypot/rate-limit tests still pass — only markup changed).

- [ ] **Step 7: Commit**

```bash
cd /var/www/suite
git add hub/views/request.eta hub/views/request-received.eta hub/views/error.eta hub/tests/request.test.js
git status
git commit -m "feat(hub): Instrument request/received/error pages

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Admin pages (companies, users, sessions, audit)

**Files:**
- Modify: `hub/views/admin/companies.eta`, `hub/views/admin/users.eta`, `hub/views/admin/sessions.eta`, `hub/views/admin/audit.eta` (full rewrites — replace inline nav with the `admin-nav` partial, wrap tables in `.table-wrap`/`.table`, statuses→pills, actions→`btn-sm` in `.tbacts`)
- Test: `hub/tests/admin-companies.test.js` (extend)

- [ ] **Step 1: Add a failing assertion to `hub/tests/admin-companies.test.js`**

Add to the existing "admin sees companies and pending requests" test (which already sets up an admin session + an "IBM" request):

```js
  assert.match(res.text, /class="table"/);
  assert.match(res.text, /class="subnav"/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/admin-companies.test.js`
Expected: FAIL — no `class="table"`.

- [ ] **Step 3: Rewrite `hub/views/admin/companies.eta`**

```html
<%~ include("../partials/header", { title: "Admin · Companies", user: it.user }) %>
<%~ include("../partials/admin-nav") %>
<div class="card">
<h2>Pending requests (<%= it.requests.length %>)</h2>
<% if (it.requests.length === 0) { %><p class="lede">No pending requests.</p><% } else { %>
<div class="table-wrap"><table class="table">
<thead><tr><th>Company</th><th>Contact</th><th>Email</th><th>Apps</th><th></th></tr></thead>
<tbody>
<% for (const r of it.requests) { %>
<tr>
<td><%= r.company_name %><% if (r.existingCompany) { %> <span class="pill pill-flag" title="A company with this name already exists">existing</span><% } %></td>
<td><%= r.contact_name %></td>
<td><%= r.email %><% if (r.dupeEmail) { %> <span class="pill pill-flag" title="Another pending request uses this email">dup</span><% } %></td>
<td><%= r.appsLabel || "—" %></td>
<td><div class="tbacts">
<form method="POST" action="/admin/requests/<%= r.id %>/approve"><button class="btn btn-pri btn-sm" type="submit">Approve</button></form>
<form method="POST" action="/admin/requests/<%= r.id %>/reject" onsubmit="return confirm('Reject this request?')"><button class="btn btn-danger btn-sm" type="submit">Reject</button></form>
</div></td>
</tr>
<% } %>
</tbody></table></div>
<% } %>
</div>
<div class="card">
<h2>Companies (<%= it.companies.length %>)</h2>
<div class="table-wrap"><table class="table">
<thead><tr><th>Name</th><th>Slug</th><th>Status</th><th>Members</th><th>Apps</th></tr></thead>
<tbody>
<% for (const c of it.companies) { %>
<tr>
<td><a class="lnk" href="/company/<%= c.slug %>"><%= c.name %></a></td>
<td class="mono"><%= c.slug %></td>
<td><span class="pill <%= c.status === 'active' ? 'pill-ok' : 'pill-closed' %>"><%= c.status %></span></td>
<td><%= c.memberCount %></td>
<td><%= (it.appsByCompany[c.id] || []).join(", ") || "—" %></td>
</tr>
<% } %>
</tbody></table></div>
</div>
<%~ include("../partials/footer") %>
```

- [ ] **Step 4: Rewrite `hub/views/admin/users.eta`**

```html
<%~ include("../partials/header", { title: "Admin · Users", user: it.user }) %>
<%~ include("../partials/admin-nav") %>
<div class="card">
<h2>Add user</h2>
<form method="POST" action="/admin/users" style="display:flex;flex-direction:column;gap:12px;max-width:420px;">
<div class="field"><label class="label">Email</label><input class="input" type="email" name="email" placeholder="email@example.com" required></div>
<div class="field"><label class="label">Display name <span class="helper">(optional)</span></label><input class="input" type="text" name="display_name"></div>
<label class="check"><input type="checkbox" name="is_admin" value="1"> Admin</label>
<p><button class="btn btn-pri" type="submit">Add user</button></p>
</form>
</div>
<div class="card">
<h2>Users (<%= it.users.length %>)</h2>
<div class="table-wrap"><table class="table">
<thead><tr><th>Email</th><th>Name</th><th>Admin</th><th>Sessions</th><th>Status</th><th></th></tr></thead>
<tbody>
<% for (const u of it.users) { %>
<tr>
<td><%= u.email %></td>
<td><%= u.display_name || "—" %></td>
<td><%= u.is_admin ? "✓" : "" %></td>
<td><%= u.session_count %></td>
<td><span class="pill <%= u.disabled_at ? 'pill-closed' : 'pill-ok' %>"><%= u.disabled_at ? "disabled" : "active" %></span></td>
<td><div class="tbacts">
<% if (!u.disabled_at) { %>
<form method="POST" action="/admin/users/<%= u.id %>/disable"><button class="btn btn-ghost btn-sm">Disable</button></form>
<% } else { %>
<form method="POST" action="/admin/users/<%= u.id %>/enable"><button class="btn btn-ghost btn-sm">Enable</button></form>
<% } %>
<form method="POST" action="/admin/users/<%= u.id %>/delete" onsubmit="return confirm('Delete <%= u.email %>?')"><button class="btn btn-danger btn-sm">Delete</button></form>
</div></td>
</tr>
<% } %>
</tbody></table></div>
</div>
<%~ include("../partials/footer") %>
```

- [ ] **Step 5: Rewrite `hub/views/admin/sessions.eta`**

```html
<%~ include("../partials/header", { title: "Admin · Sessions", user: it.user }) %>
<%~ include("../partials/admin-nav") %>
<div class="card">
<h2>Active sessions (<%= it.sessions.length %>)</h2>
<div class="table-wrap"><table class="table">
<thead><tr><th>User</th><th>Created</th><th>Last heartbeat</th><th>IP</th><th></th></tr></thead>
<tbody>
<% for (const s of it.sessions) { %>
<tr>
<td><%= s.email %></td>
<td class="mono"><%= new Date(s.created_at).toISOString().slice(0,19).replace("T"," ") %></td>
<td class="mono"><%= new Date(s.last_heartbeat_at).toISOString().slice(0,19).replace("T"," ") %></td>
<td><%= s.ip || "—" %></td>
<td><form method="POST" action="/admin/sessions/<%= s.id %>/kill"><button class="btn btn-danger btn-sm">Kill</button></form></td>
</tr>
<% } %>
</tbody></table></div>
</div>
<%~ include("../partials/footer") %>
```

- [ ] **Step 6: Rewrite `hub/views/admin/audit.eta`**

```html
<%~ include("../partials/header", { title: "Admin · Audit", user: it.user }) %>
<%~ include("../partials/admin-nav") %>
<div class="card">
<h2>Recent audit events</h2>
<div class="table-wrap"><table class="table">
<thead><tr><th>When</th><th>Event</th><th>User</th><th>App</th><th>IP</th></tr></thead>
<tbody>
<% for (const e of it.events) { %>
<tr>
<td class="mono"><%= new Date(e.created_at).toISOString().slice(0,19).replace("T"," ") %></td>
<td><%= e.event_type %></td>
<td><%= e.email || e.user_id || "—" %></td>
<td><%= e.app || "—" %></td>
<td><%= e.ip || "—" %></td>
</tr>
<% } %>
</tbody></table></div>
</div>
<%~ include("../partials/footer") %>
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd /var/www/suite/hub && node --test tests/admin-companies.test.js tests/admin-users.test.js tests/admin-sessions.test.js tests/audit.test.js`
Expected: PASS (all existing admin assertions are on text/values that are preserved).

- [ ] **Step 8: Commit**

```bash
cd /var/www/suite
git add hub/views/admin/companies.eta hub/views/admin/users.eta hub/views/admin/sessions.eta hub/views/admin/audit.eta hub/tests/admin-companies.test.js
git status
git commit -m "feat(hub): Instrument admin pages — table component, pills, sub-nav partial

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Company console + team pages

**Files:**
- Modify: `hub/views/company/console.eta`, `hub/views/company/team.eta` (full rewrites — preserve ALL role/entitlement Eta logic, just reskin)
- Test: `hub/tests/company.test.js` (extend)

- [ ] **Step 1: Add a failing assertion to `hub/tests/company.test.js`**

Find the existing test that GETs `/company/<slug>` as an owner/admin and add:

```js
  assert.match(res.text, /class="table"/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/company.test.js`
Expected: FAIL — no `class="table"`.

- [ ] **Step 3: Rewrite `hub/views/company/console.eta`**

```html
<%~ include("../partials/header", { title: "Manage · " + it.company.name, user: it.user }) %>
<nav class="subnav"><a class="lnk" href="/dashboard">← Dashboard</a></nav>
<h1><%= it.company.name %></h1>
<div class="card">
<h2>Members (<%= it.members.length %>)</h2>
<form method="POST" action="/company/<%= it.company.slug %>/members" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px;">
<div class="field" style="flex:1;min-width:220px;"><label class="label">Invite by email</label><input class="input" type="email" name="email" placeholder="email@example.com" required></div>
<select class="input" name="role" style="width:auto;">
<option value="member">Member</option>
<% if (it.companyRole === "owner") { %><option value="owner">Owner</option><% } %>
</select>
<button class="btn btn-pri" type="submit">Invite member</button>
</form>
<div class="table-wrap"><table class="table">
<thead><tr><th>Email</th><th>Role</th><th>Apps</th><th>Status</th><th></th></tr></thead>
<tbody>
<% for (const m of it.members) { %>
<tr>
<td><%= m.email %></td>
<td>
<% const canEditRow = it.companyRole === "owner" || m.role !== "owner"; %>
<% if (canEditRow) { %>
<form method="POST" action="/company/<%= it.company.slug %>/members/<%= m.userId %>/role" class="tbacts">
<select class="input" name="role" style="width:auto;">
<option value="member" <%= m.role === "member" ? "selected" : "" %>>Member</option>
<% if (it.companyRole === "owner") { %><option value="owner" <%= m.role === "owner" ? "selected" : "" %>>Owner</option><% } %>
</select>
<button class="btn btn-ghost btn-sm" type="submit">Save</button>
</form>
<% } else { %><span class="pill pill-ok"><%= m.role %></span><% } %>
</td>
<td>
<% if (m.role === "owner") { %>
  <span class="micro" title="Owners always have every app">Signal ✓ · RAID ✓</span>
<% } else { %>
  <div class="tbacts">
  <% for (const a of [["signal","Signal", m.signalOn],["raid","RAID", m.raidOn]]) { %>
    <form method="POST" action="/company/<%= it.company.slug %>/members/<%= m.userId %>/apps/<%= a[0] %>">
      <input type="hidden" name="action" value="<%= a[2] ? 'revoke' : 'grant' %>">
      <button class="btn btn-ghost btn-sm" type="submit"><%= a[1] %>: <%= a[2] ? 'On' : 'Off' %></button>
    </form>
  <% } %>
  </div>
<% } %>
</td>
<td><span class="pill <%= m.hasLoggedIn ? 'pill-ok' : 'pill-closed' %>"><%= m.hasLoggedIn ? "Active" : "Invited" %></span></td>
<td>
<% if (canEditRow) { %>
<form method="POST" action="/company/<%= it.company.slug %>/members/<%= m.userId %>/remove" onsubmit="return confirm('Remove this member?')"><button class="btn btn-danger btn-sm">Remove</button></form>
<% } %>
</td>
</tr>
<% } %>
</tbody></table></div>
</div>
<div class="card">
<h2>Teams (<%= it.teams.length %>)</h2>
<form method="POST" action="/company/<%= it.company.slug %>/teams" style="display:flex;gap:10px;align-items:flex-end;margin-bottom:10px;">
<div class="field" style="flex:1;max-width:320px;"><label class="label">New team</label><input class="input" type="text" name="name" placeholder="Team name" required></div>
<button class="btn btn-pri" type="submit">Create team</button>
</form>
<ul class="plain">
<% for (const t of it.teams) { %>
<li><a class="lnk" href="/company/<%= it.company.slug %>/teams/<%= t.id %>"><%= t.name %></a></li>
<% } %>
</ul>
</div>
<%~ include("../partials/footer") %>
```

- [ ] **Step 4: Rewrite `hub/views/company/team.eta`**

```html
<%~ include("../partials/header", { title: "Team · " + it.team.name, user: it.user }) %>
<nav class="subnav"><a class="lnk" href="/company/<%= it.company.slug %>">← <%= it.company.name %></a></nav>
<h1><%= it.team.name %></h1>
<div class="card">
<h2>Rename team</h2>
<form method="POST" action="/company/<%= it.company.slug %>/teams/<%= it.team.id %>/rename" style="display:flex;gap:10px;align-items:flex-end;">
<div class="field" style="flex:1;max-width:320px;"><label class="label">Team name</label><input class="input" type="text" name="name" value="<%= it.team.name %>" required></div>
<button class="btn btn-pri" type="submit">Rename</button>
</form>
</div>
<div class="card">
<h2>Members (<%= it.teamMembers.length %>)</h2>
<div class="table-wrap"><table class="table">
<thead><tr><th>Email</th><th></th></tr></thead>
<tbody>
<% for (const m of it.teamMembers) { %>
<tr>
<td><%= m.email %></td>
<td><form method="POST" action="/company/<%= it.company.slug %>/teams/<%= it.team.id %>/members/<%= m.userId %>/remove"><button class="btn btn-danger btn-sm">Remove</button></form></td>
</tr>
<% } %>
</tbody></table></div>
<h3 style="margin-top:18px;">Add to team</h3>
<% if (it.availableMembers.length === 0) { %>
<p class="lede">All company members are already on this team.</p>
<% } else { %>
<form method="POST" action="/company/<%= it.company.slug %>/teams/<%= it.team.id %>/members" style="display:flex;gap:10px;align-items:flex-end;">
<select class="input" name="userId" style="width:auto;">
<% for (const m of it.availableMembers) { %><option value="<%= m.userId %>"><%= m.email %></option><% } %>
</select>
<button class="btn btn-pri" type="submit">Add</button>
</form>
<% } %>
</div>
<%~ include("../partials/footer") %>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /var/www/suite/hub && node --test tests/company.test.js tests/org.test.js tests/requireCompanyRole.test.js`
Expected: PASS (role/entitlement logic unchanged; only markup changed).

- [ ] **Step 6: Commit**

```bash
cd /var/www/suite
git add hub/views/company/console.eta hub/views/company/team.eta hub/tests/company.test.js
git status
git commit -m "feat(hub): Instrument company console + team pages

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Full verification + visual pass + finish branch

**Files:** none (verification + merge)

- [ ] **Step 1: Run the whole hub suite**

Run: `cd /var/www/suite/hub && npm test`
Expected: ALL tests pass (including `theme-drift`, `instrument-chrome`, and every existing suite). Capture the summary counts.

- [ ] **Step 2: Run the foundation suite**

Run: `cd /var/www/suite/shared/theme && node --test tests/`
Expected: ALL pass (11).

- [ ] **Step 3: Confirm no drift**

Run: `node /var/www/suite/shared/theme/check-theme-drift.mjs /var/www/suite/hub`
Expected: `ok: /var/www/suite/hub`.

- [ ] **Step 4: Visual pass — serve the hub locally**

Start the hub against a scratch DB and click through every page. Suggested env (matches `tests/helpers.js`):

```bash
cd /var/www/suite/hub
DB_PATH=/tmp/instrument-hub-preview.db BASE_URL=http://localhost:3009 COOKIE_SECRET=dev RESEND_API_KEY=test FROM_EMAIL=login@test ALLOWED_APP_DOMAINS=https://sprintraid.uk,https://sprintsignal.uk,https://sprintretro.uk,https://sprintpoker.uk HUB_API_KEY_RAID=k HUB_API_KEY_SIGNAL=k HUB_API_KEY_RETRO=k HUB_API_KEY_POKER=k PORT=3009 node server.js
```
Seed an admin to view operator pages: `node scripts/create-admin.js` (follow its prompts; or insert a user + session via sqlite). Then verify against `preview.html`:
- `/` landing — band animates, 4 glyph tiles
- `/login`, `/login` → check-email, magic confirm — authcard split with waves panel
- `/request` — fields, select caret, checkboxes, textarea; submit → `/request` received page
- `/dashboard` (logged in) — band + entitled/locked tiles + Manage + Admin link
- `/admin`, `/admin/sessions`, `/admin/audit`, `/admin/companies` — sub-nav, tables, pills, action buttons
- `/company/<slug>`, a team page — tables + management controls
- Confirm `prefers-reduced-motion` stops the trace animation (DevTools → Rendering → emulate).

Ctrl-C and `rm /tmp/instrument-hub-preview.db` when done.

- [ ] **Step 5: Final holistic review**

Re-read the diff (`git log --oneline main..feat/instrument-hub`, `git diff main..feat/instrument-hub -- hub/views`). Check: no leftover `/styles.css` refs, no old `.btn`-without-variant, no `.grid-4`/`.tile`/`.topbar`-via-old-css references, all forms preserve their `action`/`name`/honeypot. Use superpowers:requesting-code-review for a fresh-eyes pass.

- [ ] **Step 6: Merge to main (local) + push**

```bash
cd /var/www/suite
git switch main
git merge --no-ff feat/instrument-hub -m "Merge Instrument hub+auth redesign (sub-project 1)"
git push origin main
git push origin feat/instrument-hub
```

- [ ] **Step 7: Deploy (live session, operator-driven)**

Per `reference-ionos-deploy` + step-by-step shell conventions, on prod as the `suite-hub` user: `git pull` on `main`, restart the `suite-hub` service, confirm `/healthz` returns 200, and spot-check landing + dashboard + an admin page in the browser. (Run interactively, one command per block — not part of the automated plan execution.)

---

## Notes for the implementer

- **No logic changes.** Every task is markup/CSS only. If a view's route passes data this plan didn't anticipate, preserve the existing Eta expression verbatim and only change surrounding tags/classes.
- **Incremental safety:** after Task 3 the chrome changes globally; views not yet rewritten still render correctly inside it (they just don't use the new components yet). Run `npm test` after each task.
- **Glyph keys** are `suite`, `raid`, `signal`, `retro`, `poker` (sprite at `/illos/glyphs.svg`). Dashboard derives the glyph from `a.key`.
- **Drift guard:** never hand-edit `hub/public/css/instrument-core.css`, `hub/public/js/oscilloscope.js`, `hub/public/illos/glyphs.svg`, or `hub/public/fonts/*` — edit the foundation source and re-run `sync-theme.mjs`. `hub/public/hub.css` is hub-owned and exempt.
- **Emails out of scope:** do not touch `hub/views/emails/*`.
