# Instrument Retro Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin Retro (server-static HTML + vanilla JS) to the Instrument design system — adopt the synced foundation + a Retro-owned `retro.css`, the oscilloscope band, Bricolage/Hanken/IBM Plex Mono fonts, and `data-app="retro"` (teal accent) — with no behavior/API/auth/WebSocket/board-logic/DB changes.

**Architecture:** Replace `theme-core.css` + `theme-retro.css` + `breathing-waves.css` + `app.css` with the synced `instrument-core.css` (drift-checked source of truth) + a Retro-owned `retro.css` (everything Instrument doesn't provide, re-pointed to Instrument tokens). Each static shell adopts `class="ins …" data-app="retro"`, the `.band`/oscilloscope, and the shared component classes; Retro's app-specific components and its own button classes keep their class names, restyled in `retro.css`.

**Tech Stack:** Node ≥20 (CommonJS — `require`), Express 4, better-sqlite3, `ws`, vanilla browser JS, `node:test` unit tests + Playwright e2e. Foundation tooling is ESM under `/var/www/suite/shared/theme/`.

**Repos & paths:** Retro is its OWN repo at `/var/www/retrospective` (remote `github.com/davidmjackson/retrospective2`, service `retrospective.service`, User=retrospective, port 3001, health at `/health`). Foundation lives in `/var/www/suite/shared/theme/` (manifest already maps `retro` → `/var/www/retrospective/public`). **Code commits in `/var/www/retrospective`; this plan + spec live in `/var/www/suite/docs/superpowers/`.** Run Retro unit tests from `/var/www/retrospective` with `npm test` (`node --test tests/theme-contrast.test.js tests/db-schema.test.js tests/upgrade-auth.test.js tests/company-access.test.js`); e2e with `npm run test:e2e` (Playwright).

**Conventions:** Explicit git staging only — never `git add -A`/`.`; `git status` before each commit. Branch `feat/instrument-retro` off Retro's live branch `main`; push to origin as backup; merge back to `main` locally. Co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Token mapping (used throughout `retro.css` tasks)

Retro's old tokens (`theme-core.css` + `theme-retro.css`) → Instrument tokens (from `instrument-core.css`, all under `.ins`):

| Retro old | Instrument | Notes |
|---|---|---|
| `--bg`, `--bg-warm` | `--bone` | page + warm fills |
| `--surface` | `--panel` | cards/panels |
| `--border` | `--line` | hairlines |
| `--border-st` | `--line2` | stronger borders |
| `--ink` | `--ink` | text |
| `--muted` | `--soft` | secondary text |
| `--faint` | `--faint` | tertiary text |
| `--accent`, `--accent-deep` | `--accent` (= `--teal` for `data-app="retro"`) | primary; deep→`--accent` |
| `--accent-on` | `#fff` | text on accent |
| `--accent-soft` | `--tealwash` | accent tint (retro accent is teal) |
| `--ok` / `--ok-bg` | `--green` / `--greenwash` | positive |
| `--warn` / `--warn-bg` | `oklch(0.5 0.12 60)` / `--amberwash` | attention |
| `--err` / `--err-bg` | `oklch(0.5 0.13 25)` / `color-mix(in oklab, oklch(0.5 0.13 25) 12%, var(--panel))` | destructive only |
| `--info` / `--info-bg` | `--teal` / `--tealwash` | neutral/info |
| `--mono` | `'IBM Plex Mono', monospace` | |
| `--serif`, `--sans` | (drop — Instrument `.ins` sets Bricolage headings / Hanken body) | |

Spacing (`--s-*`), radii (`--r-*`), and shadows (`--shadow-*`) are NOT defined by Instrument — `retro.css` re-declares them (Task 2).

**Retro-specific decisions (from the spec):**
- **Accent = teal**, applied automatically by `data-app="retro"` in the foundation. `retro.css` aliases `--accent-soft`→`--tealwash`.
- **Column tags (`.coltag` / `.column-icon`): category-colored chips, column bodies stay neutral.** Start (`+`, "well") = green, Stop (`−`, "improve") = red, Continue (`▶`) = teal. The column card body/border stays a uniform neutral panel.
- **`*wash`-as-translucent footgun:** Instrument `--greenwash`/`--tealwash`/`--amberwash` are **opaque** pale tints. Any fill that must show what is beneath it — the **dragula drag mirror** (`.gu-mirror`), card hover halos, vote-highlight fills, selection glows — must use `oklch(… / alpha)`, never an opaque `*wash` token.
- **Bare `.btn` footgun:** never leave a button on a bare Instrument `.btn`. Retro uses its OWN button classes (`.primary-btn`, `.secondary-btn`, `.icon-btn`, `.link-btn`, `.invite-link-btn`) emitted in both static HTML and JS — **keep those class names and restyle them in `retro.css`** (Task 2) so no markup/JS button churn is needed.
- **`[hidden]` authority:** preserve `[hidden]{display:none!important;}` as a base rule in `retro.css` — it is security-relevant (stops layout `display` classes leaking facilitator-only / dead-link UI to anonymous joiners). Do NOT drop it.
- **`.card` collision:** Instrument core defines `.ins .card` (a padded panel). Retro's board **note** cards are `<li class="card polaroid">` (emitted by `client.js:224`). Re-style the note via a MORE SPECIFIC selector (`.ins .card-list .card`) so it overrides Instrument's panel `.card`; do not redefine the bare `.ins .card`.
- **Classes Instrument already provides — do NOT re-declare** (let the foundation own them): `.card` (base), `.btn`/`.btn-pri`/`.btn-ghost`/`.btn-danger`/`.btn-sm`, `.topbar`, `.brand`/`.mk`, `.band`/`.band-in`/`.eyebrow`/`.waves`, `.pill`, `.notice` (base), `.field`/`.label`/`.input`, `.mono`, `.app-footer`, `.page`, `.shell`, `.stack`, `.row`/`.row-end`, `.spread`, `.center`, `.muted`. Retro keeps its own `.page-content`, `.panel`, and all app-specific classes — those ARE re-declared in `retro.css`.

---

## Task 0: Branch setup (retro repo)

**Files:** none (git only)

- [ ] **Step 1: Branch off the live branch**

```bash
cd /var/www/retrospective
git switch main
git switch -c feat/instrument-retro
git status
```
Expected: on `feat/instrument-retro`, clean tree (ignore the known untracked `.playwright-retros.db`, `test-results/`, `.vscode/`).

- [ ] **Step 2: Push as backup**

```bash
cd /var/www/retrospective
git push -u origin feat/instrument-retro
```

---

## Task 1: Sync foundation into Retro + drift guard + drop old fonts/glyphs

**Files:**
- Create (via sync): `public/css/instrument-core.css`, `public/js/oscilloscope.js`, `public/illos/glyphs.svg`, `public/fonts/*.woff2`
- Create: `tests/theme-drift.test.js`
- Delete: `public/fonts/Fraunces.woff2`, `public/fonts/Inter.woff2`, `public/fonts/JetBrainsMono.woff2`, `public/illos/theme-illos.svg`

- [ ] **Step 1: Write the failing drift test**

Create `/var/www/retrospective/tests/theme-drift.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

test("retro's synced Instrument assets match the foundation source", async () => {
  const mod = await import("/var/www/suite/shared/theme/check-theme-drift.mjs");
  const r = mod.driftReport("/var/www/retrospective");
  assert.deepEqual(r.missing, [], "no missing synced assets");
  assert.deepEqual(r.mismatched, [], "no drifted synced assets");
  assert.equal(r.ok, true);
});
```
(The drift module is ESM; this CommonJS test loads it with dynamic `import()`. The absolute path is correct on this single-box deployment.)

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd /var/www/retrospective && node --test tests/theme-drift.test.js`
Expected: FAIL — `missing` lists `css/instrument-core.css`, `js/oscilloscope.js`, `illos/glyphs.svg`, and the 8 woff2 fonts (not synced yet).

- [ ] **Step 3: Run the sync**

```bash
node /var/www/suite/shared/theme/sync-theme.mjs /var/www/retrospective
```
Expected: `synced 11 assets -> /var/www/retrospective`.

- [ ] **Step 4: Run it — expect PASS**

Run: `cd /var/www/retrospective && node --test tests/theme-drift.test.js`
Expected: PASS.

- [ ] **Step 5: Remove the now-unused old fonts + brand glyph sprite**

`theme-illos.svg` is used in Retro ONLY as the topbar brand glyph (replaced by `glyphs.svg#glyph-retro` in Task 4); it carries no report content.

```bash
cd /var/www/retrospective
git rm public/fonts/Fraunces.woff2 public/fonts/Inter.woff2 public/fonts/JetBrainsMono.woff2 public/illos/theme-illos.svg
```

- [ ] **Step 6: Commit**

```bash
cd /var/www/retrospective
git add public/css/instrument-core.css public/js/oscilloscope.js public/illos/glyphs.svg public/fonts tests/theme-drift.test.js
git status
git commit -m "feat(retro): sync Instrument foundation + drift guard; drop old fonts + theme-illos

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `retro.css` part A — tokens, base, utilities, inputs, buttons, chrome, tags/notices/modal

**Files:**
- Create: `public/css/retro.css` (new, Retro-owned, NOT drift-checked)

This task ports the parts of `theme-core.css` + `theme-retro.css` that Instrument does NOT provide, scoped under `.ins`, re-pointed to Instrument tokens via the mapping table above. Read `public/css/theme-core.css` and `public/css/theme-retro.css` for the exact source rules. **Crucially: restyle Retro's own button classes (`.primary-btn`/`.secondary-btn`/`.link-btn`/`.icon-btn`/`.invite-link-btn`) here** so the shells and JS-emitted buttons need no class churn (read `public/css/app.css` lines ~22-92 + ~1591-1630 + ~1906 for the originals).

- [ ] **Step 1: Create `retro.css` with the token + base + utility + chrome layer**

```css
/* retro.css — Retro-owned layer over instrument-core.css.
   Holds everything Instrument doesn't provide, re-pointed to Instrument tokens.
   Loaded AFTER instrument-core.css. NOT part of the synced foundation. */

.ins{
  /* Spacing + radii + shadows Instrument doesn't define */
  --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-6:24px; --s-8:32px; --s-12:48px;
  --r-sm:6px; --r-md:8px; --r-lg:12px; --r-xl:16px; --r-pill:999px;
  --shadow-sm:0 1px 0 rgba(20,30,28,0.04);
  --shadow-md:0 1px 0 rgba(20,30,28,0.04), 0 8px 24px rgba(20,30,28,0.06);
  --shadow-lg:0 1px 0 rgba(20,30,28,0.04), 0 16px 44px rgba(20,30,28,0.10);
  /* Semantic aliases mapped onto the Instrument palette */
  --ok:var(--green); --ok-bg:var(--greenwash);
  --warn:oklch(0.5 0.12 60); --warn-bg:var(--amberwash);
  --err:oklch(0.5 0.13 25); --err-bg:color-mix(in oklab, oklch(0.5 0.13 25) 12%, var(--panel));
  --info:var(--teal); --info-bg:var(--tealwash);
  --accent-soft:var(--tealwash); --accent-deep:var(--accent); --accent-on:#fff;
  --mono-font:'IBM Plex Mono', ui-monospace, monospace;
  /* Retro column-tag category colours (used by .column-icon / .coltag) */
  --col-start:var(--green); --col-stop:oklch(0.5 0.13 25); --col-continue:var(--teal);
}

/* The HTML [hidden] attribute must always win over layout display classes.
   SECURITY-RELEVANT: keeps facilitator-only / dead-link UI hidden from anon joiners. */
[hidden]{display:none !important;}

/* Utilities not in Instrument (Instrument has .center/.muted) */
.ins .kicker{font-family:var(--mono-font); font-size:0.66rem; font-weight:600; text-transform:uppercase; letter-spacing:0.12em; color:var(--soft);}
.ins .faint{color:var(--faint); font-size:0.85rem;}
.ins .hidden{display:none !important;}

/* Page wrapper (Retro uses .page-content for the main column, not Instrument's .page) */
.ins .page-content{padding:var(--s-6); max-width:1040px; margin:0 auto;}
.ins .page-narrow{max-width:560px;}

/* App-footer link colour (Instrument provides .app-footer; keep its link faint) */
.ins .app-footer a{color:var(--faint);}

/* Bare inputs/selects/textareas (Retro markup uses .field > span, not .input) */
.ins input[type="text"], .ins input[type="email"], .ins input[type="password"],
.ins input[type="number"], .ins select, .ins textarea{
  width:100%; padding:10px 12px; border:1px solid var(--line2); border-radius:var(--r-md);
  background:var(--bone); color:var(--ink); font:inherit;
  transition:border-color 120ms ease, box-shadow 120ms ease;
}
.ins input::placeholder, .ins textarea::placeholder{color:var(--faint);}
.ins input:focus, .ins select:focus, .ins textarea:focus{
  outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--tealwash);
}
.ins .field{display:block; margin-bottom:var(--s-4);}
.ins .field > span{display:block; font-weight:600; font-size:0.85rem; margin-bottom:var(--s-1); color:var(--ink);}

/* Retro's own button classes (kept in markup + JS; restyled onto Instrument) */
.ins .primary-btn, .ins .secondary-btn, .ins .link-btn{
  display:inline-flex; align-items:center; justify-content:center; gap:var(--s-2);
  padding:9px 18px; min-height:38px; border-radius:var(--r-pill);
  font-family:inherit; font-weight:700; font-size:0.92rem; cursor:pointer;
  text-decoration:none; border:1px solid transparent;
  transition:transform 120ms ease, filter 120ms ease, box-shadow 120ms ease,
             border-color 120ms ease, background 120ms ease, color 120ms ease;
}
.ins .primary-btn{background:var(--accent); border-color:var(--accent); color:#fff; box-shadow:0 1px 2px rgba(20,30,28,0.12);}
.ins .primary-btn:hover{filter:brightness(1.08); transform:translateY(-1px); box-shadow:0 4px 12px rgba(20,30,28,0.16);}
.ins .secondary-btn{background:var(--panel); border-color:var(--line2); color:var(--ink);}
.ins .secondary-btn:hover{border-color:var(--accent); color:var(--accent); transform:translateY(-1px);}
.ins .link-btn{background:transparent; border-color:transparent; color:var(--accent); min-height:auto; padding:6px 8px;}
.ins .link-btn:hover{text-decoration:underline;}
.ins .primary-btn:disabled, .ins .secondary-btn:disabled, .ins .link-btn:disabled{opacity:0.55; cursor:not-allowed; transform:none; filter:none;}
.ins .btn-block{width:100%;}

/* Tags + notice variants (Instrument has base .notice + .pill only) */
.ins .tag{display:inline-block; padding:3px 9px; border-radius:var(--r-sm); background:var(--bone); color:var(--soft); font-size:0.7rem; font-weight:700; text-transform:uppercase; letter-spacing:0.06em;}
.ins .tag-ok{background:var(--ok-bg); color:var(--ok);}
.ins .tag-warn{background:var(--warn-bg); color:var(--warn);}
.ins .tag-err{background:var(--err-bg); color:var(--err);}
.ins .tag-info{background:var(--info-bg); color:var(--info);}
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

- [ ] **Step 2: Sanity-check it parses (braces balanced)**

Run: `cd /var/www/retrospective && node -e "const c=require('fs').readFileSync('public/css/retro.css','utf8');const o=(c.match(/{/g)||[]).length,cl=(c.match(/}/g)||[]).length;if(o!==cl)throw new Error('brace mismatch '+o+'/'+cl);console.log('braces ok',o)"`
Expected: `braces ok <n>` (balanced).

- [ ] **Step 3: Commit**

```bash
cd /var/www/retrospective
git add public/css/retro.css
git status
git commit -m "feat(retro): retro.css part A — tokens, base, inputs, buttons, chrome, tags/notices/modal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `retro.css` part B — Retro app components (re-tokenized)

**Files:**
- Modify: `public/css/retro.css` (append)

Append all of Retro's app-specific components, re-pointed to Instrument tokens via the mapping table, scoped under `.ins`. **This is a faithful re-tokenization of existing, working rules in `public/css/app.css` (and the `.polaroid` rule in `theme-retro.css`)** — read the source files and apply the mapping; do not redesign layout. Scope every selector with a leading `.ins `.

Component groups to migrate (every class from `app.css`, grouped):
- **Page chrome:** `.app-header`, `.page-header`, `.page-content`(done in A), `.topbar-lead`, `.header-actions`, `.menu-link`, `.back-link`, `.status`, `.status-pill`, `.eyebrow` (skip — Instrument owns it), `.title-row`, `.session-header`, `.session-title`.
- **Lobby:** `.lobby-page`, `.overview-grid`, `.overview-card`, `.overview-icon` (+ `.purple`/`.green` variants → use `--accent`/`--green`), `.panel`, `.panel-header`, `.panel-copy`, `.create-retro-panel`, `.retro-list`, `.retro-item`, `.retro-info`, `.retro-actions`, `.retro-empty`, `.sort-controls`, `.field-row`, `.field-hint`, `.field-value`.
- **Board:** `.retro-page`, `.retro-shell`, `.retro-workspace`, `.health-strip`, `.health-card`, `.health-status`(+`.is-ready`), `.health-status-detail`, `.instruction-banner`, `.banner-dismiss`, `.board`, `.column`, `.column-start`/`.column-stop`/`.column-continue`, `.column-header`, `.column-title`, `.column-icon`, `.column-count`, `.column-add`, `.card-list`, `.card-details`, `.card-footer`, `.card-controls`, `.polaroid`/`.polaroid-body` (note card — see worked example), `.pin` (hide), `.avatar`, `.vote-btn`, `.vote-count`, `.create-action-btn`, `.session-sidebar`, `.sidebar-panel`, `.sidebar-heading`, `.timer`, `.timer-display`, `.timer-readout`, `.timer-set`, `.timer-actions`, `.timer-controls`, `.retro-health`, `.retro-status`, `.retro-info`, `.participant-list`, `.participant-avatar`, `.presence`, `.read-only`, `.instruction-list`, `.instruction-section`, `.instructions-content`, `.instructions-dialog`, `.note-details`, `.note-dialog`(+header/icons), `.invite-link-btn` (restyle as a small ghost button), `.tips-bar`, `.tips-dismiss`, `.form-grid`.
- **Actions report:** `.actions-page`, `.actions-board`, `.actions-summary`, `.action-card`, `.action-list`, `.action-meta`, `.action-fields`, `.action-field`, `.action-notes`, `.action-save-row`, `.action-buttons`, `.action-dialog`, `.save-status`(+`.is-error`/`.is-success` → `--err`/`--ok`), `.kanban-column`, `.kanban-header`, `.team-section`, `.preview-column`.
- **Dialogs / misc:** `.confirm-dialog`/`.confirm-content`, `.dialog-actions`, `.dialog-close`, `.dialog-header`, `.icon-btn`/`.icon-btn-close`/`.icon-btn-save` (restyle), `.error-text`, `.title-row`, `.key-badge`/`.key-panel`/`.key-reveal-*`/`.key-warning` (lobby key reveal), `.activity`/`.activity-card`, `.admin-page`/`.admin-summary`, `.table-wrap`/`.team-table`.
- **Legal:** `.legal-page`, `.legal-shell`, `.legal-panel`, `.legal-updated`, `.legal-back-link`.
- **Login (if present/used):** `.login-band`/`.login-footer`/`.login-hero`/`.login-preview`/`.login-shell`, `.auth-card`/`.auth-form`/`.auth-header` — re-tokenize if still referenced by any served page; otherwise they are harmless dead rules (Retro auth is hub-delegated). Keep faithful.

Apply these replacements while migrating each rule: `var(--border)`→`var(--line)`, `var(--border-st)`→`var(--line2)`, `var(--surface)`→`var(--panel)`, `var(--bg)`/`var(--bg-warm)`→`var(--bone)`, `var(--muted)`→`var(--soft)`, `var(--accent-soft)`→`var(--tealwash)`, `var(--mono)`→`var(--mono-font)`; `--ok`/`--warn`/`--info`/`--err`/`--accent`/`--accent-deep`/`--faint` are aliased in Task 2 so they resolve correctly.

- [ ] **Step 1: Worked example — the column tags (category colours) + neutral column body**

The columns are uniform neutral panel cards; only the `.column-icon` chip carries the category colour. Append:

```css
.ins .board{display:grid; grid-template-columns:repeat(3,1fr); gap:var(--s-4); align-items:start;}
.ins .column{background:var(--panel); border:1px solid var(--line2); border-radius:var(--r-lg); padding:var(--s-4); display:flex; flex-direction:column; gap:var(--s-3); box-shadow:var(--shadow-sm);}
.ins .column-header{display:flex; align-items:center; gap:var(--s-3);}
.ins .column-title{display:flex; align-items:center; gap:var(--s-2); font-weight:700;}
.ins .column-icon{display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:8px; color:#fff; font-weight:700; flex-shrink:0;}
.ins .column-start  .column-icon{background:var(--col-start);}
.ins .column-stop   .column-icon{background:var(--col-stop);}
.ins .column-continue .column-icon{background:var(--col-continue);}
.ins .column-count{margin-left:auto; font-family:var(--mono-font); font-size:0.78rem; color:var(--soft); background:var(--bone); border-radius:var(--r-pill); padding:2px 10px;}
.ins .card-list{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--s-3); min-height:24px;}
.ins .column-add{align-self:flex-start; background:transparent; border:1px dashed var(--line2); color:var(--soft); border-radius:var(--r-md); padding:6px 12px; cursor:pointer; font:inherit;}
.ins .column-add:hover{border-color:var(--accent); color:var(--accent);}
```

- [ ] **Step 2: Worked example — the note card (overrides Instrument `.card`) + hide the pin + alpha hover halo**

`client.js` emits `<li class="card polaroid">…<div class="pin pin-*">`. Use `.ins .card-list .card` so it beats Instrument's panel `.card`; hover halo is a translucent `oklch(.../alpha)`, NOT a `*wash`. Append:

```css
.ins .card-list .card{background:var(--panel); border:1px solid var(--line); border-radius:var(--r-md); padding:var(--s-3); box-shadow:var(--shadow-sm); transition:border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;}
.ins .card-list .card:hover{border-color:var(--accent); box-shadow:0 0 0 3px oklch(0.58 0.088 206 / 0.16), var(--shadow-sm); transform:translateY(-1px);}
.ins .polaroid-body{font-family:inherit; color:var(--ink); margin:0;}
.ins .pin{display:none;}
.ins .card-footer{display:flex; align-items:center; gap:var(--s-2); margin-top:var(--s-2);}
.ins .avatar{display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; border-radius:var(--r-pill); background:var(--tealwash); color:var(--accent); font-size:0.7rem; font-weight:700;}
.ins .vote-btn{background:transparent; border:1px solid var(--line2); border-radius:var(--r-pill); padding:2px 10px; cursor:pointer; font:inherit; color:var(--soft);}
.ins .vote-btn:hover{border-color:var(--accent); color:var(--accent);}
.ins .vote-count{font-family:var(--mono-font); font-size:0.78rem; color:var(--soft);}
```

- [ ] **Step 3: Worked example — the dragula drag mirror (translucent, NOT a wash)**

`dragula` clones the dragged card into `.gu-mirror` on `<body>`. Give it a translucent lift so the board shows through. Append:

```css
.ins .gu-mirror{background:var(--panel); border:1px solid var(--accent); border-radius:var(--r-md); padding:var(--s-3); box-shadow:0 8px 24px oklch(0.235 0.013 250 / 0.18); opacity:0.95; list-style:none;}
.gu-mirror{list-style:none;}
.ins .gu-transit{opacity:0.4;}
```
(`.gu-mirror` is appended to `<body>`, which has `class="ins …"`, so `.ins .gu-mirror` matches.)

- [ ] **Step 4: Migrate ALL remaining component groups** listed above the same way (faithful copy from `app.css` + `.ins ` prefix + token swap + the column/note/mirror rules already done). Re-tokenize `.save-status.is-error`→`--err`, `.save-status.is-success`→`--ok`, `.overview-icon.purple`→`var(--accent)`, `.overview-icon.green`→`var(--green)`. Restyle `.invite-link-btn`/`.icon-btn`/`.icon-btn-save`/`.icon-btn-close` as small bordered/ghost buttons (mirror `.secondary-btn`). Do NOT re-declare the classes Instrument owns (listed in the header).

- [ ] **Step 5: Sanity-check braces balance**

Run: `cd /var/www/retrospective && node -e "const c=require('fs').readFileSync('public/css/retro.css','utf8');const o=(c.match(/{/g)||[]).length,cl=(c.match(/}/g)||[]).length;if(o!==cl)throw new Error('mismatch '+o+'/'+cl);console.log('braces ok',o)"`
Expected: balanced.

- [ ] **Step 6: Commit**

```bash
cd /var/www/retrospective
git add public/css/retro.css
git status
git commit -m "feat(retro): retro.css part B — app components re-tokenized (columns, notes, drag, timer, lobby, actions)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Reskin the five static shells

**Files:**
- Modify: `public/lobby.html`, `public/retrospective.html`, `public/actions.html`, `public/join.html`, `public/license.html`

Mechanical transformation applied to every shell:
- In `<head>`: replace the four CSS links (`theme-core.css`, `theme-retro.css`, `app.css`, `breathing-waves.css`) with exactly `<link rel="stylesheet" href="/css/instrument-core.css">` then `<link rel="stylesheet" href="/css/retro.css">`. **Keep** any `vendor/dragula/dragula.min.css` link (board + actions) as the FIRST link.
- `<body>`: keep the page-specific class, add `ins` + `data-app`, drop the generic `page`/`cork-bg`:
  - `class="page lobby-page"` → `class="ins lobby-page" data-app="retro"`
  - `class="retro-page cork-bg"` → `class="ins retro-page" data-app="retro"`
  - `class="page actions-page"` → `class="ins actions-page" data-app="retro"`
  - `class="page legal-page"` → `class="ins legal-page" data-app="retro"`
  - join (`class="page lobby-page"`) → `class="ins lobby-page" data-app="retro"`
- Brand glyph: `<svg class="brand-glyph" aria-hidden="true"><use href="/illos/theme-illos.svg#pin"/></svg>` → `<svg class="mk" width="22" height="22" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-retro"/></svg>`.
- Header band: `<header class="header-band" data-breathing-waves data-wave-palette="retro" role="none"><canvas></canvas><div class="header-content"><p class="eyebrow">X</p><h1 class="header-title" …>Y</h1>…<p class="header-subtitle" …>Z</p></div></header>` → `<div class="band"><div class="waves"></div><div class="band-in"><div class="eyebrow">X</div><h1 …>Y</h1>…<p class="sub" …>Z</p></div></div>` (preserve any inner element ids and extra children like `.title-row`).
- Script tail: replace `<script src="breathing-waves.js"></script>` with `<script type="module" src="/js/oscilloscope.js"></script>` (keep all other scripts + order).
- Add before `</body>`: `<footer class="app-footer"><a href="/license">License</a></footer>` (all five shells).

- [ ] **Step 1: Rewrite `public/join.html`** (focused flow, NO band — full file)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Join a retro</title>
  <link rel="stylesheet" href="/css/instrument-core.css" />
  <link rel="stylesheet" href="/css/retro.css" />
</head>
<body class="ins lobby-page" data-app="retro">
  <main class="page-content" style="max-width:480px;padding-top:48px;">
    <section class="panel">
      <h1>Join the retro</h1>
      <p id="join-board-title" class="panel-copy">Checking your link…</p>
      <p id="join-error" class="error-text" hidden></p>
      <form id="join-form" class="form-grid" hidden>
        <label class="field">
          <span>Your name</span>
          <input id="join-name" type="text" placeholder="Your name" maxlength="80" required />
        </label>
        <button type="submit" class="primary-btn">Join board</button>
      </form>
    </section>
  </main>
  <footer class="app-footer"><a href="/license">License</a></footer>
  <script src="/join.js"></script>
</body>
</html>
```
(The inline `style` attribute is preserved; Retro's CSP allows it today since the page already uses it.)

- [ ] **Step 2: Rewrite `public/license.html`** (band + page-narrow; keep ALL the `<h2>`/`<p>` licence body text verbatim — full file)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Retrospective Licence</title>
    <link rel="stylesheet" href="/css/instrument-core.css" />
    <link rel="stylesheet" href="/css/retro.css" />
    <script type="module" src="/js/oscilloscope.js"></script>
  </head>
  <body class="ins legal-page" data-app="retro">
    <div class="band"><div class="waves"></div><div class="band-in">
      <div class="eyebrow">Legal</div>
      <h1>Retrospective App Proprietary Free-Use Licence</h1>
      <p class="sub legal-updated">Copyright (c) 2026 David Jackson. All rights reserved.</p>
    </div></div>

    <main class="legal-shell page-content page-narrow">
      <section class="panel legal-panel">
        <p class="brand"><svg class="mk" width="22" height="22" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-retro"/></svg> <span>Retrospective</span></p>

        <h2>Developer and Owner</h2>
        <p>
          This application and its source code are the property of David Jackson,
          the developer and copyright owner.
        </p>

        <h2>Free Use of the Application</h2>
        <p>
          The Retrospective app may be used free of charge by end users to run
          and manage retrospectives through an authorised hosted instance of the
          application.
        </p>

        <h2>Restrictions</h2>
        <p>
          No permission is granted to copy, reproduce, publish, distribute,
          sublicense, sell, lease, modify, reverse engineer, create derivative
          works from, or replicate the source code, design, structure, workflows,
          or application as a competing or substantially similar product.
        </p>

        <h2>Repository Access</h2>
        <p>
          Access to the source code repository, if granted, is for review,
          maintenance, deployment, or authorised collaboration only. Repository
          access does not grant ownership or reuse rights.
        </p>

        <h2>Ownership</h2>
        <p>
          All intellectual property rights in the application, source code,
          design, database structure, documentation, and related assets remain
          with David Jackson unless explicitly agreed in writing.
        </p>

        <h2>No Warranty</h2>
        <p>
          The application is provided "as is", without warranty of any kind,
          express or implied, including but not limited to warranties of fitness
          for a particular purpose, availability, security, or non-infringement.
        </p>

        <h2>Limitation of Liability</h2>
        <p>
          To the fullest extent permitted by law, the developer shall not be
          liable for any claim, damages, loss of data, loss of business, or other
          liability arising from use of the application.
        </p>

        <h2>Written Permission</h2>
        <p>
          Any use outside this licence requires prior written permission from
          David Jackson.
        </p>

        <a class="secondary-btn legal-back-link" href="/">Return to sign in</a>
      </section>
    </main>
    <footer class="app-footer"><a href="/license">License</a></footer>
  </body>
</html>
```
(The oscilloscope module is included exactly ONCE, in `<head>` — `type="module"` defers it, so it runs after parse and finds `.waves`.)

- [ ] **Step 3: Edit `public/lobby.html`** (targeted chrome edits — body markup unchanged)

Apply: head links (4→2), `<body class="ins lobby-page" data-app="retro">`, brand glyph swap, band swap, footer add, script-tail swap. The band becomes:

```html
    <div class="band"><div class="waves"></div><div class="band-in">
      <div class="eyebrow">Workspace</div>
      <h1>Retrospectives</h1>
      <p class="sub" id="user-summary">Loading user...</p>
    </div></div>
```
And the tail (lines around 97-99) becomes:

```html
    <script src="lobby.js"></script>
    <script type="module" src="/js/oscilloscope.js"></script>
    <script src="/auth-client/heartbeat.js"></script>
  </body>
```
Add `<footer class="app-footer"><a href="/license">License</a></footer>` immediately before the closing `</body>` (after the `</main>`, before the scripts is also fine). The topbar `.brand` `<p>` and its `<span>Retrospective</span>` are kept; only the inner `<svg>` glyph changes.

- [ ] **Step 4: Edit `public/actions.html`** (targeted chrome edits — body markup unchanged)

Apply the same transformation. Keep the FIRST `<link rel="stylesheet" href="vendor/dragula/dragula.min.css" />`, then the two Instrument links. Band:

```html
    <div class="band"><div class="waves"></div><div class="band-in">
      <div class="eyebrow">Report</div>
      <h1>Actions Report</h1>
      <p class="sub">Track actions across every team and retrospective.</p>
    </div></div>
```
Tail:

```html
    <script src="vendor/dragula/dragula.min.js"></script>
    <script src="actions.js"></script>
    <script type="module" src="/js/oscilloscope.js"></script>
    <script src="/auth-client/heartbeat.js"></script>
  </body>
```
Add the footer before `</body>`. Brand glyph swap as above.

- [ ] **Step 5: Edit `public/retrospective.html`** (targeted chrome edits — board body unchanged)

Apply the same transformation. Keep the FIRST `vendor/dragula/dragula.min.css` link. `<body class="ins retro-page" data-app="retro">` (drop `cork-bg`). The band preserves its `.title-row` children + ids:

```html
    <div class="band"><div class="waves"></div><div class="band-in">
      <div class="eyebrow">Session</div>
      <div class="title-row">
        <h1 id="retro-title">Retrospective</h1>
        <div class="retro-status" id="retro-status"></div>
        <button id="copy-invite-link" type="button" class="invite-link-btn" hidden>Copy invite link</button>
      </div>
      <p class="sub" id="retro-meta">Loading retro details...</p>
    </div></div>
```
Tail:

```html
    <script src="vendor/dragula/dragula.min.js"></script>
    <script src="client.js"></script>
    <script type="module" src="/js/oscilloscope.js"></script>
    <script src="/auth-client/heartbeat.js"></script>
  </body>
```
Add the footer before `</body>`. Brand glyph swap as above (the topbar `.brand` and `.menu-link ☰` are kept).

- [ ] **Step 6: Verify no stale references remain in any shell**

Run: `cd /var/www/retrospective && grep -rlE "theme-core|theme-retro|/css/app.css|breathing-waves|brand-glyph|header-band|data-breathing|theme-illos" public/*.html`
Expected: NO output (all five shells migrated).

- [ ] **Step 7: Commit**

```bash
cd /var/www/retrospective
git add public/lobby.html public/retrospective.html public/actions.html public/join.html public/license.html
git status
git commit -m "feat(retro): reskin static shells to Instrument chrome + oscilloscope band

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Delete superseded CSS/JS + reference guards

**Files:**
- Delete: `public/breathing-waves.js`, `public/css/breathing-waves.css`, `public/css/theme-core.css`, `public/css/theme-retro.css`, `public/css/app.css`

No JS logic changes are needed — Retro's JS emits its own class names (`primary-btn`, `secondary-btn`, `card polaroid`, `pin`, `kanban-column`, …), all restyled in `retro.css`. There are no `btn-primary` literals in Retro's JS.

- [ ] **Step 1: Confirm no `btn-primary` literal anywhere in JS** (Retro never used it)

Run: `cd /var/www/retrospective && grep -rn "btn-primary" public/*.js`
Expected: NO output.

- [ ] **Step 2: Delete the superseded files**

```bash
cd /var/www/retrospective
git rm public/breathing-waves.js public/css/breathing-waves.css public/css/theme-core.css public/css/theme-retro.css public/css/app.css
```

- [ ] **Step 3: Confirm nothing still references them**

Run: `cd /var/www/retrospective && grep -rnE "breathing-waves|theme-core|theme-retro|/css/app.css" public/ | grep -vE "retro.css|instrument-core"`
Expected: NO output.

- [ ] **Step 4: Commit**

```bash
cd /var/www/retrospective
git status
git commit -m "feat(retro): remove breathing-waves + old theme/app CSS (superseded by Instrument)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Update the header e2e spec for the oscilloscope band

**Files:**
- Modify: `tests/e2e/header-waves.spec.js` (rewrite to test the Instrument band)

The old spec asserts `.header-band[data-breathing-waves]` + a `<canvas>`. The oscilloscope mounts an `<svg>` into `.band .waves` instead. **First read the existing spec** to reuse its auth/seed helper imports and page list (it imports from `tests/e2e/helpers/_auth.js` / `seed.js` and visits lobby/board/actions/license). Preserve the auth + navigation it already does; only change what it asserts about the header.

- [ ] **Step 1: Rewrite `tests/e2e/header-waves.spec.js`** to assert the band

Replace the header assertions with this shape (keep the file's existing helper imports + the way it authenticates + which pages it visits):

```js
// For each banded page the spec already visits (lobby, board, actions, license):
const band = page.locator(".band").first();
await expect(band).toBeVisible();
// oscilloscope.js mounts an <svg> trace into the empty .waves container:
await expect.poll(async () => band.locator(".waves svg").count()).toBeGreaterThan(0);
```
Remove the old `[data-breathing-waves] canvas` / `.header-band[data-breathing-waves]` locators. Keep `join.html` OUT of the banded list (join has no band). If the spec attaches `pageerror`/console-error listeners, keep them and keep asserting zero errors.

- [ ] **Step 2: Commit** (the run happens in Task 8's full e2e pass)

```bash
cd /var/www/retrospective
git add tests/e2e/header-waves.spec.js
git status
git commit -m "test(retro): header e2e targets the oscilloscope band, not breathing-waves

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Update the palette contrast test

**Files:**
- Modify: `tests/theme-contrast.test.js`

The test pins the OLD Retro hexes (now unused). `lib/contrast` only parses hex, so replace the map with the Instrument palette's hex equivalents and check the pairs Retro actually relies on. **First read the existing test** to match its import path for `lib/contrast` and its assertion helpers (`contrastRatio`/`meetsAA` or similar). Derive the exact hexes from `instrument-core.css`'s oklch tokens (open the synced CSS in browser devtools and read `getComputedStyle`, or use any oklch→hex converter) — do not guess. Mark the white-on-accent button pair as large text since `--teal`/`--green` at L≈0.45-0.58 meets 3:1 (large/bold) but may be borderline for 4.5:1 body. **If a body pair fails AA, do not weaken the test — report it as a real accessibility finding.**

- [ ] **Step 1: Rewrite `tests/theme-contrast.test.js`** with the Instrument pairs

```js
// tests/theme-contrast.test.js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { contrastRatio, meetsAA } = require("../lib/contrast"); // match the existing import

// Instrument palette pairs Retro relies on. Hexes are the sRGB equivalents of
// the oklch tokens in instrument-core.css — derive exactly; confirm vs the synced CSS.
const INS = {
  bone:      "#F2F1EC",  // --bone
  panel:     "#FFFFFF",  // --panel
  ink:       "#2B2E33",  // --ink
  soft:      "#5F6770",  // --soft
  faint:     "#8A8E94",  // --faint
  teal:      "#3A8FA0",  // --teal  oklch(0.58 0.088 206) — retro accent
  tealwash:  "#E2F1F3",  // --tealwash
  green:     "#1F7A5C",  // --green
  greenwash: "#E2F3EA",  // --greenwash
  white:     "#FFFFFF"
};

const BODY_PAIRS = [
  ["ink",  "bone"],
  ["ink",  "panel"],
  ["soft", "panel"],
  ["soft", "bone"],
  ["green", "greenwash"]
];

for (const [fg, bg] of BODY_PAIRS) {
  test(`instrument contrast: ${fg} on ${bg} meets AA body text`, () => {
    const ratio = contrastRatio(INS[fg], INS[bg]);
    assert.ok(meetsAA(INS[fg], INS[bg]),
      `${fg} (${INS[fg]}) on ${bg} (${INS[bg]}) = ${ratio.toFixed(2)}:1, need 4.5:1`);
  });
}

test("instrument contrast: white on teal meets AA large/bold text", () => {
  const ratio = contrastRatio(INS.white, INS.teal);
  assert.ok(meetsAA(INS.white, INS.teal, { largeText: true }),
    `white on teal = ${ratio.toFixed(2)}:1, need 3:1 large`);
});
```
(If the existing `meetsAA` signature differs — e.g. no options arg — adapt: use a `contrastRatio(...) >= 3` assertion for the large-text pair instead. Match the real API in `lib/contrast.js`.)

- [ ] **Step 2: Run it**

Run: `cd /var/www/retrospective && node --test tests/theme-contrast.test.js`
Expected: PASS. If a body pair fails, the hex is wrong (re-derive) OR it's a real contrast gap — surface it, don't weaken.

- [ ] **Step 3: Commit**

```bash
cd /var/www/retrospective
git add tests/theme-contrast.test.js
git status
git commit -m "test(retro): contrast test pins the Instrument palette pairs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Full verification + visual pass + finish branch

**Files:** none (verification + merge)

- [ ] **Step 1: Unit suite**

Run: `cd /var/www/retrospective && npm test`
Expected: all `node --test` files pass — `theme-drift`, updated `theme-contrast`, and the unchanged `db-schema`/`upgrade-auth`/`company-access`. (Add `tests/theme-drift.test.js` to the `npm test` script's file list if it isn't picked up — confirm the `test` script in `package.json` includes it; if not, append it.)

- [ ] **Step 2: E2E suite**

Run: `cd /var/www/retrospective && npm run test:e2e`
Expected: all Playwright specs pass — the rewritten `header-waves`, plus `retro-smoke` and `retro-sharing`. If a smoke/sharing selector breaks, confirm it targets a presentational class that moved; update ONLY presentational selectors. **Never weaken** the tenancy / anon-cannot-facilitate / dead-link-join-form-hidden assertions.

- [ ] **Step 3: Drift check**

Run: `node /var/www/suite/shared/theme/check-theme-drift.mjs /var/www/retrospective`
Expected: `ok: /var/www/retrospective`.

- [ ] **Step 4: Visual pass — run Retro locally**

Boot Retro against a scratch DB (mirror `playwright.config.js`'s env / use the e2e seed). Click through and compare to `shared/theme/preview.html` + the live Signal app:
- `/lobby` — oscilloscope band, overview cards, session form, past-retros list, create-retro panel
- `/r/<board>` (board) — band with title-row + invite button, health strip stat cards, instruction banner, **3 columns with green/red/teal coltag chips**, note cards, voting, **drag a card (translucent mirror, board shows through)**, timer card, participants
- `/actions` — band, kanban columns (To do / In progress / Done), action cards
- `/join?token=…` — focused card, no band, name + Join (and the closed/dead-link state still hides the form)
- `/license` — band + licence text + footer link
- Confirm `prefers-reduced-motion` stops the oscilloscope trace.

- [ ] **Step 5: Final holistic review**

`cd /var/www/retrospective && git diff main..feat/instrument-retro`. Confirm: no leftover old-theme refs, no bare `.btn` without a variant, every element `id` / form `name` / route / WS call preserved, the `[hidden]` rule present, no `*wash` used where translucency is required (mirror/halo/selection). Use superpowers:requesting-code-review for a fresh-eyes pass.

- [ ] **Step 6: Merge to the live branch + push**

```bash
cd /var/www/retrospective
git switch main
git merge --no-ff feat/instrument-retro -m "Merge Instrument Retro redesign (sub-project 3)"
git push origin main
git push origin feat/instrument-retro
```

- [ ] **Step 7: Deploy (operator-driven live session)**

On prod: `git pull` in `/var/www/retrospective` on `main`, `sudo systemctl restart retrospective.service`, verify `curl -s -w '\n' localhost:3001/health`, then hard-refresh the browser (no asset cache-buster — same caveat as the hub and Signal). No npm install / no migration expected (views/CSS/JS only). Run interactively, one command per block — NOT part of automated execution.

---

## Notes for the implementer

- **No logic changes.** Markup/CSS/JS-presentation only. Preserve every element `id`, form `name`, route, WebSocket message, and API call. Retro's JS emits Retro-specific classes (`primary-btn`, `secondary-btn`, `card polaroid`, `pin`, `column-icon`, `kanban-column`, `action-card`, `avatar`, `vote-btn`…) — keep them; they are restyled in `retro.css`.
- **Brand glyph only.** `theme-illos.svg#pin` was the only `theme-illos` use; it moves to `glyphs.svg#glyph-retro`. The file is deleted in Task 1.
- **Cross-repo:** the drift module and sync script live in `/var/www/suite/shared/theme/`; both repos are on the same box, so absolute paths are fine.
- **Drift guard:** never hand-edit `public/css/instrument-core.css`, `public/js/oscilloscope.js`, `public/illos/glyphs.svg`, or `public/fonts/*` — edit the foundation source and re-run `sync-theme.mjs`. `public/css/retro.css` is Retro-owned and exempt.
- **`.card` specificity:** Retro's note cards are `<li class="card polaroid">`; their styling MUST out-specify Instrument's base `.ins .card` (use `.ins .card-list .card`). Verify in the visual pass that note cards are tight sticky-note cards, not the big padded panel card.
- **`*wash` is opaque:** the dragula mirror, hover halos, vote/selection fills use `oklch(.../alpha)`, never a `*wash` token (SP2 footgun).
- **`[hidden]` is security-relevant:** keep the base `[hidden]{display:none!important;}` rule (Task 2) — it stops facilitator-only and dead-link UI leaking to anonymous joiners.
- **`.notice` footgun (from the hub):** Instrument `.notice` is `display:flex`. If any Retro notice contains inline markup (`<a>`, `<strong>`), wrap its text in a single `<span>` so it stays one flex item.
