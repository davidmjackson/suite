# Instrument Raid Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin Raid (server-static HTML + vanilla JS) to the Instrument design system — adopt the synced foundation + a Raid-owned `raid.css`, a `.topbar`, the oscilloscope band, Bricolage/Hanken/IBM Plex Mono fonts, and `data-app="raid"` (amber accent) with a **vivid** RAG status palette — with no behaviour/API/`/extract`/quota/export changes. This is the LAST surface; on deploy the Instrument redesign program is complete.

**Architecture:** Replace `theme-core.css` + `theme-raid.css` + `app.css` + `breathing-waves.css` with the synced `instrument-core.css` (drift-checked source of truth) + a Raid-owned `raid.css` (everything Instrument doesn't provide, re-pointed to Instrument tokens via a single token-alias block so the component rules port with minimal churn). Both static shells adopt `class="ins …" data-app="raid"`, a foundation `.topbar` (brand glyph + Sign out), the `.band`/oscilloscope, and the shared component vocabulary. Raid's BEM button classes keep their names, restyled in `raid.css`. RAID category pills stay calm (washes); RAG/severity/conflict pills go **vivid** (a saturated red/amber/green triad) — the one place Raid is louder than its siblings, justified by at-a-glance scannability.

**Tech Stack:** Node ≥20 (CommonJS — `require`), Express 5, hub-delegated auth (`@suite/auth-client`), vanilla browser JS, `node:test` unit tests (`tests/*.unit.test.js`) + Playwright e2e. Foundation tooling is ESM under `/var/www/suite/shared/theme/`.

**Repos & paths:** Raid is its OWN repo at `/var/www/raid` (remote `github.com/davidmjackson/raid.git`, service `raid.service`, **User=raid**, env `/var/www/raid/.env`, port 3003, health at `/health`, public domain `sprintraid.uk` via Apache reverse-proxy). Foundation lives in `/var/www/suite/shared/theme/` (manifest already maps `raid` → `/var/www/raid/public`, and `instrument-core.css` already resolves `.ins[data-app="raid"] { --accent: var(--amber) }`). **Code commits in `/var/www/raid`; this plan + spec live in `/var/www/suite/docs/superpowers/`.** Run Raid unit tests from `/var/www/raid` with `npm test` (`node --test tests/*.unit.test.js` — new tests MUST be named `*.unit.test.js` to be picked up by this glob); e2e with `npm run test:e2e` (Playwright).

**Conventions:** Explicit git staging only — never `git add -A`/`.`; `git status` before each commit. Branch `feat/instrument-raid` off Raid's live branch **`master`** (not `main`); push to origin as backup; merge back to `master` locally. Co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Token mapping (used throughout `raid.css` tasks)

Raid's old tokens (`theme-core.css` + `theme-raid.css`, all hex) → Instrument tokens (from `instrument-core.css`, all under `.ins`). `raid.css` **aliases the old names** in one block (Task 2) so the ported component rules resolve with minimal edits.

| Raid old | Instrument | Notes |
|---|---|---|
| `--bg`, `--bg-warm` | `--bone` | page + warm fills |
| `--surface` | `--panel` | cards/panels |
| `--border`, `--border-st` | `--line2` | card borders/hairlines |
| `--ink` | `--ink` | text |
| `--muted` | `--soft` | secondary text |
| `--faint` | `--faint` | tertiary text |
| `--accent` | `--accent` (= `--amber` for `data-app="raid"`) | accent (band-derived, links, focus) |
| `--accent-on` | `--ink` | **text on amber is INK** — white on amber fails AA (~3:1) |
| `--accent-deep` | `oklch(0.46 0.10 66)` | deep amber for accent text/links on light bg |
| `--accent-soft` | `oklch(0.70 0.125 72 / 0.16)` | **translucent** amber (focus ring / privacy chip / deps pill) — NOT a `*wash` |
| `--accent-btn` | `oklch(0.77 0.11 78)` | **Raid-local** — a slightly lighter amber so the INK primary-button label clears AA |
| `--serif` | `'Bricolage Grotesque', sans-serif` | headings (Instrument also sets `h1/h2/h3` to Bricolage) |
| `--sans` | `'Hanken Grotesk', system-ui, -apple-system, sans-serif` | body |
| `--mono` | `'IBM Plex Mono', ui-monospace, monospace` | |

**Status colours — two tiers (the core Raid decision):**

- **CATEGORY identity pills** (`.raid-card__pill--*`) stay **calm** (muted washes): risks→`--err`/`--err-bg` (calm red), assumptions→`--info`/`--info-bg` (teal), issues→`--warn`/`--warn-bg` (calm amber), dependencies→`--accent-soft`/`--accent-deep` (amber). These are headers, not status.
- **RAG / SEVERITY / CONFLICT pills** (`.raid-item__rag--*`, `.raid-item__sev-label--*`, conflict pill/callout/corner-chip, `.raid-card--conflict`) go **VIVID** — the saturated triad below. This is the scannable status layer.

`raid.css` calm aliases: `--ok`/`--ok-bg`→`--green`/`--greenwash`; `--warn`/`--warn-bg`→`oklch(0.5 0.12 60)`/`--amberwash`; `--err`/`--err-bg`→`oklch(0.5 0.15 25)`/`oklch(0.95 0.04 25)` (foundation has no red); `--info`/`--info-bg`→`--teal`/`--tealwash`.

`raid.css` vivid RAG triad (values **tunable in the visual pass — keep the contrast test green**):

```
--rag-red:oklch(0.55 0.20 25);    --rag-red-on:#fff;
--rag-amber:oklch(0.80 0.15 75);  --rag-amber-on:oklch(0.28 0.06 60);
--rag-green:oklch(0.50 0.14 152); --rag-green-on:#fff;
```

**Raid-specific decisions (from the spec):**
- **Accent = amber**, applied automatically by `data-app="raid"`. **Amber is light** → never put white text on it: text on amber is ink, the primary button uses the slightly-lighter `--accent-btn` so its ink label clears AA. This is a Raid-specific footgun the contrast test guards (Task 4).
- **Vivid RAG, but only for status.** Category header pills stay calm; RAG/severity/conflict go vivid. Conflict = **red** (was amber in the old design). Issue severity **Low folds into green** (the old blue `--info` "Low" is dropped — only `.raid-item__sev-label--low` changes; `--info` stays as the *assumptions category* identity colour).
- **Topbar (Retro/Signal-style).** Both shells gain a foundation `.topbar` (brand `glyph-raid` + wordmark). On `index` the `#logout-button` Sign out moves from the footer to the topbar (same id + handler); `license` shows brand only.
- **`*wash`-as-translucent footgun:** Instrument `--amberwash`/`--greenwash`/`--tealwash` are **opaque** pale tints. The `--accent-soft` privacy-chip / focus ring / ghost-hover must use `oklch(… / alpha)`, never a `*wash`.
- **Bare `.btn` footgun:** the foundation base `.btn` is intentionally minimal **and `.btn-pri` is hardwired to `--green`**. Raid uses its OWN BEM modifiers (`.btn--primary`, `.btn--secondary`, `.btn--ghost`) — restyle those in `raid.css` and map `.btn--primary` to amber explicitly. Do NOT re-declare the base `.btn` geometry — inherit the foundation's (this intentionally shifts Raid's pill buttons to the suite's 6px radius).
- **`.input-card__helper--hidden` authority:** keep `visibility:hidden` for the helper, and `[hidden]{display:none}` for `#result-zone` (the `idle` phase relies on it).
- **Classes Instrument already provides — do NOT re-declare** (let the foundation own them): `.btn` (base), `.btn-pri`/`.btn-ghost`/`.btn-danger`/`.btn-sm`, `.card` (base), `.topbar`, `.brand`/`.mk`, `.tbacts`, `.band`/`.band-in`/`.eyebrow`/`.sub`/`.waves`, `.pill`, `.page`. Do NOT override `.waves` colour — the green/teal trace is a fixed suite signature (poker/retro don't override it either).
- **Drop the `.hero*` rules.** The hero (glyph/kicker/title/tagline) is absorbed into the band; its CSS is not ported.

---

## Task 0: Branch setup (raid repo)

**Files:** none (git only)

- [ ] **Step 1: Branch off the live branch**

```bash
cd /var/www/raid
git switch master
git switch -c feat/instrument-raid
git status
```
Expected: on `feat/instrument-raid`, clean tree (ignore any known untracked `test-results/`, `data/` scratch).

- [ ] **Step 2: Push as backup**

```bash
cd /var/www/raid
git push -u origin feat/instrument-raid
```

---

## Task 1: Sync foundation into Raid + drift guard + drop old fonts/glyph

**Files:**
- Create (via sync): `public/css/instrument-core.css`, `public/js/oscilloscope.js`, `public/illos/glyphs.svg`, `public/fonts/*.woff2` (8 woff2)
- Create: `tests/theme-drift.unit.test.js`
- Delete: `public/fonts/Fraunces.woff2`, `public/fonts/Inter.woff2`, `public/fonts/JetBrainsMono.woff2`, `public/illos/theme-illos.svg`

- [ ] **Step 1: Write the failing drift test**

Create `/var/www/raid/tests/theme-drift.unit.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

test("raid's synced Instrument assets match the foundation source", async () => {
  const mod = await import("/var/www/suite/shared/theme/check-theme-drift.mjs");
  const r = mod.driftReport("/var/www/raid");
  assert.deepEqual(r.missing, [], "no missing synced assets");
  assert.deepEqual(r.mismatched, [], "no drifted synced assets");
  assert.equal(r.ok, true);
});
```
(The drift module is ESM; this CommonJS test loads it with dynamic `import()`. The absolute path is correct on this single-box deployment. Named `*.unit.test.js` so `npm test`'s `tests/*.unit.test.js` glob picks it up.)

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd /var/www/raid && node --test tests/theme-drift.unit.test.js`
Expected: FAIL — `missing` lists `css/instrument-core.css`, `js/oscilloscope.js`, `illos/glyphs.svg`, and the 8 woff2 fonts (not synced yet).

- [ ] **Step 3: Run the sync**

```bash
node /var/www/suite/shared/theme/sync-theme.mjs /var/www/raid
```
Expected: `synced 11 assets -> /var/www/raid` (3 static + 8 fonts).

- [ ] **Step 4: Run it — expect PASS**

Run: `cd /var/www/raid && node --test tests/theme-drift.unit.test.js`
Expected: PASS.

- [ ] **Step 5: Remove the now-unused old fonts + brand glyph sprite**

`theme-illos.svg` is used only as the hero/license brand glyph (`#sticker-circle`), replaced by `glyphs.svg#glyph-raid` in Task 5.

```bash
cd /var/www/raid
git rm public/fonts/Fraunces.woff2 public/fonts/Inter.woff2 public/fonts/JetBrainsMono.woff2 public/illos/theme-illos.svg
```

- [ ] **Step 6: Commit**

```bash
cd /var/www/raid
git add public/css/instrument-core.css public/js/oscilloscope.js public/illos/glyphs.svg public/fonts tests/theme-drift.unit.test.js
git status
git commit -m "feat(raid): sync Instrument foundation + drift guard; drop old fonts + theme-illos

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `raid.css` part A — token aliases, base, buttons, input card, footer, loading

**Files:**
- Create: `public/css/raid.css` (new, Raid-owned, NOT drift-checked)

This task ports the parts of `theme-core.css` + `app.css` that Instrument does NOT provide, scoped under `.ins`, with a token-alias block so component rules resolve. Read `public/css/app.css` lines ~52-243 for the originals (privacy-chip, input-card, buttons, footer, loading/spinner, quota-note).

- [ ] **Step 1: Create `raid.css` with the token + base + button + input + footer + loading layer**

```css
/* raid.css — Raid-owned layer over instrument-core.css.
   Holds everything Instrument doesn't provide, re-pointed to Instrument tokens.
   Loaded AFTER instrument-core.css. NOT part of the synced foundation. */

.ins{
  /* Spacing + radii + shadows Instrument doesn't define (from theme-core) */
  --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-6:24px; --s-8:32px; --s-12:48px;
  --r-sm:6px; --r-md:8px; --r-lg:12px; --r-xl:16px; --r-pill:999px;
  --shadow-sm:0 1px 0 rgba(42,31,18,0.04);
  --shadow-md:0 1px 0 rgba(42,31,18,0.04), 0 8px 24px rgba(42,31,18,0.06);
  --shadow-lg:0 1px 0 rgba(42,31,18,0.04), 0 16px 44px rgba(42,31,18,0.10);

  /* Structural aliases: old theme-core/theme-raid names → Instrument tokens
     (so the ported component rules resolve with minimal churn). */
  --bg:var(--bone); --bg-warm:var(--bone);
  --surface:var(--panel);
  --border:var(--line2); --border-st:var(--line2);
  --muted:var(--soft);
  --serif:'Bricolage Grotesque',sans-serif;
  --sans:'Hanken Grotesk',system-ui,-apple-system,sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,monospace;

  /* Amber accent text/tints. NOTE: --amber is LIGHT — white text on it FAILS
     AA (~3:1). Text on amber is INK; the primary button uses --accent-btn. */
  --accent-on:var(--ink);
  --accent-deep:oklch(0.46 0.10 66);          /* deep amber for text/links on light bg */
  --accent-soft:oklch(0.70 0.125 72 / 0.16);  /* translucent amber (focus ring / chip) */
  --accent-btn:oklch(0.77 0.11 78);           /* lighter amber so the INK label clears AA */

  /* VIVID RAG triad — Raid is intentionally louder than the suite (scannability).
     Values tunable in the visual pass; keep tests/theme-contrast green. */
  --rag-red:oklch(0.55 0.20 25);    --rag-red-on:#fff;
  --rag-amber:oklch(0.80 0.15 75);  --rag-amber-on:oklch(0.28 0.06 60);
  --rag-green:oklch(0.50 0.14 152); --rag-green-on:#fff;

  /* Calm semantic aliases — CATEGORY identity pills + the error panel only */
  --ok:var(--green);  --ok-bg:var(--greenwash);
  --warn:oklch(0.5 0.12 60); --warn-bg:var(--amberwash);
  --err:oklch(0.5 0.15 25);  --err-bg:oklch(0.95 0.04 25);
  --info:var(--teal); --info-bg:var(--tealwash);
}

/* The HTML [hidden] attr must always win (result-zone idle phase). */
[hidden]{display:none !important;}

/* visually-hidden utility (moved out of index.html's inline <style>) */
.ins .visually-hidden{position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0;}

/* App shell */
.ins .app-page{max-width:920px; margin:0 auto; padding:var(--s-8) var(--s-6);}

/* Buttons — restyle Raid's OWN BEM modifiers; base .btn geometry is the
   foundation's (6px radius). Primary = amber w/ INK label (white fails AA). */
.ins .btn:focus-visible{outline:none; box-shadow:0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent);}
.ins .btn--primary{background:var(--accent-btn); color:var(--ink); border-color:var(--accent-btn);}
.ins .btn--primary:hover:not(:disabled){filter:brightness(1.04); transform:translateY(-1px); box-shadow:var(--shadow-md);}
.ins .btn--primary:disabled{background:var(--bone); color:var(--faint); border-color:var(--line2); cursor:not-allowed; box-shadow:none; transform:none;}
.ins .btn--secondary{background:var(--bone); color:var(--ink); border-color:var(--line2);}
.ins .btn--secondary:hover:not(:disabled){border-color:var(--accent); color:var(--accent-deep);}
.ins .btn--ghost{background:var(--panel); color:var(--ink); border-color:var(--line2);}
.ins .btn--ghost:hover:not(:disabled){border-color:var(--accent); color:var(--accent-deep);}

/* Privacy chip (translucent amber — NOT a *wash) */
.ins .privacy-chip{display:inline-flex; align-items:center; gap:6px; background:var(--accent-soft); color:var(--accent-deep); font:500 12.5px/1 var(--sans); padding:6px 12px; border-radius:var(--r-pill); margin-bottom:var(--s-3);}
.ins .privacy-chip__icon{width:14px; height:14px;}

/* Input card */
.ins .input-card{background:var(--panel); border:1px solid var(--line2); border-radius:var(--r-lg); box-shadow:var(--shadow-md); padding:var(--s-6); margin-bottom:var(--s-8);}
.ins .input-card__textarea{width:100%; min-height:220px; font:400 14.5px/1.55 var(--sans); color:var(--ink); background:var(--bone); border:1px solid var(--line2); border-radius:var(--r-md); padding:12px 14px; resize:vertical; box-sizing:border-box;}
.ins .input-card__textarea:focus{outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft);}
.ins .input-card__counter{font:400 12.5px/1 var(--sans); color:var(--soft); text-align:right; margin-top:var(--s-2);}
.ins .input-card__counter--warn{color:var(--warn);}
.ins .input-card__counter--err{color:var(--err);}
.ins .input-card__helper{font:400 12.5px/1.4 var(--sans); color:var(--err); margin-top:var(--s-2); min-height:1.4em;}
.ins .input-card__helper--hidden{visibility:hidden;}
.ins .input-card__actions{margin-top:var(--s-4); display:flex; justify-content:flex-end;}

/* Footer (suite links + license link; Sign out moved to the topbar) */
.ins .app-footer{text-align:center; padding:var(--s-12) var(--s-6) var(--s-8); color:var(--soft); font:400 12.5px/1.5 var(--sans);}
.ins .app-footer a{color:var(--accent-deep);}
.ins .app-footer a:focus-visible{outline:none; box-shadow:0 0 0 3px var(--accent-soft); border-radius:var(--r-sm);}

/* Result zone + loading + quota note */
.ins .result-zone{margin-top:var(--s-6);}
.ins .loading{text-align:center; padding:var(--s-12) var(--s-4); color:var(--soft);}
.ins .spinner{width:40px; height:40px; margin:0 auto var(--s-3); border:3px solid var(--accent-soft); border-top-color:var(--accent); border-radius:50%; animation:raid-spin 1s linear infinite;}
@keyframes raid-spin{to{transform:rotate(360deg);}}
.ins .quota-note{font-size:0.85rem; color:var(--soft); margin:0 0 var(--s-4);}
```

- [ ] **Step 2: Sanity-check it parses (braces balanced)**

Run: `cd /var/www/raid && node -e "const c=require('fs').readFileSync('public/css/raid.css','utf8');const o=(c.match(/{/g)||[]).length,cl=(c.match(/}/g)||[]).length;if(o!==cl)throw new Error('brace mismatch '+o+'/'+cl);console.log('braces ok',o)"`
Expected: `braces ok <n>` (balanced).

- [ ] **Step 3: Commit**

```bash
cd /var/www/raid
git add public/css/raid.css
git status
git commit -m "feat(raid): raid.css part A — tokens, buttons, input card, footer, loading

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `raid.css` part B — result grid, RAID cards, VIVID RAG, action/error/license

**Files:**
- Modify: `public/css/raid.css` (append)

Append Raid's result-zone components, re-pointed to Instrument tokens, scoped under `.ins`. This is a faithful re-tokenization of existing rules in `public/css/app.css` lines ~245-521, with three intentional changes: (1) RAG/severity/conflict pills become **vivid**; (2) Issue severity **Low → green**; (3) conflict treatment → **red** (was amber).

- [ ] **Step 1: Append the result grid + RAID card + category pills**

```css
/* Result grid */
.ins .result-grid{display:grid; grid-template-columns:1fr 1fr; gap:var(--s-4); margin-top:var(--s-4);}
@media (max-width:640px){.ins .result-grid{grid-template-columns:1fr;}}

/* RAID card */
.ins .raid-card{position:relative; background:var(--panel); border:1px solid var(--line2); border-radius:var(--r-lg); padding:var(--s-6); box-shadow:var(--shadow-sm);}
.ins .raid-card__header{display:flex; align-items:center; gap:var(--s-2); margin-bottom:var(--s-4);}
.ins .raid-card__pill{font:700 10.5px/1 var(--sans); text-transform:uppercase; letter-spacing:0.04em; padding:4px 10px; border-radius:var(--r-pill);}
/* CATEGORY identity pills stay CALM (washes) */
.ins .raid-card__pill--risks{background:var(--err-bg); color:var(--err);}
.ins .raid-card__pill--assumptions{background:var(--info-bg); color:var(--info);}
.ins .raid-card__pill--issues{background:var(--warn-bg); color:var(--warn);}
.ins .raid-card__pill--dependencies{background:var(--accent-soft); color:var(--accent-deep);}
.ins .raid-card__count{font:600 13px/1 var(--sans); color:var(--soft);}
.ins .raid-card__empty{font:400 13px/1.4 var(--sans); color:var(--soft); font-style:italic;}

/* RAID item */
.ins .raid-item{padding:var(--s-3) 0; border-bottom:1px solid var(--bone);}
.ins .raid-item:last-child{border-bottom:none;}
.ins .raid-item__title{font:600 14.5px/1.35 var(--sans); color:var(--ink); margin:0 0 var(--s-2);}
.ins .raid-item__meta{display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:var(--s-2);}
.ins .raid-item__owner{font:500 11.5px/1 var(--sans); color:var(--soft); background:var(--bone); padding:3px 8px; border-radius:var(--r-pill);}
.ins .raid-item__score{font:500 12.5px/1 var(--sans); color:var(--soft);}
.ins .raid-item__body{font:400 13.5px/1.5 var(--sans); color:var(--ink); margin:0;}
.ins .raid-item__body + .raid-item__body{margin-top:var(--s-2);}
.ins .raid-item__label{font-weight:600; color:var(--accent-deep);}
```

- [ ] **Step 2: Append the VIVID RAG / severity / conflict layer (the core change)**

```css
/* RAG + severity pills — VIVID (saturated, filled). The scannable status layer. */
.ins .raid-item__rag, .ins .raid-item__sev-label{font:700 10.5px/1 var(--sans); text-transform:uppercase; letter-spacing:0.04em; padding:3px 8px; border-radius:var(--r-pill);}
.ins .raid-item__rag--red,    .ins .raid-item__sev-label--high  {background:var(--rag-red);   color:var(--rag-red-on);}
.ins .raid-item__rag--amber,  .ins .raid-item__sev-label--medium{background:var(--rag-amber); color:var(--rag-amber-on);}
.ins .raid-item__rag--green,  .ins .raid-item__sev-label--low   {background:var(--rag-green); color:var(--rag-green-on);}

/* Conflict treatment — VIVID RED (was amber). The hero feature of Dependencies. */
.ins .raid-card--conflict{border:2px solid var(--rag-red);}
.ins .raid-card__corner-chip{position:absolute; top:-11px; right:14px; background:var(--rag-red); color:var(--rag-red-on); font:700 10.5px/1 var(--sans); text-transform:uppercase; letter-spacing:0.04em; padding:4px 10px; border-radius:var(--r-pill);}
.ins .raid-item__conflict-pill{font:700 10.5px/1 var(--sans); text-transform:uppercase; letter-spacing:0.04em; padding:3px 8px; border-radius:var(--r-pill); background:var(--rag-red); color:var(--rag-red-on);}
.ins .raid-item__conflict-callout{background:oklch(0.95 0.04 25); border-left:3px solid var(--rag-red); padding:var(--s-2) var(--s-3); border-radius:0 var(--r-md) var(--r-md) 0; font:400 12.5px/1.5 var(--sans); color:var(--ink); margin-top:var(--s-2);}
.ins .raid-item__conflict-callout strong{color:var(--rag-red); font-weight:700;}
```

- [ ] **Step 3: Append action bar, error card, license page, responsive + reduced-motion**

```css
/* Action / export bar */
.ins .action-bar{display:flex; gap:var(--s-2); flex-wrap:wrap; margin-top:var(--s-6);}
@media (max-width:640px){.ins .action-bar{flex-direction:column;} .ins .action-bar .btn{width:100%;}}

/* Error card (calm red panel — vivid would be too loud full-bleed) */
.ins .error-card{background:var(--err-bg); border:1px solid var(--err); border-radius:var(--r-lg); padding:var(--s-6); text-align:center;}
.ins .error-card__icon{width:32px; height:32px; margin:0 auto var(--s-3); color:var(--err);}
.ins .error-card__message{font:400 14.5px/1.5 var(--sans); color:var(--err); margin:0 0 var(--s-4);}
.ins .error-card__actions{display:flex; justify-content:center;}

/* License page */
.ins .license-wrap{max-width:900px; margin:var(--s-8) auto; background:var(--panel); border:1px solid var(--line2); border-radius:var(--r-lg); box-shadow:var(--shadow-md); padding:var(--s-6);}
.ins .license-wrap p{margin:0 0 var(--s-3); color:var(--ink); line-height:1.6; font:400 14.5px/1.6 var(--sans);}
.ins .license-wrap a{color:var(--accent-deep); text-decoration:underline; text-underline-offset:2px;}
.ins .license-wrap a:hover{color:var(--accent);}
.ins .license-wrap pre{margin-top:var(--s-4); background:var(--bone); border:1px solid var(--line2); border-radius:var(--r-md); padding:var(--s-4); white-space:pre-wrap; word-break:break-word; color:var(--ink); line-height:1.5; font:400 13px/1.55 var(--mono);}
@media (max-width:640px){.ins .license-wrap{margin:var(--s-4); padding:var(--s-4);}}

/* Reduced motion */
@media (prefers-reduced-motion:reduce){
  .ins *{transition:none !important;}
  .ins .btn--primary:hover:not(:disabled){transform:none;}
  .ins .spinner{animation:none; border-top-color:var(--accent-soft);}
}

/* Mobile */
@media (max-width:640px){
  .ins .app-page{padding:var(--s-6) var(--s-4);}
  .ins .input-card{padding:var(--s-4);}
  .ins .input-card__actions .btn{width:100%;}
}
```
(The old `.hero__title` mobile override is dropped — the hero is gone.)

- [ ] **Step 4: Sanity-check braces balance**

Run: `cd /var/www/raid && node -e "const c=require('fs').readFileSync('public/css/raid.css','utf8');const o=(c.match(/{/g)||[]).length,cl=(c.match(/}/g)||[]).length;if(o!==cl)throw new Error('mismatch '+o+'/'+cl);console.log('braces ok',o)"`
Expected: balanced.

- [ ] **Step 5: Commit**

```bash
cd /var/www/raid
git add public/css/raid.css
git status
git commit -m "feat(raid): raid.css part B — result grid, vivid RAG, action/error/license

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `lib/contrast.js` + the palette contrast test (vivid pairs + the amber/white footgun)

**Files:**
- Create: `lib/contrast.js`
- Create: `tests/theme-contrast.unit.test.js`

Raid has no contrast helper yet. Mirror the one shipped in the other suite apps, then pin the pairs Raid relies on — including the vivid RAG triad and the amber primary button (the AA-risky pair).

- [ ] **Step 1: Create `lib/contrast.js`**

```js
"use strict";

/**
 * WCAG 2.1 contrast helpers. Used to check palette pairs at test-time so
 * the design system stays accessible as it evolves.
 */
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function relLuminance({ r, g, b }) {
  const channel = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrastRatio(fgHex, bgHex) {
  const l1 = relLuminance(hexToRgb(fgHex));
  const l2 = relLuminance(hexToRgb(bgHex));
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}
function meetsAA(fgHex, bgHex, { largeText = false } = {}) {
  return contrastRatio(fgHex, bgHex) >= (largeText ? 3 : 4.5);
}
module.exports = { contrastRatio, meetsAA };
```

- [ ] **Step 2: Write the contrast test**

Create `/var/www/raid/tests/theme-contrast.unit.test.js`. The hexes are the sRGB equivalents of the `instrument-core.css` + `raid.css` oklch tokens — **derive each exactly** (devtools `getComputedStyle` on a `.ins[data-app="raid"]` element, or an oklch→sRGB converter). The starting values below are best estimates; reconcile them with the actual rendered tokens. RAG/severity pills are 10.5px bold = NOT "large", so they need **4.5:1**.

```js
// tests/theme-contrast.unit.test.js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { contrastRatio, meetsAA } = require("../lib/contrast");

// sRGB equivalents of the Instrument + raid.css oklch tokens. DERIVE EXACTLY.
const C = {
  bone:      "#f1f3f5", // --bone
  panel:     "#fdfeff", // --panel
  ink:       "#1a1f24", // --ink
  soft:      "#52575d", // --soft
  faint:     "#7c8186", // --faint
  accentBtn: "#e6ad55", // --accent-btn oklch(0.77 0.11 78) — amber primary fill
  ragRed:    "#c5302a", // --rag-red    oklch(0.55 0.20 25)
  ragAmber:  "#e6a02e", // --rag-amber  oklch(0.80 0.15 75)
  ragAmberOn:"#473410", // --rag-amber-on oklch(0.28 0.06 60)
  ragGreen:  "#157a4a", // --rag-green  oklch(0.50 0.14 152)
  white:     "#ffffff",
};

// Body text — AA 4.5:1
const BODY = [
  ["ink",  "bone"], ["ink", "panel"], ["soft", "panel"], ["soft", "bone"],
  ["ink",  "accentBtn"],   // INK label on the amber primary button (white would FAIL ~3:1)
  ["white","ragRed"],      // vivid red pill label
  ["ragAmberOn","ragAmber"], // dark label on vivid amber pill
  ["white","ragGreen"],    // vivid green pill label
];
for (const [fg, bg] of BODY) {
  test(`raid contrast: ${fg} on ${bg} meets AA (4.5:1)`, () => {
    const r = contrastRatio(C[fg], C[bg]);
    assert.ok(meetsAA(C[fg], C[bg]), `${fg} (${C[fg]}) on ${bg} (${C[bg]}) = ${r.toFixed(2)}:1, need 4.5:1`);
  });
}
```
(If a pair fails: the hex is mis-derived OR the token genuinely fails AA. For the amber button, the fix is to tune `--accent-btn` / keep ink text — **never switch to white text on amber**. For a RAG pill, deepen/lighten the vivid token (and its `-on`) until it clears 4.5 — adjust `raid.css` and this hex together. NEVER weaken the threshold.)

- [ ] **Step 3: Run it**

Run: `cd /var/www/raid && node --test tests/theme-contrast.unit.test.js`
Expected: PASS. If a pair fails, reconcile per the note above before continuing.

- [ ] **Step 4: Commit**

```bash
cd /var/www/raid
git add lib/contrast.js tests/theme-contrast.unit.test.js
git status
git commit -m "test(raid): contrast helper + pin Instrument/vivid-RAG palette pairs (amber=ink label)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Reskin the two static shells (`index.html`, `license.html`)

**Files:**
- Modify: `public/index.html`, `public/license.html`

- [ ] **Step 1: Rewrite `public/index.html`** (full file — head links, topbar, band, body, footer)

Replace the four CSS links with two, drop `breathing-waves.js`, add the oscilloscope module, add `class="ins" data-app="raid"`, add the topbar (with the relocated `#logout-button`), swap the header-band+hero for a `.band`, remove the inline `<style>` (now in `raid.css`), and drop the footer Sign-out button.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RAID — From scattered notes to a scored RAID log</title>
  <meta name="description" content="Turn project notes into a scored, classified RAID log: Risks, Assumptions, Issues, Dependencies — with dependency conflict detection.">

  <link rel="stylesheet" href="/css/instrument-core.css">
  <link rel="stylesheet" href="/css/raid.css">

  <script src="/js/clipboard.js" defer></script>
  <script src="/js/samples.js" defer></script>
  <script src="/js/exports.js" defer></script>
  <script src="/js/extractUi.js" defer></script>
  <script src="/js/app.js" defer></script>
  <script type="module" src="/js/oscilloscope.js"></script>
  <script src="/auth-client/heartbeat.js" defer></script>
</head>
<body class="ins" data-app="raid">

  <header class="topbar">
    <a class="brand" href="/"><svg class="mk" width="22" height="22" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-raid"/></svg> <span>RAID</span></a>
    <span class="tbacts">
      <button id="logout-button" class="btn btn--ghost" type="button">Sign out</button>
    </span>
  </header>

  <div class="band"><div class="waves"></div><div class="band-in">
    <div class="eyebrow">RAID extraction</div>
    <h1>RAID</h1>
    <p class="sub">From scattered notes to a scored RAID log, in seconds.</p>
  </div></div>

  <main class="app-page">

    <section class="input-card" aria-labelledby="input-heading">
      <h2 id="input-heading" class="visually-hidden">Project notes</h2>

      <div class="privacy-chip" role="note">
        <svg class="privacy-chip__icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 11V8a7 7 0 0 1 14 0v3"/><rect x="4" y="11" width="16" height="10" rx="2"/>
        </svg>
        <span>Notes are sent to a cloud LLM and not stored.</span>
      </div>

      <label class="visually-hidden" for="notes-textarea">Project notes</label>
      <textarea id="notes-textarea" class="input-card__textarea" autocomplete="off" spellcheck="true" aria-describedby="notes-helper notes-counter"></textarea>

      <div id="notes-counter" class="input-card__counter">0 chars</div>
      <div id="notes-helper" class="input-card__helper input-card__helper--hidden" aria-live="polite"></div>

      <div class="input-card__actions">
        <button id="generate-button" class="btn btn--primary" type="button" disabled>Generate RAID</button>
      </div>
    </section>

    <section id="result-zone" class="result-zone" aria-live="polite" aria-atomic="false" hidden>
      <!-- Populated by app.js with the spinner, grid, action bar, or error card -->
    </section>

  </main>

  <footer class="app-footer">
    <p>Part of the suite: <a href="https://sprintpoker.uk">sprintpoker</a> · <a href="https://sprintretro.uk">sprintretro</a> · <a href="https://signal.uk">signal</a></p>
    <p><small>Built with Claude. <a href="/license.html">License</a></small></p>
  </footer>

</body>
</html>
```
(Element ids `#notes-textarea`/`#notes-counter`/`#notes-helper`/`#generate-button`/`#result-zone`/`#logout-button` are all preserved — `app.js` looks them up by id. The suite-links text is unchanged, out of scope.)

- [ ] **Step 2: Rewrite `public/license.html`** (full file — chrome swap; licence `<pre>`/`<p>` text VERBATIM)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>License | RAID</title>
  <link rel="stylesheet" href="/css/instrument-core.css">
  <link rel="stylesheet" href="/css/raid.css">
  <script type="module" src="/js/oscilloscope.js"></script>
</head>
<body class="ins" data-app="raid">

  <header class="topbar">
    <a class="brand" href="/"><svg class="mk" width="22" height="22" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-raid"/></svg> <span>RAID</span></a>
  </header>

  <div class="band"><div class="waves"></div><div class="band-in">
    <div class="eyebrow">Legal</div>
    <h1>RAID Free Use License</h1>
    <p class="sub">This tool is free to use, but it is not open source.</p>
  </div></div>

  <main class="license-wrap">
    <p>You may use the software at no cost, but you may not copy, redistribute, modify, or sell it.</p>
    <p>The software is provided "as is" and all responsibility for use of the extracted RAID log and any decisions arising from it remains with the user. Return to the <a href="/">main app</a>.</p>
    <pre>RAID Free Use License
Version 1.0
Effective date: February 13, 2026

Copyright (c) 2026 David Jackson
All rights reserved.

1. Grant of License
You are granted a limited, personal, non-exclusive, non-transferable,
revocable license to use this RAID software at no charge.

2. Restrictions
You may not, and may not allow any third party to:
- copy, reproduce, publish, distribute, or redistribute the software;
- modify, adapt, translate, reverse engineer, decompile, or create
  derivative works from the software;
- sell, sublicense, lease, rent, or otherwise commercially exploit the
  software;
- remove or alter any ownership, attribution, or legal notices.

The restriction on copying does not prohibit temporary technical copies
automatically created by a browser or device solely to access and use an
authorized hosted instance of the software.

3. Ownership
The software is licensed, not sold. All intellectual property rights,
title, and interest remain with David Jackson.

4. Disclaimer of Warranties
The software is provided "AS IS" and "AS AVAILABLE", without warranties
of any kind, express or implied, including but not limited to merchantability,
fitness for a particular purpose, non-infringement, accuracy, and uninterrupted
or error-free operation.

5. Limitation of Liability
To the maximum extent permitted by law, David Jackson will not be liable for
any direct, indirect, incidental, special, consequential, or exemplary damages
arising out of or related to use of, inability to use, or reliance on the
software.

Without limiting the above, David Jackson is not liable for:
- delivery failure, missed deadlines, cost overruns, or any project outcome;
- incorrect classification, prioritisation, or interpretation of RAID items,
  or any decision or action taken based on the extracted log;
- inaccuracies, omissions, or hallucinations in AI-generated content;
- any business, operational, or technical decision made by users of the
  software.

By using the software, you acknowledge that responsibility for use of the
software and any decisions arising from the extracted RAID log lies solely
with the user.

6. Termination
This license terminates automatically if you breach any term. On termination,
you must stop using the software immediately.

7. Governing Law
This license is governed by the laws of England and Wales, excluding conflict
of law rules.</pre>
  </main>

  <footer class="app-footer">
    <p><small>Built with Claude. Return to the <a href="/">main app</a>.</small></p>
  </footer>

</body>
</html>
```
(The oscilloscope module is `type="module"` so it runs after parse and finds `.band .waves`.)

- [ ] **Step 3: Verify no stale references remain in either shell**

Run: `cd /var/www/raid && grep -rlE "theme-core|theme-raid|/css/app\.css|breathing-waves|brand-glyph|header-band|data-breathing|theme-illos|hero__|sticker-circle" public/*.html`
Expected: NO output (both shells migrated).

- [ ] **Step 4: Commit**

```bash
cd /var/www/raid
git add public/index.html public/license.html
git status
git commit -m "feat(raid): reskin shells — topbar + oscilloscope band; Sign out to topbar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Delete superseded CSS/JS

**Files:**
- Delete: `public/js/breathing-waves.js`, `public/css/breathing-waves.css`, `public/css/theme-core.css`, `public/css/theme-raid.css`, `public/css/app.css`

No JS logic changes are needed — Raid's JS (`app.js`) emits class names (`raid-card`, `raid-item__rag--*`, `raid-item__sev-label--*`, `btn--primary`, …) all restyled in `raid.css`. The vivid RAG / low→green / conflict→red changes are pure CSS; `ragClass()`/`sevLabelClass()` and the conflict logic in `app.js` are untouched.

- [ ] **Step 1: Confirm nothing still references the files to be deleted**

Run: `cd /var/www/raid && grep -rnE "theme-core|theme-raid|/css/app\.css|breathing-waves" public/ tests/ | grep -vE "raid\.css|instrument-core"`
Expected: NO output.

- [ ] **Step 2: Delete the superseded files**

```bash
cd /var/www/raid
git rm public/js/breathing-waves.js public/css/breathing-waves.css public/css/theme-core.css public/css/theme-raid.css public/css/app.css
```

- [ ] **Step 3: Commit**

```bash
cd /var/www/raid
git status
git commit -m "feat(raid): remove breathing-waves + old theme/app CSS (superseded by Instrument)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: E2E — fix the stale Playwright config + a public license-page band spec

**Files:**
- Modify: `playwright.config.js`
- Create: `tests/e2e/license-band.spec.js`

Raid currently has NO e2e specs and the `playwright.config.js` `webServer` command is **stale** (it references `RAID_KEYS_FILE`/`RAID_ADMIN_KEY_NAME`, a pre-hub-auth model `server.js` no longer uses). The authed `/` page bounces to the hub via `auth.requireAuth`, so a standalone authed e2e would require a hub stub — **out of scope** for a reskin. The **public** `/license.html` route needs no auth and exercises the core reskin wiring (instrument-core + raid.css load, the oscilloscope module mounting into `.band .waves`, the `glyph-raid` brand). That is the e2e guard; the authed `index` states are covered by the Task 8 manual visual pass (noted explicitly — not silently dropped).

- [ ] **Step 1: Fix the `webServer` command in `playwright.config.js`**

Replace the stale `webServer.command` so the server boots for public-route testing (dummy hub env + a throwaway sessions DB; the license/health routes never call the hub):

```js
  webServer: {
    command: 'PORT=3003 ANTHROPIC_API_KEY=dummy-for-e2e HUB_BASE_URL=http://127.0.0.1:9 HUB_API_KEY=dummy APP_SESSIONS_DB=/tmp/raid-e2e-sessions.db node server.js',
    url: 'http://localhost:3003/health',
    reuseExistingServer: !process.env.CI,
    timeout: 10_000
  }
```
(Leave the rest of the config as-is: `testDir: './tests/e2e'`, `baseURL: 'http://localhost:3003'`, headless Chrome.)

- [ ] **Step 2: Confirm the server boots and `/health` + `/license.html` are reachable**

Run: `cd /var/www/raid && PORT=3003 ANTHROPIC_API_KEY=dummy-for-e2e HUB_BASE_URL=http://127.0.0.1:9 HUB_API_KEY=dummy APP_SESSIONS_DB=/tmp/raid-e2e-sessions.db node server.js &` then `sleep 1 && curl -s -w '\n' localhost:3003/health && curl -s -o /dev/null -w '%{http_code}\n' localhost:3003/license.html`; then `kill %1`.
Expected: `{"ok":true,...}` and `200`. If boot fails on missing hub env, add any env the error names (the public routes still won't call the hub).

- [ ] **Step 3: Write the license-page band spec**

Create `/var/www/raid/tests/e2e/license-band.spec.js`:

```js
const { test, expect } = require('@playwright/test');

test('license page renders the oscilloscope band with no console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/license.html');

  // Instrument chrome present
  await expect(page.locator('body.ins[data-app="raid"]')).toHaveCount(1);
  await expect(page.locator('.topbar .brand')).toBeVisible();

  // Oscilloscope mounted a trace into the band's .waves
  const band = page.locator('.band').first();
  await expect(band).toBeVisible();
  await expect.poll(async () => band.locator('.waves svg').count()).toBeGreaterThan(0);

  expect(errors, errors.join('\n')).toHaveLength(0);
});
```

- [ ] **Step 4: Run the e2e spec**

Run: `cd /var/www/raid && npx playwright install chromium && npm run test:e2e`
Expected: PASS (1 spec). The `webServer` boots the server automatically. If the oscilloscope assertion fails, confirm `oscilloscope.js` is linked as `type="module"` and the `.band .waves` markup matches Task 5.

- [ ] **Step 5: Commit**

```bash
cd /var/www/raid
git add playwright.config.js tests/e2e/license-band.spec.js
git status
git commit -m "test(raid): fix stale Playwright webServer; add public license-page band e2e

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Full verification + visual pass + finish branch

**Files:** none (verification + merge)

- [ ] **Step 1: Unit suite**

Run: `cd /var/www/raid && npm test`
Expected: all `node --test tests/*.unit.test.js` pass — new `theme-drift`, `theme-contrast`, plus the unchanged `exports`/`extract`/`extractHandler`/`extractUi`/`samples`. (The `tests/*.unit.test.js` glob auto-includes the two new files.)

- [ ] **Step 2: E2E suite**

Run: `cd /var/www/raid && npm run test:e2e`
Expected: `license-band` passes.

- [ ] **Step 3: Drift check**

Run: `node /var/www/suite/shared/theme/check-theme-drift.mjs /var/www/raid`
Expected: `ok: /var/www/raid`.

- [ ] **Step 4: Visual pass — run Raid locally**

Boot Raid against the e2e env (Step from Task 7) OR with real `.env`, open `http://localhost:3003/`, sign in via the hub if needed, and compare to `shared/theme/preview.html` + the live Retro/Signal/Poker apps:
- `/` **idle** — topbar (glyph-raid + Sign out), oscilloscope band (green/teal trace), input card with privacy chip, char counter, **amber primary "Generate RAID"** with a readable **ink** label
- counter **warn/err** states (paste >800k / >1M chars)
- **loading** — spinner (amber)
- **result** — the 4-up grid; calm **category** pills (risks=red-wash, assumptions=teal, issues=amber-wash, deps=amber); **VIVID** RAG pills on Risks; Issue severities (High=red, Medium=amber, **Low=green**); a Dependency with `conflict_flag` → **vivid red** corner-chip + conflict pill + red-bordered card + red callout; an empty category ("No items detected."); the **action bar** (Copy = amber primary, CSV/Jira = secondary, Try another = ghost); the quota note
- **error** — trigger a failure (e.g. stop the model) → calm red error card + Try again
- `/license.html` — topbar, band, licence text, footer link
- Confirm `prefers-reduced-motion` stops the oscilloscope trace + spinner.

- [ ] **Step 5: Final holistic review**

`cd /var/www/raid && git diff master..feat/instrument-raid`. Confirm: no leftover old-theme refs; no bare `.btn` without a variant; **no white text on amber** anywhere (primary button label is ink); every element `id` / route / API call preserved (`#notes-textarea`, `#generate-button`, `#result-zone`, `#logout-button`, `/extract`); `[hidden]` rule present (result-zone idle); RAG/severity/conflict are vivid, category pills calm, conflict is red, Issue-Low is green; no `*wash` used where translucency is required (privacy chip / focus ring use `oklch(.../alpha)`). Use superpowers:requesting-code-review for a fresh-eyes pass.

- [ ] **Step 6: Merge to the live branch + push**

```bash
cd /var/www/raid
git switch master
git merge --no-ff feat/instrument-raid -m "Merge Instrument Raid redesign (sub-project 5) — final surface"
git push origin master
git push origin feat/instrument-raid
```

- [ ] **Step 7: Deploy (operator-driven live session)**

On prod: `git pull` in `/var/www/raid` on `master`, `sudo systemctl restart raid` (service `raid.service`, port 3003, User=raid, env `/var/www/raid/.env`), verify `curl -s -w '\n' localhost:3003/health`, then hard-refresh the browser (no asset cache-buster — same caveat as Hub/Signal/Retro/Poker). No npm install / no migration expected (views/CSS/JS only). Run interactively, one command per block — NOT part of automated execution.

---

## Notes for the implementer

- **No logic changes.** Markup/CSS only (no JS edits at all — Raid emits its own class names, restyled in `raid.css`). Preserve every element `id`, route, and API call. The vivid RAG / low→green / conflict→red changes are purely which CSS the existing classes resolve to.
- **Accent = amber, and amber is LIGHT.** Never white text on amber (~3:1, fails AA). Text on amber is ink; the primary button uses the slightly-lighter `--accent-btn` so its ink label clears AA. Task 4's contrast test is the gate — if it fails, tune the token, don't weaken the test.
- **Two-tier status colour.** CATEGORY header pills stay calm (washes); RAG/SEVERITY/CONFLICT pills are vivid. Conflict is red (changed from the old amber). Issue-Low is green (the old blue `--info` "Low" is dropped; `--info` survives only as the assumptions *category* colour).
- **Topbar is new.** Both shells gain a foundation `.topbar`; `#logout-button` moves footer → topbar on `index` (same id/handler). License topbar = brand only.
- **`*wash` is opaque:** the privacy chip, focus ring, and any translucent fill use `oklch(.../alpha)` via `--accent-soft`, never a `*wash` token.
- **Base `.btn` is the foundation's.** Don't re-declare its geometry — only the BEM modifiers + a `.btn:focus-visible` ring live in `raid.css`. This intentionally moves Raid's buttons from pill to the suite's 6px radius.
- **`.waves` colour is NOT overridden** — the green/teal trace is a fixed suite signature (poker/retro leave it too).
- **No e2e for the authed page.** Raid had zero e2e + a stale Playwright config; standing up hub-auth e2e is disproportionate to a reskin. The public license-page spec guards the core wiring; the authed `index` states are covered by the manual visual pass (Task 8 Step 4) — this is a deliberate, stated limitation, not a silent gap.
- **Cross-repo:** the drift module + sync script live in `/var/www/suite/shared/theme/`; both repos are on the same box, so absolute paths are fine. Never hand-edit synced files (`instrument-core.css`, `oscilloscope.js`, `glyphs.svg`, `fonts/*`) — edit the foundation source + re-run `sync-theme.mjs`. `raid.css` is Raid-owned and exempt.
- **This is the last surface.** On merge + deploy, the Instrument visual redesign program (SP0–SP5) is complete.
```

