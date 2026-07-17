# Marketing Site

Static marketing surface for `sprintsuite.uk`. No server, no framework, no build
step — plain HTML/CSS/JS served from `public/`.

## Pages

| Path | Source | Status |
|---|---|---|
| `/sprintsight-coming-soon/intro/` | `public/sprintsight-coming-soon/intro/` | Coming-soon promo. Live. |

## Layout

```
public/
├── sprintsight-coming-soon/intro/   the page, with its own assets beside it
│   ├── index.html
│   ├── sight.css                    page-specific layer
│   ├── sight.js                     page-specific behaviour
│   └── sight-og.png                 built by tools/build-og.sh
├── css/instrument-core.css          SYNCED — never hand-edit
├── js/oscilloscope.js               SYNCED — never hand-edit (unused here; sync copies it anyway)
├── illos/glyphs.svg                 SYNCED — never hand-edit
└── fonts/                           SYNCED — never hand-edit
```

A page keeps its own assets in its own directory. That is what lets prod serve
this with a single Apache rule instead of one per file — see Deploying.

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
done — semantics, every contrast pair, the honesty constraints, the console
contract. The rest of it (200% zoom, a keyboard-only run, an OG card validator)
is genuinely manual and is not pretended to be covered.

There is no CI in this repo yet, so nothing runs these automatically. Wiring
`npm test` into CI is the obvious first job when CI arrives.

## Deploying

Build spec §2.2 says to serve `marketing/public` as the document root for
`sprintsuite.uk`. **Ignore that — it is not possible.** The hub owns that document
root: it runs on `:3004` behind Apache and does `express.static(hub/public)`,
already serving `/`, `/request`, `/privacy`, `/login` and the asset trees `/css/`,
`/js/`, `/illos/`, `/fonts/`, plus its own `/favicon.svg`.

The page is therefore self-contained under its own path, and prod needs exactly
one Apache rule in the `sprintsuite.uk :443` vhost, **above** the hub's
`ProxyPass /`:

```apache
ProxyPass /sprintsight-coming-soon !
Alias /sprintsight-coming-soon /var/www/suite/marketing/public/sprintsight-coming-soon
<Directory /var/www/suite/marketing/public/sprintsight-coming-soon>
  Require all granted
  Options -Indexes
</Directory>
```

`ProxyPass … !` is the load-bearing line: without it the hub's catch-all proxy
swallows the path and the Alias never runs.

**Three shared assets still come from the hub**, by design: the page requests
`/css/instrument-core.css`, `/illos/glyphs.svg` and `/fonts/*` absolutely, and
`instrument-core.css` hardcodes `url("/fonts/…")` so the fonts could not be
relocated anyway. They are byte-identical across surfaces — that is exactly what
`check-theme-drift.mjs` guarantees — so whichever surface answers is correct. But
it is a real cross-surface dependency: **if the hub is down, this page loses its
stylesheet and fonts.** It keeps its content, layout being the only casualty.

`/sprintsight-coming-soon/intro` (no trailing slash) 301s to `…/intro/`. That is
normal directory behaviour and is why `canonical` names the trailing-slash form —
the canonical must be the URL that actually returns 200, not the one that
redirects.

## Things that will bite you

- **`--con-dim` is load-bearing.** `oklch(0.62 …)` clears WCAG AA on the console
  background by 0.08. The mock's `0.5` fails outright. Do not "tidy" it back.
  `tests/contrast.test.mjs` enforces this and every other pair.
- **The rail and the coming-soon chip are correctness, not decoration.** Every
  present-tense claim on the page is only honest because they are there. They
  come off when the product ships, not before.
- **The scorecard shows targets, not results.** If a real eval run scores below
  4/4, the page changes before launch.
- **The notify form has no endpoint.** `NOTIFY_ENDPOINT` is `null` in `sight.js`,
  so submitting reports the error state and logs a console warning. Deliberate: a
  form that silently swallows an address is worse than one that admits it failed.
  Set the constant to go live; the five states already work against it.
- **Five of the eight console evidence ids are not in their source of truth.**
  `sight/docs/data/data-strategy.md` §6 records ids for Atlas only, as an
  "Example:", and `bugspike`/`triage` are not artifact types in §5 at all. The
  page labels its data synthetic in both the rail and the footer, so shipping
  them is honest, but §14's "ids match §6 exactly" cannot be ticked until §6
  grows the other three teams.

## Coupling — this page restates specs that live elsewhere

Sprintsight is still in build, so these WILL move. When they do, this page moves
with them. Lifted from the build spec's §15 before it was archived; it is the one
part of that document that was never "done".

| On this page | Source of truth |
|---|---|
| Console JSON shape | `/var/www/sight/docs/evals/watermelon-eval.md` §2 |
| Evidence ids, team roster | `/var/www/sight/docs/data/data-strategy.md` §3, §6 |
| The three tells and their ids | `/var/www/sight/docs/moat/moat-behaviours.md` §2-4 |
| Scope guardrail callout | `/var/www/sight/docs/moat/moat-behaviours.md` §2, **LOCKED** |
| "Recommend-only, never auto-writes" | `/var/www/sight/docs/moat/moat-behaviours.md` §4, **LOCKED**, permanent product principle |
| Audience word counts (150/400/none) | `/var/www/sight/docs/evals/report-quality-eval.md` §4, **LOCKED** |
| Scorecard target figures | `/var/www/sight/docs/evals/watermelon-eval.md` §8 |

If any of these move, add a line to `/var/www/sight/HANDOVER.md` under
`Learning queue` so this page gets updated with them.

**Known gap:** only Atlas's three evidence ids actually appear in
`data-strategy.md` §6, and they are given there as an *"Example:"*. Boreas,
Cygnus and Draco have none, and `bugspike`/`triage` are not artifact types in §5
at all. The five ids the console cites for those teams follow the documented
convention but are not recorded anywhere. The page labels its data synthetic in
both the rail and the footer, so shipping them is honest — but the ids cannot be
verified against §6 until §6 grows the other three teams.
`tests/page.test.mjs` asserts the Atlas three against the real file and checks
the rest for convention conformance, which is the strongest check available.

## Docs

The build spec and its approved mock-up were archived to
`~/suite-archive/marketing/docs/` once the page shipped — see the git history for
`marketing/docs/`. They were build instructions for a page that now exists, and
the deviations made during the build mean they no longer describe what shipped.
The reasoning that outlived them lives in the commit bodies, in code comments,
and in `tests/` — which enforce it rather than merely describing it.
