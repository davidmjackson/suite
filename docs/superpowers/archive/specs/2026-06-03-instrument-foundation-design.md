# Instrument Foundation — Design

Date: 2026-06-03
Repo: suite (`/var/www/suite`), source lives in `shared/theme/`
Status: approved (design), pre-plan

## Goal

Stand up the **shared foundation** of the "Instrument" design system as a single
token + component source that every Sprint Suite surface (the hub + the four
apps) can consume, replacing today's drifted, copy-by-convention CSS. This
sub-project ships **no user-facing change** — it delivers the source of truth,
the self-hosted fonts, the new oscilloscope header, the glyph sprite, a sync
tool, a drift check, and a standalone preview page. The first surface to consume
it (the hub + auth) is a separate sub-project.

## Background

Sprint Suite is four Agile apps (Sprintraid, Sprintsignal, Sprintretro,
Sprintpoker) plus a central hub + passwordless auth, all under one sign-in. The
**"Instrument" design handoff** (`project-design-docs/design_handoff_sprint_suite/`,
source of truth `Sprint-Suite-latest.zip`) specifies a unified calm-tech system:
a cool bone ground, evergreen primary, a single teal "signal" accent, a grotesk
display face, and an animated **oscilloscope-trace header** as the suite's
signature element. The handoff's `directions/instrument.jsx` (`InsCSS`,
`.ins` scope) is the authoritative stylesheet; `directions/shared.jsx` holds the
`Waves` (variant `scope`) header and the geometric `Glyph` set. The `.jsx` files
are *design references*, not production code — the task is to recreate them in
each app's real environment (server-rendered HTML + vanilla JS + plain CSS).

**Current state / the problem.** Each app is its own repo with its own
`public/css/` holding `theme-core.css` + `theme-{app}.css` + `app.css` +
`breathing-waves.{css,js}`. `theme-core.css` was meant to be a shared base but
has **already drifted** (signal's and retro's copies have different checksums).
The hub + auth screens never got the apps' polish (plain default scaffolding).
Instrument fixes both: one token source, consistently applied to all five
surfaces.

## Decisions (brainstorm 2026-06-03)

1. **Decompose into a program**: sub-project 0 = this foundation; sub-projects
   1–5 = each surface (hub/auth first, then Signal, Retro, Poker, Raid), each its
   own spec → plan → build → deploy. Only the foundation is shared.
2. **Cross-repo sharing = sync script**, not a symlinked npm package. CSS is a
   static asset, the apps have no build step, and they must stay independently
   deployable — so a single canonical source plus a copy-into-each-`public/`
   script fits best. A drift check guards against a surface editing its copy.
3. **Fonts self-hosted** (subset woff2 in the foundation, synced into each app's
   `/fonts/`, declared via `@font-face`) — no external runtime dependency, faster
   first paint, no third-party request leaking user IPs (a UK-SaaS GDPR nicety).

## Design

### Canonical source: `suite/shared/theme/`

```
shared/theme/
  instrument-core.css      # tokens + .ins component CSS + @font-face (source of truth)
  oscilloscope.js          # SVG scope-trace header generator (replaces breathing-waves.js)
  glyphs.svg               # geometric app-glyph sprite (suite/raid/signal/retro/poker)
  fonts/                   # self-hosted subset woff2: Bricolage Grotesque, Hanken Grotesk, IBM Plex Mono
  preview.html             # standalone kitchen-sink / living style guide (foundation-only)
  sync-theme.mjs           # copy source into a surface's public/{css,js,illos,fonts}
  check-theme-drift.mjs    # checksum a surface's synced copy against source
  README.md                # how to author, sync, and consume the foundation
```

#### `instrument-core.css`

- **Tokens** as `:root` CSS custom properties in **oklch**, transcribed verbatim
  from the handoff: `--bone --panel --ink --soft --faint --line --line2 --green
  --greenwash --teal --tealwash --amber --amberwash` plus the inline red/flag
  text colors. Radius scale (5/6/8/10/12/16px), spacing/layout (1120px column,
  40px side padding, 24/26px card padding, 16–18px gaps; 390px mobile frame,
  16px padding, 13px gap), and elevation (modal/auth/popover shadows) as tokens.
- **Type scale** via `@font-face` (self-hosted) for **Bricolage Grotesque** 700
  (display, `letter-spacing -0.02em`), **Hanken Grotesk** 400/500/600/700 (body),
  **IBM Plex Mono** 400/500/600 (eyebrows/labels/scores). Roles per the handoff
  table (H1 44, H2 21, body 15, label 13, micro/eyebrow 11 mono uppercase…).
- **Component CSS** under the `.ins` scope (cards, the slim topbar, the wavy
  band, buttons incl. ghost/danger, pills/chips, inputs, tables, notices,
  modals/popovers) transcribed from `InsCSS` in `directions/instrument.jsx`.
- **Per-app accent**: a single shared base palette with one accent hue each —
  **Raid = amber, Signal = green, Retro = teal, Poker = ink** — selected by a
  `data-app="raid|signal|retro|poker"` attribute on the root element, which maps
  to `--accent`. **Green stays the suite primary** action color everywhere; the
  hub uses the suite palette (no per-app accent override).

#### `oscilloscope.js` (+ header CSS in `instrument-core.css`)

The signature header: a header **band** (`background: var(--panel)`, 1px
`--line2` bottom border) with an animated SVG trace behind the title, per
`Waves` variant `scope` in `directions/shared.jsx`:

- SVG `viewBox="0 0 2400 200"`, `preserveAspectRatio="none"`, 100%×100%.
- A `<g>` of three stacked paths drawn across width 3600 (so it drifts
  seamlessly): (1) flat baseline `M0 110 L3600 110`, `--line2`/teal, opacity 0.4;
  (2) the main trace — a low ripple `110 + 3·sin(x/30)` with a **gaussian pulse
  spike** every 600px `110 − 64·e^(−6p²)·cos(3.2p)`, stroke `currentColor`
  (green), width 2.2, opacity 0.9; (3) the same trace, teal, width 6, opacity
  0.12 (soft glow).
- `@keyframes insdrift { to { transform: translateX(-600px) } }`,
  `animation: insdrift 9s linear infinite`; gated by
  `@media (prefers-reduced-motion: reduce) { animation: none }`, with the static
  end-state as the visible state (content never hidden pre-animation).
- The slim **topbar** above the band (brand glyph + wordmark left, ghost-button
  actions right) merges the legacy two-header system into one.

This **replaces** `breathing-waves.{css,js}` (removed per-surface during each
surface's rollout, not here).

#### `glyphs.svg`

The geometric app-glyph sprite — `suite` (2×2 grid), `raid` (diamond + dot),
`signal` (concentric arcs + dot), `retro` (three bars), `poker` (two cards) —
each `currentColor` on a 24×24 viewBox, per `Glyph` in `directions/shared.jsx`.
Synced into each surface's `public/illos/`.

#### `preview.html`

A standalone page that renders **every** token swatch, type specimen, component,
the oscilloscope header, and the glyph set, loading **only** the foundation files
(relative paths). It is the visual acceptance check for the foundation before any
app consumes it, and thereafter a living style guide. It is not served in prod;
it lives in `shared/theme/` for local viewing.

### Tooling

#### `sync-theme.mjs`

Node script (no deps beyond `node:fs`/`node:path`/`node:crypto`). Given a target
surface root (e.g. `/var/www/signal`) it copies the source files into the
surface's public tree:

- `instrument-core.css` → `<target>/public/css/`
- `oscilloscope.js` → `<target>/public/js/`
- `glyphs.svg` → `<target>/public/illos/`
- `fonts/*` → `<target>/public/fonts/`

Idempotent (overwrites). Accepts a single target path, or `--all` to iterate a
built-in surface map (hub = `suite/hub`, signal, retrospective, scrumpoker,
raid). Each surface then **commits its synced copy in its own repo**, so it stays
self-contained and independently deployable.

Migration smoothness: the apps already `<link>` `theme-core.css`. The sync writes
`instrument-core.css` as a new file; during each surface's rollout the template's
link is pointed at it (or `theme-core.css` is overwritten with the Instrument
contents — decided per surface). The foundation does not edit any app template.

#### `check-theme-drift.mjs`

Given a surface root, checksums its synced copies (`public/css/instrument-core.css`,
`public/js/oscilloscope.js`, `public/illos/glyphs.svg`, `public/fonts/*`) against
the canonical source and exits non-zero on any mismatch or missing file. Runnable
standalone or from a surface's test step, so a stale or hand-edited copy fails
loudly. `--all` checks every surface in the map.

### Validation / testing (no consuming app required)

- **Unit** (`node --test`): `sync-theme` writes the expected files to the
  expected dirs under a temp target; `check-theme-drift` passes immediately after
  a clean sync and fails when a synced file is mutated or removed.
- **Visual**: `preview.html` renders all tokens/components/header/glyphs — the
  manual eyeball acceptance and the reference artifact. Optionally a Playwright
  screenshot of `preview.html` captured as a baseline.

### Deploy

**None.** The foundation lands in `suite/shared/theme/` (committed to suite). No
service restarts, no prod change — the first user-facing change is sub-project 1
(hub + auth) consuming the foundation. `sync-theme`/`check-theme-drift` are dev
tools run during each surface's rollout.

## Out of scope (later sub-projects)

- Applying Instrument to any surface (hub/auth = sub-project 1, then Signal,
  Retro, Poker, Raid) — each rebuilds its templates to Instrument markup, runs
  `sync-theme`, removes `breathing-waves`, and deploys independently.
- Restyling the apps' custom SVG data-viz (Signal radar/bars) — handled in the
  Signal sub-project.
- Mobile (390px) layouts — specified in the handoff, executed per surface.

## References

- Design source of truth: `project-design-docs/design_handoff_sprint_suite/`
  (`README.md`, `directions/instrument.jsx` `InsCSS`, `directions/shared.jsx`
  `Waves`/`Glyph`), from `Sprint-Suite-latest.zip`.
- Cross-app sharing precedent: `@suite/auth-client` in `suite/shared/`.
- Current per-app CSS: `<app>/public/css/{theme-core,theme-<app>,app}.css` +
  `breathing-waves.{css,js}`.
</content>
