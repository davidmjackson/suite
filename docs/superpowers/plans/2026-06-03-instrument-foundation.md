# Instrument Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared "Instrument" design-system foundation in `suite/shared/theme/` — one canonical token+component CSS, self-hosted fonts, the oscilloscope header, the glyph sprite, a preview style-guide, and sync/drift-check tooling — shipping no user-facing change.

**Architecture:** A single canonical source directory (`suite/shared/theme/`) holds the design assets plus two dependency-free Node scripts (`sync-theme.mjs`, `check-theme-drift.mjs`) that copy the assets into any surface's `public/{css,js,illos,fonts}/` and verify the copy hasn't drifted. The component CSS and the oscilloscope header are transcribed/ported from the approved handoff (`project-design-docs/design_handoff_sprint_suite/`). A standalone `preview.html` renders everything for visual acceptance.

**Tech Stack:** Plain CSS (oklch custom properties, `.ins` scope), vanilla ES modules (`.mjs`), `node:test`, self-hosted woff2 fonts, SVG. No build step, no runtime dependencies.

---

## Source of truth (read before starting)

- Component CSS + tokens: `project-design-docs/design_handoff_sprint_suite/directions/instrument.jsx` — the `InsCSS` `<style>` block, lines **6–64**.
- Oscilloscope header algorithm: `…/directions/shared.jsx` — `Waves`, `variant === 'scope'`, lines **32–48** and the SVG wrapper lines **58–68**.
- App glyphs: `…/directions/shared.jsx` — `Glyph`, lines **111–139**.
- Token table, type scale, spacing: `…/README.md` (the "Design Tokens" section).

This work happens on the existing branch `design/instrument-foundation` (the spec is already committed there). All paths below are relative to `/var/www/suite` unless absolute.

## File Structure

```
shared/theme/
  instrument-core.css       # tokens + @font-face + .ins component CSS (source of truth)
  oscilloscope.js           # vanilla ES module: build + mount the scope-trace SVG header
  glyphs.svg                # <symbol> sprite: suite/raid/signal/retro/poker app glyphs
  fonts/                    # self-hosted woff2 (Bricolage 700; Hanken 400/500/600/700; IBM Plex Mono 400/500/600)
  preview.html              # standalone kitchen-sink / living style guide (foundation-only)
  sync-theme.mjs            # copy source → a surface's public/{css,js,illos,fonts}
  check-theme-drift.mjs     # checksum a surface's synced copy vs source
  manifest.mjs              # shared list of synced assets (used by both tools)
  README.md                 # author / sync / consume instructions
  tests/
    sync-theme.test.mjs
    check-theme-drift.test.mjs
    oscilloscope.test.mjs
```

`manifest.mjs` is the single list of synced assets so `sync-theme` and `check-theme-drift` can never disagree about what's in scope.

---

### Task 1: Scaffold + the asset manifest

**Files:**
- Create: `shared/theme/manifest.mjs`
- Test: `shared/theme/tests/manifest.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `shared/theme/tests/manifest.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { ASSETS, SURFACES } from "../manifest.mjs";

test("manifest lists each asset with a source file and a public subdir", () => {
  assert.ok(ASSETS.length >= 3); // 3 static now; becomes 11 once fonts land (Task 3)
  for (const a of ASSETS) {
    assert.match(a.src, /\.(css|js|svg|woff2)$/, `${a.src} has an asset extension`);
    assert.match(a.destDir, /^(css|js|illos|fonts)$/, `${a.destDir} is a known public subdir`);
  }
});

test("the four apps + the hub are registered as surfaces with public roots", () => {
  const names = SURFACES.map((s) => s.name).sort();
  assert.deepEqual(names, ["hub", "poker", "raid", "retro", "signal"]);
  for (const s of SURFACES) assert.match(s.publicRoot, /\/public$/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /var/www/suite/shared/theme && node --test tests/manifest.test.mjs`
Expected: FAIL — cannot find module `../manifest.mjs`.

- [ ] **Step 3: Create the manifest**

Create `shared/theme/manifest.mjs`:

```js
// manifest.mjs — single source of truth for which foundation assets get synced
// into each surface, and where each surface lives. Fonts are expanded at runtime
// by reading the fonts/ dir, so adding a weight needs no edit here.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const THEME_DIR = dirname(fileURLToPath(import.meta.url));

// Non-font assets: { src (relative to THEME_DIR), destDir (public subdir) }.
const STATIC_ASSETS = [
  { src: "instrument-core.css", destDir: "css" },
  { src: "oscilloscope.js", destDir: "js" },
  { src: "glyphs.svg", destDir: "illos" },
];

function fontAssets() {
  let files = [];
  try {
    files = readdirSync(join(THEME_DIR, "fonts")).filter((f) => f.endsWith(".woff2"));
  } catch {
    files = [];
  }
  return files.map((f) => ({ src: `fonts/${f}`, destDir: "fonts" }));
}

export const ASSETS = [...STATIC_ASSETS, ...fontAssets()];

// Surface name -> its app repo public/ root. Single-box layout under /var/www.
export const SURFACES = [
  { name: "hub", publicRoot: "/var/www/suite/hub/public" },
  { name: "signal", publicRoot: "/var/www/signal/public" },
  { name: "retro", publicRoot: "/var/www/retrospective/public" },
  { name: "poker", publicRoot: "/var/www/scrumpoker/public" },
  { name: "raid", publicRoot: "/var/www/raid/public" },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /var/www/suite/shared/theme && node --test tests/manifest.test.mjs`
Expected: PASS (2 tests). `fontAssets()` returns `[]` for now (no fonts yet), so `ASSETS` has the 3 static entries — the `>= 3` assertion holds. Task 3 raises it to `>= 11` once the 8 fonts land.

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite
git add shared/theme/manifest.mjs shared/theme/tests/manifest.test.mjs
git commit -m "feat(theme): asset+surface manifest for the Instrument foundation"
```

---

### Task 2: `instrument-core.css` — tokens, fonts, components

**Files:**
- Create: `shared/theme/instrument-core.css`
- Reference: `project-design-docs/design_handoff_sprint_suite/directions/instrument.jsx` lines 6–64

- [ ] **Step 1: Author the file**

Create `shared/theme/instrument-core.css` with three parts, in order:

**(a) `@font-face` block** (self-hosted; the files arrive in Task 3). Use `font-display: swap` and the exact filenames Task 3 downloads:

```css
/* Instrument — self-hosted fonts (see shared/theme/fonts/) */
@font-face { font-family: "Bricolage Grotesque"; font-weight: 700; font-style: normal; font-display: swap; src: url("/fonts/bricolage-grotesque-700.woff2") format("woff2"); }
@font-face { font-family: "Hanken Grotesk"; font-weight: 400; font-style: normal; font-display: swap; src: url("/fonts/hanken-grotesk-400.woff2") format("woff2"); }
@font-face { font-family: "Hanken Grotesk"; font-weight: 500; font-style: normal; font-display: swap; src: url("/fonts/hanken-grotesk-500.woff2") format("woff2"); }
@font-face { font-family: "Hanken Grotesk"; font-weight: 600; font-style: normal; font-display: swap; src: url("/fonts/hanken-grotesk-600.woff2") format("woff2"); }
@font-face { font-family: "Hanken Grotesk"; font-weight: 700; font-style: normal; font-display: swap; src: url("/fonts/hanken-grotesk-700.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Mono"; font-weight: 400; font-style: normal; font-display: swap; src: url("/fonts/ibm-plex-mono-400.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Mono"; font-weight: 500; font-style: normal; font-display: swap; src: url("/fonts/ibm-plex-mono-500.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Mono"; font-weight: 600; font-style: normal; font-display: swap; src: url("/fonts/ibm-plex-mono-600.woff2") format("woff2"); }
```

**(b) The component CSS**: copy `InsCSS` verbatim from `instrument.jsx` lines **6–64** (everything between the `<style>{` backtick and the closing backtick), with exactly two edits:

1. In the `.ins{…}` root rule (lines 6–16), **delete** `width:100%; height:100%; overflow:hidden;` (line 15) — those are design-canvas artboard rules and would clip real scrolling pages. **Keep** `-webkit-font-smoothing:antialiased;`, the tokens, `background`, `color`, and the font declarations.
2. Immediately after the `.ins{…}` root rule, **add the per-app accent seam** (the spec's `data-app` model):

```css
.ins { --accent: var(--green); }
.ins[data-app="raid"]  { --accent: var(--amber); }
.ins[data-app="signal"]{ --accent: var(--green); }
.ins[data-app="retro"] { --accent: var(--teal); }
.ins[data-app="poker"] { --accent: var(--ink); }
```

Leave every other selector (`.topbar`, `.brand`, `.btn*`, `.band`, `.waves`, `@keyframes insdrift`, the `prefers-reduced-motion` guard, `.band-in`, `.eyebrow`, `.card`, `.pill*`, `.input`, `.notice`, `.authcard`, etc.) byte-for-byte as in the source.

- [ ] **Step 2: Verify structurally**

Run: `cd /var/www/suite/shared/theme && grep -c "^@font-face" instrument-core.css && grep -c "\.ins" instrument-core.css`
Expected: `8` font-face rules, and a `.ins` count of ≥ 40 (every component selector carried over).

Run: `cd /var/www/suite/shared/theme && grep -E "width:100%; height:100%; overflow:hidden" instrument-core.css; echo "exit=$?"`
Expected: no match (`exit=1`) — the canvas-only rule was removed.

Run: `cd /var/www/suite/shared/theme && grep -c 'data-app=' instrument-core.css`
Expected: `4` (the accent overrides).

- [ ] **Step 3: Commit**

```bash
cd /var/www/suite
git add shared/theme/instrument-core.css
git commit -m "feat(theme): instrument-core.css — tokens, fonts, .ins components"
```

---

### Task 3: Self-host the fonts

**Files:**
- Create: `shared/theme/fonts/*.woff2` (8 files)

- [ ] **Step 1: Download the eight woff2 files**

Fontsource publishes latin-subset woff2 on jsDelivr. Download each weight, renaming to the filenames `instrument-core.css` references. Run each as its own command:

```bash
cd /var/www/suite/shared/theme/fonts
curl -fsSL -o bricolage-grotesque-700.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/bricolage-grotesque@latest/latin-700-normal.woff2"
```
```bash
curl -fsSL -o hanken-grotesk-400.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/hanken-grotesk@latest/latin-400-normal.woff2"
```
```bash
curl -fsSL -o hanken-grotesk-500.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/hanken-grotesk@latest/latin-500-normal.woff2"
```
```bash
curl -fsSL -o hanken-grotesk-600.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/hanken-grotesk@latest/latin-600-normal.woff2"
```
```bash
curl -fsSL -o hanken-grotesk-700.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/hanken-grotesk@latest/latin-700-normal.woff2"
```
```bash
curl -fsSL -o ibm-plex-mono-400.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/ibm-plex-mono@latest/latin-400-normal.woff2"
```
```bash
curl -fsSL -o ibm-plex-mono-500.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/ibm-plex-mono@latest/latin-500-normal.woff2"
```
```bash
curl -fsSL -o ibm-plex-mono-600.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/ibm-plex-mono@latest/latin-600-normal.woff2"
```

If any URL 404s, fall back to google-webfonts-helper: `https://gwfh.mranftl.com/api/fonts/<id>?download=zip&subsets=latin&variants=<weight>&formats=woff2` (ids: `bricolage-grotesque`, `hanken-grotesk`, `ibm-plex-mono`), unzip, and rename to the same filenames.

- [ ] **Step 2: Verify every file is a real woff2**

Run:
```bash
cd /var/www/suite/shared/theme/fonts && for f in *.woff2; do printf '%s ' "$f"; head -c4 "$f"; echo " ($(stat -c%s "$f") bytes)"; done
```
Expected: 8 files, each starting with the magic string `wOF2` and a non-trivial byte count (> 5000). If any shows HTML/0 bytes, the download failed — re-fetch via the fallback.

- [ ] **Step 3: Confirm the manifest now sees the fonts**

Edit `shared/theme/tests/manifest.test.mjs`: change the first assertion back to `assert.ok(ASSETS.length >= 11)` (3 static + 8 fonts).

Run: `cd /var/www/suite/shared/theme && node --test tests/manifest.test.mjs`
Expected: PASS — `fontAssets()` now returns the 8 woff2 entries.

- [ ] **Step 4: Commit**

```bash
cd /var/www/suite
git add shared/theme/fonts shared/theme/tests/manifest.test.mjs
git commit -m "feat(theme): self-host Instrument fonts (Bricolage/Hanken/IBM Plex Mono)"
```

---

### Task 4: `oscilloscope.js` — the scope-trace header (TDD)

**Files:**
- Create: `shared/theme/oscilloscope.js`
- Test: `shared/theme/tests/oscilloscope.test.mjs`

The module is a vanilla ES module exporting a pure `scopePath()` (the trace geometry, unit-testable) and a `mountWaves(el)` that injects the SVG into every `.band .waves` container. Ported from `Waves` (`variant: 'scope'`) in `shared.jsx` lines 32–48.

- [ ] **Step 1: Write the failing test**

Create `shared/theme/tests/oscilloscope.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { scopePath, W, BASELINE } from "../oscilloscope.js";

test("scopePath starts at the left baseline and spans the full width", () => {
  const d = scopePath();
  assert.ok(d.startsWith("M0 110"), "starts at M0 110");
  assert.ok(d.includes(`L${W} `) || d.trim().endsWith(`L${W} 110.0`) || d.includes(` L${W} `),
    "reaches the right edge W");
  assert.equal(W, 3600);
  assert.equal(BASELINE, 110);
});

test("scopePath has a deep pulse spike near each 600px period (y well above baseline)", () => {
  const d = scopePath();
  // Parse the "L<x> <y>" points and find the minimum y (spikes go UP = smaller y).
  const ys = [...d.matchAll(/L\d+(?:\.\d+)? (\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const minY = Math.min(...ys);
  assert.ok(minY < 60, `a pulse rises well above the 110 baseline (minY=${minY})`);
  // ...and the calm sections stay close to baseline (within the 3px ripple).
  const calm = ys.filter((y) => Math.abs(y - 110) <= 3.001);
  assert.ok(calm.length > ys.length / 2, "most of the trace is the calm ripple");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /var/www/suite/shared/theme && node --test tests/oscilloscope.test.mjs`
Expected: FAIL — cannot find module `../oscilloscope.js`.

- [ ] **Step 3: Implement the module**

Create `shared/theme/oscilloscope.js` (faithful port; the path math is exactly `shared.jsx` lines 34–43):

```js
// oscilloscope.js — Instrument signature header. Vanilla ES module.
// Pure geometry (scopePath) + a DOM mount (mountWaves). Ported from the
// design handoff's Waves(variant:'scope').
export const W = 3600;        // path drawn across 3600 so the -600px drift loops seamlessly
export const BASELINE = 110;

// The calm baseline ripple with a gaussian pulse spike every 600px.
export function scopePath() {
  let d = `M0 ${BASELINE}`;
  for (let x = 8; x <= W; x += 8) {
    const seg = x % 600;
    let y = BASELINE + 3 * Math.sin(x / 30);
    if (seg > 250 && seg < 350) {
      const p = (seg - 300) / 50; // -1..1 across the 100px pulse window
      y = BASELINE - 64 * Math.exp(-(p * p) * 6) * Math.cos(p * 3.2);
    }
    d += ` L${x} ${y.toFixed(1)}`;
  }
  return d;
}

// Build the SVG markup string for one header backdrop.
export function scopeSvg() {
  const d = scopePath();
  const baseline = `M0 ${BASELINE} L${W} ${BASELINE}`;
  return (
    `<svg viewBox="0 0 2400 200" preserveAspectRatio="none" width="100%" height="100%">` +
    `<g class="waves-drift">` +
    `<path d="${baseline}" fill="none" stroke="var(--teal)" stroke-width="1" opacity="0.4" stroke-linecap="round"/>` +
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2.2" opacity="0.9" stroke-linecap="round"/>` +
    `<path d="${d}" fill="none" stroke="var(--teal)" stroke-width="6" opacity="0.12" stroke-linecap="round"/>` +
    `</g></svg>`
  );
}

// Mount the trace into every empty `.waves` container on the page.
export function mountWaves(root = (typeof document !== "undefined" ? document : null)) {
  if (!root) return 0;
  const targets = root.querySelectorAll(".band .waves, .authleft .waves");
  targets.forEach((el) => { if (!el.querySelector("svg")) el.innerHTML = scopeSvg(); });
  return targets.length;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => mountWaves());
  } else {
    mountWaves();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /var/www/suite/shared/theme && node --test tests/oscilloscope.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite
git add shared/theme/oscilloscope.js shared/theme/tests/oscilloscope.test.mjs
git commit -m "feat(theme): oscilloscope.js scope-trace header (ported from handoff)"
```

---

### Task 5: `glyphs.svg` — the app-glyph sprite

**Files:**
- Create: `shared/theme/glyphs.svg`
- Reference: `shared.jsx` `Glyph`, lines 111–139

- [ ] **Step 1: Author the sprite**

Create `shared/theme/glyphs.svg` as a `<symbol>` sprite (each glyph transcribed verbatim from the matching `Glyph` branch; `viewBox="0 0 24 24"`, `currentColor`). Consume with `<svg class="ins-glyph"><use href="/illos/glyphs.svg#glyph-signal"/></svg>`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
  <symbol id="glyph-suite" viewBox="0 0 24 24" fill="none">
    <g fill="currentColor">
      <rect x="3" y="3" width="7.5" height="7.5" rx="2"/>
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" opacity="0.55"/>
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" opacity="0.55"/>
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>
    </g>
  </symbol>
  <symbol id="glyph-raid" viewBox="0 0 24 24" fill="none">
    <rect x="12" y="2.5" width="13.4" height="13.4" rx="2.5" transform="rotate(45 12 2.5)" stroke="currentColor" stroke-width="2"/>
    <circle cx="12" cy="12" r="2" fill="currentColor"/>
  </symbol>
  <symbol id="glyph-signal" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <path d="M4 16a8 8 0 0 1 16 0" opacity="0.45"/>
    <path d="M7.5 16a4.5 4.5 0 0 1 9 0" opacity="0.75"/>
    <circle cx="12" cy="16" r="1.6" fill="currentColor" stroke="none"/>
  </symbol>
  <symbol id="glyph-retro" viewBox="0 0 24 24" fill="none">
    <g fill="currentColor">
      <rect x="3.5" y="9" width="4.2" height="11" rx="1.4"/>
      <rect x="9.9" y="5" width="4.2" height="15" rx="1.4" opacity="0.62"/>
      <rect x="16.3" y="12" width="4.2" height="8" rx="1.4"/>
    </g>
  </symbol>
  <symbol id="glyph-poker" viewBox="0 0 24 24" fill="none">
    <rect x="6.5" y="4" width="11" height="15" rx="2.4" transform="rotate(-9 12 11.5)" stroke="currentColor" stroke-width="2" opacity="0.5"/>
    <rect x="7.5" y="6" width="11" height="15" rx="2.4" transform="rotate(7 12 13)" fill="currentColor"/>
  </symbol>
</svg>
```

- [ ] **Step 2: Verify it's well-formed XML with five symbols**

Run:
```bash
cd /var/www/suite/shared/theme && node -e "const s=require('fs').readFileSync('glyphs.svg','utf8'); const n=(s.match(/<symbol /g)||[]).length; if(n!==5) throw new Error('want 5 symbols, got '+n); for(const id of ['suite','raid','signal','retro','poker']) if(!s.includes('glyph-'+id)) throw new Error('missing '+id); console.log('ok: 5 symbols');"
```
Expected: `ok: 5 symbols`.

- [ ] **Step 3: Commit**

```bash
cd /var/www/suite
git add shared/theme/glyphs.svg
git commit -m "feat(theme): geometric app-glyph SVG sprite"
```

---

### Task 6: `preview.html` — kitchen-sink style guide

**Files:**
- Create: `shared/theme/preview.html`

- [ ] **Step 1: Author the preview page**

Create `shared/theme/preview.html` loading only the foundation files by relative path, wrapped in `.ins`, rendering: the topbar + oscilloscope band, a token/swatch table, a type-scale specimen, the button/pill/input/notice/card components, and the five glyphs. Note: `<use href>` to an external SVG file works over `http://`, so view via a local server (Step 2), not `file://`.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Instrument — Style Guide</title>
<link rel="stylesheet" href="./instrument-core.css">
</head>
<body class="ins" data-app="signal">
  <header class="topbar">
    <span class="brand"><span class="mk"><svg width="22" height="22"><use href="./glyphs.svg#glyph-suite"/></svg></span>Sprint Suite</span>
    <span class="tbacts"><a class="btn btn-ghost btn-sm">Sign out</a></span>
  </header>
  <div class="band">
    <div class="waves" aria-hidden="true"></div>
    <div class="band-in">
      <p class="eyebrow">Style Guide</p>
      <h1>Instrument foundation</h1>
      <p class="sub">Every token and component, foundation files only.</p>
    </div>
  </div>

  <div class="page">
    <div class="card">
      <h2>Colour tokens</h2>
      <div class="tok-row"><span class="swatch" style="background:var(--bone)"></span><span>--bone</span><span class="mono">ground</span></div>
      <div class="tok-row"><span class="swatch" style="background:var(--green)"></span><span>--green</span><span class="mono">primary</span></div>
      <div class="tok-row"><span class="swatch" style="background:var(--teal)"></span><span>--teal</span><span class="mono">signal</span></div>
      <div class="tok-row"><span class="swatch" style="background:var(--amber)"></span><span>--amber</span><span class="mono">flag</span></div>
      <div class="tok-row"><span class="swatch" style="background:var(--ink)"></span><span>--ink</span><span class="mono">text</span></div>
    </div>

    <div class="card">
      <h2>Type</h2>
      <p class="disp" style="font-size:44px">Display 44 — Bricolage</p>
      <p>Body 15 — Hanken Grotesk. The quick brown fox jumps over the lazy dog.</p>
      <p class="micro">MICRO — IBM PLEX MONO</p>
    </div>

    <div class="card">
      <h2>Buttons &amp; pills</h2>
      <p>
        <button class="btn btn-pri">Primary</button>
        <button class="btn btn-ghost">Ghost</button>
        <button class="btn btn-danger">Danger</button>
      </p>
      <p>
        <span class="pill pill-ok">Open</span>
        <span class="pill pill-flag">Flagged</span>
        <span class="pill pill-closed">Closed</span>
      </p>
    </div>

    <div class="card">
      <h2>Form</h2>
      <div class="field"><label class="label">Email</label><input class="input" placeholder="you@example.com"><span class="helper">We send a magic link.</span></div>
      <p class="notice">A teal notice, for hints and confirmations.</p>
    </div>

    <div class="card">
      <h2>App glyphs</h2>
      <p style="display:flex; gap:18px; color:var(--green)">
        <svg width="30" height="30"><use href="./glyphs.svg#glyph-suite"/></svg>
        <svg width="30" height="30"><use href="./glyphs.svg#glyph-raid"/></svg>
        <svg width="30" height="30"><use href="./glyphs.svg#glyph-signal"/></svg>
        <svg width="30" height="30"><use href="./glyphs.svg#glyph-retro"/></svg>
        <svg width="30" height="30"><use href="./glyphs.svg#glyph-poker"/></svg>
      </p>
    </div>
  </div>
  <footer class="footer">Instrument foundation · preview</footer>
  <script type="module" src="./oscilloscope.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify it renders**

Run (serves the dir on a port, then you open it):
```bash
cd /var/www/suite/shared/theme && python3 -m http.server 8799
```
Open `http://127.0.0.1:8799/preview.html` in a browser. Confirm against the handoff's `project-design-docs/design_handoff_sprint_suite/Sprint Suite - Instrument.html`:
- the oscilloscope trace animates in the band (and the five glyphs render),
- the bone ground / evergreen primary / teal accent are correct,
- Bricolage display + Hanken body + Plex Mono micro fonts load (no fallback serif/system flash after first paint),
- buttons, pills, input focus ring, and the teal notice match.

Stop the server with Ctrl-C when done.

- [ ] **Step 3: Commit**

```bash
cd /var/www/suite
git add shared/theme/preview.html
git commit -m "feat(theme): preview.html kitchen-sink style guide"
```

---

### Task 7: `sync-theme.mjs` — copy source into a surface (TDD)

**Files:**
- Create: `shared/theme/sync-theme.mjs`
- Test: `shared/theme/tests/sync-theme.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `shared/theme/tests/sync-theme.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncTo } from "../sync-theme.mjs";
import { ASSETS } from "../manifest.mjs";

test("syncTo copies every manifest asset into the target's public subdirs", () => {
  const target = mkdtempSync(join(tmpdir(), "theme-sync-"));
  const copied = syncTo(target);
  assert.equal(copied, ASSETS.length);
  for (const a of ASSETS) {
    const base = a.src.split("/").pop();
    assert.ok(existsSync(join(target, "public", a.destDir, base)), `${a.destDir}/${base} exists`);
  }
  // content matches source
  const css = readFileSync(join(target, "public", "css", "instrument-core.css"), "utf8");
  assert.match(css, /@font-face/);
});

test("syncTo is idempotent (re-running overwrites, same count)", () => {
  const target = mkdtempSync(join(tmpdir(), "theme-sync-"));
  syncTo(target);
  assert.equal(syncTo(target), ASSETS.length);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /var/www/suite/shared/theme && node --test tests/sync-theme.test.mjs`
Expected: FAIL — cannot find module `../sync-theme.mjs`.

- [ ] **Step 3: Implement the script**

Create `shared/theme/sync-theme.mjs`:

```js
// sync-theme.mjs — copy the Instrument foundation assets into a surface's
// public/{css,js,illos,fonts}. Usage:
//   node sync-theme.mjs <publicRoot-or-appRoot>   # one surface
//   node sync-theme.mjs --all                     # every registered surface
import { mkdirSync, copyFileSync } from "node:fs";
import { join, basename } from "node:path";
import { ASSETS, SURFACES, THEME_DIR } from "./manifest.mjs";

// target = an app root (…/signal) OR a public root (…/signal/public). Normalise to public/.
export function syncTo(target) {
  const publicRoot = target.endsWith("/public") ? target : join(target, "public");
  let n = 0;
  for (const a of ASSETS) {
    const destDir = join(publicRoot, a.destDir);
    mkdirSync(destDir, { recursive: true });
    copyFileSync(join(THEME_DIR, a.src), join(destDir, basename(a.src)));
    n++;
  }
  return n;
}

function main(argv) {
  const arg = argv[2];
  if (!arg) { console.error("usage: node sync-theme.mjs <appRoot|publicRoot> | --all"); process.exit(2); }
  const targets = arg === "--all" ? SURFACES.map((s) => s.publicRoot) : [arg];
  for (const t of targets) console.log(`synced ${syncTo(t)} assets -> ${t}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /var/www/suite/shared/theme && node --test tests/sync-theme.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite
git add shared/theme/sync-theme.mjs shared/theme/tests/sync-theme.test.mjs
git commit -m "feat(theme): sync-theme.mjs — copy foundation into a surface"
```

---

### Task 8: `check-theme-drift.mjs` — verify a synced copy (TDD)

**Files:**
- Create: `shared/theme/check-theme-drift.mjs`
- Test: `shared/theme/tests/check-theme-drift.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `shared/theme/tests/check-theme-drift.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncTo } from "../sync-theme.mjs";
import { driftReport } from "../check-theme-drift.mjs";

test("a freshly synced surface reports no drift", () => {
  const target = mkdtempSync(join(tmpdir(), "theme-drift-"));
  syncTo(target);
  const r = driftReport(target);
  assert.equal(r.ok, true);
  assert.deepEqual(r.mismatched, []);
  assert.deepEqual(r.missing, []);
});

test("a mutated copy is flagged as drifted", () => {
  const target = mkdtempSync(join(tmpdir(), "theme-drift-"));
  syncTo(target);
  appendFileSync(join(target, "public", "css", "instrument-core.css"), "\n/* local edit */\n");
  const r = driftReport(target);
  assert.equal(r.ok, false);
  assert.ok(r.mismatched.includes("css/instrument-core.css"));
});

test("a missing copy is flagged", () => {
  const target = mkdtempSync(join(tmpdir(), "theme-drift-"));
  syncTo(target);
  // no glyphs synced into a second, empty target
  const empty = mkdtempSync(join(tmpdir(), "theme-drift-"));
  const r = driftReport(empty);
  assert.equal(r.ok, false);
  assert.ok(r.missing.length > 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /var/www/suite/shared/theme && node --test tests/check-theme-drift.test.mjs`
Expected: FAIL — cannot find module `../check-theme-drift.mjs`.

- [ ] **Step 3: Implement the script**

Create `shared/theme/check-theme-drift.mjs`:

```js
// check-theme-drift.mjs — verify a surface's synced copy matches the source.
// Exit non-zero if any asset is missing or differs. Usage:
//   node check-theme-drift.mjs <appRoot|publicRoot>
//   node check-theme-drift.mjs --all
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, basename } from "node:path";
import { ASSETS, SURFACES, THEME_DIR } from "./manifest.mjs";

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

export function driftReport(target) {
  const publicRoot = target.endsWith("/public") ? target : join(target, "public");
  const mismatched = [];
  const missing = [];
  for (const a of ASSETS) {
    const rel = `${a.destDir}/${basename(a.src)}`;
    const srcHash = sha(readFileSync(join(THEME_DIR, a.src)));
    let copy;
    try { copy = readFileSync(join(publicRoot, a.destDir, basename(a.src))); }
    catch { missing.push(rel); continue; }
    if (sha(copy) !== srcHash) mismatched.push(rel);
  }
  return { ok: mismatched.length === 0 && missing.length === 0, mismatched, missing };
}

function main(argv) {
  const arg = argv[2];
  if (!arg) { console.error("usage: node check-theme-drift.mjs <appRoot|publicRoot> | --all"); process.exit(2); }
  const targets = arg === "--all" ? SURFACES.map((s) => s.publicRoot) : [arg];
  let bad = false;
  for (const t of targets) {
    const r = driftReport(t);
    if (r.ok) { console.log(`ok: ${t}`); }
    else { bad = true; console.error(`DRIFT: ${t}`); for (const m of r.mismatched) console.error(`  changed: ${m}`); for (const m of r.missing) console.error(`  missing: ${m}`); }
  }
  process.exit(bad ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /var/www/suite/shared/theme && node --test tests/check-theme-drift.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite
git add shared/theme/check-theme-drift.mjs shared/theme/tests/check-theme-drift.test.mjs
git commit -m "feat(theme): check-theme-drift.mjs — guard synced copies against drift"
```

---

### Task 9: README + full-suite green

**Files:**
- Create: `shared/theme/README.md`

- [ ] **Step 1: Write the README**

Create `shared/theme/README.md` documenting: what the foundation is, the file map, how to author (edit source here only), how a surface consumes it (`node sync-theme.mjs /var/www/<app>` then commit the synced files in that app's repo, wrap the body in `class="ins"` + `data-app`, drop `breathing-waves`, include `oscilloscope.js`), and the drift guard (`node check-theme-drift.mjs /var/www/<app>` in the app's test step). Keep it tight and scannable.

```markdown
# Instrument foundation (`@suite/theme`)

Canonical source of the Sprint Suite "Instrument" design system. Edit assets
**here only**; every surface gets a synced copy.

## Files
- `instrument-core.css` — tokens (oklch) + `@font-face` + `.ins` component CSS. Source of truth.
- `oscilloscope.js` — signature scope-trace header (replaces the legacy `breathing-waves`).
- `glyphs.svg` — app-glyph `<symbol>` sprite (`#glyph-suite|raid|signal|retro|poker`).
- `fonts/` — self-hosted woff2.
- `preview.html` — kitchen-sink style guide (serve the dir, open over http).
- `sync-theme.mjs` / `check-theme-drift.mjs` / `manifest.mjs` — tooling.

## Consume it in a surface
```bash
node /var/www/suite/shared/theme/sync-theme.mjs /var/www/signal   # copies into signal/public/{css,js,illos,fonts}
```
Then in that app's repo: wrap the page body in `class="ins"` (+ `data-app="signal"`),
link `/css/instrument-core.css`, include `/js/oscilloscope.js` as a module, render
the band with an empty `<div class="waves">`, remove `breathing-waves.*`, and
**commit the synced files**. Add a CI/test step:
```bash
node /var/www/suite/shared/theme/check-theme-drift.mjs /var/www/signal
```

## Preview
```bash
cd /var/www/suite/shared/theme && python3 -m http.server 8799   # open http://127.0.0.1:8799/preview.html
```
```

- [ ] **Step 2: Run the entire foundation test suite**

Run: `cd /var/www/suite/shared/theme && node --test tests/`
Expected: PASS — manifest (2), oscilloscope (2), sync-theme (2), check-theme-drift (3). All green, 0 fail.

- [ ] **Step 3: End-to-end smoke of the tooling against a scratch target**

Run:
```bash
T=$(mktemp -d) && node /var/www/suite/shared/theme/sync-theme.mjs "$T" && node /var/www/suite/shared/theme/check-theme-drift.mjs "$T" && echo "SMOKE OK"
```
Expected: `synced 11 assets -> …`, then `ok: …/public`, then `SMOKE OK`. (No real surface is touched.)

- [ ] **Step 4: Commit**

```bash
cd /var/www/suite
git add shared/theme/README.md
git commit -m "docs(theme): how to author, sync, and consume the Instrument foundation"
```

---

## Self-Review

**1. Spec coverage:**
- Canonical source `suite/shared/theme/` → Tasks 1–9 all land there ✓
- `instrument-core.css` (oklch tokens + `.ins` components + `@font-face`) → Task 2 ✓
- Per-app `data-app` accent seam → Task 2 Step 1(b) ✓
- `oscilloscope.js` replacing breathing-waves → Task 4 ✓
- `glyphs.svg` sprite → Task 5 ✓
- Self-hosted fonts → Task 3 ✓
- `preview.html` style guide → Task 6 ✓
- `sync-theme.mjs` (css/js/illos/fonts) → Task 7 ✓
- `check-theme-drift.mjs` → Task 8 ✓
- Unit tests for both tools + (bonus) oscilloscope geometry → Tasks 4, 7, 8 ✓
- No deploy → no deploy task; Task 9 smoke only touches a temp dir ✓
- README → Task 9 ✓

**2. Placeholder scan:** No TBD/TODO. The CSS-extraction step references exact source lines (6–64) with two explicit, enumerated edits rather than re-typing the block — the source file is in the repo, so this is precise, not a placeholder. Font download gives exact URLs + a verify step + a named fallback.

**3. Type/name consistency:** `manifest.mjs` exports `ASSETS`, `SURFACES`, `THEME_DIR` — consumed with those names in `sync-theme.mjs`, `check-theme-drift.mjs`, and the tests. `syncTo(target)` and `driftReport(target)` signatures match across implementation and tests. Asset `{ src, destDir }` shape is consistent everywhere. Font filenames in the `@font-face` block (Task 2) exactly match the `curl -o` names (Task 3).
</content>
