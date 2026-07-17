# Marketing Site

Static marketing surface for `sprintsuite.uk`. No server, no framework, no build
step — plain HTML/CSS/JS served from `public/`.

## Pages

| Path | Source | Status |
|---|---|---|
| `/sprintsight` | `public/sprintsight/index.html` | Coming-soon promo. Live-ready. |

## Layout

```
public/
├── sprintsight/index.html   the page
├── css/
│   ├── instrument-core.css  SYNCED — never hand-edit
│   └── sight.css            page-specific layer
├── js/
│   ├── oscilloscope.js      SYNCED — never hand-edit (unused here; sync copies it anyway)
│   └── sight.js             page-specific behaviour
├── illos/glyphs.svg         SYNCED — never hand-edit
├── fonts/                   SYNCED — never hand-edit
└── favicon.svg              hand-maintained copy of glyphs.svg#glyph-sight-sm
```

Anything marked SYNCED comes from `shared/theme/`. Edit it there, then:

```bash
node /var/www/suite/shared/theme/sync-theme.mjs --all
```

`--all`, not just this surface: the sprite and the core stylesheet are shared, so
every surface has to move together or the drift check goes red.

## Checks

```bash
npm test          # drift check + page tests
npm run drift     # synced assets match shared/theme/
npm run og        # rebuild the Open Graph card from tools/sight-og.svg
```

`tests/` encodes the statically-checkable half of the build spec's definition of
done — semantics, contrast-critical tokens, the honesty constraints, the console
contract. The rest of it (200% zoom, a keyboard-only run, an OG card validator)
is genuinely manual and is not pretended to be covered.

There is no CI in this repo yet, so nothing runs these automatically. Wiring
`npm test` into CI is the obvious first job when CI arrives.

## Things that will bite you

- **`--con-dim` is load-bearing.** `oklch(0.62 …)` clears WCAG AA on the console
  background by 0.08. The mock's `0.5` fails outright. Do not "tidy" it back.
- **The rail and the coming-soon chip are correctness, not decoration.** Every
  present-tense claim on the page is only honest because they are there. They
  come off when the product ships, not before.
- **The scorecard shows targets, not results.** If a real eval run scores below
  4/4, the page changes before launch.
- **`/sprintsight` needs an Apache rule.** Default static serving 301s the
  no-slash form to `/sprintsight/`, which is the canonical URL redirecting to a
  non-canonical one.

## Deploying — READ THIS FIRST, the spec is wrong here

Build spec §2.2 says to serve `marketing/public` as the document root for
`sprintsuite.uk`. **That is not possible.** The hub already owns that document
root: it runs on port 3004 behind Apache and does `express.static(hub/public)`,
which already serves `/`, `/request`, `/privacy`, `/login`, and the asset trees
`/css/`, `/js/`, `/illos/`, `/fonts/` — plus its own `/favicon.svg`.

Deployed naively, this page would 404 on `/css/sight.css` and `/js/sight.js`, and
`<link rel="icon" href="/favicon.svg">` would silently serve the **hub's** icon
instead of the melon. Nothing would look broken enough to notice.

The shared assets are not the problem: `instrument-core.css`, `glyphs.svg` and
the fonts are byte-identical across both surfaces (that is what the drift check
guarantees), so they resolve correctly whichever surface answers.

Two workable options, both needing a decision before launch:

**A. Alias the marketing-only paths ahead of the hub proxy.** Page unchanged.
Apache needs an entry per marketing-only asset (`/sprintsight`, `/css/sight.css`,
`/js/sight.js`, `/illos/sight-og.png`) and the favicon still collides.

**B. Self-contain under `/sprintsight/`.** One Apache alias, no collisions. Costs
a change to the page: every asset href becomes `/sprintsight/…`. Note that
`instrument-core.css` hardcodes `url("/fonts/…")`, so the fonts would still come
from the hub's tree — same bytes, but an implicit cross-surface dependency worth
knowing about.

Also unresolved either way: `/sprintsight` (no trailing slash) is the canonical
URL, but default static serving 301s it to `/sprintsight/`. So the canonical URL
redirects to a non-canonical one. Needs `DirectorySlash Off` plus an explicit
rewrite, or an `Alias` straight to the file.

## Docs

- `docs/sprintsight-promo-BUILD-SPEC.md` — the build specification
- `docs/reference/sprintsight-C-evidence-desk.html` — approved mock-up, visual target
