# Instrument — Raid redesign (sub-project 5)

**Date:** 2026-06-04
**Program:** Instrument visual redesign. Sub-project 0 (shared `suite/shared/theme/`
foundation), sub-project 1 (Hub + Auth), sub-project 2 (Signal), sub-project 3 (Retro), and
sub-project 4 (Poker) are built, merged, and live. This is **sub-project 5** — **the last
surface**: make Raid (sprintraid.uk) consume the Instrument foundation. When this ships, the
visual redesign program is complete.

## Goal

Reskin Raid to the Instrument `.ins` design system — replace its
`theme-core`/`theme-raid`/`app.css`/`breathing-waves` layer with the synced foundation, adopt the
oscilloscope band, Bricolage/Hanken/IBM Plex Mono fonts, and the shared component vocabulary, and
re-point Raid's app-specific components (the input/notes card, the four-card RAID result grid — the
risk/assumption/issue/dependency items with their RAG severity pills and dependency-conflict
callouts, the action/export bar, the error card and loading spinner) to Instrument tokens.
**Markup + CSS + a light JS class touch-up only — no behaviour, API, `/extract`, auth, quota, or
export-logic change.**

## Repo / environment

- Raid lives in its **own repo** at `/var/www/raid` (remote
  `github.com/davidmjackson/raid.git`, separate from `/var/www/suite`). Service `raid.service`,
  `User=raid`, env `/var/www/raid/.env`, port 3003 (Apache reverse-proxy at `sprintraid.uk`,
  `ReadWritePaths=/var/www/raid`). Live branch is **`master`** (note: `master`, not `main`); new
  work branches off it as `feat/instrument-raid`.
- Raid is **server-static + client-rendered**: static HTML shells in `public/` (`index`,
  `license`) + vanilla JS (`app.js` state machine, `extractUi.js` pure mapper, `exports.js`,
  `samples.js`, `clipboard.js`) that POST `/extract` and build the result DOM. Auth is delegated to
  the hub via `/auth-client/heartbeat.js`; `server.js` gates `/` and `/extract` with
  `auth.requireAuth`.
- `index.html` is a single-page shell with one app surface carrying four runtime phases (`idle` /
  `loading` / `result` / `error`): a hero, the notes input card, and a `#result-zone` populated by
  `app.js`. `license.html` is standalone.
- The Instrument foundation stays in `/var/www/suite/shared/theme/`; `manifest.mjs` already
  registers `raid` → `/var/www/raid/public`, and `instrument-core.css` already resolves
  `.ins[data-app="raid"] { --accent: var(--amber) }`. Cross-repo sync/drift works because both
  repos live on the same box.
- **Program docs (this spec + the plan) live in the suite repo** (`/var/www/suite/docs/superpowers/`);
  **code changes commit in the Raid repo.**

## Scope

In scope — the whole app:
- Both static shells: `index` (hero + input card + result zone) and `license`.
- All client-JS-generated markup in `app.js`: the four `.raid-card` category cards (risks,
  assumptions, issues, dependencies) and their `.raid-item`s, the RAG/severity pills, the
  dependency-conflict pill + callout + `.raid-card--conflict` state, the action/export bar, the
  quota note, the error card, and the loading spinner.

Not in scope: server/routes, auth, the `/extract` API, quota enforcement, the RAID extraction
prompt/schema, export formats (Markdown/CSV/Jira), `samples.js` content, any behaviour. No
licence-text change (the existing `license.html` text is reskinned as-is). No cache-buster
(program-wide deferred item).

## Key decisions (brainstorm 2026-06-04)

1. **Full `.ins` adoption** (same model as Hub/Signal/Retro/Poker). `instrument-core.css` scopes
   everything under `.ins`, so consuming the synced foundation *requires* adopting `.ins`; a
   compatibility shim was rejected for the same reasons as the prior four sub-projects (it would
   fork the token vocabulary and break the sync/drift model).
2. **Accent = amber.** `data-app="raid"` already resolves `--accent` to `--amber` in the foundation,
   matching the design handoff (Raid=amber, Signal=green, Retro=teal, Poker=ink). The brand amber
   (`--amber: oklch(0.70 0.125 72)`) drives chrome: the band, eyebrow/kicker, primary buttons,
   focus.
3. **RAG status colour = vivid classic traffic-light (option C).** A RAID log lives or dies on
   at-a-glance red/green scanning, so — uniquely in the suite — Raid uses a **saturated** RAG triad
   rather than the muted restraint of its siblings. This is a deliberate, eyes-open departure from
   the suite's calm palette, justified by the functional need. A *bright* RAG-amber also separates
   cleanly from the muted brand amber, so the two-ambers collision risk is low. `raid.css` defines a
   `--rag-red` / `--rag-amber` / `--rag-green` triad (vivid fills + text colours) — the Raid
   analogue of Poker's `--danger` / Retro's `--col-stop`, just a full set. Suggested values
   (tune during the visual pass): red `oklch(0.6 0.21 25)` on white; amber `oklch(0.8 0.16 75)` on
   `oklch(0.28 0.06 60)`; green `oklch(0.6 0.16 150)` on white.
4. **One unified three-colour triad — no separate blue.** Risk RAG *and* Issue severity share the
   same red/amber/green: Risk RAG = red/amber/green; Issue severity High=red, Medium=amber,
   **Low=green** (today's blue/info "Low" is dropped); dependency conflict = red. This is a purely
   presentational change — the existing JS class `raid-item__sev-label--low` is simply restyled to
   green (no `app.js`/`extractUi.js` logic change). It trades the old semantic nicety (blue = "minor,
   not good") for a simpler 3-colour palette, accepted by the user.
5. **Band placement.** Oscilloscope band on **both** shells — `index` and `license`. Raid has no
   anonymous-entry / guest screen to keep band-free (the whole app is auth-gated behind the hub), so
   there is no calmer-guest-entry exception to make here; both surfaces are banded.
6. **Glyph.** `theme-illos.svg` is brand-only in Raid (the hero `#sticker-circle` glyph + the inline
   privacy/error SVGs are separate inline markup). Switch the brand glyph to `glyphs.svg#glyph-raid`
   and **remove `theme-illos.svg`**. The inline privacy-chip and error-card SVGs stay inline
   (restyled via tokens).
7. **Topbar (Retro/Signal-style).** Raid gains an Instrument `.topbar` above the band on both shells
   — a `.brand` (the `glyph-raid` mark + "RAID" wordmark) on the left and a quiet **Sign out**
   button on the right. This is more consistent with Hub/Signal/Retro (Poker is the band-led
   exception) and surfaces Sign out properly. The `#logout-button` (and its `app.js` wiring) **moves
   from the footer to the topbar** — same id, same handler, just relocated markup; no JS logic
   change. On `license` (no logged-in action) the topbar shows the brand only.
8. **Footer / license link.** Raid keeps an `app-footer` with the suite-links line and the
   `/license.html` link (Sign out having moved up to the topbar per §7), reskinned, and reskins
   `license.html`. No licence-text change — that stays with the queued licence/consent work.

## CSS layering — replace four files with two

Remove `public/css/theme-core.css`, `public/css/theme-raid.css`, `public/css/app.css`, and
`public/css/breathing-waves.css`. Each page links:
1. **`/css/instrument-core.css`** — synced foundation, source of truth, drift-checked.
2. **`/css/raid.css`** — Raid-owned (the `retro.css`/`poker.css` equivalent), **not** drift-checked.

`raid.css` (mirror the finished `poker.css`/`retro.css` structure) contains:
- A Raid-local token block for what Instrument doesn't define: any `--s-*` spacing / `--r-*` radius
  / `--shadow-*` scales that `app.css` relies on (ported from `theme-core.css`), plus the **vivid
  RAG triad** (`--rag-red` / `--rag-amber` / `--rag-green` + their text/contrast colours), and
  semantic aliases mapped onto the Instrument palette.
- All of `app.css`'s components, scoped under `.ins`, re-pointed to Instrument tokens
  (warm bg→`--bone`; surface→`--panel`; border→`--line`/`--line2`; muted→`--soft`;
  accent→`--accent` (now amber); mono→`'IBM Plex Mono',monospace`).
- The RAID component system: `.result-grid`, the four `.raid-card`s (`.raid-card__header` pill +
  `.raid-card__count`, `.raid-card__pill--{risks,assumptions,issues,dependencies}`,
  `.raid-card__empty`, `.raid-card--conflict` + `.raid-card__corner-chip`), the `.raid-item`
  (`__title`/`__meta`/`__owner`/`__score`/`__body`/`__label`), the **vivid**
  `.raid-item__rag--{red,amber,green}` and `.raid-item__sev-label--{high,medium,low}` (low→green),
  the `.raid-item__conflict-pill` + `.raid-item__conflict-callout`, the input card
  (`.input-card`/`__textarea`/`__counter`(+`--warn`/`--err`)/`__helper`(+`--hidden`)/`.privacy-chip`),
  the `.action-bar`, the `.quota-note`, the `.error-card`, and the `.loading`/`.spinner`.
- The `.visually-hidden` utility currently in `index.html`'s inline `<style>` folded into `raid.css`.

Fonts switch Fraunces/Inter/JetBrains Mono → Bricolage/Hanken/IBM Plex Mono automatically via
Instrument's `@font-face` + synced woff2. The old font files (`Fraunces.woff2`, `Inter.woff2`,
`JetBrainsMono.woff2`) become unused and are removed. `theme-illos.svg` is removed (brand-only,
replaced by `glyphs.svg`).

## Chrome + per-page mapping (static shells)

Pure markup reskin; no behaviour change.
- **Both pages:** `<body class="ins" data-app="raid">`; link `instrument-core.css` + `raid.css`;
  add an Instrument `.topbar` (`.brand` = `glyphs.svg#glyph-raid` mark + "RAID" wordmark; **index**
  also has the relocated `#logout-button` Sign out on the right, `license` shows brand only);
  replace the `breathing-waves.js` include with `oscilloscope.js` (`type="module"`); keep the
  reskinned `app-footer` (suite-links line + license link, Sign out removed — now in the topbar);
  remove the inline `<style>` block (move `.visually-hidden` into `raid.css`).
- **index — hero/band:** `.header-band` + `data-breathing-waves` (`data-wave-palette="raid"`) →
  `<div class="band"><div class="waves"></div><div class="band-in">` carrying the eyebrow
  ("RAID extraction") + title ("RAID") + tagline ("From scattered notes to a scored RAID log, in
  seconds."). The standalone `.hero` block (incl. its `#sticker-circle` glyph) is absorbed into the
  band; the brand glyph now lives in the topbar per §7.
- **index — input card:** `.input-card` → Instrument panel-card; `.privacy-chip` (lock icon + "not
  stored" note) reskinned; `.input-card__textarea` → Instrument form input; `.input-card__counter`
  (+ `--warn`/`--err` states) and `.input-card__helper` (+ `--hidden`) restyled; the
  `#generate-button` (`btn btn--primary`) → amber-accent primary.
- **index — result zone (client-rendered by `app.js`):** the four-up `.result-grid` of category
  cards kept as-is (reskinned to Instrument panel cards); category pills, RAG/severity pills, and
  conflict pill/callout in the **vivid** triad; `.action-bar` buttons mapped per §"Buttons"; the
  `.quota-note`, `.error-card`, and `.loading`/`.spinner` reskinned.
- **license:** reskin, band, text unchanged.

## Buttons & semantic colours & footgun audit (SP2–SP4 lessons)

Raid uses **BEM-modifier** button classes (`btn btn--primary`, `btn btn--secondary`, `btn
btn--ghost`). Keep the class names and restyle in `raid.css` (as Retro/Poker did with their own
classes), mapping to Instrument semantics:
- **Primary** (`btn--primary`: Generate RAID, Copy as Markdown, Try again) → **amber** accent filled.
- **Secondary** (`btn--secondary`: Download CSV, Download for Jira) → bordered with a subtle bone
  fill (`--bone` background, `--line2` border) — more affordance than ghost, no accent fill.
- **Ghost** (`btn--ghost`: Sign out, Try another sample) → Instrument `btn-ghost` — `--panel`
  background, `--line2` border, the quietest variant.

Footgun audit:
- **Bare `.btn` / BEM-modifier footgun:** Instrument's base `.btn` is intentionally minimal **and
  `.btn-pri` is hardwired to `--green`, not `--accent`**. Every reskinned button must resolve to a
  fully-styled variant in `raid.css` — never a bare `.btn`/`.btn btn--…` — and `.btn--primary` must
  map to the **amber accent** explicitly (do not rely on the foundation's green `.btn-pri`).
- **`*wash`-as-translucent footgun:** Instrument `--amberwash`/`--greenwash` tokens are **opaque**
  pale tints, not translucent. Any overlay/halo/hover state that must show what's beneath it must
  use `oklch(… / alpha)`, never an opaque `*wash` token.
- **Compound element-state selectors:** Raid toggles state classes on the `.ins` element itself or
  on banded sections — `.app-page`, the `#result-zone[hidden]` toggle, the counter
  `--warn`/`--err`, the helper `--hidden`, `.raid-card--conflict`. Any state class on the `.ins`
  element needs a **compound** selector (`.ins.app-page`, not `.ins .app-page`); preserve
  `[hidden]{display:none}` semantics so the result zone stays hidden in `idle`.
- **App-CSP:** verified — neither `server.js` nor the Apache vhost (`deploy/apache/raid.conf`) sets
  a Content-Security-Policy, so the `oscilloscope.js` ES module and any inline style load fine.
  Inline CSS is folded into `raid.css` regardless for cleanliness.

## JS reskin

- **`app.js`** — the result zone is built in JS (`renderGrid` / `renderCard` / the per-category
  `renderRiskItem`/`renderAssumptionItem`/`renderIssueItem`/`renderDependencyItem` /
  `renderActionBar` / `renderErrorCard`). Update only theme-derived generated class names if any
  change; keep all emitted class names where present and restyle them via `raid.css`. No logic
  change — the `ragClass`/`sevLabelClass` helpers and the sort/conflict logic stay; only the CSS
  those classes resolve to changes (incl. `--low` → green).
- **`extractUi.js`** (pure status→message mapper + `renderNote` quota line) — unaffected; only the
  `.quota-note` appearance is restyled.
- **`exports.js` / `samples.js` / `clipboard.js`** — unaffected (export logic, sample content, and
  clipboard copy are out of scope).
- **`#logout-button`** keeps its id and `onLogout` handler; only its markup position changes
  (footer → topbar). `app.js`'s `$('#logout-button')` lookup is unaffected.
- **Replace `breathing-waves.js`** include with `oscilloscope.js` (`type="module"`) on both shells;
  **remove `breathing-waves.js`** and all references.

## Testing & verification

- **Drift guard:** a `theme-drift` test in Raid importing `driftReport` from
  `/var/www/suite/shared/theme/check-theme-drift.mjs`, asserting the synced copies match source,
  wired into Raid's test run. (Cross-repo dependency on `/var/www/suite` — acceptable; both repos
  are on the same box.)
- **Contrast test:** pin the palette pairs Raid actually uses — white on vivid `--rag-red`
  (risk/issue High, conflict), dark on vivid `--rag-amber` (Medium), white on vivid `--rag-green`
  (Low / RAG green), the amber primary-button label, ink on bone body.
- **Unit tests** (existing `node --test tests/*.unit.test.js`, incl. `extractUi`/`exports`/validation
  logic) test pure JS — unaffected, stay green.
- **Playwright e2e** (existing, `playwright test`) drive a real browser — the **primary guard** for
  the client-rendered result reskin. Add a **header-band spec** (band renders on index + license).
  Audit specs for changed selectors and update only genuinely-broken **presentational** selectors;
  **never weaken** behavioural / quota / auth-gating assertions (the `auth.requireAuth` bounce, the
  402 quota-limit message, the error/loading phases, the export-button wiring).
- **Visual pass:** run Raid locally and eyeball every phase — idle (hero + input card + privacy
  chip + counter states), loading (spinner), result (all four category cards incl. empty-state,
  vivid RAG/severity pills, a dependency with a conflict callout, the action bar, the quota note),
  and error — against `shared/theme/preview.html` and the live Retro/Signal/Poker apps.

## Build & deploy

- Built via subagent-driven TDD (~7–8 tasks: branch → sync + drift test → `raid.css` part A
  tokens/RAG-triad/base/buttons/chrome → part B input-card/result-grid/raid-cards/RAG/action-bar/
  error → reskin 2 shells + JS class touch-ups + remove inline `<style>` → e2e band spec + contrast
  test → verify + merge), with two-stage review + a final holistic review (as for
  Hub/Signal/Retro/Poker).
- Branch `feat/instrument-raid` off Raid's live `master`; pushed to origin as backup. Verify +
  review locally; merge to `master` locally; push.
- Deploy (operator-driven live session): on prod, `git pull` in `/var/www/raid`, restart the
  `raid` service (`raid.service`, port 3003, `User=raid`, env `/var/www/raid/.env`), verify
  `/health` + smoke (`curl -s http://127.0.0.1:3003/health`), then **hard-refresh** in browser
  (assets linked without a cache-buster — same caveat as Hub/Signal/Retro/Poker). No npm install /
  no migration expected (views/CSS/JS only).
- Explicit git staging only; `git status` before each commit.

## Non-goals / deferred

- This is the **last** redesign surface — there is no follow-on sub-project. On merge + deploy the
  Instrument visual redesign program is complete.
- Any change to the `/extract` API, the RAID extraction prompt/schema, quota enforcement, export
  formats, auth, sample content, or the server.
- The licence-text update and first-login consent — separate queued licence/consent work, blocked
  on final lawyer-reviewed text.
- A cache-buster for static assets — noted as a program-wide improvement, not done here.
