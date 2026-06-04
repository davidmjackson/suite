# Instrument — Poker redesign (sub-project 4)

**Date:** 2026-06-03
**Program:** Instrument visual redesign. Sub-project 0 (shared `suite/shared/theme/`
foundation), sub-project 1 (Hub + Auth), sub-project 2 (Signal), and sub-project 3 (Retro) are
built, merged, and live. This is **sub-project 4**: make Poker (sprintpoker.uk) consume the
Instrument foundation.

## Goal

Reskin Poker to the Instrument `.ins` design system — replace its `theme-core`/`theme-poker`/
`breathing-waves`/`app.css` layer with the synced foundation, adopt the oscilloscope band,
Bricolage/Hanken/IBM Plex Mono fonts, and the shared component vocabulary, and re-point Poker's
app-specific components (the entry form + card preview, the estimation room — vote deck,
participants, results — the role/end-session modals and the invite popover, and the anonymous
share-link join) to Instrument tokens. **Markup + CSS + a light JS reskin only — no behavior, API,
auth, WebSocket, voting/round logic, or share-link change.**

## Repo / environment

- Poker lives in its **own repo** at `/var/www/scrumpoker` (remote
  `bitbucket.org/epicnerd/scrum-poker`, separate from `/var/www/suite`). Service `scrumpoker`,
  `User=davidj`, env `/etc/scrumpoker.env`, port 3000. Live branch `main`; new work branches off it
  as `feat/instrument-poker`.
- Poker is **server-static + client-rendered**: static HTML shells in `public/` (`index`, `join`,
  `license`) + vanilla JS (`app.js`, `cardDeck.js`, `clipboard.js`, `join.js`) that drive a
  WebSocket and build the DOM. Auth is delegated to the hub via `/auth-client/heartbeat.js`.
- `index.html` is a single-page shell carrying **three states**: the entry/login form, the
  estimation room, and two modal dialogs (edit-role, end-session). `join.html` is the separate
  anonymous share-link entry (which then shows the same room markup). `license.html` is standalone.
- The Instrument foundation stays in `/var/www/suite/shared/theme/`; `manifest.mjs` already
  registers `poker` → `/var/www/scrumpoker/public`. Cross-repo sync/drift works because both repos
  live on the same box.
- **Program docs (this spec + the plan) live in the suite repo** (`/var/www/suite/docs/superpowers/`);
  **code changes commit in the Poker repo.**

## Scope

In scope — the whole app:
- All three static shells: `index` (entry + room + modals), `join` (anonymous share-link entry +
  room), `license`.
- All client-JS-generated markup: the voting deck (flip cards built by `cardDeck.js`), the
  participants list, the results/grouped-results, the connection-status pill, the invite popover.

Not in scope: server/routes, auth, the WebSocket protocol, voting/round/reveal/reset logic,
share-link behavior, room/company scoping, any behavior. No licence-text change (the existing
`license.html` text is reskinned as-is). No cache-buster (program-wide deferred item).

## Key decisions (brainstorm 2026-06-03)

1. **Full `.ins` adoption** (same model as Hub/Signal/Retro). `instrument-core.css` scopes
   everything under `.ins`, so consuming the synced foundation *requires* adopting `.ins`; a
   compatibility shim was rejected for the same reasons as the prior sub-projects (it would fork the
   token vocabulary and break the sync/drift model).
2. **Accent = ink.** `data-app="poker"` resolves `--accent` to `--ink` in the foundation, matching
   the design handoff (Raid=amber, Signal=green, Retro=teal, **Poker=ink**). Poker is deliberately
   **monochrome** — the playing cards are the visual interest, not a chromatic hue. Today's
   warm/serif identity is replaced.
3. **Card back = CSS lattice, not a raster.** The voting cards keep their existing 3-D flip
   mechanic (`cardDeck.js` builds `.card-inner` rotating between a back and front face, toggled by
   `.is-face-down`), but the **back face becomes a styled `.pkback` CSS lattice `<div>` instead of
   an `<img src="/images/cardback.jpg">`**. `images/cardback.jpg` is removed. The front face becomes
   the Instrument `.pkfront` number card (≈64×90, radius 9, ink number in Bricolage 24/700). This is
   the single small `cardDeck.js` edit (build a styled `<div>` back rather than an `<img>`); all flip
   / stagger / reset / intro animation timing is preserved unchanged.
4. **Band placement.** Oscilloscope band on the `index` **entry** screen, the **room** (in both
   `index` and `join`), and `license`; **the anonymous `join` *entry* screen stays focused with no
   band** (Poker's analogue of Retro's `join` / Signal's `respond` / the hub's bare auth). The
   handoff mockup shows a band on the Poker join screen, but suite-wide we keep anonymous entry
   points focused for a calmer guest first impression.
5. **Glyph.** `theme-illos.svg` is brand-only in Poker. Switch the brand glyph to
   `glyphs.svg#glyph-poker` (two overlapping rounded-rect cards) and **remove `theme-illos.svg`
   entirely**.
6. **Footer / license link.** Poker already has `<footer class="app-footer"><a href="/license">…</a></footer>`
   on every shell — keep it (reskinned) and reskin the existing `license.html`. No licence-text
   change — that stays with the queued licence/consent work.

## CSS layering — replace four files with two

Remove `public/css/theme-core.css`, `public/css/theme-poker.css`, `public/css/breathing-waves.css`,
and `public/css/app.css`. Each page links:
1. **`/css/instrument-core.css`** — synced foundation, source of truth, drift-checked.
2. **`/css/poker.css`** — Poker-owned (the `retro.css`/`signal.css`/`hub.css` equivalent),
   **not** drift-checked.

`poker.css` (mirror the finished `retro.css` structure) contains:
- A Poker-local token block for what Instrument doesn't define: any `--s-*` spacing / `--r-*` radius
  / `--shadow-*` scales that `app.css` relies on (ported from `theme-core.css`), plus a
  **`--danger`** red (the foundation has no red token — same situation Retro handled with its own
  `--col-stop`), and semantic aliases mapped onto the Instrument palette.
- All of `app.css`'s components, scoped under `.ins`, re-pointed to Instrument tokens
  (`--bg`/warm→`--bone`; `--surface`→`--panel`; `--border`→`--line`/`--line2`; `--muted`→`--soft`;
  `--accent`→`--accent` (now ink); `--mono`→`'IBM Plex Mono',monospace`).
- The **card system** (`.pkfront`/`.pkback` + the existing `.vote-card`/`.card-inner`/`.card-face`/
  `.card-back`/`.card-front`/`.is-face-down`/`.selected`/`.picked` flip classes restyled to the
  Instrument card look), the **entry card preview** (`.preview-card*`, `.preview-votes`), the **room
  grid** (vote panel, participants, results, grouped results), the **modals** (`.modal-overlay`/
  `.modal-content`/`.modal-actions`) and the **invite popover** (`.invite-menu`/`.invite-action`).

Fonts switch Fraunces/Inter/JetBrains Mono → Bricolage/Hanken/IBM Plex Mono automatically via
Instrument's `@font-face` + synced woff2. The old font files (`Fraunces.woff2`, `Inter.woff2`,
`JetBrainsMono.woff2`) become unused and are removed. `theme-illos.svg` is removed (brand-only,
replaced by `glyphs.svg`). `images/cardback.jpg` is removed (replaced by the `.pkback` CSS lattice).

## Chrome + per-page mapping (static shells)

Pure markup reskin; no behavior change.
- **All three pages:** `<body class="ins" data-app="poker">`; link `instrument-core.css` +
  `poker.css`; topbar/brand → `.ins` versions; brand glyph → `glyphs.svg#glyph-poker`; replace the
  `breathing-waves.js` include with `oscilloscope.js` (`type="module"`) on banded shells; keep the
  `app-footer` license link.
- **index — entry screen:** `.header-band` + `data-breathing-waves` → `<div class="band"><div
  class="waves"></div><div class="band-in">` carrying the eyebrow ("Planning room") + title +
  subtitle. Entry form (`.entry-card`/`.field`/`select`) → Instrument form primitives; the
  `.entry-preview` card-preview aside → Instrument `.pkfront`/`.pkback` preview cards +
  `.preview-votes` Fibonacci chips.
- **index — room:** band (eyebrow "Estimation room", title "Scrum Poker Room", room/org subtitle);
  `.room-userbar` greeting + action buttons; `.room-grid` (vote panel + participants + results +
  grouped results) as Instrument panel cards; `.facilitator-controls` button row.
- **index — modals:** edit-role + end-session `.modal-overlay`/`.modal-content` reskinned to an
  Instrument dialog; the invite `.invite-menu` popover reskinned.
- **join — entry:** focused full-screen anonymous join card (name field + Join button), **no band**;
  only brand/fonts/classes updated. The room markup it reveals matches `index`'s room.
- **license:** reskin, band, text unchanged.
- The vote deck, participants, and results render client-side inside their shells, inheriting the
  band/chrome.

### Card & room components (`index.html` + `app.js` + `cardDeck.js`)

- **Voting deck** (`#voting-cards` / `.voting-deck`): flip cards built by `cardDeck.js` →
  `.pkfront` (number, Bricolage 24/700, ink) front / `.pkback` (CSS lattice) back; selected vote =
  ink outline + slight lift. Flip / stagger / reset animation preserved.
- **Card preview** (`.entry-preview`): static `.pkfront`/`.pkback` preview cards + `.preview-votes`
  Fibonacci chips + a `Ready` status pill.
- **Participants** (`#participants-list` / `.participants-list`): rows with name + role pill + a
  mini card indicator (voted / not-voted).
- **Results** (`#vote-summary` average + `#ordered-votes` grouped): Instrument stat/panel cards.
- **Connection status** (`#connection-status`): a pill — green when connected, `--danger` when
  connecting/disconnected.

## Buttons & semantic colors & footgun audit (SP2/SP3 lessons)

Poker uses its own button classes (`btn btn-primary`, `toolbar-action`, `success-action`,
`secondary-action`, `danger-action`, `invite-action`). Keep the class names and restyle in
`poker.css` (as Retro did with its own classes), mapping to Instrument semantics:
- **Primary** (`btn-primary`: Enter Room / Join / Save Role) → **ink** filled (the accent —
  monochrome poker = dark buttons).
- **Show Votes** (`success-action`) → **green** (suite primary — the affirmative reveal).
- **Reset / End / Logout** (`danger-action`, `.danger`) → the Poker-local **`--danger`** red.
- **Role / Next Round / Cancel / Invite** (`secondary-action`, `toolbar-action`, `invite-action`) →
  an Instrument **`btn-ghost`**-equivalent (bordered/quiet).

Footgun audit:
- **Bare `.btn` footgun:** Instrument's base `.btn` is intentionally minimal and requires a variant.
  Every reskinned button must resolve to a real variant — never a bare `.btn`/`.btn btn-sm`. (The
  `btn btn-primary` markup keeps `btn-primary` styled in `poker.css`.)
- **`*wash`-as-translucent footgun:** Instrument `--greenwash`/`--tealwash`/`--amberwash` tokens are
  **opaque** pale tints, not translucent. Any overlay/fill that must show what's beneath it — the
  card hover halos / selection glow, the modal overlay scrim — must use `oklch(… / alpha)`, never an
  opaque `*wash` token.
- **Compound body-state / element-state selectors:** Poker toggles state classes on elements that
  also carry `ins` or sit directly on the banded sections (`.app-page`, `.login-page`/`.room-page`,
  `.hidden`, modal `.modal-overlay.hidden`, `.observer-note.hidden`, observer/facilitator-only
  controls). Any state class on the `.ins` element itself needs a **compound** selector
  (`.ins.app-page`, not `.ins .app-page`); preserve `.hidden{display:none!important}` /
  `[hidden]{display:none!important}` — it is a security-relevant guard that hides facilitator-only
  controls (End, facilitator-controls) and the observer note from users who must not see them, not
  cosmetic.

## JS reskin

- **`app.js` / `join.js`** — update only theme-derived generated class names (card faces, role
  pills, status pills); no logic change. Keep JS-emitted class names where present and restyle them
  via `poker.css`.
- **`cardDeck.js`** — the one functional edit: build the card back as a styled `.pkback` `<div>`
  (CSS lattice) instead of an `<img src="/images/cardback.jpg">`; front face becomes `.pkfront`.
  Flip mechanics, class toggles (`.is-face-down`/`.selected`/`.picked`), and animation timing
  unchanged.
- **Replace `breathing-waves.js`** include with `oscilloscope.js` (`type="module"`) on the banded
  shells; **remove `breathing-waves.js`** and all references.
- `clipboard.js` (invite-link copy) is unaffected — only the popover appearance is restyled.

## Testing & verification

- **Drift guard:** a `theme-drift` test in Poker importing `driftReport` from
  `/var/www/suite/shared/theme/check-theme-drift.mjs`, asserting the synced copies match source.
  Wired into Poker's test run. (Cross-repo dependency on `/var/www/suite` — acceptable; both repos
  are on the same box.)
- **Contrast test:** pin the Instrument palette pairs Poker actually uses — ink number on bone card,
  white on green (Show Votes), white on `--danger` (Reset/End/Logout), ink primary button label.
- **Card-deck unit test:** assert `cardDeck.js` builds `.pkfront`/`.pkback` faces (no `<img>`) and
  that the flip toggles `.is-face-down` — guards the JS edit.
- **Unit tests** (existing `npm test`, currently 72) test `lib/` + server logic — unaffected, stay
  green.
- **Playwright e2e** (existing 8) drive a real browser — the **primary guard** for the
  client-rendered reskin. Add a **header-band spec**: band renders on entry+room but **not** on the
  anon `join` entry. Audit specs for changed selectors and update only genuinely-broken
  **presentational** selectors; **never weaken** behavioral / tenancy / anonymous-gating assertions
  (the anonymous share-link join, the observer-cannot-vote gating, the facilitator-only-controls
  gating, any company-scope boundary).
- **Visual pass:** run Poker locally and eyeball every state — entry + card preview, room (deck,
  flip/reveal, participants, results, grouped), both modals + invite popover, anonymous join,
  license — against `shared/theme/preview.html` and the live Retro/Signal apps.

## Build & deploy

- Built via subagent-driven TDD (~8 tasks: branch → sync + drift test → `poker.css` part A
  tokens/base/buttons/chrome → part B room/cards/modals/preview → reskin 3 shells → `cardDeck.js`
  back-face edit → e2e band + gating spec + contrast + card-deck test → verify + merge), with
  two-stage review + a final holistic review (as for Hub/Signal/Retro).
- Branch `feat/instrument-poker` off Poker's live `main`; pushed to origin as backup. Verify +
  review locally; merge to `main` locally; push.
- Deploy (operator-driven live session): on prod, `git pull` in `/var/www/scrumpoker`, restart the
  `scrumpoker` service (port 3000, `User=davidj`, env `/etc/scrumpoker.env`), verify health + smoke,
  then **hard-refresh** in browser (assets linked without a cache-buster — same caveat as
  Hub/Signal/Retro). No npm install / no migration expected (views/CSS/JS only).
- Explicit git staging only; `git status` before each commit.

## Non-goals / deferred

- The remaining surface (Raid) — separate follow-on sub-project 5.
- Any change to voting/round/reveal/reset behavior, the WebSocket protocol, room/company scoping,
  share-link behavior, the licence text, or the server/API.
- A cache-buster for static assets — noted as a program-wide improvement, not done here.
