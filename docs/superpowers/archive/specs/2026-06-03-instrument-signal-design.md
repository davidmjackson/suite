# Instrument — Signal redesign (sub-project 2)

**Date:** 2026-06-03
**Program:** Instrument visual redesign. Sub-project 0 (shared `suite/shared/theme/`
foundation) and sub-project 1 (Hub + Auth) are built, merged, and live. This is
**sub-project 2**: make Signal (sprintsignal.uk) consume the Instrument foundation.

## Goal

Reskin Signal to the Instrument `.ins` design system — replace its `theme-core`/
`theme-signal`/`breathing-waves` layer with the synced foundation, adopt the oscilloscope
band, IBM/Bricolage/Hanken fonts, and the shared component vocabulary, and re-point Signal's
app-specific components (survey list, radar report, respondent flow) to Instrument tokens.
Markup + CSS + a light JS reskin only — **no API, auth, survey-logic, or data changes**.

## Repo / environment

- Signal lives in its **own repo** at `/var/www/signal` (separate from `/var/www/suite`).
  Service `signal.service`, `User=signal`, port 3002. Live branch `feat/suite-auth`
  (tag `post-signal-company-scoping`); new work branches off it as `feat/instrument-signal`.
- Signal is **client-rendered**: static HTML shells in `public/` (`dashboard`, `survey`,
  `respond`, `admin`, `license`) + vanilla JS (`api.js`, `dashboard.js`, `survey.js`,
  `respond.js`, `radar.js`) that fetch the API and build the DOM. Auth is delegated to the hub.
- The Instrument foundation stays in `/var/www/suite/shared/theme/`; `manifest.mjs` already
  registers `signal` → `/var/www/signal/public`. Cross-repo sync/drift works because both
  repos live on the same box.
- **Program docs (this spec + the plan) live in the suite repo** (`/var/www/suite/docs/superpowers/`);
  **code changes commit in the signal repo.**

## Scope

In scope — the whole app:
- All five static shells: `dashboard`, `survey`, `respond`, `admin`, `license`.
- All client-JS-generated markup (survey list, survey builder, respondent flow, report).
- The **radar** results chart (recolored to Instrument tokens).

Not in scope: API/routes, auth, survey-scoring logic, DB, any behavior.

## Key decisions (brainstorm 2026-06-03)

1. **Full `.ins` adoption** (same model as the hub). A compatibility shim was rejected:
   `instrument-core.css` scopes everything under `.ins`, so consuming the synced foundation
   *requires* adopting `.ins`; a shim would copy tokens instead of consuming the foundation,
   breaking the sync/drift model and leaving two parallel component vocabularies.
2. **Semantic color mapping = "amber for all attention"** (option A): ok→green,
   info→teal, warn/slipping/flagged→amber, delta-up→green, delta-down→amber, delta-flat→faint,
   radar baseline→neutral grey. Red stays reserved for destructive actions only.
3. **Band placement preserved** from today: `dashboard`, `survey`, `admin`, `license` keep a
   band (breathing-waves → oscilloscope); `respond` stays the focused full-screen flow (no band).
4. **Weather glyphs (`theme-illos.svg`) are report content and stay.** Only the topbar *brand*
   glyph switches to `glyphs.svg#glyph-signal`.

## CSS layering — replace three files with two

Remove `public/css/theme-core.css`, `public/css/theme-signal.css`, `public/css/breathing-waves.css`.
Each page links:
1. **`/css/instrument-core.css`** — synced foundation, source of truth, drift-checked.
2. **`/css/signal.css`** — Signal-owned (the `hub.css` equivalent), **not** drift-checked.

`signal.css` contains:
- A Signal-local token block for what Instrument doesn't define: the `--s-*` spacing scale and
  `--r-*` radius scale (ported from `theme-core.css`, since `app.css` relies on them), plus
  `--baseline` (radar grey) and the `--radar-*` custom props the radar reads.
- All of `app.css`'s components, scoped under `.ins`, re-pointed to Instrument tokens:
  - `--bg`/`--surface`→`--bone`/`--panel`; `--border`→`--line`, `--border-st`→`--line2`;
    `--muted`→`--soft`, `--faint`→`--faint`; `--accent`→`--accent` (green, unchanged);
    `--accent-soft`→`--greenwash`; `--bg-warm`→`--bone`; `--mono` → `'IBM Plex Mono',monospace`.
  - Semantic (decision 2): `--ok`→green/greenwash, `--warn`→amber/amberwash, `--info`→teal/tealwash;
    `focus-*` left-borders, `tag-*`, `delta-*`, `scale-option.selected` follow suit; `--sig-baseline`→grey.
- Components carried over (kept class names, restyled): `survey-row`, `report-grid`, `radar-wrap`/
  `legend`, `focus-card`/`axis-card`, `q-row`/`bar`, `respond-shell`/`scale-option`/`progress-track`,
  `radio-option`, `detail-list`, `key-box`, `license-text`, `footer-note`.

Fonts switch Fraunces/Inter/JetBrains Mono → Bricolage/Hanken/IBM Plex Mono automatically via
Instrument's `@font-face` + synced woff2. The old font files (`Fraunces.woff2`, `Inter.woff2`,
`JetBrainsMono.woff2`) become unused and are removed.

## Chrome + per-page mapping (static shells)

Pure markup reskin; no behavior change.
- **All five pages:** `<body class="ins" data-app="signal">` (signal accent = green); link
  `instrument-core.css` + `signal.css`; topbar/brand → `.ins` versions; brand glyph
  `theme-illos.svg#postcard` → `glyphs.svg#glyph-signal`; `.btn-primary` → `.btn-pri`
  (`.btn`/`.btn-ghost`/`.btn-sm`/`.btn-danger` already match Instrument); replace the
  `breathing-waves.js` include with `oscilloscope.js` (`type="module"`).
- **dashboard, survey, admin, license:** `.header-band` + `<canvas data-breathing-waves>` →
  `<div class="band"><div class="waves"></div><div class="band-in">` carrying the existing
  `.eyebrow` + the title as the band `<h1>`.
- **respond:** unchanged structure — the focused full-screen `respond-shell` card (Signal's
  analogue of the hub's bare auth), no band; only brand/fonts/classes updated.
- The report/radar renders client-side inside the dashboard shell, inheriting its band/chrome.

## JS reskin

- **`api.js`** — the shared button-builder's `btn-primary` → `btn-pri`.
- **`radar.js`** — replace the hard-coded hex constants (`accent #1D9E75`, `baseline #888780`,
  `guide`, `text`, `textMuted`, fills) with values read from CSS custom properties exposed in
  `signal.css` (`--radar-now`=green, `--radar-baseline`=grey, `--radar-guide`=`--line`,
  text=`--ink`, textMuted=`--soft`, wash fills) via `getComputedStyle`, so the radar is
  token-driven and stays in sync with the foundation.
- **`dashboard.js` / `survey.js`** — keep using `theme-illos.svg` weather glyphs (report content);
  no shared-class remaps beyond what `api.js` covers.
- **`respond.js`** — Signal-specific generated classes kept, restyled via `signal.css`.
- **Remove `breathing-waves.js`** and all references.

## Testing & verification

- **Drift guard:** a `theme-drift` test in Signal importing `driftReport` from
  `/var/www/suite/shared/theme/check-theme-drift.mjs`, asserting the synced copies match source.
  Wired into Signal's test run. (Cross-repo dependency on `/var/www/suite` — acceptable; both
  repos are on the same box.)
- **Unit tests** (86, `node --test tests/*.test.js`) test `lib/` logic — unaffected, stay green.
- **Playwright e2e** (10, `playwright test`) drive a real browser — the primary guard for the
  client-rendered reskin. Audit specs for changed selectors (`btn-primary`→`btn-pri`,
  `header-band`→`band`, brand glyph) and update only genuinely-broken **presentational**
  selectors; never weaken behavioral/auth/company-isolation assertions.
- **Visual pass:** run Signal locally and eyeball every page + the report/radar + the
  respondent flow against `shared/theme/preview.html` and the live hub.

## Build & deploy

- Built via subagent-driven TDD with two-stage review + a final holistic review (as for the hub).
- Branch `feat/instrument-signal` off Signal's live `feat/suite-auth`; pushed to origin as backup.
  Verify + review locally; merge to `feat/suite-auth` locally; push.
- Deploy (operator-driven live session): on prod as appropriate user, `git pull` in
  `/var/www/signal`, restart `signal.service`, verify health + smoke, then **hard-refresh** in
  browser (Signal's CSS/JS are linked without a cache-buster — same caveat as the hub).
- Explicit git staging only; `git status` before each commit.

## Non-goals / deferred

- The remaining surfaces (Retro/Poker/Raid) — separate follow-on sub-projects 3–5.
- Any change to the survey definition, scoring, weather-glyph artwork, or API.
- A cache-buster for static assets — noted as a program-wide improvement, not done here.
