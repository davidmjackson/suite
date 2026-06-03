# Instrument Signal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin Signal (client-rendered, static HTML + vanilla JS) to the Instrument design system — adopt the synced foundation + a Signal-owned `signal.css`, the oscilloscope band, Bricolage/Hanken/IBM Plex Mono fonts, and recolor the radar — with no API/auth/logic changes.

**Architecture:** Replace `theme-core.css` + `theme-signal.css` + `breathing-waves.css` with the synced `instrument-core.css` (drift-checked source of truth) + a Signal-owned `signal.css` (everything Instrument doesn't provide, re-pointed to Instrument tokens). Each static shell adopts `class="ins" data-app="signal"`, the `.band`/oscilloscope, and the shared component classes; Signal's app-specific components keep their class names, restyled in `signal.css`.

**Tech Stack:** Node ≥20 (CommonJS here — `require`), Express 5, better-sqlite3, vanilla browser JS, `node:test` unit tests + Playwright e2e. Foundation tooling is ESM under `/var/www/suite/shared/theme/`.

**Repos & paths:** Signal is its OWN repo at `/var/www/signal` (service `signal.service`, User=signal, port 3002, health at `/health`). Foundation lives in `/var/www/suite/shared/theme/` (manifest already maps `signal` → `/var/www/signal/public`). **Code commits in `/var/www/signal`; this plan + spec live in `/var/www/suite/docs/superpowers/`.** Run Signal unit tests from `/var/www/signal` with `npm test` (`node --test tests/*.test.js`); e2e with `npm run test:e2e` (Playwright, boots its own instance on port 3010 against a throwaway DB).

**Conventions:** Explicit git staging only — never `git add -A`/`.`; `git status` before each commit. Branch `feat/instrument-signal` off Signal's live branch `feat/suite-auth`; push to origin as backup; merge back to `feat/suite-auth` locally. Co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Token mapping (used throughout `signal.css` tasks)

Signal's old tokens → Instrument tokens (from `instrument-core.css`, all under `.ins`):

| Signal old | Instrument | Notes |
|---|---|---|
| `--bg`, `--bg-warm` | `--bone` | page + warm fills |
| `--surface` | `--panel` | cards |
| `--border` | `--line` | hairlines |
| `--border-st` | `--line2` | stronger borders |
| `--ink` | `--ink` | text |
| `--muted` | `--soft` | secondary text |
| `--faint` | `--faint` | tertiary text |
| `--accent`, `--accent-deep` | `--accent` (=`--green`) | primary; deep→`--green` |
| `--accent-on` | `#fff` | text on accent |
| `--accent-soft` | `--greenwash` | accent tint |
| `--ok` / `--ok-bg` | `--green` / `--greenwash` | positive |
| `--warn` / `--warn-bg` | `oklch(0.5 0.12 60)` / `--amberwash` | attention (mapping A) |
| `--err` / `--err-bg` | `oklch(0.5 0.13 25)` / `color-mix(in oklab, oklch(0.5 0.13 25) 12%, var(--panel))` | destructive only |
| `--info` / `--info-bg` | `--teal` / `--tealwash` | divided/neutral |
| `--mono` | `'IBM Plex Mono', monospace` | |
| `--serif`, `--sans` | (drop — Instrument `.ins` sets Bricolage headings / Hanken body) | |

Spacing (`--s-*`), radii (`--r-*`), and shadows (`--shadow-*`) are NOT defined by Instrument — `signal.css` re-declares them verbatim (Task 2). Semantic decision (brainstorm): ok→green, warn/slipping/flagged→amber, info/divided→teal, delta-up→green, delta-down→amber, delta-flat→faint, radar baseline→neutral grey. Red is reserved for destructive actions.

---

## Task 0: Branch setup (signal repo)

**Files:** none (git only)

- [ ] **Step 1: Branch off the live branch**

```bash
cd /var/www/signal
git switch feat/suite-auth
git switch -c feat/instrument-signal
git status
```
Expected: on `feat/instrument-signal`, clean tree.

- [ ] **Step 2: Push as backup**

```bash
cd /var/www/signal
git push -u origin feat/instrument-signal
```

---

## Task 1: Sync foundation into Signal + drift guard + drop old fonts

**Files:**
- Create (via sync): `public/css/instrument-core.css`, `public/js/oscilloscope.js`, `public/illos/glyphs.svg`, `public/fonts/*.woff2`
- Create: `tests/theme-drift.test.js`
- Delete: `public/fonts/Fraunces.woff2`, `public/fonts/Inter.woff2`, `public/fonts/JetBrainsMono.woff2`

- [ ] **Step 1: Write the failing drift test**

Create `/var/www/signal/tests/theme-drift.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

test("signal's synced Instrument assets match the foundation source", async () => {
  const mod = await import("/var/www/suite/shared/theme/check-theme-drift.mjs");
  const r = mod.driftReport("/var/www/signal");
  assert.deepEqual(r.missing, [], "no missing synced assets");
  assert.deepEqual(r.mismatched, [], "no drifted synced assets");
  assert.equal(r.ok, true);
});
```
(The drift module is ESM; this CommonJS test loads it with dynamic `import()`. The absolute path is correct on this single-box deployment.)

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd /var/www/signal && node --test tests/theme-drift.test.js`
Expected: FAIL — `missing` lists `css/instrument-core.css`, `js/oscilloscope.js`, `illos/glyphs.svg`, and the 8 woff2 fonts (not synced yet).

- [ ] **Step 3: Run the sync**

```bash
node /var/www/suite/shared/theme/sync-theme.mjs /var/www/signal
```
Expected: `synced 11 assets -> /var/www/signal`.

- [ ] **Step 4: Run it — expect PASS**

Run: `cd /var/www/signal && node --test tests/theme-drift.test.js`
Expected: PASS.

- [ ] **Step 5: Remove the now-unused old fonts**

```bash
cd /var/www/signal
git rm public/fonts/Fraunces.woff2 public/fonts/Inter.woff2 public/fonts/JetBrainsMono.woff2
```

- [ ] **Step 6: Commit**

```bash
cd /var/www/signal
git add public/css/instrument-core.css public/js/oscilloscope.js public/illos/glyphs.svg public/fonts tests/theme-drift.test.js
git status
git commit -m "feat(signal): sync Instrument foundation + drift guard; drop old fonts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `signal.css` part A — tokens, utilities, inputs, tag/notice/modal, layout

**Files:**
- Create: `public/css/signal.css` (new, Signal-owned, NOT drift-checked)

This task ports the parts of `theme-core.css` that Instrument does NOT provide, scoped under `.ins`, re-pointed to Instrument tokens via the mapping table above. Read `public/css/theme-core.css` for the source rules. Instrument already provides (do NOT re-declare): `.card`, `.btn`/`.btn-pri`/`.btn-ghost`/`.btn-danger`/`.btn-sm`, `.topbar`, `.brand`/`.mk`, `.band`/`.band-in`/`.eyebrow`/`.waves`, `.pill`, `.notice` (base), `.field`/`.label`/`.input`, `.mono`/`.micro`/`.lede`/`.helper`, `a.lnk`, `.footer`.

- [ ] **Step 1: Create `signal.css` with the token + utility + component layer**

```css
/* signal.css — Signal-owned layer over instrument-core.css.
   Holds everything Instrument doesn't provide, re-pointed to Instrument tokens.
   Loaded AFTER instrument-core.css. NOT part of the synced foundation. */

.ins{
  /* Spacing + radii + shadows Instrument doesn't define */
  --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-6:24px; --s-8:32px; --s-12:48px;
  --r-sm:6px; --r-md:8px; --r-lg:12px; --r-xl:16px; --r-pill:999px;
  --shadow-sm:0 1px 0 rgba(20,30,28,0.04);
  --shadow-md:0 1px 0 rgba(20,30,28,0.04), 0 8px 24px rgba(20,30,28,0.06);
  --shadow-lg:0 1px 0 rgba(20,30,28,0.04), 0 16px 44px rgba(20,30,28,0.10);
  /* Semantic aliases mapped onto the Instrument palette (mapping A) */
  --ok:var(--green); --ok-bg:var(--greenwash);
  --warn:oklch(0.5 0.12 60); --warn-bg:var(--amberwash);
  --err:oklch(0.5 0.13 25); --err-bg:color-mix(in oklab, oklch(0.5 0.13 25) 12%, var(--panel));
  --info:var(--teal); --info-bg:var(--tealwash);
  --accent-soft:var(--greenwash); --accent-deep:var(--green); --accent-on:#fff;
  --mono-font:'IBM Plex Mono', ui-monospace, monospace;
  /* Radar series colours (read by radar.js via getComputedStyle) */
  --radar-now:var(--green);
  --radar-baseline:oklch(0.62 0.008 250);
  --radar-guide:var(--line);
  --radar-text:var(--ink);
  --radar-textmuted:var(--soft);
  --radar-now-fill:var(--greenwash);
  --radar-baseline-fill:color-mix(in oklab, oklch(0.62 0.008 250) 14%, transparent);
}

/* Utilities not in Instrument */
.ins .kicker{font-family:var(--mono-font); font-size:0.66rem; font-weight:600; text-transform:uppercase; letter-spacing:0.12em; color:var(--soft);}
.ins .faint{color:var(--faint); font-size:0.85rem;}
.ins .center{text-align:center;}
.ins .hidden{display:none !important;}
.ins .muted{color:var(--soft);}

/* Layout shells/utilities */
.ins .page-narrow{max-width:560px;}
.ins .shell{min-height:100vh; display:flex; align-items:center; justify-content:center; padding:var(--s-6);}
.ins .stack > * + *{margin-top:var(--s-4);}
.ins .row{display:flex; gap:var(--s-3); flex-wrap:wrap; align-items:center;}
.ins .row-end{justify-content:flex-end;}
.ins .spread{display:flex; justify-content:space-between; align-items:center; gap:var(--s-3);}
.ins .app-footer{text-align:center; padding:var(--s-6); font-size:0.8rem; color:var(--faint);}
.ins .app-footer a{color:var(--faint);}

/* Bare inputs/selects/textareas (Signal markup doesn't use the .input class) */
.ins input[type="text"], .ins input[type="email"], .ins input[type="password"],
.ins input[type="number"], .ins select, .ins textarea{
  width:100%; padding:10px 12px; border:1px solid var(--line2); border-radius:var(--r-md);
  background:var(--bone); color:var(--ink); font:inherit;
  transition:border-color 120ms ease, box-shadow 120ms ease;
}
.ins input::placeholder, .ins textarea::placeholder{color:var(--faint);}
.ins input:focus, .ins select:focus, .ins textarea:focus{
  outline:none; border-color:var(--green); box-shadow:0 0 0 3px var(--greenwash);
}
/* Signal's field uses a <span> label child, not Instrument's .label */
.ins .field{display:block; margin-bottom:var(--s-4);}
.ins .field > span{display:block; font-weight:600; font-size:0.85rem; margin-bottom:var(--s-1); color:var(--ink);}

/* Tags + notice variants (Instrument has base .notice + .pill only) */
.ins .tag{display:inline-block; padding:3px 9px; border-radius:var(--r-sm); background:var(--bone); color:var(--soft); font-size:0.7rem; font-weight:700; text-transform:uppercase; letter-spacing:0.06em;}
.ins .tag-ok{background:var(--ok-bg); color:var(--ok);}
.ins .tag-warn{background:var(--warn-bg); color:var(--warn);}
.ins .tag-err{background:var(--err-bg); color:var(--err);}
.ins .tag-info{background:var(--info-bg); color:var(--info);}
.ins .tag-divided{background:var(--info-bg); color:var(--info);}
.ins .tag-flagged{background:var(--warn-bg); color:var(--warn);}
.ins .notice-error{background:var(--err-bg); border-color:var(--err); color:var(--err);}
.ins .notice-ok{background:var(--ok-bg); border-color:var(--ok); color:var(--ok);}
.ins .notice-info{background:var(--info-bg); border-color:color-mix(in oklab, var(--teal) 40%, var(--line2)); color:var(--ink);}

/* Modal (Instrument has no modal component) */
.ins .modal-overlay{position:fixed; inset:0; background:oklch(0.235 0.013 250 / 0.48); display:flex; align-items:center; justify-content:center; z-index:50; padding:var(--s-4);}
.ins .modal-overlay.hidden{display:none;}
.ins .modal-content{width:min(420px,100%); background:var(--panel); border:1px solid var(--line2); border-radius:var(--r-xl); box-shadow:var(--shadow-lg); padding:var(--s-6);}
.ins .modal-content h2{margin:0 0 var(--s-2);}
.ins .modal-actions{display:flex; justify-content:flex-end; gap:var(--s-2); margin-top:var(--s-6);}
```

- [ ] **Step 2: Sanity-check it parses**

Run: `cd /var/www/signal && node -e "const fs=require('fs');const c=fs.readFileSync('public/css/signal.css','utf8');const o=(c.match(/{/g)||[]).length,cl=(c.match(/}/g)||[]).length;if(o!==cl)throw new Error('brace mismatch '+o+'/'+cl);console.log('braces ok',o)"`
Expected: `braces ok <n>` (balanced).

- [ ] **Step 3: Commit**

```bash
cd /var/www/signal
git add public/css/signal.css
git status
git commit -m "feat(signal): signal.css part A — tokens, utilities, inputs, tags/notices/modal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `signal.css` part B — Signal app components (re-tokenized) + radar vars

**Files:**
- Modify: `public/css/signal.css` (append)

Append all of Signal's app-specific components, re-pointed to Instrument tokens via the mapping table, scoped under `.ins`. **This is a faithful re-tokenization of existing, working rules** — read the source files and apply the mapping; do not redesign layout. Sources:
- From `public/css/theme-signal.css`: `.sky-hero` (+ `.sky-stars`, `.sky-hero .card`, `.sky-hero > .brand`), `.postcard-tile` (+ `.glyph`, `.pt-team`, `.pt-meta`, hover), `.series-team-name`/`.series-template-name`/`.series-followups`/`.series-followup-chip`/`.series-orphans-label`, `.question-postcard` (+ `::after`), `.axis-glyph` + `.axis-glyph-sun`(→`--warn`)/`-cloud`(→`--soft`)/`-rain`(→`--info`)/`-wind`(→`--accent-deep`).
- From `public/css/app.css`: `.detail-list`, `.key-box`, `.survey-row` (+ children + mobile), `.report-head`/`.report-grid`, `.radar-wrap`/`.legend`/`.legend-item`/`.legend-swatch`/`.legend-now`(→`--radar-now`)/`.legend-baseline`(→`--radar-baseline`), `.focus-card` (+ variants `.focus-lowFlat`→`--warn`, `.focus-lowRising`→`--ok`, `.focus-highSlip`→`--warn`, `.focus-divided`→`--info`, + head/axis/score/tip), `.axes-grid`/`.axis-card` (+ name/score, `.axis-delta`, `.delta-up`→`--ok`, `.delta-down`→`--warn`, `.delta-flat`→`--faint`), `.q-row`/`.q-text`/`.q-meta`/`.bar`/`.bar-fill`(→`--accent`)/`.q-score`, `.guidance`, `.respond-shell`/`.respond-card`/`.progress-track`/`.progress-fill`(→`--accent`)/`.question-text`/`.scale`/`.scale-option`(+`:hover`,`.selected`→border `--accent` bg `--greenwash`)/`.scale-num`/`.respond-nav`, `.footer-note`/`.footer-note-wide`, `.radio-option`, `.license-text`.
- From `theme-core.css` section 6: the motion keyframes (`drift-in`, `pin-up`, `postcard-send`, `sticker-place`) + classes (`.motion-drift-in`/`.motion-pin-up`/`.motion-send`/`.motion-place`) and the `prefers-reduced-motion` block — keep verbatim (they're the "Weather Postcards" animations).

Replacements to apply while migrating: every `var(--border)`→`var(--line)`, `var(--border-st)`→`var(--line2)`, `var(--surface)`→`var(--panel)`, `var(--bg)`/`var(--bg-warm)`→`var(--bone)`, `var(--muted)`→`var(--soft)`, `var(--accent-soft)`→`var(--greenwash)`, `var(--mono)`→`var(--mono-font)`, `var(--sig-baseline)`→`var(--radar-baseline)`; `--ok`/`--warn`/`--info`/`--accent`/`--accent-deep`/`--faint` already aliased in Task 2 so they resolve correctly. Scope every selector with a leading `.ins `.

- [ ] **Step 1: Worked example — migrate `.survey-row` and `.scale-option`**

Append (this is the pattern for all rules — note `.ins ` prefix + token swaps):

```css
.ins .survey-row{display:flex; justify-content:space-between; align-items:center; gap:var(--s-4); padding:var(--s-4); border:1px solid var(--line); border-radius:var(--r-md); background:var(--panel); cursor:pointer; text-decoration:none; color:inherit;}
.ins .survey-row + .survey-row{margin-top:var(--s-2);}
.ins .survey-row:hover{border-color:var(--line2); background:var(--bone);}
.ins .survey-row-main{min-width:0;}
.ins .survey-row-team{font-weight:600;}
@media (max-width:599px){ .ins .survey-row{flex-direction:column; align-items:flex-start; gap:var(--s-3);} }

.ins .scale-option{display:flex; align-items:center; gap:var(--s-3); padding:11px 14px; border:1px solid var(--line2); border-radius:var(--r-md); cursor:pointer;}
.ins .scale-option:hover{background:var(--bone);}
.ins .scale-option.selected{border-color:var(--green); background:var(--greenwash);}
.ins .scale-option input{width:auto;}
.ins .scale-num{font-family:var(--mono-font); font-weight:700; color:var(--soft);}
```

- [ ] **Step 2: Migrate ALL remaining rules listed above** the same way (faithful copy + `.ins ` prefix + token swap + semantic mapping). Include the radar legend swatches reading the radar vars:

```css
.ins .legend-now{background:var(--radar-now);}
.ins .legend-baseline{background:var(--radar-baseline);}
```

- [ ] **Step 3: Sanity-check braces balance**

Run: `cd /var/www/signal && node -e "const c=require('fs').readFileSync('public/css/signal.css','utf8');const o=(c.match(/{/g)||[]).length,cl=(c.match(/}/g)||[]).length;if(o!==cl)throw new Error('mismatch '+o+'/'+cl);console.log('braces ok',o)"`
Expected: balanced.

- [ ] **Step 4: Commit**

```bash
cd /var/www/signal
git add public/css/signal.css
git status
git commit -m "feat(signal): signal.css part B — app components re-tokenized + radar vars

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Reskin the five static shells

**Files:**
- Modify: `public/dashboard.html`, `public/admin.html`, `public/survey.html`, `public/license.html`, `public/respond.html` (full rewrites)

Mechanical transformation applied to every shell:
- `<body>` → `<body class="ins" data-app="signal">`.
- In `<head>`: replace the three/four CSS links (`theme-core.css`, `theme-signal.css`, `app.css`, `breathing-waves.css`) with exactly `<link rel="stylesheet" href="/css/instrument-core.css">` then `<link rel="stylesheet" href="/css/signal.css">`.
- Replace the `<script src="/js/breathing-waves.js" defer></script>` line with `<script type="module" src="/js/oscilloscope.js"></script>` (keep all other scripts/order, including `/js/api.js`, the page JS, and `/auth-client/heartbeat.js`).
- Brand glyph: `<svg class="brand-glyph" …><use href="/illos/theme-illos.svg#postcard"/></svg>` → `<svg class="mk" width="22" height="22" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-signal"/></svg>`.
- `class="btn btn-primary"` → `class="btn btn-pri"` (every occurrence).
- Header band: `<header class="header-band" data-breathing-waves data-wave-palette="signal" role="none"><canvas></canvas><div class="header-content"><p class="eyebrow">X</p><h1 class="header-title">Y</h1></div></header>` → `<div class="band"><div class="waves"></div><div class="band-in"><div class="eyebrow">X</div><h1>Y</h1></div></div>`. Where a `.header-subtitle` exists (survey report), render it as `<p class="sub">…</p>` inside `.band-in`.

- [ ] **Step 1: Rewrite `public/dashboard.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Surveys — Signal</title>
  <link rel="stylesheet" href="/css/instrument-core.css">
  <link rel="stylesheet" href="/css/signal.css">
  <script src="/js/api.js" defer></script>
  <script src="/js/dashboard.js" defer></script>
  <script type="module" src="/js/oscilloscope.js"></script>
  <script src="/auth-client/heartbeat.js" defer></script>
</head>
<body class="ins" data-app="signal">
  <header class="topbar">
    <a href="/" class="brand"><svg class="mk" width="22" height="22" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-signal"/></svg> Signal</a>
    <span class="topbar-actions">
      <a class="btn btn-ghost btn-sm" href="/admin">Teams &amp; admins</a>
      <button id="signout-btn" class="btn btn-ghost btn-sm" type="button">Sign out</button>
    </span>
  </header>
  <div class="band"><div class="waves"></div><div class="band-in">
    <div class="eyebrow">Workspace</div>
    <h1>Surveys</h1>
  </div></div>
  <main class="page">
    <div id="main-content" class="hidden stack">
      <div class="row row-end">
        <a class="btn btn-pri" href="/survey">New survey</a>
      </div>
      <div id="survey-list"></div>
      <p id="empty-state" class="card muted hidden">
        No surveys yet. Create one to share an anonymous health check with a team.
      </p>
      <p class="footer-note footer-note-wide">
        Counts show participation only — never who answered. A report stays
        hidden until a survey has at least 3 responses.
      </p>
    </div>
  </main>
  <footer class="app-footer"><a href="/license">License</a></footer>
</body>
</html>
```

- [ ] **Step 2: Rewrite `public/admin.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Teams &amp; admins — Signal</title>
  <link rel="stylesheet" href="/css/instrument-core.css">
  <link rel="stylesheet" href="/css/signal.css">
  <script src="/js/api.js" defer></script>
  <script src="/js/admin.js" defer></script>
  <script type="module" src="/js/oscilloscope.js"></script>
  <script src="/auth-client/heartbeat.js" defer></script>
</head>
<body class="ins" data-app="signal">
  <header class="topbar">
    <a href="/" class="brand"><svg class="mk" width="22" height="22" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-signal"/></svg> Signal</a>
    <span class="topbar-actions">
      <a class="btn btn-ghost btn-sm" href="/dashboard">All surveys</a>
      <button id="signout-btn" class="btn btn-ghost btn-sm" type="button">Sign out</button>
    </span>
  </header>
  <div class="band"><div class="waves"></div><div class="band-in">
    <div class="eyebrow">Workspace</div>
    <h1>Teams &amp; admins</h1>
  </div></div>
  <main class="page">
    <div class="card">
      <h2>Teams</h2>
      <p class="faint">
        A team is who a survey is for. Its access key is shown once on creation
        or rotation — copy it then.
      </p>
      <div class="row">
        <input type="text" id="team-name" placeholder="New team name" autocomplete="off">
        <button id="create-team-btn" class="btn btn-pri" type="button">Create team</button>
      </div>
      <p id="team-message" class="notice hidden"></p>
      <div id="key-reveal" class="hidden">
        <p class="faint" id="key-reveal-label"></p>
        <p id="key-reveal-value" class="key-box"></p>
      </div>
      <div id="team-list"></div>
    </div>
  </main>
  <footer class="app-footer"><a href="/license">License</a></footer>
</body>
</html>
```

- [ ] **Step 3: Rewrite `public/survey.html`** (two bands — builder + report; preserves all ids, `notice notice-error`/`notice-info`, the `.field`>span builder form, report grid)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Survey — Signal</title>
  <link rel="stylesheet" href="/css/instrument-core.css">
  <link rel="stylesheet" href="/css/signal.css">
  <script src="/js/api.js" defer></script>
  <script src="/js/radar.js" defer></script>
  <script src="/js/survey.js" defer></script>
  <script type="module" src="/js/oscilloscope.js"></script>
  <script src="/auth-client/heartbeat.js" defer></script>
</head>
<body class="ins" data-app="signal">
  <header class="topbar">
    <a href="/" class="brand"><svg class="mk" width="22" height="22" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-signal"/></svg> Signal</a>
    <span class="topbar-actions">
      <a class="btn btn-ghost btn-sm" href="/dashboard">All surveys</a>
      <button id="signout-btn" class="btn btn-ghost btn-sm" type="button">Sign out</button>
    </span>
  </header>
  <main class="page">
    <p id="loading" class="muted">Loading…</p>
    <p id="page-error" class="notice notice-error hidden"></p>

    <section id="builder" class="hidden">
      <div class="band"><div class="waves"></div><div class="band-in">
        <div class="eyebrow">Create</div>
        <h1>New survey</h1>
      </div></div>
      <p id="builder-no-teams" class="notice notice-info hidden">
        You need a team first. <a href="/admin">Create a team</a>, then come back.
      </p>
      <div id="builder-form" class="card hidden">
        <label class="field" for="team-select">
          <span>Team</span>
          <select id="team-select"></select>
        </label>
        <label class="field" for="template-select">
          <span>Question template</span>
          <select id="template-select"></select>
        </label>
        <div class="field">
          <span>Run type</span>
          <label class="radio-option">
            <input type="radio" name="run-type" id="run-baseline" value="baseline" checked>
            <span>Baseline — a fresh, standalone run</span>
          </label>
          <label class="radio-option">
            <input type="radio" name="run-type" id="run-followup" value="followup">
            <span>Follow-up — compared against an earlier run</span>
          </label>
        </div>
        <label class="field hidden" id="baseline-field" for="baseline-select">
          <span>Baseline survey to compare against</span>
          <select id="baseline-select"></select>
        </label>
        <p id="builder-error" class="notice notice-error hidden"></p>
        <button id="create-btn" class="btn btn-pri" type="button">
          Create &amp; generate link
        </button>
      </div>
      <div id="builder-result" class="card hidden">
        <h2>Survey created</h2>
        <p class="muted">Share this anonymous link with the team:</p>
        <p id="result-link" class="key-box"></p>
        <div class="row">
          <button id="copy-result" class="btn btn-sm" type="button">Copy link</button>
          <a class="btn btn-sm btn-pri" href="/dashboard">Done</a>
        </div>
      </div>
    </section>

    <section id="report" class="hidden">
      <div class="band"><div class="waves"></div><div class="band-in">
        <div class="eyebrow">Health check report</div>
        <h1 id="report-title">Survey</h1>
        <p id="report-sub" class="sub"></p>
      </div></div>
      <div class="card" id="report-controls">
        <h3>Survey link</h3>
        <p id="share-link" class="key-box"></p>
        <div class="row">
          <button id="copy-share" class="btn btn-sm" type="button">Copy link</button>
          <a id="csv-link" class="btn btn-sm hidden" href="#">Export CSV</a>
          <button id="toggle-status" class="btn btn-sm" type="button"></button>
          <button id="delete-survey" class="btn btn-sm btn-danger" type="button">Delete</button>
        </div>
        <p id="control-message" class="notice hidden"></p>
      </div>
      <p id="report-locked" class="notice notice-info hidden"></p>
      <div id="report-body" class="hidden">
        <div class="report-grid">
          <div class="card">
            <h2>Radar</h2>
            <div id="radar" class="radar-wrap"></div>
            <div class="legend">
              <span class="legend-item">
                <span class="legend-swatch legend-now"></span>This run
              </span>
              <span class="legend-item" id="legend-baseline">
                <span class="legend-swatch legend-baseline"></span>Baseline
              </span>
            </div>
          </div>
          <div class="card">
            <h2>Focus areas</h2>
            <p class="faint">Ranked by where attention helps most.</p>
            <div id="focus"></div>
          </div>
        </div>
        <div class="card">
          <h2>All axes</h2>
          <div id="axes" class="axes-grid"></div>
        </div>
        <div class="card">
          <h2>Per-question detail</h2>
          <p class="faint">Ranked lowest first. Higher is healthier.</p>
          <div id="breakdown"></div>
        </div>
        <p id="guidance" class="guidance"></p>
      </div>
    </section>
  </main>
  <footer class="app-footer"><a href="/license">License</a></footer>
</body>
</html>
```

- [ ] **Step 4: Rewrite `public/license.html`** (band + page-narrow; keep the full `<pre class="license-text">` block verbatim from the current file — do not alter the license wording)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>License — Signal</title>
  <link rel="stylesheet" href="/css/instrument-core.css">
  <link rel="stylesheet" href="/css/signal.css">
  <script type="module" src="/js/oscilloscope.js"></script>
</head>
<body class="ins" data-app="signal">
  <div class="band"><div class="waves"></div><div class="band-in">
    <div class="eyebrow">Legal</div>
    <h1>Signal Free Use License</h1>
  </div></div>
  <main class="page page-narrow">
    <div class="card">
      <p class="brand"><svg class="mk" width="22" height="22" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-signal"/></svg> Signal</p>
      <p>This tool is free to use, but it is not open source.</p>
      <p>You may use the software at no cost, but you may not copy, redistribute, modify, or sell it.</p>
      <p>The software is provided &ldquo;as is&rdquo; and all responsibility for the interpretation and use of the survey results remains with the user. Return to the <a href="/">main app</a>.</p>
      <pre class="license-text">[KEEP the exact <pre> text content from the current public/license.html lines 31–89 — copy it verbatim, unchanged]</pre>
    </div>
  </main>
</body>
</html>
```

- [ ] **Step 5: Rewrite `public/respond.html`** (bare focused flow, no band)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Health check — Signal</title>
  <link rel="stylesheet" href="/css/instrument-core.css">
  <link rel="stylesheet" href="/css/signal.css">
  <script src="/js/api.js" defer></script>
  <script src="/js/respond.js" defer></script>
</head>
<body class="ins" data-app="signal">
  <main class="respond-shell">
    <div class="respond-card card">
      <p class="brand"><svg class="mk" width="22" height="22" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-signal"/></svg> Signal health check</p>
      <p id="respond-loading" class="muted">Loading…</p>
      <div id="respond-closed" class="hidden">
        <h1>This survey is closed</h1>
        <p class="muted">It is no longer accepting responses. Thank you anyway.</p>
      </div>
      <div id="respond-question" class="hidden">
        <div class="progress-track">
          <div id="progress-fill" class="progress-fill"></div>
        </div>
        <p id="progress-text" class="faint"></p>
        <div class="question-postcard">
          <p id="axis-label" class="kicker"></p>
          <p id="question-text" class="question-text"></p>
          <div id="scale" class="scale"></div>
          <p id="respond-error" class="notice notice-error hidden"></p>
        </div>
        <div class="spread respond-nav">
          <button id="back-btn" class="btn" type="button">Back</button>
          <button id="next-btn" class="btn btn-pri" type="button">Next</button>
        </div>
      </div>
      <div id="respond-thanks" class="hidden center">
        <h1>Thank you</h1>
        <p class="muted">
          Your answers have been recorded anonymously. You can close this page.
        </p>
      </div>
    </div>
    <p class="footer-note">
      This survey is anonymous. There is no login, and individual answers are
      never shown to anyone — only team-level summaries.
    </p>
  </main>
  <footer class="app-footer"><a href="/license">License</a></footer>
</body>
</html>
```

- [ ] **Step 6: Verify no stale references remain**

Run: `cd /var/www/signal && grep -rlE "theme-core|theme-signal|/css/app.css|breathing-waves|btn-primary|brand-glyph|header-band" public/*.html`
Expected: NO output (all five shells migrated).

- [ ] **Step 7: Commit**

```bash
cd /var/www/signal
git add public/dashboard.html public/admin.html public/survey.html public/license.html public/respond.html
git status
git commit -m "feat(signal): reskin static shells to Instrument chrome + oscilloscope band

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: JS — api.js button + remove breathing-waves + delete dead CSS

**Files:**
- Modify: `public/js/api.js` (the `confirmModal` button class)
- Delete: `public/js/breathing-waves.js`, `public/css/breathing-waves.css`, `public/css/theme-core.css`, `public/css/theme-signal.css`, `public/css/app.css`

- [ ] **Step 1: Fix the button class in `api.js`**

In `public/js/api.js`, in `confirmModal`, change the confirm button class from `btn-primary` to `btn-pri`:

```js
    const confirmBtn = el("button", {
      class: `btn ${opts.danger === false ? "btn-pri" : "btn-danger"}`,
      type: "button",
      text: opts.confirmLabel || "Confirm"
    });
```

- [ ] **Step 2: Confirm no other `btn-primary` in JS**

Run: `cd /var/www/signal && grep -rn "btn-primary" public/js/`
Expected: NO output.

- [ ] **Step 3: Delete the superseded files**

```bash
cd /var/www/signal
git rm public/js/breathing-waves.js public/css/breathing-waves.css public/css/theme-core.css public/css/theme-signal.css public/css/app.css
```

- [ ] **Step 4: Confirm nothing still references them**

Run: `cd /var/www/signal && grep -rnE "breathing-waves|theme-core|theme-signal|/css/app.css" public/ | grep -v "signal.css\|instrument-core"`
Expected: NO output.

- [ ] **Step 5: Commit**

```bash
cd /var/www/signal
git add public/js/api.js
git status
git commit -m "feat(signal): confirmModal uses btn-pri; remove breathing-waves + old theme CSS

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Radar — read Instrument tokens via CSS variables

**Files:**
- Modify: `public/js/radar.js` (the `RADAR` color constants)

- [ ] **Step 1: Replace the hard-coded color constants with a CSS-var reader**

In `public/js/radar.js`, replace the literal color fields in the `RADAR` object (currently `accent`, `accentFill`, `baseline`, `baselineFill`, `guide`, `text`, `textMuted`) with values read from the `.ins` custom properties defined in `signal.css`. Keep the non-color fields (`width`, `height`, `radius`, `scaleMax`). Insert this helper above the `RADAR` definition and use it:

```js
function cssVar(name, fallback) {
  if (typeof document === "undefined") return fallback;
  const root = document.querySelector(".ins") || document.documentElement;
  const v = getComputedStyle(root).getPropertyValue(name).trim();
  return v || fallback;
}

const RADAR = {
  width: 600,
  height: 460,
  radius: 150,
  scaleMax: 5,
  accent:       cssVar("--radar-now", "#1D9E75"),
  accentFill:   cssVar("--radar-now-fill", "rgba(29,158,117,0.16)"),
  baseline:     cssVar("--radar-baseline", "#888780"),
  baselineFill: cssVar("--radar-baseline-fill", "rgba(136,135,128,0.12)"),
  guide:        cssVar("--radar-guide", "#E3E3DF"),
  text:         cssVar("--radar-text", "#2A2A28"),
  textMuted:    cssVar("--radar-textmuted", "#6B6B66")
};
```
(SVG presentation attributes accept any CSS color string, so the resolved oklch/wash values work directly. The fallbacks keep the chart sane if the stylesheet hasn't loaded.)

- [ ] **Step 2: Smoke-check the module parses**

Run: `cd /var/www/signal && node -e "require('fs').readFileSync('public/js/radar.js','utf8');new Function(require('fs').readFileSync('public/js/radar.js','utf8').replace(/document|getComputedStyle/g,'void 0'));console.log('parse ok')"` (best-effort syntax check; the radar runs in the browser).
Expected: `parse ok`.

- [ ] **Step 3: Commit**

```bash
cd /var/www/signal
git add public/js/radar.js
git status
git commit -m "feat(signal): radar reads Instrument colours from CSS variables

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Update the header e2e spec for the oscilloscope band

**Files:**
- Modify: `tests/e2e/header-waves.spec.js` (rewrite to test the Instrument band)

The old spec asserts `.header-band[data-breathing-waves]` + a sized `<canvas>`. The oscilloscope mounts an `<svg>` into `.band .waves` instead.

- [ ] **Step 1: Rewrite `tests/e2e/header-waves.spec.js`**

```js
"use strict";

const { test, expect } = require("@playwright/test");
const { authenticate } = require("./_auth");

const PUBLIC_PAGES = [
  { path: "/license", title: "Signal Free Use License" }
];

const AUTH_PAGES = [
  { path: "/dashboard", title: "Surveys" },
  { path: "/admin", title: "Teams & admins" },
  // survey has two .band elements; first() targets the builder one
  { path: "/survey", title: "New survey" }
];

async function signIn(page) {
  await authenticate(page.context());
}

function attachErrorListeners(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  return errs;
}

async function assertOscilloscope(band) {
  // oscilloscope.js mounts an <svg> trace into the empty .waves container.
  await expect.poll(async () => band.locator(".waves svg").count()).toBeGreaterThan(0);
}

test.describe("Instrument oscilloscope band", () => {
  test("renders on the public license page", async ({ page }) => {
    const errs = attachErrorListeners(page);
    for (const { path, title } of PUBLIC_PAGES) {
      await page.goto(path);
      const band = page.locator(".band").first();
      await expect(band).toBeVisible();
      await expect(band.locator("h1")).toContainText(title);
      await assertOscilloscope(band);
    }
    expect(errs).toEqual([]);
  });

  test("renders on auth-gated pages", async ({ page }) => {
    const errs = attachErrorListeners(page);
    await signIn(page);
    for (const { path, title } of AUTH_PAGES) {
      await page.goto(path);
      const band = page.locator(".band").first();
      await expect(band).toBeVisible();
      await expect(band.locator("h1").first()).toContainText(title);
      await assertOscilloscope(band);
    }
    expect(errs).toEqual([]);
  });
});
```

- [ ] **Step 2: Commit** (run happens in Task 9's full e2e pass)

```bash
cd /var/www/signal
git add tests/e2e/header-waves.spec.js
git status
git commit -m "test(signal): header e2e targets the oscilloscope band, not breathing-waves

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Update the palette contrast test

**Files:**
- Modify: `tests/theme-contrast.test.js`

The test pins the OLD Signal hexes (now unused). `lib/contrast` only parses hex, so replace the map with the Instrument palette's hex equivalents and check the pairs Signal actually relies on. Derive the exact hexes from `instrument-core.css`'s oklch tokens — run a quick conversion (e.g. open the synced CSS in a browser devtools and read `getComputedStyle` of a `.ins` element, or use any oklch→hex converter) rather than guessing. Mark the white-on-green button pair as large text (`{ largeText: true }`) since Instrument `--green` at L≈0.45 meets 3:1 (large/bold) but is borderline for 4.5:1 body. **If a body pair fails AA, do not weaken the test — report it as a real accessibility finding.**

- [ ] **Step 1: Rewrite `tests/theme-contrast.test.js`**

```js
// tests/theme-contrast.test.js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { contrastRatio, meetsAA } = require("../lib/contrast");

/**
 * Instrument palette pairs Signal relies on. Hexes are the sRGB equivalents of
 * the oklch tokens in instrument-core.css (derive exactly; values below are the
 * expected approximations — confirm against the synced CSS).
 */
const INS = {
  bone:      "#F2F1EC",  // --bone  oklch(0.964 0.004 240)
  panel:     "#FFFFFF",  // --panel oklch(0.996 0.002 240)
  ink:       "#2B2E33",  // --ink   oklch(0.235 0.013 250)
  soft:      "#5F6770",  // --soft  oklch(0.455 0.012 250)
  faint:     "#8A8E94",  // --faint oklch(0.6 0.01 250)
  green:     "#1F7A5C",  // --green oklch(0.45 0.077 162)
  greenwash: "#E2F3EA",  // --greenwash oklch(0.95 0.03 165)
  amberdark: "#7A5A12",  // warn text oklch(0.5 0.12 60)
  amberwash: "#F6ECD6",  // --amberwash oklch(0.95 0.05 78)
  white:     "#FFFFFF"
};

const BODY_PAIRS = [
  ["ink",   "bone"],
  ["ink",   "panel"],
  ["soft",  "panel"],
  ["soft",  "bone"],
  ["green", "greenwash"],
  ["amberdark", "amberwash"]
];

for (const [fg, bg] of BODY_PAIRS) {
  test(`instrument contrast: ${fg} on ${bg} meets AA body text`, () => {
    const ratio = contrastRatio(INS[fg], INS[bg]);
    assert.ok(meetsAA(INS[fg], INS[bg]),
      `${fg} (${INS[fg]}) on ${bg} (${INS[bg]}) = ${ratio.toFixed(2)}:1, need 4.5:1`);
  });
}

test("instrument contrast: white on green meets AA large/bold text", () => {
  const ratio = contrastRatio(INS.white, INS.green);
  assert.ok(meetsAA(INS.white, INS.green, { largeText: true }),
    `white on green = ${ratio.toFixed(2)}:1, need 3:1 large`);
});
```

- [ ] **Step 2: Run it**

Run: `cd /var/www/signal && node --test tests/theme-contrast.test.js`
Expected: PASS. If any body pair fails, the hex is wrong (re-derive) OR it's a real contrast gap — surface it, don't weaken.

- [ ] **Step 3: Commit**

```bash
cd /var/www/signal
git add tests/theme-contrast.test.js
git status
git commit -m "test(signal): contrast test pins the Instrument palette pairs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Full verification + visual pass + finish branch

**Files:** none (verification + merge)

- [ ] **Step 1: Unit suite**

Run: `cd /var/www/signal && npm test`
Expected: all `node --test` files pass (incl. `theme-drift`, updated `theme-contrast`, the unchanged `contrast`/`scoring`/`insights`/`db`/`server`/`companyAccess`/`quality`/`templateLoader`). Capture counts.

- [ ] **Step 2: E2E suite**

Run: `cd /var/www/signal && npm run test:e2e`
Expected: all Playwright specs pass (the rewritten `header-waves`, plus `smoke`/`survey`/`grouping`/`company-scoping`). If `survey.spec.js`'s `.postcard-tile` click fails, confirm `dashboard.js` still emits `.postcard-tile` (it should — that class is kept and restyled in `signal.css`).

- [ ] **Step 3: Drift check**

Run: `node /var/www/suite/shared/theme/check-theme-drift.mjs /var/www/signal`
Expected: `ok: /var/www/signal`.

- [ ] **Step 4: Visual pass — run Signal locally**

Boot Signal against a scratch DB (mirror `playwright.config.js`'s env; auth is cache-admitted with a seeded session, or use the e2e seed). Click through and compare to `shared/theme/preview.html` + the live hub:
- `/dashboard` — oscilloscope band, survey list (postcard tiles + series grouping), New survey button
- `/survey` — builder (band, form, run-type radios) → create → result; then a report (band, **radar in Instrument green/grey**, focus cards with amber/green/teal left-borders, axis cards + deltas, per-question bars, guidance)
- `/admin` — band, teams card, key reveal
- `/s/<code>` (respond) — focused card, progress, scale options (selected = green), thanks
- `/license` — band + license text
- Confirm `prefers-reduced-motion` stops the oscilloscope trace and the postcard motion.

- [ ] **Step 5: Final holistic review**

`cd /var/www/signal && git diff feat/suite-auth..feat/instrument-signal`. Confirm: no leftover old-theme refs, no `btn-primary`, every form action / id / `name` preserved, radar reads vars, weather glyphs (`theme-illos.svg`) untouched. Use superpowers:requesting-code-review for a fresh-eyes pass.

- [ ] **Step 6: Merge to the live branch + push**

```bash
cd /var/www/signal
git switch feat/suite-auth
git merge --no-ff feat/instrument-signal -m "Merge Instrument Signal redesign (sub-project 2)"
git push origin feat/suite-auth
git push origin feat/instrument-signal
```

- [ ] **Step 7: Deploy (operator-driven live session)**

On prod: `git pull` in `/var/www/signal` on `feat/suite-auth`, `sudo systemctl restart signal.service`, verify `curl -s -w '\n' localhost:3002/health`, then hard-refresh the browser (no asset cache-buster — same caveat as the hub). Run interactively, one command per block — not part of automated execution.

---

## Notes for the implementer

- **No logic changes.** Markup/CSS/JS-presentation only. Preserve every element `id`, form `name`, route, and API call. If a JS file emits a Signal-specific class (survey-row, postcard-tile, focus-card, scale-option, axis-glyph…), keep the class — it's restyled in `signal.css`.
- **Weather glyphs stay.** `theme-illos.svg` and its `#sun/#cloud/#rain/#wind/#postcard` usages in `dashboard.js`/`survey.js` are report content — do not touch. Only the topbar brand glyph moved to `glyphs.svg#glyph-signal`.
- **Cross-repo:** the drift module and sync script live in `/var/www/suite/shared/theme/`; both repos are on the same box, so absolute paths are fine.
- **Drift guard:** never hand-edit `public/css/instrument-core.css`, `public/js/oscilloscope.js`, `public/illos/glyphs.svg`, or `public/fonts/*` — edit the foundation source and re-run `sync-theme.mjs`. `public/css/signal.css` is Signal-owned and exempt.
- **`.notice` footgun (from the hub):** Instrument `.notice` is `display:flex`. If any Signal notice contains inline markup (`<a>`, `<strong>`), wrap its text in a single `<span>` so it stays one flex item. (Signal's notices are currently plain text or contain a single `<a>` — check `builder-no-teams` which has an inline link; wrap its text in a `<span>` if it renders broken.)
