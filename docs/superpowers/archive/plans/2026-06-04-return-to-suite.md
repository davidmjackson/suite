# Return to Suite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give authenticated suite users a non-destructive "Return to Suite" button (→ hub `/dashboard`) inside every app, shown only when they hold a valid suite session; anonymous share-link users never see it. Sign Out is unchanged.

**Architecture:** A shared core in `@suite/auth-client` — a `GET /auth/whoami` handler (JSON `{authed, dashboardUrl}`, never redirects) + a `suite-return.js` client snippet that reveals a hidden `[data-suite-return]` button when authed — consumed by thin per-app integration (mount the route, add the hidden button to the topbar, include the snippet). Visibility keys off session-cookie presence, which is the only correct discriminator (Retro serves one board shell to both authed and anon users).

**Tech Stack:** Node ≥20 CommonJS, Express, `node:test`. Shared package at `/var/www/suite/shared/auth-client` is **symlinked** into all four apps' `node_modules` (changes picked up automatically; new handler loads on app restart, static asset serves immediately).

**Repos & paths:**
- Shared: `/var/www/suite/shared/auth-client` (lives in the **suite** repo; tests `cd /var/www/suite/shared/auth-client && node --test tests/*.test.js`).
- Apps (own repos): Raid `/var/www/raid` (branch `master`), Signal `/var/www/signal` (branch `feat/suite-auth`), Retro `/var/www/retrospective` (branch `main`), Poker `/var/www/scrumpoker` (branch `main`).
- This plan + spec live in the suite repo `docs/superpowers/`.

**Conventions:** Explicit git staging only — never `git add -A`/`.`; `git status` before each commit. Branch `feat/return-to-suite` in each repo off its live branch; push as backup; merge back locally. Co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Deploy ordering (critical):** the suite auth-client change MUST be live before any app is restarted with the route mounted (an app calling `app.get('/auth/whoami', auth.handleWhoami)` before `handleWhoami` exists would crash on boot). So: ship Phase 1 (auth-client) first, then the apps in any order.

---

## File structure

**Shared (`/var/www/suite/shared/auth-client/`):**
- Create `handlers/whoami.js` — the `GET /auth/whoami` handler (one responsibility: report auth state + dashboard URL).
- Create `public/suite-return.js` — the client reveal snippet (served at `/auth-client/suite-return.js`).
- Modify `lib/factory.js` — wire `handleWhoami` into the returned client.
- Create `tests/whoami.test.js` — unit tests for the handler.

**Per app** (Raid/Signal/Retro/Poker): mount `GET /auth/whoami`; add the hidden button to the named shells' topbar; include the snippet; add one markup-presence unit test.

---

## Phase 1 — Shared core (`@suite/auth-client`)

### Task 1: `whoami` handler + factory wiring + unit tests

**Files:**
- Create: `/var/www/suite/shared/auth-client/handlers/whoami.js`
- Modify: `/var/www/suite/shared/auth-client/lib/factory.js`
- Create: `/var/www/suite/shared/auth-client/tests/whoami.test.js`

- [ ] **Step 1: Branch the suite repo**

```bash
cd /var/www/suite
git switch main
git switch -c feat/return-to-suite
git status
```

- [ ] **Step 2: Write the failing unit test**

Create `/var/www/suite/shared/auth-client/tests/whoami.test.js`:

```js
// tests/whoami.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAuthClient } = require("../lib/factory.js");

function mk(cookieHeader) {
  const client = createAuthClient({
    appName: "raid", hubBaseUrl: "https://hub.example/", hubApiKey: "k",
    cookieName: "raid_session", dbPath: ":memory:",
  });
  const req = { headers: cookieHeader ? { cookie: cookieHeader } : {} };
  const captured = { status: 200, body: undefined, redirected: false };
  const res = {
    status(c) { captured.status = c; return res; },
    json(b) { captured.body = b; return res; },
    redirect() { captured.redirected = true; return res; },
  };
  return { client, req, res, captured };
}

test("whoami: no cookie -> 200 {authed:false}, no redirect", () => {
  const { client, req, res, captured } = mk(null);
  client.handleWhoami(req, res);
  assert.equal(captured.status, 200);
  assert.deepEqual(captured.body, { authed: false });
  assert.equal(captured.redirected, false);
});

test("whoami: unknown cookie -> 200 {authed:false}", () => {
  const { client, req, res, captured } = mk("raid_session=nope");
  client._ctx.store.get = () => null;
  client.handleWhoami(req, res);
  assert.equal(captured.status, 200);
  assert.deepEqual(captured.body, { authed: false });
});

test("whoami: valid session -> 200 {authed:true, dashboardUrl} (trailing slash stripped)", () => {
  const { client, req, res, captured } = mk("raid_session=abc");
  client._ctx.store.get = () => ({ id: "s1", central_session_id: "cs1", user_id: "u1" });
  client.handleWhoami(req, res);
  assert.equal(captured.status, 200);
  assert.deepEqual(captured.body, { authed: true, dashboardUrl: "https://hub.example/dashboard" });
  assert.equal(captured.redirected, false);
});
```

- [ ] **Step 3: Run it — expect FAIL**

Run: `cd /var/www/suite/shared/auth-client && node --test tests/whoami.test.js`
Expected: FAIL — `client.handleWhoami is not a function`.

- [ ] **Step 4: Create the handler**

Create `/var/www/suite/shared/auth-client/handlers/whoami.js`:

```js
// handlers/whoami.js
// GET /auth/whoami — reports whether the caller holds a valid app session and,
// if so, the hub dashboard URL. NEVER redirects (unlike requireAuth) and makes
// NO hub round-trip — a cheap local store lookup safe to call on every page load.
const { parseCookies } = require("../lib/cookies.js");

function createWhoamiHandler(ctx) {
  return function handleWhoami(req, res) {
    const cookieVal = parseCookies(req.headers.cookie)[ctx.cookieName];
    const sess = cookieVal ? ctx.store.get(cookieVal) : null;
    if (!sess) return res.status(200).json({ authed: false });
    const base = String(ctx.hubBaseUrl || "").replace(/\/+$/, "");
    return res.status(200).json({ authed: true, dashboardUrl: base + "/dashboard" });
  };
}

module.exports = { createWhoamiHandler };
```

- [ ] **Step 5: Wire it into the factory**

Modify `/var/www/suite/shared/auth-client/lib/factory.js`:
- After the other handler requires (the `createHeartbeatHandler` line), add:
```js
const { createWhoamiHandler } = require("../handlers/whoami.js");
```
- In the returned object (after `handleHeartbeat: createHeartbeatHandler(ctx),`), add:
```js
    handleWhoami: createWhoamiHandler(ctx),
```

- [ ] **Step 6: Run it — expect PASS**

Run: `cd /var/www/suite/shared/auth-client && node --test tests/whoami.test.js`
Expected: PASS (3/3).

- [ ] **Step 7: Full auth-client suite still green**

Run: `cd /var/www/suite/shared/auth-client && node --test tests/*.test.js`
Expected: all pass (existing factory/heartbeat/logout/launch/middleware/etc. + the 3 new whoami tests).

- [ ] **Step 8: Commit**

```bash
cd /var/www/suite
git add shared/auth-client/handlers/whoami.js shared/auth-client/lib/factory.js shared/auth-client/tests/whoami.test.js
git status
git commit -m "feat(auth-client): add GET /auth/whoami (authed + dashboardUrl, no redirect)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 2: `suite-return.js` client snippet

**Files:**
- Create: `/var/www/suite/shared/auth-client/public/suite-return.js`

- [ ] **Step 1: Create the snippet**

Create `/var/www/suite/shared/auth-client/public/suite-return.js`:

```js
// public/suite-return.js
// Served from each app at /auth-client/suite-return.js. Include on app shells:
//   <script src="/auth-client/suite-return.js" defer></script>
// Reveals any hidden [data-suite-return] element when the caller is an
// authenticated suite user, and points it at the hub dashboard. Fails safe
// (anon or network error -> button stays hidden). Works with or without defer.
(function () {
  function reveal() {
    fetch("/auth/whoami", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : { authed: false }; })
      .then(function (d) {
        if (!d || !d.authed) return;
        var els = document.querySelectorAll("[data-suite-return]");
        for (var i = 0; i < els.length; i++) {
          if (d.dashboardUrl) els[i].setAttribute("href", d.dashboardUrl);
          els[i].hidden = false;
        }
      })
      .catch(function () { /* stay hidden */ });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", reveal);
  } else {
    reveal();
  }
})();
```

- [ ] **Step 2: Sanity-check it parses**

Run: `cd /var/www/suite && node --check shared/auth-client/public/suite-return.js && echo "syntax ok"`
Expected: `syntax ok`.

- [ ] **Step 3: Commit**

```bash
cd /var/www/suite
git add shared/auth-client/public/suite-return.js
git status
git commit -m "feat(auth-client): suite-return.js client snippet (reveal Return-to-Suite when authed)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Merge the suite branch to main + push** (the apps symlink to this working tree; merging keeps `main` authoritative)

```bash
cd /var/www/suite
git switch main
git merge --no-ff feat/return-to-suite -m "Merge Return-to-Suite shared core (auth-client whoami + snippet)"
git push origin main
git push origin feat/return-to-suite
```

---

## Phase 2 — Raid integration

**Files:**
- Modify: `/var/www/raid/server.js` (mount the route)
- Modify: `/var/www/raid/public/index.html` (button + snippet)
- Create: `/var/www/raid/tests/return-to-suite.unit.test.js`

- [ ] **Step 1: Branch**

```bash
cd /var/www/raid
git switch master
git switch -c feat/return-to-suite
git push -u origin feat/return-to-suite
git status
```

- [ ] **Step 2: Mount the route** in `/var/www/raid/server.js` — immediately after the `app.get('/auth/logout', auth.handleLogout);` line, add:

```js
app.get('/auth/whoami', auth.handleWhoami);
```

- [ ] **Step 3: Add the hidden button** in `/var/www/raid/public/index.html`. The topbar `.tbacts` currently is:

```html
    <span class="tbacts">
      <button id="logout-button" class="btn btn--ghost" type="button">Sign out</button>
    </span>
```

Change it to (button BEFORE Sign out):

```html
    <span class="tbacts">
      <a class="btn btn-ghost btn-sm" data-suite-return hidden>Return to Suite</a>
      <button id="logout-button" class="btn btn--ghost" type="button">Sign out</button>
    </span>
```

- [ ] **Step 4: Include the snippet** in `/var/www/raid/public/index.html` `<head>` — immediately after the `<script src="/auth-client/heartbeat.js" defer></script>` line, add:

```html
  <script src="/auth-client/suite-return.js" defer></script>
```

- [ ] **Step 5: Write the markup-presence unit test**

Create `/var/www/raid/tests/return-to-suite.unit.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("index.html has a hidden Return-to-Suite button + the snippet", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  assert.match(html, /data-suite-return/, "button marker present");
  assert.match(html, /\shidden(\s|>)/, "button ships hidden");
  assert.match(html, /\/auth-client\/suite-return\.js/, "snippet included");
});
```

- [ ] **Step 6: Run unit tests — expect PASS**

Run: `cd /var/www/raid && npm test`
Expected: all pass incl. the new `return-to-suite` test (the `tests/*.unit.test.js` glob picks it up).

- [ ] **Step 7: Smoke the route locally** (whoami is un-gated, so it answers with no cookie):

```bash
cd /var/www/raid
PORT=3003 ANTHROPIC_API_KEY=dummy HUB_BASE_URL=https://sprintsuite.uk HUB_API_KEY=dummy APP_SESSIONS_DB=/tmp/raid-rts.db node server.js &
SRV=$!; sleep 1.5
curl -s -w '\n' localhost:3003/auth/whoami
kill $SRV 2>/dev/null
```
Expected: `{"authed":false}` (no cookie). Confirms the route is mounted and the handler loaded from the symlinked auth-client.

- [ ] **Step 8: Commit + merge + push**

```bash
cd /var/www/raid
git add server.js public/index.html tests/return-to-suite.unit.test.js
git status
git commit -m "feat(raid): Return-to-Suite button + /auth/whoami mount

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git switch master
git merge --no-ff feat/return-to-suite -m "Merge Return-to-Suite (raid)"
git push origin master
git push origin feat/return-to-suite
```

---

## Phase 3 — Signal integration

**Files:**
- Modify: `/var/www/signal/lib/httpApp.js` (mount the route)
- Modify: `/var/www/signal/public/dashboard.html`, `admin.html`, `survey.html` (button + snippet)
- Create: `/var/www/signal/tests/return-to-suite.unit.test.js` (or `.test.js` to match Signal's runner — see Step 6)

- [ ] **Step 1: Branch**

```bash
cd /var/www/signal
git switch feat/suite-auth
git switch -c feat/return-to-suite
git push -u origin feat/return-to-suite
git status
```

- [ ] **Step 2: Mount the route** in `/var/www/signal/lib/httpApp.js` — immediately after `app.get("/auth/logout", auth.handleLogout);`, add:

```js
app.get("/auth/whoami", auth.handleWhoami);
```

- [ ] **Step 3: Add the button to all three authed shells.** In EACH of `public/dashboard.html`, `public/admin.html`, `public/survey.html`, the topbar contains:

```html
    <span class="topbar-actions">
```
…followed by existing buttons and the `<button id="signout-btn" ...>Sign out</button>`. Insert, as the FIRST child of `<span class="topbar-actions">` (before the existing links/buttons):

```html
      <a class="btn btn-ghost btn-sm" data-suite-return hidden>Return to Suite</a>
```

- [ ] **Step 4: Include the snippet** in each of the three shells. Each `<head>` has `<script src="/auth-client/heartbeat.js" defer></script>`. Immediately after it, add:

```html
  <script src="/auth-client/suite-return.js" defer></script>
```

- [ ] **Step 5: Write the markup-presence test**

Create `/var/www/signal/tests/return-to-suite.unit.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

for (const shell of ["dashboard.html", "admin.html", "survey.html"]) {
  test(`${shell} has hidden Return-to-Suite button + snippet`, () => {
    const html = fs.readFileSync(path.join(__dirname, "../public", shell), "utf8");
    assert.match(html, /data-suite-return/, "button marker present");
    assert.match(html, /\/auth-client\/suite-return\.js/, "snippet included");
  });
}
```

- [ ] **Step 6: Run Signal's test suite — expect PASS**

First confirm Signal's test glob: `cd /var/www/signal && grep '"test"' package.json`. If it globs `tests/*.unit.test.js`, keep the filename above; if it globs `tests/*.test.js`, rename to `tests/return-to-suite.test.js`. Then:
Run: `cd /var/www/signal && npm test`
Expected: all pass incl. the new test.

- [ ] **Step 7: Smoke the route locally**

```bash
cd /var/www/signal
PORT=3002 HUB_BASE_URL=https://sprintsuite.uk HUB_API_KEY=dummy APP_SESSIONS_DB=/tmp/signal-rts.db node server.js &
SRV=$!; sleep 1.5
curl -s -w '\n' localhost:3002/auth/whoami
kill $SRV 2>/dev/null
```
Expected: `{"authed":false}`. (If the server needs other env to boot, add what the error names — `/auth/whoami` itself needs no hub call.)

- [ ] **Step 8: Commit + merge + push**

```bash
cd /var/www/signal
git add lib/httpApp.js public/dashboard.html public/admin.html public/survey.html tests/return-to-suite.unit.test.js
git status
git commit -m "feat(signal): Return-to-Suite button + /auth/whoami mount

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git switch feat/suite-auth
git merge --no-ff feat/return-to-suite -m "Merge Return-to-Suite (signal)"
git push origin feat/suite-auth
git push origin feat/return-to-suite
```

---

## Phase 4 — Retro integration

**Files:**
- Modify: `/var/www/retrospective/server.js` (mount the route)
- Modify: `/var/www/retrospective/public/lobby.html`, `actions.html`, `retrospective.html` (button + snippet)
- Create: `/var/www/retrospective/tests/return-to-suite.unit.test.js` (match Retro's runner — see Step 6)

- [ ] **Step 1: Branch**

```bash
cd /var/www/retrospective
git switch main
git switch -c feat/return-to-suite
git push -u origin feat/return-to-suite
git status
```

- [ ] **Step 2: Mount the route** in `/var/www/retrospective/server.js` — immediately after `app.get("/auth/logout", auth.handleLogout);`, add:

```js
app.get("/auth/whoami", auth.handleWhoami);
```

- [ ] **Step 3: Add the button to all three shells.** In `public/lobby.html` the topbar actions group is:

```html
      <div class="header-actions">
        <a class="secondary-btn" href="/actions">Actions Report</a>
        <button type="button" class="link-btn" id="logout-btn">Log out</button>
      </div>
```

Insert as the FIRST child of `.header-actions`:

```html
        <a class="secondary-btn" data-suite-return hidden>Return to Suite</a>
```

For `public/actions.html` and `public/retrospective.html`: each has a `<header class="topbar">` with the same brand + actions pattern. Add the **same** `<a class="secondary-btn" data-suite-return hidden>Return to Suite</a>` into that shell's topbar actions group (the cluster holding its existing nav/logout control). Read each file's topbar to place it consistently with `lobby.html`.

- [ ] **Step 4: Include the snippet** in each of the three shells. Each has `<script src="/auth-client/heartbeat.js"></script>` near the end of `<body>`. Immediately after it, add:

```html
    <script src="/auth-client/suite-return.js"></script>
```

- [ ] **Step 5: Write the markup-presence test**

Create `/var/www/retrospective/tests/return-to-suite.unit.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

for (const shell of ["lobby.html", "actions.html", "retrospective.html"]) {
  test(`${shell} has hidden Return-to-Suite button + snippet`, () => {
    const html = fs.readFileSync(path.join(__dirname, "../public", shell), "utf8");
    assert.match(html, /data-suite-return/, "button marker present");
    assert.match(html, /\/auth-client\/suite-return\.js/, "snippet included");
  });
}
```

- [ ] **Step 6: Run Retro's test suite — expect PASS**

Confirm Retro's test glob: `cd /var/www/retrospective && grep '"test"' package.json`; rename the test file to match its pattern if needed. Then:
Run: `cd /var/www/retrospective && npm test`
Expected: all pass incl. the new test.

- [ ] **Step 7: Smoke the route + the anon-hidden guard**

```bash
cd /var/www/retrospective
# boot with minimal/dummy env per the repo's test config; then:
curl -s -w '\n' localhost:3001/auth/whoami
```
Expected: `{"authed":false}`. (Anon `/shared` board users get this → button stays hidden. Authed users get `{authed:true,...}` and the reveal — verified in the visual pass.)

- [ ] **Step 8: Commit + merge + push**

```bash
cd /var/www/retrospective
git add server.js public/lobby.html public/actions.html public/retrospective.html tests/return-to-suite.unit.test.js
git status
git commit -m "feat(retro): Return-to-Suite button + /auth/whoami mount

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git switch main
git merge --no-ff feat/return-to-suite -m "Merge Return-to-Suite (retro)"
git push origin main
git push origin feat/return-to-suite
```

---

## Phase 5 — Poker integration

**Files:**
- Modify: `/var/www/scrumpoker/lib/httpApp.js` (mount the route)
- Modify: `/var/www/scrumpoker/public/index.html` (button + snippet)
- Create: `/var/www/scrumpoker/tests/return-to-suite.unit.test.js` (match Poker's runner — see Step 6)

- [ ] **Step 1: Branch**

```bash
cd /var/www/scrumpoker
git switch main
git switch -c feat/return-to-suite
git push -u origin feat/return-to-suite
git status
```

- [ ] **Step 2: Mount the route** in `/var/www/scrumpoker/lib/httpApp.js` — immediately after `app.get('/auth/logout', auth.handleLogout);`, add:

```js
app.get('/auth/whoami', auth.handleWhoami);
```

- [ ] **Step 3: Add the button to the room userbar.** In `/var/www/scrumpoker/public/index.html`, the room actions group contains `<button id="logout-button" class="toolbar-action danger" type="button">Logout</button>`. Insert immediately BEFORE that logout button (so it sits in the same `.room-actions` cluster), styled as Poker's own action button (NOT a bare `.btn`):

```html
                <a class="toolbar-action" data-suite-return hidden>Return to Suite</a>
```

- [ ] **Step 4: Include the snippet** in `/var/www/scrumpoker/public/index.html` — immediately after `<script src="/auth-client/heartbeat.js" defer></script>`, add:

```html
    <script src="/auth-client/suite-return.js" defer></script>
```

- [ ] **Step 5: Write the markup-presence test**

Create `/var/www/scrumpoker/tests/return-to-suite.unit.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("index.html has a hidden Return-to-Suite button + the snippet", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  assert.match(html, /data-suite-return/, "button marker present");
  assert.match(html, /\/auth-client\/suite-return\.js/, "snippet included");
});
```

- [ ] **Step 6: Run Poker's test suite — expect PASS**

Confirm Poker's test glob: `cd /var/www/scrumpoker && grep '"test"' package.json`; rename to match if needed. Then:
Run: `cd /var/www/scrumpoker && npm test`
Expected: all pass incl. the new test.

- [ ] **Step 7: Smoke the route locally**

```bash
cd /var/www/scrumpoker
# boot per repo env (port 3000); then:
curl -s -w '\n' localhost:3000/auth/whoami
```
Expected: `{"authed":false}`.

- [ ] **Step 8: Commit + merge + push**

```bash
cd /var/www/scrumpoker
git add lib/httpApp.js public/index.html tests/return-to-suite.unit.test.js
git status
git commit -m "feat(poker): Return-to-Suite button + /auth/whoami mount

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git switch main
git merge --no-ff feat/return-to-suite -m "Merge Return-to-Suite (poker)"
git push origin main
git push origin feat/return-to-suite
```

---

## Phase 6 — Cross-repo verification + deploy

**Files:** none (verification + operator deploy).

- [ ] **Step 1: Full local verification**

```bash
cd /var/www/suite/shared/auth-client && node --test tests/*.test.js
cd /var/www/raid && npm test
cd /var/www/signal && npm test
cd /var/www/retrospective && npm test
cd /var/www/scrumpoker && npm test
```
Expected: all green.

- [ ] **Step 2: Deploy (operator-driven live session) — ORDER MATTERS**

Suite (auth-client) FIRST, then each app. On prod, one command per block:
1. `git -C /var/www/suite pull --ff-only origin main` (delivers `handleWhoami` + `suite-return.js`).
2. **Verify the dep model on prod** for each app: `ls -ld /var/www/<app>/node_modules/@suite/auth-client`. If it's a **symlink** → nothing more needed for the shared bits. If it's a **copy/directory** → run `npm install` (or `npm ci`) in that app so it picks up the new handler + asset.
3. For each app: `git -C /var/www/<app> pull --ff-only origin <live-branch>` then restart its service:
   - Raid: `sudo systemctl restart raid` (port 3003)
   - Signal: `sudo systemctl restart signal` (port 3002)
   - Retro: `sudo systemctl restart retrospective` (port 3001)
   - Poker: `sudo systemctl restart scrumpoker` (port 3000)
4. Smoke each: `curl -s -w '\n' localhost:<port>/auth/whoami` → `{"authed":false}`.

- [ ] **Step 3: Manual visual pass (per app)**

Signed in via the hub, launch each app: confirm **"Return to Suite"** appears next to Sign Out; click it → land on the hub dashboard still logged in; from there open a *different* app without re-auth. Then confirm an **anonymous share-link** visitor (Retro `/shared`, Poker `/join`, Signal `/s/:code`) does **NOT** see the button. Sign Out still fully logs out.

---

## Notes for the implementer

- **Deploy order is load-bearing:** the suite auth-client change must be live before an app boots with `/auth/whoami` mounted, or the app crashes (`auth.handleWhoami` undefined). Phase 1 → apps.
- **`whoami` never redirects** — that's its defining difference from `requireAuth`. Mount it OUTSIDE any auth guard (next to `/auth/launch`), so anon callers get a clean `{authed:false}`.
- **The button is an `<a>` revealed by JS**, hidden by default (`hidden` attr). No-JS users simply don't see it (apps are JS-driven). The snippet sets the `href` from `whoami`'s `dashboardUrl` (built from each app's own `hubBaseUrl`) — no hardcoded hub URL anywhere.
- **Button class per app matches local chrome:** Raid/Signal `btn btn-ghost btn-sm`; Retro `secondary-btn`; Poker `toolbar-action`. Never a bare `.btn`.
- **Retro `retrospective.html`** is served to BOTH authed (`/retrospective`) and anon (`/shared`); `whoami` (session presence) is what hides it for anon — do not rely on the shell file.
- **No behaviour/auth/session changes** anywhere else. Sign Out, launch, heartbeat, the hub dashboard, and all anonymous flows are untouched.
- **Symlinked dep (dev):** the shared `public/suite-return.js` is served by each app immediately (static), and `handleWhoami` loads on app restart — no `npm install` on the dev box. Re-verify symlink-vs-copy on prod (Phase 6 Step 2).
