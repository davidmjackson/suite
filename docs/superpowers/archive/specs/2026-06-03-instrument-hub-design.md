# Instrument — Hub + Auth redesign (sub-project 1)

**Date:** 2026-06-03
**Program:** Instrument visual redesign. Sub-project 0 (the shared `suite/shared/theme/`
foundation) is built + merged to suite `main` @e93fe58. This is **sub-project 1**: make
the hub (sprintsuite.uk) consume the foundation. It is the program's primary goal —
unify today's plain Bootstrap-blue hub under the Instrument design system.

## Goal

Reskin every browser-rendered hub page to the Instrument `.ins` component vocabulary,
self-host the Instrument fonts, replace the legacy header with the oscilloscope band /
auth split card, and add the one missing primitive (a table component) to the canonical
foundation. **No route, data, or auth-logic changes** — this is a pure markup + CSS
cut-over.

## Scope

In scope — all browser-rendered hub views:
- **Public / user-facing:** `landing`, `dashboard`, `login`, `check-email`, `confirm`,
  `request`, `request-received`, `error`.
- **Operator / internal:** `admin/{companies,users,sessions,audit}`, `company/{console,team}`.

Out of scope:
- **Transactional emails** (`emails/access-approved`, `emails/magic-link`) — HTML email is a
  separate styling discipline (inline CSS, no external web fonts); left exactly as-is.
- Any route, controller, schema, session, or provisioning logic.

## Key decisions (brainstorm 2026-06-03)

1. **Delivery:** single feature branch, full markup rewrite, one cut-over. The hub is one
   repo / one deploy, so incremental page-group deploys add overhead and drift risk for no
   benefit. A token/font-only shim was rejected — it would leave the hub structurally
   divergent from the other surfaces.
2. **Table component lives in the foundation** (canonical `instrument-core.css`), not
   hub-local. Other surfaces' admin views inherit it later; keeps one source of truth and
   matches the sync model.
3. **Oscilloscope band placement = "entry points":** band on **landing + dashboard** (the
   two front doors). Operator pages use the compact topbar + an in-page `<h1>`. Auth pages
   always use the split card with waves in the left panel. Rationale: gives both arrival
   moments presence without putting the animation on every utility screen (calm-tech intent).

## Foundation additions (canonical → synced)

Edit `suite/shared/theme/instrument-core.css` (the source of truth), update the kitchen-sink
`preview.html` to exercise the new bits, keep `shared/theme/tests` green, then sync into the
hub. Two additions, both generic system primitives:

- **`.table` + `.table-wrap`** — `.table-wrap` provides horizontal scroll on narrow
  viewports; `.table` styles `th`/`td` (bone/`--line2` header row, `--line` row separators,
  comfortable padding) and composes with the existing `.tbacts` (action cell) and `.pill-*`
  (status cell). Verbatim-faithful to the Instrument aesthetic already in InsCSS.
- **Form-control coverage** — extend the existing `.input` selector to also style `select`
  and `textarea`, and add a small `.checks` / `.check` row pattern for checkbox lists. The
  form scaffolding (`.field`, `.label`, `.input`, `.helper`, `.notice`) already exists.

Everything else the hub needs already exists in the foundation: `.topbar`/`.brand`/`.mk`,
`.band`/`.band-in`/`.waves`/`.eyebrow`, `.page`, `.card`/`.card h2`, `.btn` +
`.btn-pri`/`.btn-ghost`/`.btn-danger`/`.btn-sm`, `.pill`/`.pill-ok`/`.pill-flag`/`.pill-closed`,
`.authwrap`/`.authcard`/`.authleft`/`.authright`, `.footer`, `a.lnk`, `.lede`/`.micro`/`.mono`/`.keybox`.

## CSS strategy — two layers

1. **`instrument-core.css`** — the synced foundation copy, source of truth, drift-checked.
2. **`hub.css`** — a small hub-owned stylesheet for hub-specific *composition only*: the
   app-launcher grid + app-tile treatment (a `.card` variant carrying a glyph), and the
   admin sub-nav row. Hub-local because no other surface has a 4-app launcher; **not**
   drift-checked. Linked after `instrument-core.css`.

The current 23-line `hub/public/styles.css` is **deleted**.

## Assets / sync

`node /var/www/suite/shared/theme/sync-theme.mjs /var/www/suite/hub` copies `fonts/`,
`instrument-core.css`, `oscilloscope.js`, and `glyphs.svg` into `hub/public/{fonts,css,js,illos}`.
The synced files are committed in the hub. App tiles reference glyphs via
`<svg><use href="/illos/glyphs.svg#glyph-{key}"></svg>`. `oscilloscope.js` is included as
`<script type="module">`; it auto-mounts the SVG trace into every empty `.band .waves` and
`.authleft .waves` container on `DOMContentLoaded` (respects `prefers-reduced-motion`).

## Shared chrome (the two partials)

- **`partials/header.eta`** → `<body class="ins">` (suite palette, **no** `data-app`); link
  `/css/instrument-core.css` then `/hub.css`; include `/js/oscilloscope.js` as a module;
  drop the old `/styles.css` link. Render the `.topbar`:
  `<a class="brand"><svg class="mk">…#glyph-suite…</svg> Sprint Suite</a>` on the left, a
  `.tbacts` group on the right (signed-in: email + Sign out; signed-out: Sign in).
  The partial accepts an **optional `band` object** (`{eyebrow, title, sub}`): when present it
  renders `<div class="band"><div class="waves"></div><div class="band-in">…</div></div>`
  immediately under the topbar. Open the `.page` wrapper for content.
- **`partials/footer.eta`** → close `.page`, render the `.footer`, close `body`/`html`.

## Page-by-page mapping

Pure markup/class reskin; all form `action`s, hidden inputs, honeypot div, `confirm()`
handlers, and Eta control flow preserved.

**Public:**
- **landing** — pass `band {eyebrow:"Sprint Suite", title:"Agile tools for teams that ship.",
  sub:"One sign-in, four focused apps."}`. `btn-pri` "Sign in" when logged out. App-launcher
  grid: 4 `.card` tiles, each with `#glyph-{key}`, linking to the app domain.
- **dashboard** — pass `band {title:"Your apps"}`. Launcher grid driven by `it.apps`:
  entitled → existing `POST /launch/:key` form rendered as a tile button; not-entitled →
  dimmed tile with a "Request access" note. "Manage" → links to `/company/:slug`. Admin link
  → `lnk`/`btn-ghost`.
- **login / check-email / confirm** — `.authcard` split: left = waves panel + brand +
  one-line tagline; right = form. login: `.field`+`.input` email, `btn-pri` "Send magic link",
  `.helper`, preserved `return_to` hidden input. check-email / confirm reuse the shell with a
  `.notice` in place of the form.
- **request** — centered `.card`: text `.field`s (company / contact / email / job-title),
  `team_size` as a styled `select`, apps as `.checks` checkbox rows, `message` as a `textarea`,
  honeypot div untouched, `it.error` → `.notice`, submit `btn-pri`. All `it.values.*` repopulation
  preserved.
- **request-received / error** — centered `.card` with a `.notice` and a `lnk` back home.

**Operator (topbar + in-page `<h1>`, no band):** one shared pattern — a sub-nav row, then
`.card`(s) wrapping a `.table` inside `.table-wrap`.
- **admin/companies** — pending-requests table (Approve = `btn-sm btn-pri`, Reject =
  `btn-sm btn-danger` in a `.tbacts` cell; ⚠ existing-company / duplicate-email →
  `pill-flag`); companies table (status → `pill-ok`/`pill-closed`).
- **admin/users, admin/sessions, admin/audit** — tables in cards; row actions → `btn-sm`
  variants; statuses → pills.
- **company/console, company/team** — tables + management controls (role toggles, entitlement
  toggles) as `btn-sm` variants; statuses → pills.

## Testing & verification

- Add `node …/shared/theme/check-theme-drift.mjs /var/www/suite/hub` to the hub's test
  script (guards the synced foundation copies against drift).
- **Render test per view:** each view compiles and renders with representative `it` data
  without throwing, and emits the expected markup — body carries `class="ins"`;
  landing/dashboard contain a `.band`; auth pages contain `.authcard`; operator pages contain
  a `.table`. The existing hub suite stays green.
- **Visual pass:** serve the hub locally and eyeball every page against `preview.html`.
- Foundation tests (`shared/theme/tests`) stay green after the `.table` / form-control additions.

## Build & deploy

- Built via subagent-driven TDD with two-stage review + a final holistic review (same method
  as the foundation).
- Branch `feat/instrument-hub`; pushed to origin as off-machine backup. Verify + review
  locally; merge to `main` locally; prod (`suite-hub` user) pulls `main`, restart the service,
  confirm `/healthz` 200 and spot-check pages. One cut-over.
- Explicit git staging only (never `git add -A`/`.` in `/var/www/suite`); `git status` before
  each commit.

## Non-goals / deferred

- Emails (out of scope, above).
- The other four surfaces (Signal/Retro/Poker/Raid) — separate follow-on sub-projects (2–5),
  each consuming the foundation the same way.
- Named radius/space/shadow token scales or a modal component the handoff prose mentioned but
  InsCSS doesn't define — add per-surface only if a component genuinely needs them; this
  sub-project needs only `.table` + form-control coverage.
