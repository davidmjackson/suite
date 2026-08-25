# SprintSight promo page — security headers at Apache

Date: 2026-08-25
Status: accepted
Source: ZAP 2.17.0 baseline scan of sprintsuite.uk, 2026-08-25

## What this is worth — read this before trusting it

This is **scan hygiene and estate uniformity, not risk reduction**, and the
distinction matters for what gets done next.

The page is static: no server-side rendering, no user input reaching a server, no
cookies, no auth. Its CSP is an XSS *mitigation* on a page with no injection vector,
so most directives here do no work today. `nosniff` is the exception with a small
genuine benefit, because HTML, SVG and PNG share one static root. And the missing
HSTS was never a real exposure: HSTS is host-scoped, and every visitor whose CSS
loaded was already pinned by the hub's own response on the same host.

The real exposure on this origin is elsewhere and is untouched by this change: the
promo page shares `sprintsuite.uk` with the authenticated hub, which has **no CSRF
token on any of its ~22 POST routes**. `HttpOnly` stops a script reading the session
cookie; it does not stop a same-origin script *using* it, and `SameSite=Lax` is
irrelevant to a same-site request. Hardening the page next door to that risk must
not be mistaken for having addressed it. CSRF is the next story.

## Problem

`/sprintsight-coming-soon/intro/` is served by an Apache `Alias` that deliberately
sits above the hub's catch-all `ProxyPass`. That is what makes the page reachable
at all — and it is also why the page never touches `hub/middleware/securityHeaders.js`.
Confirmed live:

    GET /sprintsight-coming-soon/intro/   200, no security headers at all
    GET /login                            200, full header set

Four of the scan's eleven alerts, and 14 of its 39 instances, are this one gap:
CSP not set, X-Frame-Options missing, HSTS missing, X-Content-Type-Options missing.

## Decision

Set the headers in the vhost, in a `<Directory>` block over the aliased filesystem
path, so the static page carries the same protection the hub gives every other page.

### D1 — `<Directory>` with `Header always set`

`Alias` maps into the filesystem, so `<Directory>` is its natural partner and applies
to the files actually served. `always` rather than `onsuccess` because a 404 under
that path (a mistyped asset) otherwise gets no headers at all; the scan only ever saw
200s, so this is the case no evidence covers.

`mod_headers` is not an assumption: sprintplan.uk resolves to the same host
(194.164.124.172) and already serves Apache-set CSP/HSTS/XFO/XCTO today.

### D2 — the policy is derived from the hub's, not invented

The page's CSP is `DEFAULT_CSP` from `hub/middleware/securityHeaders.js` with exactly
one deviation (D3). Every reference on the page is same-origin — CSS, JS, fonts, the
glyph sprite, three SVGs — so `'self'` covers it with nothing added.

Two things that look like they need special handling and do not:

- **The JSON-LD block** (`index.html:52`) is a data block, not executable script, so
  `script-src 'self'` does not block it. This is proven rather than assumed:
  `hub/views/landing.eta:20` carries a JSON-LD block and is served live under the same
  `script-src 'self'`.
- **`connect-src 'self'`** is sufficient because `NOTIFY_ENDPOINT` is `null`
  (`sight.js:15`) — the notify `fetch` never fires. Wiring a real endpoint later must
  revisit this line.

`img-src 'self' data:` keeps the hub's value, and the `data:` is load-bearing:
`hub/public/css/instrument-core.css:101` sets a `data:image/svg+xml` background on
`.ins select.input`. The page pulls that stylesheet from the hub, so dropping `data:`
would break a control on a page nobody here can render to notice.

### D3 — the one deviation: `style-src` without `'unsafe-inline'`

The hub's pages run `style-src 'self' 'unsafe-inline'`, which the same scan flags
separately (5 instances). Copying that here would have *added* a sixth instance while
"fixing" the page — closing one finding by opening another.

Instead the promo page ships a clean `style-src`:

- the three `style="background:var(--token)"` swatch attributes become three classes
  in `sight.css`. A CSP hash cannot cover style *attributes* — only `style-src-attr`
  or `'unsafe-hashes'` can, and both are worse — so they have to go.
- the `<noscript><style>` block stays and is covered by a `sha256-` hash. It cannot
  move to an external stylesheet: applying only when JS is off is its whole purpose.

This makes the promo page the first surface in the suite with a clean `style-src`,
and the reference shape for doing the same to the hub's 59 inline attributes later.

### D4 — guarding a fact that now lives in three places

The policy is now written in `securityHeaders.js`, in the repo's vhost mirror, and in
the live vhost on prod. Apache cannot import from JavaScript, so the copies cannot be
collapsed — which leaves asserting their agreement.

Two guards, each catching what the other cannot:

- `marketing/tests/promo-security-headers.test.mjs` recomputes the `<noscript><style>`
  hash from `index.html` and asserts the vhost carries it, and asserts the vhost's CSP
  equals `DEFAULT_CSP` with only the documented `style-src` deviation. This catches
  html/JS/config drift **inside the repo**.
- `infrastructure/smoke-sprintsuite.sh` asserts the headers on the **running server**.
  This is the only thing that can catch the repo being right and prod being stale —
  the failure mode the vhost's own header warns about.

Neither is sufficient alone. The repo test cannot see Apache; the smoke check cannot
run in CI, because there is no CI and prod is not reachable from it.

## Known gap, accepted

Nothing catches a future inline `style=` attribute added to `index.html`. The honest
guard is a browser rendering the page under the policy, and there is no browser on
ORAC. A source-grep for `style="` would be a test that source is *spelled* a
particular way — the standard forbids it, and it would fail open on the first
construction nobody thought of. Recorded rather than papered over.

## Out of scope

Deliberately not touched, each its own item on the ZAP remediation plan:

- the hub's own `style-src 'unsafe-inline'` (59 attributes, 12 view files)
- CSRF tokens across the hub's ~22 POST routes
- `Cache-Control` on dynamic HTML; the 404 handler's CSP clobber
- the notify form's missing `method` attribute
- `RequestHeader set X-Forwarded-Proto "http"` on a `:443` vhost — looks wrong, is
  unrelated to this story, and needs its own check against cookie `Secure` handling
