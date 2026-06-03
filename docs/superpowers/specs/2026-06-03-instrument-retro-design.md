# Instrument — Retro redesign (sub-project 3)

**Date:** 2026-06-03
**Program:** Instrument visual redesign. Sub-project 0 (shared `suite/shared/theme/`
foundation), sub-project 1 (Hub + Auth), and sub-project 2 (Signal) are built, merged,
and live. This is **sub-project 3**: make Retro (sprintretro.uk) consume the Instrument
foundation.

## Goal

Reskin Retro to the Instrument `.ins` design system — replace its `theme-core`/`theme-retro`/
`breathing-waves`/`app.css` layer with the synced foundation, adopt the oscilloscope band,
Bricolage/Hanken/IBM Plex Mono fonts, and the shared component vocabulary, and re-point Retro's
app-specific components (board columns, note cards, health strip, timer, lobby, actions report,
anonymous join) to Instrument tokens. **Markup + CSS + a light JS reskin only — no behavior, API,
auth, WebSocket, board-logic, or DB change.**

## Repo / environment

- Retro lives in its **own repo** at `/var/www/retrospective` (remote
  `github.com/davidmjackson/retrospective2`, separate from `/var/www/suite`). Service
  `retrospective.service`, `User=retrospective`, port 3001. Live branch `main`; new work
  branches off it as `feat/instrument-retro`.
- Retro is **server-static + client-rendered**: static HTML shells in `public/` (`lobby`,
  `retrospective`, `actions`, `join`, `license`) + vanilla JS (`lobby.js`, `client.js`,
  `actions.js`, `join.js`) that fetch the API / drive a WebSocket and build the DOM. Auth is
  delegated to the hub via `@suite/auth-client`.
- The Instrument foundation stays in `/var/www/suite/shared/theme/`; `manifest.mjs` already
  registers `retro` → `/var/www/retrospective/public`. Cross-repo sync/drift works because both
  repos live on the same box.
- **Program docs (this spec + the plan) live in the suite repo** (`/var/www/suite/docs/superpowers/`);
  **code changes commit in the retro repo.**

## Scope

In scope — the whole app:
- All five static shells: `lobby`, `retrospective` (the board), `actions` (report), `join`
  (anonymous share-link), `license`.
- All client-JS-generated markup (board columns/note cards, lobby team list, actions notes,
  join flow, timer, participants, health strip).

Not in scope: API/routes, auth, WebSocket protocol, board/voting/timer logic, share-link
behavior, DB/schema, any behavior. No licence-text change (the existing `license.html` text is
reskinned as-is). No cache-buster (program-wide deferred item).

## Key decisions (brainstorm 2026-06-03)

1. **Full `.ins` adoption** (same model as the hub and Signal). A compatibility shim was
   rejected: `instrument-core.css` scopes everything under `.ins`, so consuming the synced
   foundation *requires* adopting `.ins`; a shim would copy tokens instead of consuming the
   foundation, breaking the sync/drift model and leaving two parallel component vocabularies.
2. **Accent = teal.** `data-app="retro"` resolves `--accent` to `--teal` in the foundation,
   matching the design handoff (Raid=amber, Signal=green, Retro=teal, Poker=ink). Today's
   forest-green identity is replaced. Each suite app reads as visually distinct.
3. **Columns: uniform bodies, category-colored icon chips.** The 3-column board renders as
   uniform neutral `.col` panel cards (per the chosen "accent-only / uniform columns" direction),
   but each column's small **26px `.coltag` icon badge carries the category color per the
   handoff: Start `+` green, Stop `−` red, Continue `▶` teal**. Column body/chrome stays neutral;
   only the icon chip encodes sentiment.
4. **Band placement.** Oscilloscope band on `lobby`, `retrospective`, `actions`, `license`;
   **`join` stays the focused full-screen flow with no band** (Retro's analogue of Signal's
   `respond` / the hub's bare auth).
5. **Glyph.** `theme-illos.svg` is used in Retro **only** as the topbar brand glyph (`#pin`) — it
   carries no report content (unlike Signal's weather glyphs). Switch the brand glyph to
   `glyphs.svg#glyph-retro` (the three vertical bars) and **remove `theme-illos.svg` entirely**.
6. **Footer / license link.** Add `<footer class="app-footer"><a href="/license">License</a></footer>`
   to every shell (mirrors the finished Signal shells); reskin the existing `license.html`. No
   licence-text change — that stays with the queued licence/consent work.

## CSS layering — replace four files with two

Remove `public/css/theme-core.css`, `public/css/theme-retro.css`, `public/css/breathing-waves.css`,
and `public/css/app.css`. Each page links:
1. **`/css/instrument-core.css`** — synced foundation, source of truth, drift-checked.
2. **`/css/retro.css`** — Retro-owned (the `signal.css`/`hub.css` equivalent), **not** drift-checked.

`retro.css` (mirror the finished `signal.css` structure) contains:
- A Retro-local token block for what Instrument doesn't define: the `--s-*` spacing scale, `--r-*`
  radius scale, and `--shadow-*` scale (ported from `theme-core.css`, since `app.css` relies on
  them), plus semantic aliases mapped onto the Instrument palette — `--ok`→green/greenwash,
  `--warn`→amber/amberwash, `--err`→red, `--info`→teal/tealwash, `--accent-soft`→greenwash,
  `--mono-font`→`'IBM Plex Mono'`.
- All of `app.css`'s components, scoped under `.ins`, re-pointed to Instrument tokens:
  - `--bg`/`--bg-warm`→`--bone`; `--surface`→`--panel`; `--border`→`--line`, `--border-st`→`--line2`;
    `--muted`→`--soft`, `--faint`→`--faint`; `--accent`→`--accent` (now teal); `--accent-soft`→
    `--greenwash`/`--tealwash` as appropriate; `--mono`→`'IBM Plex Mono',monospace`.
- The legacy decorative classes (`cork-bg`, `washi`, `pin`, `polaroid`) that `theme-retro.css`
  already neutralizes: drop the decorative ones outright (`washi`, `pin`), and fold the `polaroid`
  note-card treatment into the Instrument note-card styling. Body class `cork-bg` is removed.

Fonts switch Fraunces/Inter/JetBrains Mono → Bricolage/Hanken/IBM Plex Mono automatically via
Instrument's `@font-face` + synced woff2. The old font files (`Fraunces.woff2`, `Inter.woff2`,
`JetBrainsMono.woff2`) become unused and are removed. `theme-illos.svg` is removed (brand-only,
replaced by `glyphs.svg`).

## Chrome + per-page mapping (static shells)

Pure markup reskin; no behavior change.
- **All five pages:** `<body class="ins" data-app="retro">`; link `instrument-core.css` +
  `retro.css`; topbar/brand → `.ins` versions; brand glyph `theme-illos.svg#pin` →
  `glyphs.svg#glyph-retro`; replace the `breathing-waves.js` include with `oscilloscope.js`
  (`type="module"`); add the `app-footer` license link.
- **lobby, retrospective, actions, license:** `.header-band` + `data-breathing-waves` →
  `<div class="band"><div class="waves"></div><div class="band-in">` carrying the existing
  eyebrow + the title as the band `<h1>` + optional subtitle.
- **join:** unchanged structure — the focused full-screen anonymous join card (Retro's analogue
  of the hub's bare auth / Signal's `respond`), no band; only brand/fonts/classes updated.
- The board, lobby list, and actions report render client-side inside their shells, inheriting
  the band/chrome.

### Board components (`retrospective.html` + `client.js`)

- **Health strip** (`health-strip` / `health-card`): the four Notes/Votes/Actions/Online stat
  cards → Instrument stat cards.
- **Instruction banner** (`instruction-banner` + `banner-dismiss`): re-tokenized notice/banner.
- **Board** (`board` / `column` / `card-list`): 3 uniform `.col` panel cards (Start/Stop/Continue
  = well/improve/continue). Column header: 26px `.coltag` icon badge (white symbol on category
  color — Start `+`/green, Stop `−`/red, Continue `▶`/teal), title + sub, and a `column-count`
  pill. `column-add` button → an Instrument button variant.
- **Note cards** (`card`/`polaroid` emitted by `client.js`): keep the JS-emitted class names,
  restyle in `retro.css` as the Instrument note card; remove the `pin`/`washi` decorations.
- **Sidebar chrome:** timer card (mono countdown + Start/Stop/Reset buttons), retro-health flag
  pill, participant avatars.

### Lobby / actions / join

- **Lobby:** overview cards + create-team card + past-retrospectives rows (open/closed pills +
  Open/Close actions).
- **Actions report:** 3 status columns (To do / In progress / Done) with header status dots +
  action notes (title + owner/Unassigned pill + due-date mono + source-retro pill).
- **Join:** focused anonymous join card (name field + Join button), no band; the closed/dead-link
  state and timer-display-without-controls behavior are unchanged (presentational reskin only).

## Buttons & footgun audit (SP2 lessons)

- Retro uses its own button classes (`primary-btn`, `secondary-btn`, `icon-btn`, `link-btn`,
  `invite-link-btn`), **not** Instrument's. Remap static-shell buttons to Instrument variants
  (`primary-btn`→`btn-pri`, `secondary-btn`→`btn-ghost`, link/icon buttons → appropriate
  variants); for JS-emitted buttons, keep the class and restyle in `retro.css`.
- **Bare `.btn` footgun:** Instrument's base `.btn` is intentionally minimal and requires a
  variant. Ensure every reskinned button resolves to a real variant — never a bare `.btn`.
- **`*wash`-as-translucent footgun:** Instrument `--greenwash`/`--tealwash`/`--amberwash` tokens
  are **opaque** pale tints, not translucent. Any overlay/fill that must show what's beneath it —
  the dragula drag mirror, card hover halos, vote-highlight fills, selection glows — must use
  `oklch(… / alpha)`, never an opaque `*wash` token.
- **`[hidden]` authority:** Retro already relies on a base `[hidden]{display:none!important}` rule
  (from the room-sharing work) so layout `display` classes don't leak facilitator-only / dead-link
  UI to anonymous joiners. Preserve that rule in the new CSS — it is a security-relevant guard,
  not cosmetic.

## JS reskin

- **`client.js` / `lobby.js` / `actions.js` / `join.js`** — update only theme-derived generated
  class names (note cards, column tags, status pills); no logic change. Keep JS-emitted class
  names where present and restyle them via `retro.css`.
- **Replace `breathing-waves.js`** include with `oscilloscope.js` (`type="module"`) on the four
  banded shells; **remove `breathing-waves.js`** and all references.
- `dragula` (vendor) is kept; only the drag-mirror appearance is restyled (via the alpha-fill
  rule above).

## Testing & verification

- **Drift guard:** a `theme-drift` test in Retro importing `driftReport` from
  `/var/www/suite/shared/theme/check-theme-drift.mjs`, asserting the synced copies match source.
  Wired into Retro's test run. (Cross-repo dependency on `/var/www/suite` — acceptable; both
  repos are on the same box.)
- **Unit tests** (21, `npm test`) test `lib/` + db-schema logic — unaffected, stay green.
- **Playwright e2e** (8) drive a real browser — the **primary guard** for the client-rendered
  reskin. Audit specs for changed selectors (`primary-btn`→`btn-pri`, `header-band`→`band`, brand
  glyph, body classes) and update only genuinely-broken **presentational** selectors; never weaken
  behavioral / tenancy / anonymous-gating assertions (e.g. the cross-company 404 boundary, the
  anon-can't-facilitate gating, the dead-link join-form-hidden assertion).
- **Visual pass:** run Retro locally and eyeball every page — board (all 3 columns + coltags +
  note cards + drag), lobby, actions report, anonymous join, license — against
  `shared/theme/preview.html` and the live Signal app.

## Build & deploy

- Built via subagent-driven TDD with two-stage review + a final holistic review (as for the hub
  and Signal).
- Branch `feat/instrument-retro` off Retro's live `main`; pushed to origin as backup. Verify +
  review locally; merge to `main` locally; push.
- Deploy (operator-driven live session): on prod as the appropriate user, `git pull` in
  `/var/www/retrospective`, restart `retrospective.service`, verify `/health` + smoke, then
  **hard-refresh** in browser (Retro's CSS/JS are linked without a cache-buster — same caveat as
  the hub and Signal). No npm install / no migration expected (views/CSS/JS only).
- Explicit git staging only; `git status` before each commit.

## Non-goals / deferred

- The remaining surfaces (Poker/Raid) — separate follow-on sub-projects 4–5.
- Any change to board/voting/timer/share-link behavior, the WebSocket protocol, the schema, the
  licence text, or the API.
- A cache-buster for static assets — noted as a program-wide improvement, not done here.
