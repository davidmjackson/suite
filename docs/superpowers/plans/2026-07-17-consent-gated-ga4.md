# Consent-gated GA4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GA4 to the hub's public pages (`/`, `/request`, `/privacy`) behind a self-built, UK-PECR-compliant consent bar, gated so Google is contacted only after an explicit Accept.

**Architecture:** A pure `readConsent()` reads an `ss_consent` cookie; an `analyticsLocals` middleware puts `{ gaId, consent }` on `res.locals` for the three public routes only; an Eta partial renders one `<script>` tag carrying that state in `data-*` attributes; a first-party ES module reads the attributes and either loads GA, shows the bar, or does nothing. No inline script anywhere — the hub's `script-src 'self'` stays intact.

**Tech Stack:** Node 20+, Express 5, Eta 3, better-sqlite3, `node --test` + supertest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-17-consent-gated-ga4-design.md`

## Global Constraints

- **Repo:** `/var/www/suite/hub`. No other repo is touched.
- **No new dependencies.** Reuse `parseCookies` from `lib/cookies.js`.
- **Never add `'unsafe-inline'` to `script-src`,** and never add an inline `<script>` block. The hub's strict CSP depends on the 0-inline-script invariant (2026-06-10 security-headers spec). Config reaches JS via `data-*` attributes only.
- **`readConsent` must never fail open.** Anything that is not exactly `"granted"` or `"denied"` is `null` (= ask again).
- **`DEFAULT_CSP` must not change.** `tests/security-headers.test.js` asserts it stays strict. The new policy is a separate `MARKETING_CSP`.
- **Never mount the marketing middleware with `app.use("/")`** — Express prefix-matches it against every path, leaking analytics onto `/dashboard` and `/admin`. Apply it at the route.
- **`tests/helpers.js` mirrors `server.js`.** Any middleware wiring added to one must be added to the other, or tests stop being representative.
- **The word "free" must not appear in landing copy.** `tests/landing.test.js` asserts `doesNotMatch(/free/i)` (the deliberate post-@71d1d7d gated-model positioning).
- **Exact measurement id:** `G-6FJLV7EE1X`, supplied via `GA_MEASUREMENT_ID`. Never hardcoded in source.
- **Cookie:** name `ss_consent`, values `granted` / `denied`, `Path=/`, `Max-Age=15552000` (180 days), `SameSite=Lax`, `Secure` on https.
- **Reject and Accept must have equal visual prominence.** Same size, padding and weight. This is the ICO's main enforcement theme.
- **Run the full suite before every commit:** `cd /var/www/suite/hub && npm test`. Baseline is **256 passing**.

---

### Task 1: `lib/consent.js` — read the consent cookie

**Files:**
- Create: `hub/lib/consent.js`
- Test: `hub/tests/consent.test.js`

**Interfaces:**
- Consumes: `parseCookies(header)` from `hub/lib/cookies.js` — returns a plain `{name: value}` object, values already `.trim()`-ed.
- Produces: `CONSENT_COOKIE: string`, `CONSENT_GRANTED: "granted"`, `CONSENT_DENIED: "denied"`, `CONSENT_MAX_AGE_SEC: number`, `readConsent(cookieHeader: string|undefined) -> "granted"|"denied"|null`

- [ ] **Step 1: Write the failing test**

Create `hub/tests/consent.test.js`:

```js
// tests/consent.test.js
// The consent reader is the single source of truth for "has this visitor agreed
// to analytics?". Its one hard rule: it must never fail open to "granted".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readConsent, CONSENT_COOKIE, CONSENT_MAX_AGE_SEC } from "../lib/consent.js";

test("cookie name and lifetime are the agreed values", () => {
  assert.equal(CONSENT_COOKIE, "ss_consent");
  assert.equal(CONSENT_MAX_AGE_SEC, 180 * 24 * 60 * 60, "180 days — re-ask ~twice a year");
});

test("reads an exact granted cookie", () => {
  assert.equal(readConsent("ss_consent=granted"), "granted");
});

test("reads an exact denied cookie", () => {
  assert.equal(readConsent("ss_consent=denied"), "denied");
});

test("returns null when there is no cookie header at all", () => {
  assert.equal(readConsent(undefined), null);
  assert.equal(readConsent(""), null);
});

test("returns null when ss_consent is absent among other cookies", () => {
  assert.equal(readConsent("hub_session=abc123"), null);
});

test("finds ss_consent alongside the session cookie, in either order", () => {
  assert.equal(readConsent("hub_session=abc123; ss_consent=granted"), "granted");
  assert.equal(readConsent("ss_consent=denied; hub_session=abc123"), "denied");
});

test("never fails open on unknown, empty or tampered values", () => {
  for (const v of ["", "GRANTED", "Granted", "true", "1", "yes", "grantedx", "{}", "null", "denied2"]) {
    assert.equal(
      readConsent(`ss_consent=${v}`),
      null,
      `must not accept ${JSON.stringify(v)} as a decision`
    );
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/consent.test.js`
Expected: FAIL — `Cannot find module '../lib/consent.js'`

- [ ] **Step 3: Write minimal implementation**

Create `hub/lib/consent.js`:

```js
// lib/consent.js
// Reads the visitor's analytics-consent choice from the request cookies.
//
// ss_consent is a preference record, not a tracker: it carries no identifier and
// is not linked to a user. Under PECR it is "strictly necessary" (it IS the record
// of the choice), so it needs no consent of its own — no chicken-and-egg.
//
// The one hard rule: anything that is not exactly "granted" or "denied" — absent,
// empty, tampered, or an unknown value — reads as null, meaning "ask again".
// This must never fail open to "granted".
import { parseCookies } from "./cookies.js";

export const CONSENT_COOKIE = "ss_consent";
export const CONSENT_GRANTED = "granted";
export const CONSENT_DENIED = "denied";

// 180 days. Consent is not indefinite; this re-asks roughly twice a year.
// Kept in sync with MAX_AGE in public/js/consent-banner.js.
export const CONSENT_MAX_AGE_SEC = 180 * 24 * 60 * 60;

export function readConsent(cookieHeader) {
  const v = parseCookies(cookieHeader)[CONSENT_COOKIE];
  if (v === CONSENT_GRANTED) return CONSENT_GRANTED;
  if (v === CONSENT_DENIED) return CONSENT_DENIED;
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /var/www/suite/hub && node --test tests/consent.test.js`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite/hub
git add lib/consent.js tests/consent.test.js
git commit -m "feat(hub): add consent cookie reader

Pure reader for the ss_consent preference cookie. Never fails open:
anything that is not exactly granted/denied reads as null (ask again)."
```

---

### Task 2: `middleware/analytics.js` — put consent state on `res.locals`

**Files:**
- Create: `hub/middleware/analytics.js`
- Test: `hub/tests/analytics-middleware.test.js`

**Interfaces:**
- Consumes: `readConsent(cookieHeader)` from Task 1. `config.gaMeasurementId` (added in Task 5; treat as possibly absent here).
- Produces: `analyticsLocals(config) -> (req, res, next) => void`, setting `res.locals.analytics = { gaId: string|null, consent: "granted"|"denied"|null }`

- [ ] **Step 1: Write the failing test**

Create `hub/tests/analytics-middleware.test.js`:

```js
// tests/analytics-middleware.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyticsLocals } from "../middleware/analytics.js";

// Minimal req/res doubles — the middleware touches only headers and res.locals.
const fakeReq = (cookie) => ({ headers: cookie ? { cookie } : {} });
const fakeRes = () => ({ locals: {} });

function run(config, cookie) {
  const req = fakeReq(cookie);
  const res = fakeRes();
  let nexted = false;
  analyticsLocals(config)(req, res, () => { nexted = true; });
  return { res, nexted };
}

test("exposes the measurement id and the visitor's decision", () => {
  const { res, nexted } = run({ gaMeasurementId: "G-TEST123" }, "ss_consent=granted");
  assert.deepEqual(res.locals.analytics, { gaId: "G-TEST123", consent: "granted" });
  assert.equal(nexted, true);
});

test("reports a null decision when no choice has been made", () => {
  const { res } = run({ gaMeasurementId: "G-TEST123" }, undefined);
  assert.deepEqual(res.locals.analytics, { gaId: "G-TEST123", consent: null });
});

test("carries denied through untouched", () => {
  const { res } = run({ gaMeasurementId: "G-TEST123" }, "ss_consent=denied");
  assert.equal(res.locals.analytics.consent, "denied");
});

test("gaId is null when GA_MEASUREMENT_ID is unconfigured — the kill switch", () => {
  for (const config of [{}, { gaMeasurementId: null }, { gaMeasurementId: "" }, null]) {
    const { res, nexted } = run(config, "ss_consent=granted");
    assert.equal(res.locals.analytics.gaId, null, "no id configured means no analytics");
    assert.equal(nexted, true);
  }
});

test("always calls next, even with a tampered cookie", () => {
  const { res, nexted } = run({ gaMeasurementId: "G-TEST123" }, "ss_consent=../../etc/passwd");
  assert.equal(res.locals.analytics.consent, null);
  assert.equal(nexted, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/analytics-middleware.test.js`
Expected: FAIL — `Cannot find module '../middleware/analytics.js'`

- [ ] **Step 3: Write minimal implementation**

Create `hub/middleware/analytics.js`:

```js
// middleware/analytics.js
// Exposes the visitor's analytics-consent state to the view layer, for the public
// pages only (/, /request, /privacy — see server.js).
//
// Applied PER ROUTE, never via app.use("/"): Express prefix-matches "/" against
// every path, which would mount analytics on /dashboard and /admin — the precise
// leak this design exists to prevent.
//
// Why res.locals and not a render argument: routes/request.js renders from four
// call sites (GET, 400-invalid, honeypot, POST success). Express merges res.locals
// into render options, so every site — including any added later — picks this up
// without being threaded through by hand.
import { readConsent } from "../lib/consent.js";

export function analyticsLocals(config) {
  // Resolved once at mount: unset GA_MEASUREMENT_ID is the kill switch, and it
  // means the analytics partial renders nothing at all.
  const gaId = (config && config.gaMeasurementId) || null;

  return function analytics(req, res, next) {
    res.locals.analytics = { gaId, consent: readConsent(req.headers.cookie) };
    next();
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /var/www/suite/hub && node --test tests/analytics-middleware.test.js`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite/hub
git add middleware/analytics.js tests/analytics-middleware.test.js
git commit -m "feat(hub): add analyticsLocals middleware

Puts { gaId, consent } on res.locals for the public pages. Unset
GA_MEASUREMENT_ID is the kill switch (gaId null => nothing renders)."
```

---

### Task 3: `MARKETING_CSP` — let Google load on the public pages only

**Files:**
- Modify: `hub/middleware/securityHeaders.js`
- Test: `hub/tests/security-headers.test.js` (append)

**Interfaces:**
- Consumes: existing `DEFAULT_CSP`, `makeSecurityHeaders({ contentSecurityPolicy })`.
- Produces: `MARKETING_CSP: string`, `withAppDomains(csp: string, appDomains: string[]) -> string`

- [ ] **Step 1: Write the failing test**

Append to `hub/tests/security-headers.test.js`:

```js
// --- Marketing CSP (consent-gated GA4) -------------------------------------
import { MARKETING_CSP, withAppDomains } from "../middleware/securityHeaders.js";

test("MARKETING_CSP allows exactly the Google origins GA4 needs", () => {
  assert.match(MARKETING_CSP, /script-src 'self' https:\/\/www\.googletagmanager\.com/);
  assert.match(MARKETING_CSP, /img-src 'self' data: https:\/\/www\.google-analytics\.com/);
  assert.match(MARKETING_CSP, /connect-src 'self' https:\/\/www\.google-analytics\.com https:\/\/analytics\.google\.com/);
});

test("MARKETING_CSP keeps every other protection from the default", () => {
  assert.match(MARKETING_CSP, /frame-ancestors 'none'/);
  assert.match(MARKETING_CSP, /object-src 'none'/);
  assert.match(MARKETING_CSP, /base-uri 'self'/);
  // The invariant the whole design protects: no inline script, ever.
  assert.doesNotMatch(MARKETING_CSP, /script-src[^;]*unsafe-inline/);
});

test("DEFAULT_CSP is untouched — Google is not allowed on app pages", () => {
  assert.doesNotMatch(DEFAULT_CSP, /googletagmanager/);
  assert.doesNotMatch(DEFAULT_CSP, /google-analytics/);
});

test("withAppDomains adds the app origins to form-action in both policies", () => {
  const domains = ["https://sprintraid.uk", "https://sprintpoker.uk"];
  for (const [name, csp] of [["default", DEFAULT_CSP], ["marketing", MARKETING_CSP]]) {
    const out = withAppDomains(csp, domains);
    assert.match(
      out,
      /form-action 'self' https:\/\/sprintraid\.uk https:\/\/sprintpoker\.uk/,
      `${name} policy must carry the app domains — CSP form-action is enforced on redirect targets`
    );
  }
});

test("withAppDomains changes form-action only", () => {
  const out = withAppDomains(DEFAULT_CSP, ["https://x.uk"]);
  assert.equal(out.replace(" https://x.uk", ""), DEFAULT_CSP);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/security-headers.test.js`
Expected: FAIL — `MARKETING_CSP` / `withAppDomains` are not exported (`SyntaxError` or `undefined`)

- [ ] **Step 3: Write minimal implementation**

In `hub/middleware/securityHeaders.js`, after the `DEFAULT_CSP` block and before `makeSecurityHeaders`, add:

```js
// The public marketing pages (/, /request, /privacy) may load Google Analytics —
// but only once the visitor has explicitly accepted (lib/consent.js). CSP is a
// ceiling, not a trigger: this policy is constant on those routes, while whether
// the tag renders at all is decided by consent. Deliberately NOT applied to
// /dashboard, /admin, /company or the API, which keep DEFAULT_CSP.
export const MARKETING_CSP = DEFAULT_CSP
  .replace("script-src 'self'", "script-src 'self' https://www.googletagmanager.com")
  .replace("img-src 'self' data:", "img-src 'self' data: https://www.google-analytics.com")
  .replace(
    "connect-src 'self'",
    "connect-src 'self' https://www.google-analytics.com https://analytics.google.com"
  );

// CSP form-action is enforced against redirect TARGETS, not just the initial
// action: POST /launch/:app and POST /auth/magic 302 cross-origin into the apps,
// so both policies must carry the app origins or those posts break. Deriving both
// through this one helper is what stops them drifting apart.
export function withAppDomains(csp, appDomains) {
  return csp.replace("form-action 'self'", `form-action 'self' ${appDomains.join(" ")}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /var/www/suite/hub && node --test tests/security-headers.test.js`
Expected: PASS — all existing tests plus 5 new

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite/hub
git add middleware/securityHeaders.js tests/security-headers.test.js
git commit -m "feat(hub): add MARKETING_CSP + withAppDomains helper

MARKETING_CSP allows googletagmanager/google-analytics for the public
pages only; DEFAULT_CSP is unchanged so app pages stay strict. Both
policies get form-action app domains via one helper so they cannot drift."
```

---

### Task 4: client assets — GA loader, consent bar, styles

**Files:**
- Create: `hub/public/js/ga.js`
- Create: `hub/public/js/consent-banner.js`
- Create: `hub/public/css/consent.css`
- Test: `hub/tests/consent-banner.test.js`

**Interfaces:**
- Consumes: nothing server-side. `consent-banner.js` imports `initGa` from `./ga.js`.
- Produces: `initGa(measurementId: string) -> void` (idempotent). `consent-banner.js` is a side-effecting entry point — it self-starts on load and exports nothing.
- Contract with Task 5: `consent-banner.js` locates its own config via `document.querySelector("script[data-ga-id]")` and reads `data-ga-id` and `data-consent`. Task 5's partial must emit exactly those attribute names.

**Note on testing:** this repo has no jsdom. The house pattern (`tests/confirm-modal.test.js`) is to assert the asset serves 200 and to assert on the module source read from disk. Follow it — do not add a DOM library.

- [ ] **Step 1: Write the failing test**

Create `hub/tests/consent-banner.test.js`:

```js
// tests/consent-banner.test.js
// No jsdom in this repo (see tests/confirm-modal.test.js): assert the assets serve
// and that the source upholds the invariants the design depends on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { buildTestApp } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = join(__dirname, "..", "public");
const bannerSrc = readFileSync(join(pub, "js", "consent-banner.js"), "utf8");
const gaSrc = readFileSync(join(pub, "js", "ga.js"), "utf8");

for (const asset of ["/js/consent-banner.js", "/js/ga.js", "/css/consent.css"]) {
  test(`GET ${asset} serves 200`, async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get(asset);
    assert.equal(res.status, 200);
  });
}

test("ga.js is the only place that reaches googletagmanager", () => {
  assert.match(gaSrc, /googletagmanager\.com\/gtag\/js/);
  assert.doesNotMatch(bannerSrc, /googletagmanager/, "the banner must go through initGa()");
});

test("the banner loads GA only in the granted branch", () => {
  // Exactly one initGa call site per branch: page-load-granted and accept.
  const calls = bannerSrc.match(/initGa\(/g) || [];
  assert.equal(calls.length, 2, "initGa is called on granted-at-load and on accept, nowhere else");
  assert.match(bannerSrc, /consent === "granted"/, "granted is matched exactly");
});

test("the banner writes the agreed cookie attributes", () => {
  assert.match(bannerSrc, /ss_consent/);
  assert.match(bannerSrc, /Path=\//);
  assert.match(bannerSrc, /SameSite=Lax/);
  assert.match(bannerSrc, /Secure/);
  assert.match(bannerSrc, /180 \* 24 \* 60 \* 60/, "180 days, in sync with lib/consent.js");
});

test("the banner offers a withdrawal hook and reads its config from data attributes", () => {
  assert.match(bannerSrc, /\[data-consent-settings\]/);
  assert.match(bannerSrc, /data-ga-id/);
  assert.match(bannerSrc, /data-consent/);
});

test("Esc does not dismiss the bar — dismissal is not a decision", () => {
  assert.doesNotMatch(bannerSrc, /Escape/);
});

test("consent.css gives Reject and Accept equal prominence", () => {
  const css = readFileSync(join(pub, "css", "consent.css"), "utf8");
  assert.match(css, /\.consent-acts \.btn\{[^}]*min-width/, "both buttons share a min-width");
  assert.doesNotMatch(css, /\.consent-no\{[^}]*(font-size|opacity|display:none)/, "reject is not diminished");
});

test("the banner styles are hub-only, not in the synced foundation", () => {
  const core = readFileSync(join(pub, "css", "instrument-core.css"), "utf8");
  assert.doesNotMatch(core, /\.consent/, "instrument-core.css is synced across all five surfaces");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/consent-banner.test.js`
Expected: FAIL — `ENOENT: no such file or directory ... public/js/consent-banner.js`

- [ ] **Step 3a: Write `public/js/ga.js`**

```js
// public/js/ga.js
// Loads Google Analytics 4.
//
// Called ONLY from consent-banner.js, and only in the granted branch — a visitor
// who has not accepted never reaches this module, so their browser never contacts
// Google at all. That is the whole point of the design; do not import this from
// anywhere else.
//
// This is Google's gtag snippet rewritten as a first-party module rather than
// pasted inline. The hub's CSP is `script-src 'self'` with no 'unsafe-inline'
// (middleware/securityHeaders.js), so an inline block would be blocked outright.
// The fix for that is never to add 'unsafe-inline' — it is this file.

let started = false;

export function initGa(measurementId) {
  if (started || !measurementId) return;
  started = true;

  const s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(measurementId);
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  // Must be a real `arguments`-using function, not an arrow: gtag relies on the
  // arguments object being pushed, not an array.
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag("js", new Date());
  gtag("config", measurementId);
}
```

- [ ] **Step 3b: Write `public/js/consent-banner.js`**

```js
// public/js/consent-banner.js
// The analytics consent bar. One bar, one purpose (analytics), no vendor SDK.
//
// Contract — the server renders exactly one tag carrying the state:
//   <script type="module" src="/js/consent-banner.js"
//           data-ga-id="G-XXXX" data-consent="granted|denied|"></script>
// data-consent is the ss_consent cookie as read server-side (lib/consent.js);
// empty means no choice has been made yet.
//
// Branches:
//   "granted" -> initGa() immediately, no bar
//   ""        -> show the bar, contact nobody
//   "denied"  -> do nothing at all
//
// Accept and Reject write the cookie and hide the bar. Accept also calls initGa()
// on the spot, so the pageview that earned the consent is not lost.
//
// Any [data-consent-settings] element reopens the bar: PECR requires withdrawing
// to be as easy as granting.
//
// Deliberately NOT a focus-trapping modal like confirm-modal.js: this bar must not
// block the page, and Esc must not dismiss it — dismissal is not a decision.
import { initGa } from "./ga.js";

const COOKIE = "ss_consent";
const MAX_AGE = 180 * 24 * 60 * 60; // keep in sync with CONSENT_MAX_AGE_SEC in lib/consent.js

let bar = null;
let gaId = null;

function writeConsent(value) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = COOKIE + "=" + value + "; Path=/; Max-Age=" + MAX_AGE + "; SameSite=Lax" + secure;
}

function choose(value) {
  writeConsent(value);
  if (bar) bar.hidden = true;
  if (value === "granted") initGa(gaId);
}

function build() {
  const el = document.createElement("section");
  el.className = "consent";
  el.hidden = true;
  el.setAttribute("role", "region");
  el.setAttribute("aria-label", "Analytics consent");
  el.innerHTML =
    '<div class="consent-in">' +
      '<div class="consent-copy">' +
        '<p class="consent-eyebrow">Analytics</p>' +
        '<p class="consent-msg">We would like to count visits to our public pages, so we can see ' +
        'which ones people find useful. Nothing runs unless you accept, we never use it for ads, ' +
        'and you can change your mind at any time. ' +
        '<a class="consent-lnk" href="/privacy">Privacy note</a></p>' +
      '</div>' +
      '<div class="consent-acts">' +
        '<button type="button" class="btn btn-ghost consent-no">Reject</button>' +
        '<button type="button" class="btn btn-pri consent-yes">Accept</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(el);
  el.querySelector(".consent-no").addEventListener("click", function () { choose("denied"); });
  el.querySelector(".consent-yes").addEventListener("click", function () { choose("granted"); });
  return el;
}

function open() {
  if (!bar) bar = build();
  bar.hidden = false;
}

function start() {
  const tag = document.querySelector("script[data-ga-id]");
  if (!tag) return; // analytics not wired on this page — nothing to consent to
  gaId = tag.getAttribute("data-ga-id") || null;
  if (!gaId) return;

  const consent = tag.getAttribute("data-consent") || "";
  if (consent === "granted") initGa(gaId);
  else if (consent !== "denied") open();

  // Withdraw / re-consent, from the landing footer and the /privacy note.
  document.addEventListener("click", function (e) {
    const t = e.target.closest ? e.target.closest("[data-consent-settings]") : null;
    if (!t) return;
    e.preventDefault();
    open();
  });
}

// type="module" is deferred, so the DOM is parsed by the time this runs. The
// readyState guard is belt-and-braces for a non-deferred load.
if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
```

- [ ] **Step 3c: Write `public/css/consent.css`**

```css
/* public/css/consent.css — analytics consent bar (hub public pages only).
   Deliberately NOT in instrument-core.css: that is a synced foundation asset
   shared by all five surfaces and guarded by tests/theme-drift.test.js. This bar
   is hub-only. Tokens (--panel, --line2, --ink, --soft, --teal) come from it. */

.consent{position:fixed;left:0;right:0;bottom:0;z-index:40;background:var(--panel);
  border-top:1px solid var(--line2);box-shadow:0 -6px 24px oklch(0.235 0.013 250 / 0.08)}
.consent[hidden]{display:none}
.consent-in{max-width:1120px;margin:0 auto;padding:16px 40px;display:flex;
  align-items:center;justify-content:space-between;gap:28px;flex-wrap:wrap}
.consent-eyebrow{font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;
  letter-spacing:0.16em;text-transform:uppercase;color:var(--teal);margin-bottom:4px}
.consent-msg{color:var(--soft);font-size:13.5px;max-width:72ch}
.consent-lnk{color:var(--green);text-decoration:underline}
.consent-acts{display:flex;gap:10px;flex:0 0 auto}

/* Equal prominence. The ICO's main enforcement theme is a prominent Accept beside
   a diminished Reject — these two share size, padding and weight by construction.
   Do not restyle one without the other. */
.consent-acts .btn{min-width:104px;justify-content:center}

@media (max-width:720px){
  .consent-in{padding:14px 18px;gap:14px}
  .consent-acts{width:100%}
  .consent-acts .btn{flex:1}
}

/* Landing footer "Cookie settings" — a <button> because it performs an action
   rather than navigating, styled to sit with its sibling links in .lp-foot-col. */
.lp-foot-btn{display:block;color:var(--soft);font-size:14px;text-decoration:none;
  padding:4px 0;background:none;border:0;cursor:pointer;text-align:left;
  font-family:'Hanken Grotesk',sans-serif}
.lp-foot-btn:hover{color:var(--green)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /var/www/suite/hub && node --test tests/consent-banner.test.js`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite/hub
git add public/js/ga.js public/js/consent-banner.js public/css/consent.css tests/consent-banner.test.js
git commit -m "feat(hub): add consent bar + GA loader client assets

ga.js is the only module that reaches googletagmanager, and only the
granted branch calls it. No inline script: config arrives via data-*
attributes, so script-src 'self' is preserved. Reject/Accept are equal
prominence by construction."
```

---

### Task 5: wire it up — config, partial, routes, server, helpers

**Files:**
- Create: `hub/views/partials/analytics.eta`
- Modify: `hub/config.js`
- Modify: `hub/server.js`
- Modify: `hub/tests/helpers.js`
- Modify: `hub/routes/landing.js`
- Modify: `hub/routes/request.js`
- Modify: `hub/routes/legal.js`
- Modify: `hub/views/landing.eta` (head only)
- Modify: `hub/views/partials/header.eta`
- Modify: `hub/views/request.eta`, `hub/views/request-received.eta`, `hub/views/privacy.eta` (include lines only)
- Test: `hub/tests/analytics-wiring.test.js`

**Interfaces:**
- Consumes: `analyticsLocals(config)` (Task 2); `MARKETING_CSP`, `withAppDomains` (Task 3); the `data-ga-id` / `data-consent` contract (Task 4).
- Produces: `config.gaMeasurementId: string|null`. `mountLanding(app, { marketing })`, `mountRequest(app, { emailSender, marketing })`, `mountLegal(app, { marketing })` — `marketing` defaults to `[]` in all three so existing callers keep working. `buildTestApp()` additionally returns `marketing`.

- [ ] **Step 1: Write the failing test**

Create `hub/tests/analytics-wiring.test.js`:

```js
// tests/analytics-wiring.test.js
// The gate: Google must be reachable from the page only when consent is granted,
// and only on the public pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";

const GA = { GA_MEASUREMENT_ID: "G-TEST123" };
const OFF = { GA_MEASUREMENT_ID: "" };

async function withRoutes(env) {
  const { app, db, config, marketing } = await buildTestApp({ env });
  const { mountRequest } = await import("../routes/request.js?t=" + Date.now());
  const { mountLegal } = await import("../routes/legal.js?t=" + Date.now());
  const { mountDashboard } = await import("../routes/dashboard.js?t=" + Date.now());
  mountRequest(app, { marketing });
  mountLegal(app, { marketing });
  mountDashboard(app);
  return { app, db, config };
}

test("no choice yet: the bar is wired but Google is never referenced", async () => {
  const { app } = await withRoutes(GA);
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.text, /googletagmanager/, "no Google reference before consent");
  assert.match(res.text, /src="\/js\/consent-banner\.js"/);
  assert.match(res.text, /data-ga-id="G-TEST123"/);
  assert.match(res.text, /data-consent=""/, "empty means: ask");
});

test("granted: state reaches the client so the banner can load GA", async () => {
  const { app } = await withRoutes(GA);
  const res = await request(app).get("/").set("Cookie", "ss_consent=granted");
  assert.match(res.text, /data-consent="granted"/);
});

test("denied: state reaches the client and stays denied", async () => {
  const { app } = await withRoutes(GA);
  const res = await request(app).get("/").set("Cookie", "ss_consent=denied");
  assert.match(res.text, /data-consent="denied"/);
  assert.doesNotMatch(res.text, /googletagmanager/);
});

test("a tampered cookie re-asks rather than failing open", async () => {
  const { app } = await withRoutes(GA);
  const res = await request(app).get("/").set("Cookie", "ss_consent=GRANTED");
  assert.match(res.text, /data-consent=""/);
});

test("kill switch: no GA_MEASUREMENT_ID means no banner, no stylesheet, no script", async () => {
  const { app } = await withRoutes(OFF);
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.text, /consent-banner\.js/);
  assert.doesNotMatch(res.text, /consent\.css/);
  assert.doesNotMatch(res.text, /googletagmanager/);
});

test("every public page carries the bar", async () => {
  const { app } = await withRoutes(GA);
  for (const p of ["/", "/request", "/privacy"]) {
    const res = await request(app).get(p);
    assert.equal(res.status, 200, `${p} renders`);
    assert.match(res.text, /consent-banner\.js/, `${p} wires the consent bar`);
  }
});

test("the 400-invalid re-render keeps the bar (the res.locals regression guard)", async () => {
  const { app } = await withRoutes(GA);
  const res = await request(app).post("/request").type("form").send({ company_name: "", email: "nope" });
  assert.equal(res.status, 400);
  assert.match(res.text, /consent-banner\.js/, "validation-error page is a live public page too");
});

test("POST /request success renders request-received with the bar", async () => {
  const { app } = await withRoutes(GA);
  const res = await request(app).post("/request").type("form").send({
    company_name: "Acme", contact_name: "A Person", email: "a@example.com",
  });
  assert.equal(res.status, 200);
  assert.match(res.text, /consent-banner\.js/);
});

test("analytics never leak past the login door", async () => {
  const { app, db } = await withRoutes(GA);
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u9", "z@z.z", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u9", now(), now(), now() + 60_000);

  const res = await request(app).get("/dashboard").set("Cookie", `hub_session=${sid}; ss_consent=granted`);
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.text, /consent-banner\.js/, "no bar on signed-in pages");
  assert.doesNotMatch(res.text, /googletagmanager/, "Google never sees signed-in usage");
});

test("/license and /terms stay inert — no analytics, so no bar", async () => {
  const { app } = await withRoutes(GA);
  for (const p of ["/license", "/terms"]) {
    const res = await request(app).get(p);
    assert.doesNotMatch(res.text, /consent-banner\.js/, `${p} carries no analytics`);
  }
});

test("CSP: public pages allow Google, app pages do not", async () => {
  const { app, db } = await withRoutes(GA);
  for (const p of ["/", "/request", "/privacy"]) {
    const res = await request(app).get(p);
    assert.match(res.headers["content-security-policy"], /googletagmanager/, `${p} allows GA`);
  }
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u8", "y@y.y", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u8", now(), now(), now() + 60_000);
  const dash = await request(app).get("/dashboard").set("Cookie", `hub_session=${sid}`);
  assert.doesNotMatch(dash.headers["content-security-policy"], /googletagmanager/, "app pages stay strict");
});

test("CSP: form-action app domains survive on the marketing policy", async () => {
  const { app } = await withRoutes(GA);
  const res = await request(app).get("/");
  assert.match(res.headers["content-security-policy"], /form-action 'self' https:\/\/sprintraid\.uk/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/www/suite/hub && node --test tests/analytics-wiring.test.js`
Expected: FAIL — `buildTestApp` does not return `marketing`; no `data-ga-id` in output

- [ ] **Step 3a: Add the config key**

In `hub/config.js`, add after the `adminEmail` block:

```js
  // Optional: GA4 measurement id for the public pages. Unset ⇒ analytics are off
  // entirely (no tag, no consent bar), which is the default for dev and tests so
  // they never pollute the property. Prod sets GA_MEASUREMENT_ID=G-6FJLV7EE1X.
  gaMeasurementId: process.env.GA_MEASUREMENT_ID || null,
```

- [ ] **Step 3b: Create `hub/views/partials/analytics.eta`**

```
<!-- views/partials/analytics.eta — renders nothing unless GA_MEASUREMENT_ID is set.
     No inline <script>: config travels via data-* attributes (CSP script-src 'self'). -->
<% if (it.analytics && it.analytics.gaId) { %>
<link rel="stylesheet" href="/css/consent.css">
<script type="module" src="/js/consent-banner.js" data-ga-id="<%= it.analytics.gaId %>" data-consent="<%= it.analytics.consent || '' %>"></script>
<% } %>
```

- [ ] **Step 3c: Include the partial from both head paths**

In `hub/views/landing.eta`, immediately before `</head>`:

```
<%~ include("partials/analytics", { analytics: it.analytics }) %>
```

In `hub/views/partials/header.eta`, immediately before `</head>`:

```
<%~ include("partials/analytics", { analytics: it.analytics }) %>
```

Then have each public view pass `analytics` into the header — Eta partials receive only what is passed, which is exactly why `/login`, `/dashboard` and admin stay inert without any conditional.

`hub/views/request.eta`, line 1 — add `analytics: it.analytics`:

```
<%~ include("partials/header", { title: "Register your interest", user: null, analytics: it.analytics, band: { eyebrow: "Get started", title: "Register your interest", sub: "Tell us about your team and we'll set you up with access." } }) %>
```

`hub/views/request-received.eta`, line 1 — add `analytics: it.analytics`:

```
<%~ include("partials/header", { title: "Request received", user: null, analytics: it.analytics, band: { eyebrow: "Get started", title: "Request received", sub: "Thanks — we've got your request." } }) %>
```

`hub/views/privacy.eta`, line 1 — add `analytics: it.analytics` and change **nothing else**. The version stays at 1.0 here so this task lands green; Task 7 owns the bump.

```
<%~ include("partials/header", { title: "Data & Privacy Note — Sprint Suite", analytics: it.analytics, band: { eyebrow: "Legal", title: "Data & Privacy Note", sub: "Version 1.0 · Effective 1 July 2026" } }) %>
```

- [ ] **Step 3d: Accept `marketing` in the three mounts**

`hub/routes/landing.js` — change the signature and apply to the route:

```js
export function mountLanding(app, { marketing = [] } = {}) {
  app.get("/", marketing, (req, res) => {
```

`hub/routes/request.js` — change the signature and apply to both routes:

```js
export function mountRequest(app, { emailSender, marketing = [] } = {}) {
```

```js
  app.get("/request", marketing, (req, res) => {
```

```js
  app.post("/request", marketing, honeypotAndLimit, validate(requestSchema, { onInvalid: requestInvalid }), async (req, res) => {
```

`hub/routes/legal.js` — apply to `/privacy` only:

```js
export function mountLegal(app, { marketing = [] } = {}) {
  for (const [path, title] of Object.entries(STUBS)) {
    app.get(path, (req, res) => res.render("legal", { title }));
  }
  app.get("/license", (req, res) => res.render("license"));
  // /privacy carries the consent bar: it hosts the withdraw control in §6, which
  // needs consent-banner.js present to do anything.
  app.get("/privacy", marketing, (req, res) => res.render("privacy"));
}
```

- [ ] **Step 3e: Wire `server.js`**

Replace the CSP block and the three mount calls:

```js
import { makeSecurityHeaders, DEFAULT_CSP, MARKETING_CSP, withAppDomains } from "./middleware/securityHeaders.js";
import { analyticsLocals } from "./middleware/analytics.js";
```

```js
app.use(makeSecurityHeaders({ contentSecurityPolicy: withAppDomains(DEFAULT_CSP, config.allowedAppDomains) }));
```

```js
// Public pages (/, /request, /privacy) only: a wider CSP that permits GA4, plus the
// consent state for the view. Applied at the route — never app.use("/"), which
// prefix-matches every path and would leak analytics onto /dashboard and /admin.
const marketing = [
  makeSecurityHeaders({ contentSecurityPolicy: withAppDomains(MARKETING_CSP, config.allowedAppDomains) }),
  analyticsLocals(config),
];
```

```js
mountLanding(app, { marketing });
```

```js
mountRequest(app, { emailSender, marketing });
mountLegal(app, { marketing });
```

- [ ] **Step 3f: Mirror it in `tests/helpers.js`**

```js
import { makeSecurityHeaders, DEFAULT_CSP, MARKETING_CSP, withAppDomains } from "../middleware/securityHeaders.js";
import { analyticsLocals } from "../middleware/analytics.js";
```

Replace the `const csp = ...` / `app.use(...)` pair with:

```js
  app.use(makeSecurityHeaders({ contentSecurityPolicy: withAppDomains(DEFAULT_CSP, config.allowedAppDomains) }));
```

Then, just before `mountLanding`:

```js
  // Mirror server.js — the marketing middleware pair for the public pages.
  const marketing = [
    makeSecurityHeaders({ contentSecurityPolicy: withAppDomains(MARKETING_CSP, config.allowedAppDomains) }),
    analyticsLocals(config),
  ];
  const { mountLanding } = await import("../routes/landing.js?t=" + Date.now());
  mountLanding(app, { marketing });
  return { app, db, config, marketing };
```

- [ ] **Step 4: Run the full suite**

Run: `cd /var/www/suite/hub && npm test`
Expected: PASS — all 256 existing tests still green, plus 12 new in `tests/analytics-wiring.test.js`. Nothing should be red at this commit.

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite/hub
git add config.js server.js tests/helpers.js routes/landing.js routes/request.js routes/legal.js \
        views/partials/analytics.eta views/partials/header.eta views/landing.eta \
        views/request.eta views/request-received.eta views/privacy.eta tests/analytics-wiring.test.js
git commit -m "feat(hub): wire consent-gated GA4 into the public pages

GA_MEASUREMENT_ID gates everything; unset means analytics are off. The
marketing middleware (wider CSP + consent locals) is applied at the route,
so /dashboard and /admin keep the strict default and never see the bar.
Consent state reaches the client via data-* attributes only."
```

---

### Task 6: landing copy — retire the "No tracking" claims

**Files:**
- Modify: `hub/views/landing.eta`
- Modify: `hub/tests/landing.test.js`

**Interfaces:**
- Consumes: `.lp-foot-btn` and the `[data-consent-settings]` hook from Task 4.
- Produces: no code interface. Copy only.

**Constraint:** the word "free" must not appear anywhere in the landing output — `tests/landing.test.js` asserts `doesNotMatch(/free/i)`.

- [ ] **Step 1: Update the tests first (they encode the requirement)**

In `hub/tests/landing.test.js`, replace the trust-items test:

```js
test("landing shows the four trust items", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.match(res.text, /Passwordless sign-in/);
  assert.match(res.text, /Anonymous health checks/);
  assert.match(res.text, /Exports to Jira, CSV &amp; Markdown/);
  // GA4 (consent-gated) makes an absolute "no tracking" claim false. We keep the
  // claim we can defend: no advertising, ever.
  assert.match(res.text, /No ads, no clutter/);
  assert.doesNotMatch(res.text, /No tracking, no clutter/);
});
```

And append:

```js
test("the data FAQ describes consent-gated analytics honestly", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.doesNotMatch(res.text, /no third-party tracking/i, "GA4 makes this false");
  assert.match(res.text, /only if you accept/i, "consent is stated plainly");
  assert.match(res.text, /never sell/i);
  assert.match(res.text, /anonymous/i, "health-check anonymity claim survives");
});

test("the landing footer offers a withdraw-consent control", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  const footer = res.text.slice(res.text.indexOf('class="lp-footer"'));
  assert.match(footer, /data-consent-settings/, "PECR: withdrawing must be as easy as granting");
  assert.match(footer, /Cookie settings/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /var/www/suite/hub && node --test tests/landing.test.js`
Expected: FAIL — `No ads, no clutter` not found; `data-consent-settings` not found

- [ ] **Step 3: Make the copy changes**

In `hub/views/landing.eta`, in the `.trust` strip, replace the fourth trust item:

```html
    <span class="trust-item"><span class="dot"></span> No ads, no clutter</span>
```

Replace the "Where does my data go?" FAQ entry:

```html
  <div class="qa"><h3>Where does my data go?</h3><p>Your work stays in Sprint Suite. We never sell it and we never use it for advertising, and health-check submissions are anonymous. On our public pages we use Google Analytics to count visits, but only if you accept &mdash; nothing loads until you do, and you can change your mind at any time from the Cookie settings link below.</p></div>
```

In the footer's Legal column, after the License link:

```html
      <button type="button" class="lp-foot-btn" data-consent-settings>Cookie settings</button>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /var/www/suite/hub && node --test tests/landing.test.js`
Expected: PASS — including the pre-existing `doesNotMatch(/free/i)` assertion

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite/hub
git add views/landing.eta tests/landing.test.js
git commit -m "feat(hub): retire the no-tracking claims from the landing page

Consent-gated GA4 makes 'No tracking, no clutter' and the FAQ's 'no
third-party tracking' false. Reframed to 'No ads, no clutter' plus an
honest FAQ, and added the footer Cookie settings control (PECR:
withdrawing must be as easy as granting)."
```

---

### Task 7: `/privacy` v1.1 — disclose Google, fix §6

**Files:**
- Modify: `hub/views/privacy.eta`
- Modify: `hub/tests/legal.test.js`

**Interfaces:**
- Consumes: `[data-consent-settings]` (Task 4), `analytics` in the header include (Task 5 step 3c).
- Produces: no code interface. Legal copy only.

**Context:** §11 commits us to moving the version on material changes. §§4, 6 and 7 all change materially, so this goes to **v1.1, effective 17 July 2026**. This task owns the whole bump — band subtitle, meta line, body and tests — so the version change lands as one reviewable unit.

- [ ] **Step 1: Update the tests first**

In `hub/tests/legal.test.js`, replace the `/privacy` test:

```js
test("GET /privacy renders the Data & Privacy Note (Version 1.1)", async () => {
  const { app } = await buildWithLegal();
  const res = await request(app).get("/privacy");
  assert.equal(res.status, 200);
  assert.match(res.text, /Data &amp; Privacy Note/);
  assert.match(res.text, /Version 1\.1/);
  assert.match(res.text, /David Jackson/);              // names the controller
  assert.match(res.text, /nirvanadesign@msn\.com/);     // real contact address
  assert.match(res.text, /Anthropic/);                  // discloses RAID AI processing
  assert.match(res.text, /href="\/license"/);           // links back to the licence
  assert.doesNotMatch(res.text, /being finalised/);     // not the stub
  assert.doesNotMatch(res.text, /\[[A-Z][^\]]*\]/);     // no leftover [BRACKET] placeholders
});

test("/privacy discloses Google Analytics accurately and drops the false claim", async () => {
  const { app } = await buildWithLegal();
  const res = await request(app).get("/privacy");
  // The v1.0 promise that consent-gated GA4 makes false.
  assert.doesNotMatch(res.text, /there are no third-party tracking cookies/i);
  assert.match(res.text, /Google/, "Google is named as a processor");
  assert.match(res.text, /_ga/, "the actual cookies are named");
  assert.match(res.text, /ss_consent/, "the consent cookie is disclosed too");
  assert.match(res.text, /only .{0,20}(if|when) you (accept|consent)/i);
  assert.match(res.text, /data-consent-settings/, "withdrawal control is present");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /var/www/suite/hub && node --test tests/legal.test.js`
Expected: FAIL — `Version 1.1` not found (still 1.0)

- [ ] **Step 3: Rewrite the affected sections**

In `hub/views/privacy.eta`:

Bump the version in the header include (line 1), leaving the `analytics` key Task 5 added in place:

```
<%~ include("partials/header", { title: "Data & Privacy Note — Sprint Suite", analytics: it.analytics, band: { eyebrow: "Legal", title: "Data & Privacy Note", sub: "Version 1.1 · Effective 17 July 2026" } }) %>
```

Update the meta line:

```html
  <p class="legal-meta">Controller: David Jackson. Last updated 17 July 2026.</p>
```

In **§4 (processors)**, add Google to the processor list, matching the existing list's markup:

```html
    <li><strong>Google (Google Analytics):</strong> counts visits to our public pages, and only if you accept analytics cookies. Google receives your IP address and browser information. It is never used for advertising, and we do not share your account or app content with Google.</li>
```

Replace **§6 (cookies)** in full:

```html
  <p><strong>6. Cookies.</strong> We set a single essential session cookie so you stay signed in. It is not used for tracking or advertising. If you make a choice about analytics on our public pages we also store that choice in an essential cookie (<code>ss_consent</code>) so we do not have to ask you again; it holds nothing but your answer.</p>

  <p>On our public pages (the home page, the interest-registration form, and this note) we would like to use Google Analytics to count visits, so we can see which pages are useful. It sets analytics cookies (<code>_ga</code> and <code>_ga_*</code>). <strong>These are only set if you accept</strong> &mdash; until then, and if you decline, your browser does not contact Google at all. They are never used for advertising, and we never sell your data. You can change your mind at any time: <button type="button" class="lnk" data-consent-settings>change your analytics choice</button>. There are no advertising cookies anywhere on Sprint Suite.</p>
```

Update **§7 (international transfers)**:

```html
  <p><strong>7. International transfers.</strong> Some processors (including Anthropic and Google) are based outside the UK/EEA. Where data is transferred internationally, it is done under the safeguards recognised by UK and EU data-protection law, such as standard contractual clauses.</p>
```

Update **§11 (changes)** to record the amendment:

```html
  <p><strong>11. Changes.</strong> We may update this note from time to time; the version shown here at the time of your use applies. Material changes will be reflected in the version and date above. Version 1.1 (17 July 2026) added Google Analytics on our public pages, behind your consent, and described the cookies it sets.</p>
```

- [ ] **Step 4: Run the full suite**

Run: `cd /var/www/suite/hub && npm test`
Expected: PASS — all tests green, including the previously-failing legal tests. Total ≈ 256 + ~35 new.

- [ ] **Step 5: Commit**

```bash
cd /var/www/suite/hub
git add views/privacy.eta tests/legal.test.js
git commit -m "feat(hub): privacy note v1.1 — disclose consent-gated Google Analytics

Drops the v1.0 claim that there are no third-party tracking cookies,
which consent-gated GA4 makes false. Names Google as a processor, names
the _ga/_ga_* and ss_consent cookies, states that nothing is set without
consent, and carries the withdrawal control. Version bumped per §11."
```

---

## Verification before hand-off

- [ ] `cd /var/www/suite/hub && npm test` — all green.
- [ ] `grep -rn "unsafe-inline" middleware/securityHeaders.js` — appears on `style-src` only, never `script-src`.
- [ ] `grep -rn "<script>" views/` — no inline script blocks anywhere (the invariant).
- [ ] `grep -rn "No tracking" views/` — no hits.
- [ ] Drive it locally with `GA_MEASUREMENT_ID=G-TEST123 npm start`, then on `http://localhost:3004/`:
  - bar appears; Reject hides it and **no** request to googletagmanager appears in the Network tab;
  - reload — bar stays gone, still no Google;
  - footer "Cookie settings" reopens the bar; Accept loads googletagmanager and sets `_ga`;
  - `/dashboard` (signed in) shows no bar and no Google.

## Deployment (do not run without the user — this is their step)

1. Add `GA_MEASUREMENT_ID=G-6FJLV7EE1X` to the hub `EnvironmentFile` **before** restart, or analytics stay silently off (by design).
2. Pull as **`davidj`**, not `sudo -u suite-hub` (deploy tree is davidj-owned; dubious-ownership is fatal).
3. `systemctl restart suite-hub`; verify `/healthz` returns `{"ok":true}` on port **3004**.
4. This ships the parked `/privacy` note **and** its v1.1 amendment together — @279cce8 was never deployed, so v1.0 never goes live on its own.
5. Confirm in GA Realtime that an accepted visit registers, and that a rejected one does not.
