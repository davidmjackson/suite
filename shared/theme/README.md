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
    node /var/www/suite/shared/theme/sync-theme.mjs /var/www/signal   # copies into signal/public/{css,js,illos,fonts}

Then in that app's repo: wrap the page body in `class="ins"` (+ `data-app="signal"`),
link `/css/instrument-core.css`, include `/js/oscilloscope.js` as a module, render
the band with an empty `<div class="waves">`, remove `breathing-waves.*`, and
**commit the synced files**. Add a CI/test step:

    node /var/www/suite/shared/theme/check-theme-drift.mjs /var/www/signal

## Preview
    cd /var/www/suite/shared/theme && python3 -m http.server 8799   # open http://127.0.0.1:8799/preview.html
