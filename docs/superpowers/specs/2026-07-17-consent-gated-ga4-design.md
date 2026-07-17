# Consent-gated GA4 on the marketing pages — design

**Date:** 2026-07-17
**Status:** Approved, ready for implementation plan
**Scope:** Hub only — the public pages `/`, `/request` (covering the `request-received`
view) and `/privacy`. No app repos touched.
**Roadmap slot:** Marketing / measurement. Independent of Tier-1 stack work (#3 Express 5 / ESM).

## Problem

There is no measurement on the public funnel. We cannot answer "how many people who
land on `/` go on to register their interest", which is the only number that matters
pre-launch. A GA4 property (`G-6FJLV7EE1X`) exists and is empty.

The naive fix — pasting `marketing/GA-tracking.html` into `landing.eta` — is wrong on
three independent counts, each of which this design addresses:

1. **It would be silently blocked.** The hub sets `script-src 'self'` with no
   `'unsafe-inline'` (`middleware/securityHeaders.js:8`). The GA snippet is an inline
   `<script>` block. It would never execute, and nothing would report the failure.
2. **It would breach PECR.** The snippet sets `_ga` / `_ga_*` analytics cookies on load,
   before any consent. UK PECR reg. 6 requires consent *before* non-essential storage.
3. **It would make three published claims false.** See below.

## The false-claims problem (drives the copy scope)

Adding GA4 contradicts copy we currently publish:

| Location | Current text |
|---|---|
| `views/landing.eta` trust strip | "No tracking, no clutter" |
| `views/landing.eta` FAQ, *Where does my data go?* | "There's no third-party tracking…" |
| `views/privacy.eta` §6 | "…there are no third-party tracking cookies." |

`/privacy` §6 is the sharpest: the Data & Privacy Note (v1.0, effective 2026-07-01,
@279cce8) makes an unqualified promise, and names the ICO as the complaints route.

**Resolution (decided):** reframe to *no ad tracking* rather than *no tracking*. The
claim we keep is one we can defend: consent-gated analytics with no ad signals, never
sold, never used for advertising. The absolute "no tracking" claim is retired.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Positioning | Reframe to "No ads, no clutter" | Defensible; retires the absolute claim |
| Scope | `/`, `/request`, `/privacy` | Measures the conversion; `/privacy` hosts the withdraw control; analytics stop at the login door |
| Form factor | Sticky bottom bar | Non-blocking; hero lands unobstructed; PECR needs no blocking |
| Gating | Server-side + consent cookie | Zero Google contact unless granted |
| Consent Mode v2 | **Rejected** | Redundant under a server gate — see below |
| CMP (Cookiebot/OneTrust) | **Rejected** | One tag, one purpose, one jurisdiction |
| Withdrawal | Footer link + `/privacy` §6 button | "As easy to withdraw as to grant" |

### Why not Consent Mode v2

Consent Mode with `analytics_storage: 'denied'` is Google's canonical recipe, and it is
PECR-clean (nothing is stored pre-consent). But `gtag.js` still loads and still sends
**cookieless pings** carrying IP and user agent on every page view — including for a
visitor who has just clicked Reject. A server-side gate means a rejecter's browser never
contacts Google at all: nothing to explain, nothing to defend, and a claim we can make
truthfully in the FAQ. Consent Mode is the thing to add if ad features ever arrive.

## Architecture

### The inline-script invariant

The 2026-06-10 security-headers spec recorded **0 inline `<script>` blocks** across the
hub, which is precisely why strict `script-src 'self'` held with no refactor. **This
design preserves that invariant.** All JavaScript lives in first-party files under
`public/js/`; configuration reaches it via `data-*` attributes. We add neither
`'unsafe-inline'` nor per-request nonce machinery.

### Components

**Config** — `config.js` gains:

```js
gaMeasurementId: process.env.GA_MEASUREMENT_ID || null,
```

Optional by design. Unset ⇒ analytics off entirely: no tag, no banner, no CSP reliance.
Dev boxes and the test suite therefore never pollute the property. Prod sets
`GA_MEASUREMENT_ID=G-6FJLV7EE1X` in the hub `EnvironmentFile`.

**`lib/consent.js`** (new, pure, no I/O):

```js
export const CONSENT_COOKIE = "ss_consent";
export const CONSENT_MAX_AGE_DAYS = 180;
export function readConsent(cookieHeader) // -> "granted" | "denied" | null
```

Reuses `parseCookies` from `lib/cookies.js` — no new dependency. Anything that is not
exactly `granted` or `denied` (absent, malformed, tampered, unknown value) returns
`null`, meaning *ask again*. **It never fails open to granted.**

**View plumbing** — the three public paths are the *only* ones that opt in, via a
middleware pair applied at the route (never globally):

```js
// server.js
const marketing = [
  makeSecurityHeaders({ contentSecurityPolicy: marketingCsp }),
  analyticsLocals(config),   // sets res.locals.analytics = { gaId, consent }
];
mountLanding(app, { marketing });
mountRequest(app, { emailSender, marketing });
mountLegal(app, { marketing });   // /privacy only; /license and /terms stay inert
// inside each: app.get("/", marketing, handler)
```

**Why `/privacy` is in the set.** The withdraw control lives in §6, and it needs
`consent-banner.js` present to do anything. Without the marketing middleware the
button would render and silently do nothing. Including `/privacy` also keeps the
banner copy ("visits to our public pages") honest. `/license` and `/terms` stay out:
they carry no analytics, so they need no bar. The line that matters is unchanged —
analytics stop at the login door.

**Eta partials do not inherit `it`.** A partial sees only what is explicitly passed,
so `partials/header.eta` must be given `analytics: it.analytics` by each top-level
view that wants it (`request.eta`, `request-received.eta`, `privacy.eta`). This is a
feature, not a chore: `login.eta`, `dashboard.eta` and the admin views simply never
pass it, so the header is inert there **structurally** rather than by a conditional
someone could later get wrong.

**Why `res.locals` and not a render argument.** `routes/request.js` renders from **four**
call sites — `:17` (400 invalid), `:38` (GET), `:43` (honeypot), `:68` (POST success).
Passing `analytics` explicitly to each invites exactly one bug: miss `:17` and the banner
silently vanishes from the validation-error page, which is a live marketing page a real
visitor hits. Express merges `res.locals` into render options, so setting it once in
middleware means all four sites — and any added later — get it for free.

**Why applied at the route and not via `app.use`.** `app.use("/", …)` prefix-matches
**every** path in Express, so it would mount analytics on `/dashboard` and `/admin` too —
the precise leak this design exists to prevent. Passing the middleware into the existing
`mountX(app, deps)` pattern keeps the match exact and the opt-in visible at the route.

`landing.eta` has its own `<head>`; `/request` and the `request-received` view render
through `partials/header.eta`, which includes the analytics partial only when
`it.analytics` is present — so the shared header stays inert for `/login`, `/dashboard`
and admin, which never receive it.

**`/request-received` is a view, not a route.** There is no `GET /request-received`; it is
rendered under `POST /request`, so it inherits that route's middleware — including the
marketing CSP — automatically. No separate mount.

**`views/partials/analytics.eta`** (new) — emits nothing unless `gaId` is set:

```
<link rel="stylesheet" href="/css/consent.css">
<script type="module" src="/js/consent-banner.js"
        data-ga-id="..." data-consent="granted|denied|"></script>
```

**`public/js/ga.js`** (new) — `initGa(measurementId)`: creates `dataLayer`, appends the
googletagmanager script, fires `js` + `config`. Idempotent (guards double-init).

**`public/js/consent-banner.js`** (new) — the single decision point. Reads its own
`data-*` attributes:

- `granted` → `initGa()` immediately, no bar
- `""` (null) → render the bar, load nothing
- `denied` → do nothing at all

Accept/Reject write the cookie and hide the bar; Accept additionally calls `initGa()` on
the spot so the pageview that earned the consent is not lost. Clicks on any
`[data-consent-settings]` element reopen the bar. House style follows
`public/js/confirm-modal.js`: vanilla ES module, no deps, contract in a header comment.

**`public/css/consent.css`** (new) — hub-only. **Not** added to `instrument-core.css`,
which is the shared theme across all five surfaces; this banner is hub marketing only.

### CSP split

`middleware/securityHeaders.js` gains `MARKETING_CSP` — `DEFAULT_CSP` plus:

- `script-src` … `https://www.googletagmanager.com`
- `img-src` … `https://www.google-analytics.com`
- `connect-src` … `https://www.google-analytics.com https://analytics.google.com`

Applied **only** to the `/`, `/request` and `/privacy` routes, via the `marketing`
middleware pair above. `/dashboard`, `/admin`, `/company` and the API keep the strict
default — widening `script-src` globally to serve three public pages would be a real
regression. The global
`makeSecurityHeaders` mount at `server.js:41` still runs first; the route-level mount
overwrites the header via `res.setHeader`, which replaces rather than appends.

**Drift hazard:** `server.js:38` already rewrites `form-action` into `DEFAULT_CSP` to
add `config.allowedAppDomains` (CSP `form-action` is enforced against *redirect targets*,
which is why `/launch/:app` and `/auth/magic` need it). Both policies must receive that
same treatment. Mitigation: derive both from one base via a shared helper, so they
cannot drift apart. A test asserts `form-action` carries the app domains under **both**
policies.

CSP is a ceiling, not a trigger: marketing pages carry the wider policy regardless of
consent state. Varying CSP by cookie would be cache-hostile and confusing for no gain.

### Cookie

`ss_consent=granted|denied`; `Path=/`; `Max-Age` 180 days; `SameSite=Lax`; `Secure`.

Set client-side — JS must read and write it, so it is deliberately **not** httpOnly. It
is a preference record, not a security token; it carries no identifier and is not linked
to a user. Under PECR it is *strictly necessary* (it is the record of the choice itself)
and therefore exempt from consent — no chicken-and-egg.

180 days ⇒ the choice is re-asked roughly twice a year, which matches ICO guidance on
not treating consent as indefinite.

## Data flow

```
GET /  →  analyticsLocals middleware reads ss_consent via readConsent()
       →  res.locals.analytics = { gaId, consent }
       →  view renders state into data-consent attribute
       →  consent-banner.js branches:
             granted → initGa() → googletagmanager.com → pageview
             null    → render bar (no network to Google)
             denied  → nothing
Accept →  write cookie → hide bar → initGa() immediately
Reject →  write cookie → hide bar → (no network to Google, ever)
[data-consent-settings] click → reopen bar with current state
```

**The invariant:** Google is contacted in the `granted` branch and nowhere else.

## Copy changes

- **Trust badge:** "No tracking, no clutter" → **"No ads, no clutter"**
- **FAQ, *Where does my data go?*:** rewritten — work stays in Sprint Suite, never sold,
  never used for ads; health-check submissions anonymous; GA on public pages **only with
  consent**; changeable any time.
- **Landing footer, Legal column:** add **"Cookie settings"** (`data-consent-settings`),
  styled to match sibling links.
- **`/privacy` §4 (processors):** add Google (Analytics) alongside Resend, Anthropic, IONOS.
- **`/privacy` §6 (cookies):** rewritten — essential session cookie; the `ss_consent`
  preference cookie; optional `_ga` / `_ga_*` analytics cookies set **only** on consent;
  never used for advertising; withdraw button inline.
- **`/privacy` §7 (transfers):** "including Anthropic" → "including Anthropic and Google".

`/privacy` is v1.0 effective 2026-07-01. These are material changes to §§4, 6, 7, so
§11 (Changes) requires the version and date to move: **v1.1, effective 2026-07-17.**

## Testing

`node --test` + supertest, matching the existing 256-test hub suite.

**Unit — `tests/consent.test.js`:** `readConsent` over granted / denied / absent header /
malformed / unknown value / `ss_consent` alongside `hub_session` in one header. Explicit
assertion that garbage → `null`, never `"granted"`.

**Route — gating:** `GET /` with no cookie ⇒ body contains **no** `googletagmanager` and
does contain `consent-banner.js`; with `ss_consent=granted` ⇒ `data-consent="granted"`;
with `ss_consent=denied` ⇒ `data-consent="denied"`. Same for `/request`.

**Route — all four `request.js` render sites** carry the banner: `GET /request`,
the 400-invalid re-render, the honeypot branch, and `POST /request` success. This is the
regression guard for the `res.locals` decision above.

**Route — no leak:** `/login`, `/dashboard` and `/admin` contain neither
`consent-banner.js` nor `googletagmanager` under any cookie state. This is the guard
against the `app.use("/")` prefix-match trap.

**Route — kill switch:** `gaMeasurementId` null ⇒ no banner, no stylesheet, no script.

**CSP — regression guard:** `/` allows `googletagmanager.com` in `script-src`;
**`/dashboard` and `/admin` do not**; `form-action` carries `allowedAppDomains` under
both policies.

**Copy guards:** landing contains `"No ads, no clutter"` and **not**
`"No tracking, no clutter"`; landing FAQ no longer contains `"no third-party tracking"`;
`/privacy` no longer contains `"there are no third-party tracking cookies"` and does
mention Google and `_ga`.

## Error handling

| Condition | Behaviour |
|---|---|
| `GA_MEASUREMENT_ID` unset | Analytics fully off. No banner (nothing to consent to). Dev/test default. |
| Malformed / tampered cookie | Treated as `null` → re-ask. Never fails open. |
| Banner mount element missing | `consent-banner.js` returns early; no throw. |
| googletagmanager.com blocked/offline | GA absent; page unaffected (async, no dependency). |
| JS disabled | No banner, no GA. Correct: nothing to consent to. |

## Files

**New (7):** `lib/consent.js` · `middleware/analytics.js` (`analyticsLocals`) ·
`views/partials/analytics.eta` · `public/js/consent-banner.js` · `public/js/ga.js` ·
`public/css/consent.css` · `tests/consent.test.js`

**Modified (12):** `config.js` · `middleware/securityHeaders.js` · `server.js` ·
`tests/helpers.js` · `routes/landing.js` · `routes/request.js` · `routes/legal.js` ·
`views/landing.eta` · `views/partials/header.eta` · `views/request.eta` ·
`views/request-received.eta` · `views/privacy.eta`

Plus assertions added to the existing landing, legal and security-headers test files.
Note `tests/helpers.js` mirrors `server.js` and must be updated in step with it.

## Out of scope (YAGNI)

- **Third-party CMP** — solves multi-vendor ad-tech, geo-variation, cookie scanning. None apply.
- **Granular per-purpose toggles** — there is exactly one purpose.
- **DB consent audit log** — not required at this scale. Revisit at solicitor review.
- **GA on signed-in pages** — widens disclosure, sits badly against positioning.
- **Shared-footer redesign** — `partials/footer.eta` is bare and arguably should carry
  legal links, but that is its own change.
- **Consent Mode v2** — see rationale above.

## Deployment notes

- `GA_MEASUREMENT_ID=G-6FJLV7EE1X` must be added to the hub `EnvironmentFile` **before**
  restart, or analytics stay silently off (by design).
- Hub runs on **port 3004**; deploy tree is davidj-owned ⇒ pull as `davidj`, not
  `sudo -u suite-hub`.
- `landing.css` has no cache-busting; `consent.css` is a new file so is unaffected, but
  the landing copy changes may need a hard refresh to verify.
- This lands on top of the **undeployed** `/privacy` note (@279cce8). That deploy is
  still parked; this work supersedes its §§4/6/7 and bumps it to v1.1, so **ship both
  together** rather than deploying the v1.0 note first.

## Open questions

None blocking. Deferred to the outstanding solicitor pass: whether a DB-backed consent
record is wanted for demonstrability under UK GDPR Art. 7(1), and confirmation that the
"no ads" reframe reads as intended.
