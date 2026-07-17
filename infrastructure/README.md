# Infrastructure

Server-side configuration and deployment artefacts.

**Nothing here is applied automatically.** The live files on IONOS
(`194.164.124.172`) are authoritative. These are references: for rebuilding a
box, for reviewing a change, and so that load-bearing rules are discoverable in
version control rather than only as prose in some subproject's README. This repo
has been bitten by live-vs-repo config drift before — if you change one, change
both, then run the smoke check.

## Contents

| Path | What |
|---|---|
| `apache/sprintsuite.uk.conf` | Mirror of the live `:443` vhost for the hub + the Sprintsight promo page |
| `smoke-sprintsuite.sh` | Post-deploy checks for sprintsuite.uk. Run on prod. |

Still planned: vhost mirrors for the other five domains, pm2 ecosystem files,
reference DNS records per domain.

## Smoke check

```bash
bash infrastructure/smoke-sprintsuite.sh
```

Run it on prod after any deploy touching the vhost, the hub, or `marketing/`.

It exists because **no test in this repo can see an Apache vhost.** The hub's
landing page has a tile linking to `/sprintsight-coming-soon/intro/`, which
Apache serves from `marketing/public` — not the hub. Delete the `Alias` and the
flagship tile lands on the hub's 404 with the entire suite green.
`hub/tests/landing-assets.test.js` looks like it would catch it and does not: its
URL regex requires a file extension, and that href ends in a slash.

The checks that are easy to underestimate:

- **`/sprintsight-coming-soon/` must 404.** If it starts returning 200 it is
  serving a directory listing — `apache2.conf` grants `Options Indexes` on
  `/var/www/`, which is why the alias points at `/intro` and not the parent.
- **The theme must carry the sight tokens and glyphs.** The promo page pulls
  `instrument-core.css`, `glyphs.svg` and its fonts from the **hub**. A stale hub
  copy renders the page colourless while every URL still returns 200 — a silent
  failure that looks completely healthy.
