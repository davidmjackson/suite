# Instrument Poker Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin Poker (server-static HTML + vanilla JS) to the Instrument design system — adopt the synced foundation + a Poker-owned `poker.css`, the oscilloscope band, Bricolage/Hanken/IBM Plex Mono fonts, and `data-app="poker"` (ink accent) — with no behavior/API/auth/WebSocket/voting-logic changes.

**Architecture:** Replace `theme-core.css` + `theme-poker.css` + `breathing-waves.css` + `app.css` with the synced `instrument-core.css` (drift-checked source of truth) + a Poker-owned `poker.css` (everything Instrument doesn't provide, re-pointed to Instrument tokens). Each static shell adopts `class="ins …" data-app="poker"`, the `.band`/oscilloscope, and the shared component classes; Poker's app-specific components and its own button classes keep their class names, restyled in `poker.css`. The voting cards keep their 3-D flip mechanic; their faces become Instrument `.pkfront`/`.pkback` cards and the back stops using a raster image.

**Tech Stack:** Node ≥20 (CommonJS — `require`), Express 5, `ws`, `uuid`, vanilla browser JS, `node:test` unit tests + Playwright e2e. Foundation tooling is ESM under `/var/www/suite/shared/theme/`.

**Repos & paths:** Poker is its OWN repo at `/var/www/scrumpoker` (remote `bitbucket.org/epicnerd/scrum-poker`, service `scrumpoker`, User=davidj, env `/etc/scrumpoker.env`, port 3000, health at `/health`). Foundation lives in `/var/www/suite/shared/theme/` (manifest already maps `poker` → `/var/www/scrumpoker/public`). **Code commits in `/var/www/scrumpoker`; this plan + spec live in `/var/www/suite/docs/superpowers/`.** Run Poker unit tests from `/var/www/scrumpoker` with `npm test` (`node --test tests/*.test.js` — a new `tests/theme-drift.test.js` is auto-picked up by the glob); e2e with `npm run test:e2e` (Playwright).

**Conventions:** Explicit git staging only — never `git add -A`/`.`; `git status` before each commit. Branch `feat/instrument-poker` off Poker's live branch `main`; push to origin as backup; merge back to `main` locally. Co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Token mapping (used throughout `poker.css` tasks)

Poker's old tokens (`theme-core.css` + `theme-poker.css`, all hex) → Instrument tokens (from `instrument-core.css`, all under `.ins`):

| Poker old | Instrument | Notes |
|---|---|---|
| `--bg`, `--bg-warm` | `--bone` | page + warm fills |
| `--surface` | `--panel` | cards/panels |
| `--border` | `--line` | hairlines |
| `--border-st` | `--line2` | stronger borders |
| `--ink` | `--ink` | text |
| `--muted` | `--soft` | secondary text |
| `--faint` | `--faint` | tertiary text |
| `--accent`, `--accent-deep` | `--accent` (= `--ink` for `data-app="poker"`) | primary; **poker accent is ink** |
| `--accent-on` | `#fff` | text on the ink accent |
| `--accent-soft` | `oklch(0.235 0.013 250 / 0.12)` | **translucent** ink tint (focus ring / card halo) — NOT a `*wash` |
| `--ok` / `--ok-bg` | `--green` / `--greenwash` | positive (Show Votes) |
| `--warn` / `--warn-bg` | `oklch(0.5 0.12 60)` / `--amberwash` | attention |
| `--err` / `--err-bg` | `--danger` / `--danger-bg` (poker-local, below) | destructive (Reset/End/Logout) |
| `--info` / `--info-bg` | `--teal` / `--tealwash` | neutral/info accents |
| `--mono` | `'IBM Plex Mono', monospace` | |
| `--serif`, `--sans` | (drop — Instrument `.ins` sets Bricolage headings / Hanken body) | |

Spacing (`--s-*`), radii (`--r-*`), and shadows (`--shadow-*`) are NOT defined by Instrument — `poker.css` re-declares them (Task 2). The foundation has **no red token** — `poker.css` declares `--danger`/`--danger-bg` (Task 2).

**Poker-specific decisions (from the spec):**
- **Accent = ink**, applied automatically by `data-app="poker"`. Poker is monochrome — the cards carry the visual interest. `poker.css` aliases `--accent-on`→`#fff` and `--accent-soft`→a translucent ink tint.
- **Card back = CSS lattice, no raster.** Keep the existing flip mechanic; the back face (`.card-back`) becomes a `.pkback` CSS lattice instead of an `<img>`. The one functional JS edit is in `cardDeck.js` (Task 4). `images/cardback.jpg` is deleted (Task 6); the static `index.html` preview `<img>` is replaced with a `.pkback` div (Task 5).
- **`*wash`-as-translucent footgun:** Instrument `--greenwash`/`--tealwash`/`--amberwash` are **opaque** pale tints. Any fill that must show what is beneath it — the card hover halo / selection glow, the modal overlay scrim — must use `oklch(… / alpha)`, never an opaque `*wash` token.
- **Bare `.btn` footgun:** never leave a button on a bare Instrument `.btn`. Poker uses its OWN button classes (`.btn-primary` (with `.btn`), `.toolbar-action`, `.invite-action`, `.success-action`, `.secondary-action`, `.danger-action`, `.text-action`) emitted in static HTML — **keep those class names and restyle them in `poker.css`** (Task 2) so no markup churn is needed.
- **`.hidden` / `[hidden]` authority:** Poker relies on `.hidden{display:none!important}` (from theme-core) to hide facilitator-only controls (End, `#facilitator-controls`), the observer note, and the invite menu from users who must not see them. **Re-declare `.hidden{display:none!important}` and add `[hidden]{display:none!important}` in `poker.css`** — security-relevant, not cosmetic.
- **Compound body/element-state selectors (SP3 lesson):** Poker toggles state classes on the same elements that carry `ins` or sit on banded sections (`.app-page`, `.login-page`/`.room-page` on `<main>`, `.modal-overlay.hidden`, `.voting-deck.is-disabled`, `.status-pill.is-locked`). These are on descendants of `.ins`, so `.ins .app-page` is correct here (the `ins` class is on `<body>`, the state classes are on `<main>`/children). **The trap only bites if a class is toggled on the `.ins` element itself** — Poker keeps `ins` on `<body>` and never toggles state on `<body>`, so descendant selectors are fine; do NOT introduce a `.ins.x` requirement unless a class lands on `<body>` itself. Verify in the e2e gating spec (Task 7).
- **Classes Instrument already provides — do NOT re-declare** (let the foundation own them): `.btn` (base), `.btn-pri`/`.btn-ghost`/`.btn-danger`/`.btn-sm`, `.card` (base), `.topbar`, `.brand`/`.mk`, `.band`/`.band-in`/`.eyebrow`/`.sub`/`.waves`, `.pill`, `.notice` (base), `.field`/`.label`/`.input`, `.page`. Poker keeps its OWN `.btn-primary`, all `.entry-*`/`.preview-*`/`.room-*`/`.vote-*`/`.participant-*`/`.result-*` classes, and the card/flip classes — those ARE re-declared in `poker.css`.
- **Drop dead admin CSS.** `app.css` carries ~500 lines of `.admin-*` rules, but there is no `admin.html` shell and no JS emits `admin-*` classes — they are dead. Do NOT port them to `poker.css`.

---

## Task 0: Branch setup (poker repo)

**Files:** none (git only)

- [ ] **Step 1: Branch off the live branch**

```bash
cd /var/www/scrumpoker
git switch main
git switch -c feat/instrument-poker
git status
```
Expected: on `feat/instrument-poker`, clean tree (ignore any known untracked `test-results/`, `.vscode/`, `docs/` scratch files).

- [ ] **Step 2: Push as backup**

```bash
cd /var/www/scrumpoker
git push -u origin feat/instrument-poker
```

---

## Task 1: Sync foundation into Poker + drift guard + drop old fonts/glyph/cardback

**Files:**
- Create (via sync): `public/css/instrument-core.css`, `public/js/oscilloscope.js`, `public/illos/glyphs.svg`, `public/fonts/*.woff2`
- Create: `tests/theme-drift.test.js`
- Delete: `public/fonts/Fraunces.woff2`, `public/fonts/Inter.woff2`, `public/fonts/JetBrainsMono.woff2`, `public/illos/theme-illos.svg`, `public/images/cardback.jpg`

- [ ] **Step 1: Write the failing drift test**

Create `/var/www/scrumpoker/tests/theme-drift.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

test("poker's synced Instrument assets match the foundation source", async () => {
  const mod = await import("/var/www/suite/shared/theme/check-theme-drift.mjs");
  const r = mod.driftReport("/var/www/scrumpoker");
  assert.deepEqual(r.missing, [], "no missing synced assets");
  assert.deepEqual(r.mismatched, [], "no drifted synced assets");
  assert.equal(r.ok, true);
});
```
(The drift module is ESM; this CommonJS test loads it with dynamic `import()`. The absolute path is correct on this single-box deployment.)

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd /var/www/scrumpoker && node --test tests/theme-drift.test.js`
Expected: FAIL — `missing` lists `css/instrument-core.css`, `js/oscilloscope.js`, `illos/glyphs.svg`, and the 8 woff2 fonts (not synced yet).

- [ ] **Step 3: Run the sync**

```bash
node /var/www/suite/shared/theme/sync-theme.mjs /var/www/scrumpoker
```
Expected: `synced 11 assets -> /var/www/scrumpoker`.

- [ ] **Step 4: Run it — expect PASS**

Run: `cd /var/www/scrumpoker && node --test tests/theme-drift.test.js`
Expected: PASS.

- [ ] **Step 5: Remove the now-unused old fonts + brand glyph sprite + card-back raster**

`theme-illos.svg` is used in Poker ONLY as the license-page brand glyph (`#sticker-circle`), replaced by `glyphs.svg#glyph-poker` in Task 5. `cardback.jpg` is replaced by the `.pkback` CSS lattice (Tasks 3-5).

```bash
cd /var/www/scrumpoker
git rm public/fonts/Fraunces.woff2 public/fonts/Inter.woff2 public/fonts/JetBrainsMono.woff2 public/illos/theme-illos.svg public/images/cardback.jpg
```

- [ ] **Step 6: Commit**

```bash
cd /var/www/scrumpoker
git add public/css/instrument-core.css public/js/oscilloscope.js public/illos/glyphs.svg public/fonts tests/theme-drift.test.js
git status
git commit -m "feat(poker): sync Instrument foundation + drift guard; drop old fonts, theme-illos, cardback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `poker.css` part A — tokens, base, inputs, buttons, chrome, modal, status/connection

**Files:**
- Create: `public/css/poker.css` (new, Poker-owned, NOT drift-checked)

This task ports the parts of `theme-core.css` + `theme-poker.css` that Instrument does NOT provide, scoped under `.ins`, re-pointed to Instrument tokens via the mapping table. **Crucially: restyle Poker's own button classes here** so the shells need no class churn (read `public/css/app.css` lines ~243-326 + ~507-552 for the originals).

- [ ] **Step 1: Create `poker.css` with the token + base + utility + button + chrome layer**

```css
/* poker.css — Poker-owned layer over instrument-core.css.
   Holds everything Instrument doesn't provide, re-pointed to Instrument tokens.
   Loaded AFTER instrument-core.css. NOT part of the synced foundation. */

.ins{
  /* Spacing + radii + shadows Instrument doesn't define */
  --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-6:24px; --s-8:32px; --s-12:48px;
  --r-sm:6px; --r-md:8px; --r-lg:12px; --r-xl:16px; --r-pill:999px;
  --shadow-sm:0 1px 0 rgba(20,30,28,0.04);
  --shadow-md:0 1px 0 rgba(20,30,28,0.04), 0 8px 24px rgba(20,30,28,0.06);
  --shadow-lg:0 1px 0 rgba(20,30,28,0.04), 0 16px 44px rgba(20,30,28,0.10);
  /* Poker-local danger red (foundation has no red token) */
  --danger:oklch(0.5 0.13 25);
  --danger-bg:color-mix(in oklab, oklch(0.5 0.13 25) 12%, var(--panel));
  /* Semantic aliases mapped onto the Instrument palette */
  --ok:var(--green); --ok-bg:var(--greenwash);
  --warn:oklch(0.5 0.12 60); --warn-bg:var(--amberwash);
  --err:var(--danger); --err-bg:var(--danger-bg);
  --info:var(--teal); --info-bg:var(--tealwash);
  --accent-on:#fff; --accent-deep:var(--accent);
  --accent-soft:oklch(0.235 0.013 250 / 0.12);   /* translucent ink — focus ring / halo */
  --mono-font:'IBM Plex Mono', ui-monospace, monospace;
}

/* The HTML [hidden] attr and .hidden class must always win over layout display.
   SECURITY-RELEVANT: keeps facilitator-only controls + observer note hidden. */
[hidden]{display:none !important;}
.ins .hidden{display:none !important;}

/* Utilities not in Instrument */
.ins .kicker{font-family:var(--mono-font); font-size:0.66rem; font-weight:600; text-transform:uppercase; letter-spacing:0.12em; color:var(--soft);}
.ins .muted{color:var(--soft);}
.ins .faint{color:var(--faint); font-size:0.85rem;}
.ins .mono{font-family:var(--mono-font);}
.ins .center{text-align:center;}

/* App-footer (Poker links /license at the bottom of each shell) */
.ins .app-footer{text-align:center; padding:var(--s-6); font-size:0.8rem; color:var(--faint);}
.ins .app-footer a{color:var(--faint);}

/* Inputs / selects (Poker markup uses .field > span + bare input/select) */
.ins input[type="text"], .ins input[type="email"], .ins input[type="password"],
.ins input[type="number"], .ins select, .ins textarea{
  width:100%; padding:10px 12px; border:1px solid var(--line2); border-radius:var(--r-md);
  background:var(--bone); color:var(--ink); font:inherit;
  transition:border-color 120ms ease, box-shadow 120ms ease;
}
.ins input::placeholder, .ins textarea::placeholder{color:var(--faint);}
.ins input:focus, .ins select:focus, .ins textarea:focus{
  outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft);
}
.ins .field{display:block; margin-bottom:var(--s-4);}
.ins .field > span{display:block; font-weight:600; font-size:0.85rem; margin-bottom:var(--s-1); color:var(--ink);}
.ins .form-error{margin:0; min-height:1.2rem; color:var(--danger); font-size:0.9rem;}

/* Poker's OWN buttons (kept in markup; restyled onto Instrument).
   Primary = ink (the accent — monochrome poker = dark buttons). */
.ins .btn-primary{
  background:var(--accent); border:1px solid var(--accent); color:#fff;
  box-shadow:0 1px 2px rgba(20,30,28,0.16);
}
.ins .btn-primary:hover:not(:disabled){filter:brightness(1.15); transform:translateY(-1px); box-shadow:0 4px 12px rgba(20,30,28,0.20);}
.ins .btn-primary:disabled{opacity:0.55; cursor:not-allowed; transform:none; filter:none;}

/* Toolbar + invite-popover + facilitator buttons */
.ins .toolbar-action{
  min-height:2.25rem; border:1px solid var(--line2); border-radius:var(--r-md);
  background:var(--panel); color:var(--ink); font:inherit; font-size:0.84rem; font-weight:700;
  cursor:pointer; padding:0.42rem 0.65rem;
  transition:border-color 120ms ease, color 120ms ease, background 120ms ease;
}
.ins .toolbar-action:hover:not(:disabled){border-color:var(--accent); color:var(--accent);}
.ins .toolbar-action.danger{border-color:color-mix(in oklab, var(--danger) 45%, var(--line2)); background:var(--danger-bg); color:var(--danger);}
.ins .toolbar-action.danger:hover:not(:disabled){border-color:var(--danger);}

.ins .invite-action{
  width:100%; min-height:2.4rem; border:0; border-radius:calc(var(--r-md) - 2px);
  background:transparent; color:var(--ink); cursor:pointer; font:inherit; font-size:0.86rem;
  font-weight:600; padding:0.5rem 0.6rem; text-align:left;
}
.ins .invite-action:hover:not(:disabled){background:var(--bone);}
.ins .invite-action:disabled{cursor:not-allowed; opacity:0.68;}

.ins .text-action{border:0; background:none; color:var(--accent); font:inherit; font-size:0.88rem; font-weight:600; cursor:pointer; padding:0; text-decoration:none;}
.ins .text-action:hover{text-decoration:underline;}
.ins .text-action.danger{color:var(--danger);}

.ins .success-action, .ins .secondary-action, .ins .danger-action{
  min-height:2.75rem; border:1px solid transparent; border-radius:var(--r-md);
  font:inherit; font-weight:700; cursor:pointer; padding:0.7rem 1rem;
  transition:filter 120ms ease, background 120ms ease, border-color 120ms ease;
}
.ins .success-action{background:var(--green); color:#fff;}
.ins .success-action:hover:not(:disabled){filter:brightness(1.1);}
.ins .secondary-action{background:var(--panel); color:var(--ink); border-color:var(--line2);}
.ins .secondary-action:hover:not(:disabled){border-color:var(--accent); color:var(--accent);}
.ins .danger-action{background:var(--danger); color:#fff;}
.ins .danger-action:hover:not(:disabled){filter:brightness(1.1);}
.ins .success-action:disabled, .ins .secondary-action:disabled, .ins .danger-action:disabled{cursor:not-allowed; opacity:0.62;}

/* Status pills */
.ins .status-pill{display:inline-flex; align-items:center; min-height:1.6rem; padding:0.2rem 0.6rem; border-radius:var(--r-pill); background:var(--greenwash); color:var(--green); font-size:0.8rem; font-weight:700;}
.ins .status-pill.is-locked{background:var(--tealwash); color:var(--teal);}
.ins .section-kicker{color:var(--soft); font-size:0.78rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;}

/* Connection-status indicator (re-tokenised from hardcoded hexes) */
.ins #connection-status, #connection-status{position:fixed; top:10px; right:10px; padding:5px 10px; border-radius:var(--r-md); font-size:0.8rem; font-weight:700; z-index:100;}
#connection-status.connected{background:var(--greenwash); color:var(--green);}
#connection-status.disconnected{background:var(--danger-bg); color:var(--danger);}
#connection-status.connecting{background:var(--amberwash); color:oklch(0.5 0.12 60);}

/* Modal (Poker keeps .modal-overlay/.modal-content/.modal-actions markup) */
.ins .modal-overlay{position:fixed; inset:0; background:oklch(0.235 0.013 250 / 0.48); display:flex; align-items:center; justify-content:center; z-index:50; padding:var(--s-4);}
.ins .modal-overlay.hidden{display:none;}
.ins .modal-content{width:min(420px,100%); background:var(--panel); border:1px solid var(--line2); border-radius:var(--r-xl); box-shadow:var(--shadow-lg); padding:var(--s-6);}
.ins .modal-content h2{margin:0 0 var(--s-2);}
.ins .modal-actions{display:flex; justify-content:flex-end; gap:var(--s-2); margin-top:var(--s-6);}
```

- [ ] **Step 2: Sanity-check it parses (braces balanced)**

Run: `cd /var/www/scrumpoker && node -e "const c=require('fs').readFileSync('public/css/poker.css','utf8');const o=(c.match(/{/g)||[]).length,cl=(c.match(/}/g)||[]).length;if(o!==cl)throw new Error('brace mismatch '+o+'/'+cl);console.log('braces ok',o)"`
Expected: `braces ok <n>` (balanced).

- [ ] **Step 3: Commit**

```bash
cd /var/www/scrumpoker
git add public/css/poker.css
git status
git commit -m "feat(poker): poker.css part A — tokens, base, inputs, buttons, chrome, modal, status

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `poker.css` part B — app components + the card system (re-tokenized)

**Files:**
- Modify: `public/css/poker.css` (append)

Append all of Poker's app-specific components, re-pointed to Instrument tokens via the mapping table, scoped under `.ins`. **This is a faithful re-tokenization of existing, working rules in `public/css/app.css`** — read the source and apply the mapping; do not redesign layout. Scope every selector with a leading `.ins `. **Skip the dead `.admin-*` rules entirely** (no shell consumes them).

Component groups to migrate (from `app.css`, grouped):
- **Page shells:** `.app-page`, `.entry-shell`, `.entry-card`, `.entry-preview`, `.entry-form` (re-token; preview cards handled in the worked example below).
- **Preview pane:** `.preview-header`, `.preview-stage`, `.preview-card`/`.preview-card-back`/`.preview-card-front`/`.preview-card-small` (back becomes a `.pkback` lattice — worked example), `.preview-votes` (+ `span`).
- **Room:** `.room-shell`, `.room-header`, `.room-heading`, `.room-display`, `.room-org` (room subtitle), `.room-admin-link`, `.room-userbar`, `.user-greeting`, `.room-actions`, `.invite-menu-wrap`, `.invite-menu`, `.room-grid`, `.room-card`, `.section-heading`(+`.compact`).
- **Vote deck + cards:** `.voting-deck`(+`.is-disabled`), `.observer-note`, `.room-error`, and the **card system** (`.vote-card`/`.card-inner`/`.card-face`/`.card-front`/`.card-back`/`.is-face-down`/`.selected`, the `.card-container`/`.flip-card`/`.flipped` participant indicator, `.vote-checkmark`) — worked examples below.
- **Participants / results:** `.participants-list`, `.ordered-votes-list`, `.participant-row`/`.result-row`, `.participant-info`, `.participant-name`(+`.is-current-user`), `.participant-role`(+`.is-facilitator`), `.participant-role-controls`, `.participant-role-select`, `.participant-vote`, `.result-card`, `#average-vote`/`.result-value`, `.grouped-results`, `.result-names`.
- **Facilitator controls:** `.facilitator-controls` (the button classes themselves are styled in Task 2).
- **License page:** `.license-wrap` (+ its `h1`/`p`/`a`/`pre`) re-tokenized onto Instrument (drop the hardcoded `#111827`/`#374151`/`#1d4ed8` hexes → `--ink`/`--soft`/`--accent`; the `pre` background → `--bone`).
- **Responsive overrides:** keep the `@media (max-width:820px)` and `(max-width:520px)` blocks verbatim (they reference the classes above; no token swap needed beyond what the rules already use).

Apply these replacements while migrating each rule: `var(--border)`→`var(--line)`, `var(--border-st)`→`var(--line2)`, `var(--surface)`→`var(--panel)`, `var(--bg)`/`var(--bg-warm)`→`var(--bone)`, `var(--muted)`→`var(--soft)`, `var(--accent-soft)`→`var(--accent-soft)` (now the translucent ink from Task 2), `var(--mono)`→`var(--mono-font)`; `--ok`/`--warn`/`--info`/`--err`/`--err-bg`/`--accent`/`--accent-deep`/`--faint` are aliased in Task 2 so they resolve. Replace the literal hover hexes (`#edf2f7`, `#14874a`, `#c9343a`, `#dcfce7`, etc.) with token-based equivalents (`filter:brightness()` or the mapped tokens, as shown in Task 2's button rules).

- [ ] **Step 1: Worked example — the vote card system (`.pkfront`/`.pkback` faces + flip + selected)**

Keep the 3-D flip mechanic; restyle the faces to Instrument playing cards. The back is a **CSS lattice** (no image), the front is a bone card with an ink number in Bricolage. Append:

```css
.ins .voting-deck{display:grid; grid-template-columns:repeat(8, minmax(0,1fr)); gap:0.7rem; align-items:center;}
.ins .voting-deck.is-disabled{opacity:0.62; pointer-events:none;}

/* The button wrapper keeps the 3-D perspective + flip mechanic (unchanged geometry) */
.ins .vote-card{appearance:none; border:0; background:transparent; width:100%; aspect-ratio:64/90; min-width:0; padding:0; perspective:1000px; cursor:pointer; transition:transform 0.2s ease, opacity 0.2s ease;}
.ins .vote-card:hover:not(:disabled){transform:translateY(-4px);}
.ins .vote-card:focus-visible{outline:3px solid var(--accent-soft); outline-offset:3px;}
.ins .vote-card:disabled{cursor:not-allowed; opacity:0.55;}
.ins .vote-card .card-inner{width:100%; height:100%; position:relative; transform-style:preserve-3d; transition:transform 0.6s cubic-bezier(0.4,2,0.4,0.8);}
.ins .vote-card .card-inner.is-face-down{transform:rotateY(180deg);}
.ins .vote-card .card-face{position:absolute; inset:0; backface-visibility:hidden; display:flex; align-items:center; justify-content:center; border-radius:9px; box-shadow:0 7px 16px oklch(0.235 0.013 250 / 0.12);}

/* .pkfront — number card: bone face, ink number, Bricolage 700 */
.ins .pkfront, .ins .vote-card .card-front{
  background:var(--panel); color:var(--ink); border:1px solid var(--line2);
  font-family:'Bricolage Grotesque', var(--mono-font); font-weight:700; font-size:1.5rem;
}
/* .pkback — CSS lattice (replaces cardback.jpg); rotated for the flip back face */
.ins .pkback, .ins .vote-card .card-back{
  border:1px solid var(--accent);
  background-color:var(--ink);
  background-image:repeating-linear-gradient(45deg, oklch(1 0 0 / 0.10) 0 2px, transparent 2px 8px),
                   repeating-linear-gradient(-45deg, oklch(1 0 0 / 0.10) 0 2px, transparent 2px 8px);
}
.ins .vote-card .card-back{transform:rotateY(180deg); overflow:hidden;}

/* Selected card: ink outline + translucent ink glow (alpha, NOT a *wash) */
.ins .vote-card.selected .card-front{border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft), 0 10px 24px oklch(0.235 0.013 250 / 0.14);}
.ins .vote-checkmark{position:absolute; top:-0.35rem; right:-0.35rem; min-width:1.2rem; min-height:1.2rem; border-radius:999px; background:var(--green); color:#fff; display:grid; place-items:center; font-size:0.72rem; font-weight:700; box-shadow:var(--shadow-sm);}
```

- [ ] **Step 2: Worked example — the participant mini card-indicator (second flip card)**

`app.js` builds a small `.card-container > .card-inner.flip-card` (44×62) to show each participant's vote state. Re-token it to the same card look. Append:

```css
.ins .card-container{perspective:1000px; width:44px; height:62px; position:relative;}
.ins .card-container .card-inner, .ins .card-container .flip-card{width:100%; height:100%; position:relative; transform-style:preserve-3d; transition:transform 0.6s cubic-bezier(0.4,2,0.4,0.8);}
.ins .card-container .flip-card.flipped, .ins .card-container .card-inner.is-face-down{transform:rotateY(180deg);}
.ins .card-container .card-front{background:var(--panel); color:var(--ink); font-size:1.05rem; font-family:'Bricolage Grotesque', var(--mono-font); font-weight:700;}
.ins .card-container .card-back{background-color:var(--ink); background-image:repeating-linear-gradient(45deg, oklch(1 0 0 / 0.10) 0 2px, transparent 2px 8px), repeating-linear-gradient(-45deg, oklch(1 0 0 / 0.10) 0 2px, transparent 2px 8px); transform:rotateY(180deg); font-size:1rem;}
```
(These selectors reuse the `.card-face` base from Step 1 for borders/shadows. If `app.js` does not add `.card-face` to the container faces, add `border-radius:8px; border:1px solid var(--line2);` to the `.card-container .card-front`/`.card-back` rules — confirm against `app.js`.)

- [ ] **Step 3: Worked example — the entry-preview cards (static, no image)**

The static `index.html` preview shows a fanned card stack. The back card becomes a `.pkback` lattice div (the `<img>` is removed in Task 5). Append:

```css
.ins .preview-stage{min-height:250px; border:1px solid var(--line); border-radius:var(--r-md); background:var(--bone); position:relative; display:grid; place-items:center; overflow:hidden;}
.ins .preview-card{width:108px; aspect-ratio:64/90; border-radius:9px; border:1px solid var(--line2); box-shadow:0 12px 28px oklch(0.235 0.013 250 / 0.14); display:grid; place-items:center; font-weight:700; font-family:'Bricolage Grotesque', var(--mono-font);}
.ins .preview-card-back{grid-area:1 / 1; transform:rotate(-8deg) translateX(-52px); border-color:var(--accent); background-color:var(--ink); background-image:repeating-linear-gradient(45deg, oklch(1 0 0 / 0.10) 0 2px, transparent 2px 8px), repeating-linear-gradient(-45deg, oklch(1 0 0 / 0.10) 0 2px, transparent 2px 8px);}
.ins .preview-card-front{grid-area:1 / 1; background:var(--panel); color:var(--ink); font-size:2.6rem; transform:rotate(7deg) translateX(46px);}
.ins .preview-card-small{position:absolute; right:15%; bottom:14%; width:68px; background:var(--panel); color:var(--soft); font-size:1.35rem;}
.ins .preview-header{display:flex; align-items:center; justify-content:space-between; gap:0.75rem; color:var(--soft); font-weight:700;}
.ins .preview-votes{display:grid; grid-template-columns:repeat(8, minmax(0,1fr)); gap:0.5rem;}
.ins .preview-votes span{min-height:2.25rem; border:1px solid var(--line); border-radius:var(--r-md); background:var(--panel); display:grid; place-items:center; color:var(--ink); font-weight:700;}
```

- [ ] **Step 4: Migrate ALL remaining component groups** listed above the same way (faithful copy from `app.css` + `.ins ` prefix + token swap; skip `.admin-*`). Re-token `.participant-name.is-current-user`→`var(--accent)`, `.participant-role.is-facilitator`→`var(--warn)` (was `#ad6200`), `#average-vote`/`.result-value`→`var(--accent)`, the `.license-wrap` hardcoded hexes→tokens. Keep the two `@media` responsive blocks. Do NOT re-declare the classes Instrument owns (header list).

- [ ] **Step 5: Sanity-check braces balance**

Run: `cd /var/www/scrumpoker && node -e "const c=require('fs').readFileSync('public/css/poker.css','utf8');const o=(c.match(/{/g)||[]).length,cl=(c.match(/}/g)||[]).length;if(o!==cl)throw new Error('mismatch '+o+'/'+cl);console.log('braces ok',o)"`
Expected: balanced.

- [ ] **Step 6: Commit**

```bash
cd /var/www/scrumpoker
git add public/css/poker.css
git status
git commit -m "feat(poker): poker.css part B — room/cards/preview/participants/results re-tokenized

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `cardDeck.js` — card back becomes a styled `.pkback` div (no `<img>`)

**Files:**
- Create: `tests/carddeck.test.js`
- Modify: `public/js/cardDeck.js:9-51` (`createVotingCard`)

`createVotingCard` accepts an injected `document`, so a tiny fake-DOM stub tests it without jsdom. The edit: stop creating the `<img>` back; mark the back face `.pkback` and the front `.pkfront` (CSS draws the lattice).

- [ ] **Step 1: Write the failing unit test**

Create `/var/www/scrumpoker/tests/carddeck.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// cardDeck.js is a browser IIFE that attaches to `window`. It CANNOT be
// require()'d in Node (it runs `(function(window){...})(window)` against the
// global `window`, which is undefined → ReferenceError). Instead read it as
// text and execute it against a stub `window` via new Function.
function loadCardDeck() {
  const win = {};
  const code = fs.readFileSync(path.join(__dirname, "../public/js/cardDeck.js"), "utf8");
  new Function("window", code)(win);
  return win.ScrumPokerCardDeck;
}
const { createVotingCard } = loadCardDeck();

// Minimal fake document — createVotingCard only uses these DOM bits.
function fakeDoc() {
  const created = [];
  const make = (tag) => {
    const node = {
      tagName: tag.toUpperCase(), dataset: {}, _classes: new Set(), children: [],
      classList: { add(...c) { c.forEach((x) => node._classes.add(x)); }, contains(x) { return node._classes.has(x); } },
      appendChild(c) { node.children.push(c); return c; },
      addEventListener() {}, _text: "",
      set textContent(v) { node._text = v; }, get textContent() { return node._text; },
      set src(v) { node._src = v; }, set alt(v) { node._alt = v; },
    };
    created.push(node);
    return node;
  };
  return { document: { createElement: make }, created };
}

test("createVotingCard builds .pkfront/.pkback faces and NO <img> back", () => {
  const { document, created } = fakeDoc();
  const btn = createVotingCard({ document, value: "8" });
  assert.equal(btn.tagName, "BUTTON");
  assert.ok(!created.some((n) => n.tagName === "IMG"), "must not create an <img> back");
  assert.ok(created.some((n) => n.classList.contains("pkback")), "back face marked .pkback");
  assert.ok(created.some((n) => n.classList.contains("pkfront")), "front face marked .pkfront");
});

test("createVotingCard front face carries the value", () => {
  const { document, created } = fakeDoc();
  createVotingCard({ document, value: "13" });
  const front = created.find((n) => n.classList.contains("card-front"));
  assert.equal(front.textContent, "13");
});
```
(`loadCardDeck` executes `cardDeck.js`'s IIFE against a stub `window` and returns `window.ScrumPokerCardDeck` — no jsdom needed.)

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd /var/www/scrumpoker && node --test tests/carddeck.test.js`
Expected: FAIL — current code creates an `<img>` (IMG node present) and marks no `.pkback`/`.pkfront`.

- [ ] **Step 3: Edit `createVotingCard` in `public/js/cardDeck.js`**

Replace the back-face + front-face block (current lines ~22-44) so the back is a styled div and both faces carry the `.pk*` marker. The new body of the relevant section:

```js
    const cardInner = document.createElement('div');
    cardInner.classList.add('card-inner');

    const cardBack = document.createElement('div');
    cardBack.classList.add('card-face', 'card-back', 'pkback');

    const cardFront = document.createElement('div');
    cardFront.classList.add('card-face', 'card-front', 'pkfront');
    cardFront.textContent = value;

    cardInner.appendChild(cardBack);
    cardInner.appendChild(cardFront);
    cardButton.appendChild(cardInner);
```
Also remove the now-unused `cardBackImageSrc` parameter from the `createVotingCard` destructure (line ~15) — it is no longer referenced.

- [ ] **Step 4: Run it — expect PASS**

Run: `cd /var/www/scrumpoker && node --test tests/carddeck.test.js`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
cd /var/www/scrumpoker
git add tests/carddeck.test.js public/js/cardDeck.js
git status
git commit -m "feat(poker): card back is a CSS .pkback lattice, not a raster image

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Reskin the three static shells

**Files:**
- Modify: `public/index.html`, `public/join.html`, `public/license.html`

Mechanical transformation per shell:
- In `<head>`: replace the four CSS links (`theme-core.css`, `theme-poker.css`, `app.css`, `breathing-waves.css`) with exactly `<link rel="stylesheet" href="/css/instrument-core.css">` then `<link rel="stylesheet" href="/css/poker.css">`.
- `<body>`: keep the page-specific class, add `ins` + `data-app`: `class="app-page"` → `class="ins app-page" data-app="poker"`; `class="legal-page"` → `class="ins legal-page" data-app="poker"`.
- Header band: `<header class="header-band" data-breathing-waves data-wave-palette="poker"><canvas></canvas><div class="header-content"><p class="eyebrow">X</p><h1 class="header-title" …>Y</h1><p class="header-subtitle" …>Z</p></div></header>` → `<div class="band"><div class="waves"></div><div class="band-in"><div class="eyebrow">X</div><h1 …>Y</h1><p class="sub" …>Z</p></div></div>` (preserve inner element ids like `#room-display`, `#room-org`, `#entry-title`).
- Script tail: replace `<script src="js/breathing-waves.js" defer></script>` with `<script type="module" src="/js/oscilloscope.js"></script>` (keep every other `<script>` + order, including `/auth-client/heartbeat.js`).
- The `app-footer` license link already exists on every shell — keep it.

- [ ] **Step 1: Edit `public/index.html`** (entry + room + modals — targeted chrome edits, body markup unchanged)

Apply: head links (4→2), `<body class="ins app-page" data-app="poker">`, both band swaps (entry + room), script-tail swap. The entry band (lines ~24-31) becomes:

```html
        <div class="band"><div class="waves"></div><div class="band-in">
          <div class="eyebrow">Planning room</div>
          <h1 id="entry-title">Scrum Poker</h1>
          <p class="sub">Join a shared estimation room.</p>
        </div></div>
```
The room band (lines ~90-98) becomes:

```html
        <div class="band"><div class="waves"></div><div class="band-in">
          <div class="eyebrow">Estimation room</div>
          <h1>Scrum Poker Room</h1>
          <p class="sub room-display" id="room-display"></p>
          <p class="sub room-org" id="room-org"></p>
        </div></div>
```
Replace the preview-back `<img>` (lines ~69-71) with a lattice div:

```html
                <div class="preview-card preview-card-back"></div>
```
The script tail (lines ~7-11) keeps `cardDeck.js`, `clipboard.js`, `app.js`, `/auth-client/heartbeat.js` and swaps breathing-waves for the module:

```html
    <script src="js/cardDeck.js?v=2" defer></script>
    <script src="js/clipboard.js?v=1" defer></script>
    <script src="js/app.js?v=19" defer></script>
    <script type="module" src="/js/oscilloscope.js"></script>
    <script src="/auth-client/heartbeat.js" defer></script>
```
(Bump `cardDeck.js?v=1`→`?v=2` and `app.js?v=18`→`?v=19` so browsers re-fetch the changed JS despite no asset cache-buster.) The two `<div id="*-modal" class="modal-overlay hidden">` blocks and the `<footer class="app-footer">` are unchanged.

- [ ] **Step 2: Edit `public/join.html`** (anonymous entry — focused, NO band on the entry screen)

Apply head links (4→2) and `<body class="ins app-page" data-app="poker">`. The anonymous **entry** screen (`#join-section`, lines ~18-26) drops its band for a focused card (Poker's analogue of Retro's join / Signal's respond):

```html
    <main id="join-section" class="login-page">
        <div class="entry-shell" style="grid-template-columns:1fr; max-width:480px;">
        <section class="entry-card" aria-labelledby="entry-title">
            <h1 id="entry-title">Join a room</h1>
            <p class="sub">Enter your name to join this estimation room.</p>
            <div class="entry-form">
                <label class="field" id="name-field" for="join-name-input">
                    <span>Your name</span>
                    <input type="text" id="join-name-input" placeholder="Your name" autocomplete="name" maxlength="80">
                </label>
                <button id="join-button" class="btn btn-primary">Join</button>
                <p id="join-error" class="form-error hidden"></p>
            </div>
        </section>
        </div>
    </main>
```
The `#poker-room-section` band (lines ~47-54) gets the SAME room-band swap as index Step 1 (room band, with `#room-display`). Script tail (lines ~115-117) keeps `cardDeck.js` (bump `?v=2`) + `join.js`, swaps breathing-waves:

```html
    <script src="js/cardDeck.js?v=2" defer></script>
    <script type="module" src="/js/oscilloscope.js"></script>
    <script src="js/join.js?v=1" defer></script>
```
(The inline `style` on `.entry-shell` is acceptable only if Poker's CSP allows inline styles — it currently does, since `index.html` ships no CSP meta and the server sets none restricting `style-src`. If a strict CSP is present, instead add a `.join-narrow` class to `poker.css` and use it here. Confirm by checking the served response headers before relying on the inline style.)

- [ ] **Step 3: Rewrite `public/license.html`** (band + page; keep ALL the licence `<pre>`/`<p>` text verbatim — full file)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>License | Scrum Poker Tool</title>
  <link rel="stylesheet" href="/css/instrument-core.css">
  <link rel="stylesheet" href="/css/poker.css">
  <script type="module" src="/js/oscilloscope.js"></script>
</head>
<body class="ins legal-page" data-app="poker">
  <div class="band"><div class="waves"></div><div class="band-in">
    <span class="brand"><svg class="mk" width="22" height="22" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-poker"/></svg> <span>Scrum Poker</span></span>
    <div class="eyebrow">Legal</div>
    <h1>Scrum Poker Free Use License</h1>
    <p class="sub">This tool is free to use, but it is not open source.</p>
  </div></div>

  <main class="license-wrap">
    <p>You may use the software at no cost, but you may not copy, redistribute, modify, or sell it.</p>
    <p>The software is provided "as is" and all responsibility for Scrum implementation and outcomes remains with the user. Return to the <a href="/">main app</a>.</p>
    <pre>Scrum Poker Free Use License
Version 1.0
Effective date: February 13, 2026

Copyright (c) 2026 David Jackson
All rights reserved.

1. Grant of License
You are granted a limited, personal, non-exclusive, non-transferable,
revocable license to use this Scrum Poker software at no charge.

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
- sprint failure, delivery failure, missed deadlines, cost overruns, or any
  project outcome;
- incorrect estimation, planning, backlog management, team performance, or
  implementation of Scrum or Agile practices;
- any business, operational, or technical decision made by users of the
  software.

By using the software, you acknowledge that responsibility for use of the
software and implementation of Scrum practices lies solely with the user.

6. Termination
This license terminates automatically if you breach any term. On termination,
you must stop using the software immediately.

7. Governing Law
This license is governed by the laws of England and Wales, excluding conflict
of law rules.</pre>
  </main>
  <footer class="app-footer"><a href="/license">License Terms</a></footer>
</body>
</html>
```
(The oscilloscope module is included once, in `<head>`; `type="module"` defers it so it runs after parse and finds `.waves`.)

- [ ] **Step 4: Verify no stale references remain in any shell**

Run: `cd /var/www/scrumpoker && grep -rlE "theme-core|theme-poker|/css/app\.css|breathing-waves|brand-glyph|header-band|data-breathing|theme-illos|cardback" public/*.html`
Expected: NO output (all three shells migrated).

- [ ] **Step 5: Commit**

```bash
cd /var/www/scrumpoker
git add public/index.html public/join.html public/license.html
git status
git commit -m "feat(poker): reskin static shells to Instrument chrome + oscilloscope band (anon join no band)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Delete superseded CSS/JS + reference guards

**Files:**
- Delete: `public/js/breathing-waves.js`, `public/css/breathing-waves.css`, `public/css/theme-core.css`, `public/css/theme-poker.css`, `public/css/app.css`

No further JS logic changes are needed — Poker's JS emits its own class names (`participant-row`, `result-row`, `card-front`, `vote-card`, …), all restyled in `poker.css`; `cardDeck.js` was handled in Task 4.

- [ ] **Step 1: Confirm no `btn-pri` literal is needed and no JS references the deleted CSS**

Run: `cd /var/www/scrumpoker && grep -rn "btn-primary" public/js/ ; echo "---" ; grep -rnE "theme-core|theme-poker|/css/app\.css|breathing-waves" public/ | grep -vE "poker\.css|instrument-core"`
Expected: the first grep may show `btn-primary` only if JS builds buttons (confirm those are restyled in `poker.css` Task 2 — they are); the second grep returns NO output.

- [ ] **Step 2: Delete the superseded files**

```bash
cd /var/www/scrumpoker
git rm public/js/breathing-waves.js public/css/breathing-waves.css public/css/theme-core.css public/css/theme-poker.css public/css/app.css
```

- [ ] **Step 3: Confirm nothing still references them**

Run: `cd /var/www/scrumpoker && grep -rnE "breathing-waves|theme-core|theme-poker|/css/app\.css" public/ tests/ | grep -vE "poker\.css|instrument-core|theme-drift|theme-contrast"`
Expected: NO output (e2e specs are updated in Tasks 7-8; if a spec still references them, that is fixed there).

- [ ] **Step 4: Commit**

```bash
cd /var/www/scrumpoker
git status
git commit -m "feat(poker): remove breathing-waves + old theme/app CSS (superseded by Instrument)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Update the header e2e spec for the oscilloscope band (+ assert anon-join has NO band)

**Files:**
- Modify: `tests/e2e/header-waves.spec.js`

The old spec asserts `.header-band[data-breathing-waves]` + a `<canvas>`. The oscilloscope mounts an `<svg>` into `.band .waves`. **First read the existing spec** to reuse its auth/seed helpers + the pages it visits (it imports from `tests/e2e/helpers/`). Preserve auth + navigation; change only the header assertions, and ADD the anon-join no-band assertion.

- [ ] **Step 1: Rewrite the header assertions in `tests/e2e/header-waves.spec.js`**

For each banded view the spec reaches (the entry screen at `/`, and the room after joining), assert the band + a mounted trace:

```js
const band = page.locator(".band").first();
await expect(band).toBeVisible();
await expect.poll(async () => band.locator(".waves svg").count()).toBeGreaterThan(0);
```
Remove the old `[data-breathing-waves] canvas` / `.header-band` locators. **Add** an assertion that the anonymous join ENTRY screen has no band: navigate to a share-link `/join?...` (reuse the helper the anonymous-join spec uses, or visit `join.html` directly) and assert before joining:

```js
await expect(page.locator("#join-section .band")).toHaveCount(0);
```
Keep any `pageerror`/console-error listeners and keep asserting zero errors.

- [ ] **Step 2: Commit** (the run happens in Task 9's full e2e pass)

```bash
cd /var/www/scrumpoker
git add tests/e2e/header-waves.spec.js
git status
git commit -m "test(poker): header e2e targets the oscilloscope band; anon join has no band

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Update the palette contrast test

**Files:**
- Modify: `tests/theme-contrast.test.js`

The test pins the OLD Poker hexes (now unused). **First read the existing test** to match its import path for `lib/contrast` and its assertion helpers. Replace the map with the Instrument palette's hex equivalents and check the pairs Poker actually relies on. Derive the exact hexes from `instrument-core.css`'s oklch tokens (read them via devtools `getComputedStyle` or an oklch→hex converter) — do not guess. White-on-green (Show Votes) and white-on-danger (Reset/End) are **bold button labels** → mark them large/bold (≥3:1). **If a body pair fails AA, do not weaken the test — report it as a real accessibility finding.**

- [ ] **Step 1: Rewrite `tests/theme-contrast.test.js`** with the Instrument pairs

```js
// tests/theme-contrast.test.js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { contrastRatio, meetsAA } = require("../lib/contrast"); // match the existing import

// Instrument palette pairs Poker relies on. Hexes are the sRGB equivalents of
// the oklch tokens in instrument-core.css — derive exactly; confirm vs the synced CSS.
const INS = {
  bone:      "#F2F1EC",  // --bone
  panel:     "#FFFFFF",  // --panel
  ink:       "#2B2E33",  // --ink  oklch(0.235 0.013 250) — poker accent
  soft:      "#5F6770",  // --soft
  faint:     "#8A8E94",  // --faint
  green:     "#1F7A5C",  // --green  (Show Votes)
  greenwash: "#E2F3EA",  // --greenwash
  danger:    "#B23A33",  // --danger oklch(0.5 0.13 25) (Reset / End / Logout)
  white:     "#FFFFFF"
};

const BODY_PAIRS = [
  ["ink",  "bone"],
  ["ink",  "panel"],
  ["soft", "panel"],
  ["soft", "bone"],
  ["white", "ink"],     // primary button: white label on ink fill
  ["green", "greenwash"]
];

for (const [fg, bg] of BODY_PAIRS) {
  test(`instrument contrast: ${fg} on ${bg} meets AA body text`, () => {
    const ratio = contrastRatio(INS[fg], INS[bg]);
    assert.ok(meetsAA(INS[fg], INS[bg]),
      `${fg} (${INS[fg]}) on ${bg} (${INS[bg]}) = ${ratio.toFixed(2)}:1, need 4.5:1`);
  });
}

for (const bg of ["green", "danger"]) {
  test(`instrument contrast: white on ${bg} meets AA large/bold text`, () => {
    const ratio = contrastRatio(INS.white, INS[bg]);
    assert.ok(meetsAA(INS.white, INS[bg], { largeText: true }),
      `white on ${bg} = ${ratio.toFixed(2)}:1, need 3:1 large`);
  });
}
```
(If the existing `meetsAA` signature differs — e.g. no options arg — adapt: assert `contrastRatio(...) >= 3` for the large-text pairs. Match the real API in `lib/contrast.js`. If `white`/`green` clears 4.5:1, you may move it to `BODY_PAIRS`.)

- [ ] **Step 2: Run it**

Run: `cd /var/www/scrumpoker && node --test tests/theme-contrast.test.js`
Expected: PASS. If a body pair fails, the hex is wrong (re-derive) OR it is a real contrast gap — surface it, don't weaken.

- [ ] **Step 3: Commit**

```bash
cd /var/www/scrumpoker
git add tests/theme-contrast.test.js
git status
git commit -m "test(poker): contrast test pins the Instrument palette pairs (ink accent)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Full verification + visual pass + finish branch

**Files:** none (verification + merge)

- [ ] **Step 1: Unit suite**

Run: `cd /var/www/scrumpoker && npm test`
Expected: all `node --test tests/*.test.js` pass — new `theme-drift`, `carddeck`, updated `theme-contrast`, and the unchanged `build-info`/`http-app`/`roles`/`room-state`/`upgrade-auth`/`ws-*`. (The `tests/*.test.js` glob auto-includes the two new files.)

- [ ] **Step 2: E2E suite**

Run: `cd /var/www/scrumpoker && npm run test:e2e`
Expected: all Playwright specs pass — the rewritten `header-waves`, plus `anonymous-join`, `multi-user-room`, `scrum-poker-smoke`. If a smoke/join selector breaks, confirm it targets a presentational class that moved; update ONLY presentational selectors. **Never weaken** the anonymous-share-link join, observer-cannot-vote, facilitator-only-controls, or any company-scope assertions. Note: `scrum-poker-smoke.spec.js` references `cardDeck` — confirm it still passes with the `.pkback` (no-image) back; update only presentational expectations (e.g. an `img` locator → the `.card-back`/`.pkback` div).

- [ ] **Step 3: Drift check**

Run: `node /var/www/suite/shared/theme/check-theme-drift.mjs /var/www/scrumpoker`
Expected: `ok: /var/www/scrumpoker`.

- [ ] **Step 4: Visual pass — run Poker locally**

Boot Poker against a scratch DB (mirror `playwright.config.js`'s env / the e2e seed). Click through and compare to `shared/theme/preview.html` + the live Retro/Signal apps:
- `/` entry — oscilloscope band, entry form, **card-preview aside with `.pkback` lattice back + `.pkfront` number cards** + Fibonacci chips
- room (after Enter) — band with room/org subtitle, userbar (Invite/Role/End/Logout), **vote deck of `.pkfront` cards**, pick one (**ink outline + lift**), **Show Votes flips the deck** (`.pkback` lattice back shows during flip), participants list with role pills + mini card indicators, results + grouped results
- facilitator controls — **Show Votes = green, Reset/End Session = danger red**; Next Round = ghost
- modals — Role + End-session dialogs (Instrument card + translucent scrim); invite popover
- `/join?...` anonymous — **focused card, NO band**, name + Join; then the room (band appears)
- `/license` — band + glyph + licence text + footer link
- Confirm `prefers-reduced-motion` stops the oscilloscope trace.

- [ ] **Step 5: Final holistic review**

`cd /var/www/scrumpoker && git diff main..feat/instrument-poker`. Confirm: no leftover old-theme refs, no bare `.btn` without a variant, every element `id` / form `name` / route / WS message preserved, `.hidden`/`[hidden]` rules present, no `*wash` used where translucency is required (card halo/selection/scrim), the card back is a `.pkback` div (no `<img>`/`cardback.jpg` anywhere). Use superpowers:requesting-code-review for a fresh-eyes pass.

- [ ] **Step 6: Merge to the live branch + push**

```bash
cd /var/www/scrumpoker
git switch main
git merge --no-ff feat/instrument-poker -m "Merge Instrument Poker redesign (sub-project 4)"
git push origin main
git push origin feat/instrument-poker
```

- [ ] **Step 7: Deploy (operator-driven live session)**

On prod: `git pull` in `/var/www/scrumpoker` on `main`, `sudo systemctl restart scrumpoker` (port 3000, User=davidj, env `/etc/scrumpoker.env`), verify `curl -s -w '\n' localhost:3000/health`, then hard-refresh the browser (no asset cache-buster — same caveat as Hub/Signal/Retro). No npm install / no migration expected (views/CSS/JS only). Run interactively, one command per block — NOT part of automated execution.

---

## Notes for the implementer

- **No logic changes.** Markup/CSS/JS-presentation only. Preserve every element `id`, form `name`, route, WebSocket message, and API call. The ONLY functional JS edit is `cardDeck.js` dropping the `<img>` back for a `.pkback` div (Task 4).
- **Accent = ink.** Poker is monochrome (`data-app="poker"` → `--accent: --ink`). Primary buttons are dark/ink; the green is reserved for the affirmative Show-Votes action; destructive actions use the Poker-local `--danger` red.
- **Card system is the centerpiece.** Keep the flip mechanic (`.card-inner.is-face-down`); restyle faces to `.pkfront`/`.pkback`; the back is a pure-CSS lattice. There are TWO flip cards — the vote deck (`.vote-card`) and the participant indicator (`.card-container`).
- **Brand glyph only.** `theme-illos.svg#sticker-circle` (license page only) → `glyphs.svg#glyph-poker`. The file is deleted in Task 1.
- **No admin shell.** The `.admin-*` rules in `app.css` are dead (no `admin.html`, no JS emits them) — drop them, do not port.
- **`*wash` is opaque:** card hover halo, selection glow, and modal scrim use `oklch(.../alpha)`, never a `*wash` token (SP2 footgun).
- **`.hidden`/`[hidden]` are security-relevant:** re-declare both as `display:none!important` in `poker.css` (Task 2) — they hide facilitator-only controls + the observer note.
- **`.notice` footgun (from the hub):** Instrument `.notice` is `display:flex`. If any Poker notice gains inline markup (`<a>`, `<strong>`), wrap its text in a single `<span>` so it stays one flex item. (Poker currently uses `.form-error`/`.observer-note`, not `.notice`.)
- **Cross-repo:** the drift module + sync script live in `/var/www/suite/shared/theme/`; both repos are on the same box, so absolute paths are fine. Never hand-edit synced files (`instrument-core.css`, `oscilloscope.js`, `glyphs.svg`, `fonts/*`) — edit the foundation source + re-run `sync-theme.mjs`. `poker.css` is Poker-owned and exempt.
