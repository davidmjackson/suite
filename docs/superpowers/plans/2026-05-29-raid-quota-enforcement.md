# RAID Quota Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the already-granted RAID monthly quota by gating `/extract` on a hub `consume` call before the paid Anthropic request runs.

**Architecture:** Extract RAID's inline `/extract` handler into an injectable factory (`createExtractHandler`) so the gate logic is unit-testable without HTTP. The factory calls `auth.consume(req.centralSessionId)` (auth-client → hub atomic check-and-increment) before `extract()`; it proceeds only on `ok`, returns 402/403 on quota/entitlement failure, and **fails closed (503)** on an unreachable hub. On success it threads `remaining` back to the browser, which shows a reactive limit-reached message and a running "N left this month" note via a new pure UI-text module. No hub changes — Layers 1+2 already shipped the server side.

**Tech Stack:** Node.js (CommonJS), Express 5, `node --test` (built-in test runner), `@suite/auth-client` (already a dependency), vanilla browser JS (IIFE modules tested via `new Function('window', src)`).

---

## Spec

`docs/superpowers/specs/2026-05-29-raid-quota-enforcement-design.md`

## Working directory

All paths below are relative to `/var/www/raid` unless stated otherwise. RAID is its own git repo (currently on `main`, tag `post-suite-auth`). Run `npm test` from `/var/www/raid`.

## Pre-flight

- [ ] **Step 0: Branch + safety tag**

```bash
cd /var/www/raid
git status            # expect clean (ignore pre-existing untracked .vscode/test-results if any)
git tag pre-raid-quota
git checkout -b feat/raid-quota
```

## File Structure

- **Create** `lib/extractHandler.js` — factory `createExtractHandler({ auth, extract, apiKey, model })` returning the async `(req, res)` Express handler for `POST /extract`. Owns the full request lifecycle: input validation, API-key check, the consume gate, the paid `extract()` call, and response shaping. This is the one new unit of backend logic and the one place the gate lives.
- **Modify** `server.js` — require the factory and wire it; delete the inline handler body. Becomes a one-line route registration.
- **Create** `tests/extractHandler.unit.test.js` — `node --test` coverage of every branch using injected mocks for `auth.consume` and `extract` (no network, no DB, no Express).
- **Create** `public/js/extractUi.js` — pure browser module `window.RaidExtractUi = { messageFor, renderNote }`. `messageFor(status)` maps an HTTP status to a user-facing message descriptor; `renderNote(remaining)` produces the "N left this month" HTML. No DOM access, fully testable.
- **Create** `tests/extractUi.unit.test.js` — `node --test` coverage of `messageFor`/`renderNote`, loaded via the established `new Function('window', src)` pattern (see `tests/exports.unit.test.js`).
- **Modify** `public/js/app.js` — `callExtract` delegates status→message mapping to `RaidExtractUi.messageFor`; `onGenerate`/`renderResultZone` store and render `remaining`.
- **Modify** `public/index.html` — add `<script src="/js/extractUi.js" defer>` before `app.js`.

---

## Task 1: Backend consume gate (`createExtractHandler`)

**Files:**
- Create: `lib/extractHandler.js`
- Test: `tests/extractHandler.unit.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/extractHandler.unit.test.js`:

```javascript
// tests/extractHandler.unit.test.js
//
// Unit tests for the /extract request lifecycle, including the hub consume
// gate. auth.consume and extract are injected mocks — no network, no DB.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createExtractHandler } = require('../lib/extractHandler.js');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

const VALID_REQ = () => ({ centralSessionId: 'sess-1', body: { text: 'These are some project notes.' } });

function deps(overrides = {}) {
  return {
    auth: { consume: async () => ({ ok: true, remaining: 24 }) },
    extract: async () => ({ risks: [], assumptions: [], issues: [], dependencies: [] }),
    apiKey: 'sk-test',
    model: 'claude-sonnet-4-5',
    ...overrides,
  };
}

test('rejects short text with 400 and never consumes', async () => {
  let consumed = false;
  const handler = createExtractHandler(deps({ auth: { consume: async () => { consumed = true; return { ok: true }; } } }));
  const res = mockRes();
  await handler({ centralSessionId: 's', body: { text: 'short' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(consumed, false);
});

test('returns 500 when apiKey missing, before consuming', async () => {
  let consumed = false;
  const handler = createExtractHandler(deps({ apiKey: undefined, auth: { consume: async () => { consumed = true; return { ok: true }; } } }));
  const res = mockRes();
  await handler(VALID_REQ(), res);
  assert.equal(res.statusCode, 500);
  assert.equal(consumed, false);
});

test('on ok, calls extract and returns 200 with remaining threaded through', async () => {
  let extracted = false;
  const handler = createExtractHandler(deps({
    extract: async () => { extracted = true; return { risks: [{ title: 'r' }] }; },
    auth: { consume: async () => ({ ok: true, remaining: 7 }) },
  }));
  const res = mockRes();
  await handler(VALID_REQ(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(extracted, true);
  assert.equal(res.body.remaining, 7);
  assert.deepEqual(res.body.risks, [{ title: 'r' }]);
});

test('quota_exceeded returns 402 and never calls extract', async () => {
  let extracted = false;
  const handler = createExtractHandler(deps({
    extract: async () => { extracted = true; return {}; },
    auth: { consume: async () => ({ ok: false, reason: 'quota_exceeded' }) },
  }));
  const res = mockRes();
  await handler(VALID_REQ(), res);
  assert.equal(res.statusCode, 402);
  assert.equal(res.body.remaining, 0);
  assert.equal(extracted, false);
});

test('not_entitled returns 403 and never calls extract', async () => {
  let extracted = false;
  const handler = createExtractHandler(deps({
    extract: async () => { extracted = true; return {}; },
    auth: { consume: async () => ({ ok: false, reason: 'not_entitled' }) },
  }));
  const res = mockRes();
  await handler(VALID_REQ(), res);
  assert.equal(res.statusCode, 403);
  assert.equal(extracted, false);
});

test('unreachable hub fails closed with 503 and never calls extract', async () => {
  let extracted = false;
  const handler = createExtractHandler(deps({
    extract: async () => { extracted = true; return {}; },
    auth: { consume: async () => ({ ok: false, reason: 'unreachable' }) },
  }));
  const res = mockRes();
  await handler(VALID_REQ(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(extracted, false);
});

test('any other consume failure also fails closed with 503', async () => {
  const handler = createExtractHandler(deps({ auth: { consume: async () => ({ ok: false, reason: 'error' }) } }));
  const res = mockRes();
  await handler(VALID_REQ(), res);
  assert.equal(res.statusCode, 503);
});

test('extract throwing after consume returns 502 (no refund)', async () => {
  const handler = createExtractHandler(deps({ extract: async () => { throw new Error('boom'); } }));
  const res = mockRes();
  await handler(VALID_REQ(), res);
  assert.equal(res.statusCode, 502);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/extractHandler.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `lib/extractHandler.js`:

```javascript
// lib/extractHandler.js
//
// The POST /extract request lifecycle, factored out of server.js so the hub
// consume gate is unit-testable without HTTP. consume() runs BEFORE the paid
// extract() call: it is the atomic check-and-increment that both authorises
// and reserves a quota unit. On a hub failure we FAIL CLOSED (503) — the paid
// Anthropic call never runs without a verified consume. No refund on a later
// extract() failure (documented in the spec).

function createExtractHandler({ auth, extract, apiKey, model }) {
  return async function extractHandler(req, res) {
    const text = req.body?.text;
    if (typeof text !== 'string' || text.trim().length < 10) {
      return res.status(400).json({ error: "Provide 'text' (at least 10 chars) of project notes." });
    }
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on the server.' });
    }

    const gate = await auth.consume(req.centralSessionId);
    if (!gate.ok) {
      if (gate.reason === 'quota_exceeded') {
        return res.status(402).json({ error: 'Monthly extract limit reached.', remaining: 0 });
      }
      if (gate.reason === 'not_entitled') {
        return res.status(403).json({ error: 'No access to RAID.' });
      }
      // unreachable, error, session_not_found, anything else → fail closed
      return res.status(503).json({ error: 'Service temporarily unavailable.' });
    }

    try {
      const raid = await extract(text, { apiKey, model });
      return res.json({ ...raid, remaining: gate.remaining });
    } catch (err) {
      console.error('extract failed twice:', err.message);
      return res.status(502).json({ error: 'Extraction failed. Try rephrasing the notes and resubmit.' });
    }
  };
}

module.exports = { createExtractHandler };
```

Note: the JSON `error` strings here are fallbacks. The browser owns the displayed wording via `RaidExtractUi.messageFor(status)` (Task 3), matching RAID's existing pattern where `callExtract` ignores server error text and maps per status.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `extractHandler` tests green, and the pre-existing `exports`/`extract`/`samples` unit tests still pass.

- [ ] **Step 5: Commit**

```bash
git add lib/extractHandler.js tests/extractHandler.unit.test.js
git commit -m "feat(raid): consume gate in extract handler (fail-closed, no refund)"
```

---

## Task 2: Wire the handler into `server.js`

**Files:**
- Modify: `server.js` (the `const { extract } = ...` import region near line 12, and the `app.post('/extract', ...)` block near lines 64–79)

- [ ] **Step 1: Add the factory import**

In `server.js`, directly below the existing line:

```javascript
const { extract } = require('./lib/extract.js');
```

add:

```javascript
const { createExtractHandler } = require('./lib/extractHandler.js');
```

- [ ] **Step 2: Replace the inline `/extract` route**

Delete the entire existing block:

```javascript
app.post('/extract', auth.requireAuth, async (req, res) => {
  const text = req.body?.text;
  if (typeof text !== 'string' || text.trim().length < 10) {
    return res.status(400).json({ error: "Provide 'text' (at least 10 chars) of project notes." });
  }
  if (!API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on the server.' });
  }
  try {
    const raid = await extract(text, { apiKey: API_KEY, model: MODEL });
    res.json(raid);
  } catch (err) {
    console.error('extract failed twice:', err.message);
    res.status(502).json({ error: 'Extraction failed. Try rephrasing the notes and resubmit.' });
  }
});
```

and replace it with:

```javascript
app.post('/extract', auth.requireAuth,
  createExtractHandler({ auth, extract, apiKey: API_KEY, model: MODEL }));
```

- [ ] **Step 3: Verify existing tests still pass**

Run: `npm test`
Expected: PASS — same suite as Task 1 (the HTTP wiring has no unit test; the handler logic is covered by `extractHandler.unit.test.js`).

- [ ] **Step 4: Smoke-check the server boots**

Run: `node -e "require('./server.js')" ; sleep 1 ; curl -s localhost:3003/health`

(Requires a local `.env`/`data/`; if the box has no local RAID session DB configured, skip this step and rely on the dev-run verification in Task 5.)
Expected: `{"ok":true,"model":"..."}` then stop the process (Ctrl-C). No `createExtractHandler` / module errors on boot.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "refactor(raid): wire /extract through createExtractHandler"
```

---

## Task 3: Browser UI-text module (`RaidExtractUi`)

**Files:**
- Create: `public/js/extractUi.js`
- Test: `tests/extractUi.unit.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/extractUi.unit.test.js`:

```javascript
// tests/extractUi.unit.test.js
//
// Unit tests for the pure extract-response → UI-text helpers. Loaded the same
// way as tests/exports.unit.test.js: read the browser IIFE source and run it
// with a fake `window`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'extractUi.js'), 'utf8');
const sandbox = { window: {} };
new Function('window', SRC)(sandbox.window);
const { messageFor, renderNote } = sandbox.window.RaidExtractUi;

test('402 maps to a limit-reached message', () => {
  assert.match(messageFor(402).error, /limit/i);
  assert.equal(messageFor(402).reload, undefined);
});

test('403 maps to a no-access message mentioning the dashboard', () => {
  assert.match(messageFor(403).error, /dashboard/i);
});

test('503 maps to a temporarily-unavailable message', () => {
  assert.match(messageFor(503).error, /unavailable/i);
});

test('401 still signals reload (preserved behaviour)', () => {
  assert.equal(messageFor(401).reload, true);
  assert.match(messageFor(401).error, /redirect/i);
});

test('preserved status mappings still resolve', () => {
  assert.match(messageFor(502).error, /Extraction failed/);
  assert.match(messageFor(429).error, /Too many requests/);
  assert.match(messageFor(400).error, /rejected/);
});

test('unmapped/success status returns null', () => {
  assert.equal(messageFor(200), null);
  assert.equal(messageFor(418), null);
});

test('renderNote shows a count with correct pluralisation', () => {
  assert.equal(renderNote(3), '<p class="quota-note">3 extracts left this month.</p>');
  assert.equal(renderNote(1), '<p class="quota-note">1 extract left this month.</p>');
});

test('renderNote returns empty string for unlimited (null) or non-number', () => {
  assert.equal(renderNote(null), '');
  assert.equal(renderNote(undefined), '');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `ENOENT` reading `public/js/extractUi.js`.

- [ ] **Step 3: Write the minimal implementation**

Create `public/js/extractUi.js`:

```javascript
// public/js/extractUi.js
//
// Pure mapping from an /extract HTTP response to UI text. No DOM access so it
// is unit-testable. Consumed by app.js (callExtract + renderResultZone).
(function (window) {
  'use strict';

  // Returns a descriptor { error, reload? } for known statuses, else null
  // (caller treats null as: 2xx success, or fall back to a generic message).
  function messageFor(status) {
    switch (status) {
      case 401: return { reload: true, error: 'Signed out — redirecting.' };
      case 400: return { error: 'The AI service rejected the request. This is likely a temporary configuration issue. Please try again.' };
      case 402: return { error: "You've reached your monthly extract limit. Your quota resets on the 1st." };
      case 403: return { error: "You don't have access to RAID. Request access from the Sprint Suite dashboard." };
      case 429: return { error: 'Too many requests. Please wait a moment and try again.' };
      case 502: return { error: 'Extraction failed. Try rephrasing or shortening your notes.' };
      case 503: return { error: 'Service temporarily unavailable. Please try again in a moment.' };
      default:  return null;
    }
  }

  // Quiet "N left this month" note. Empty for unlimited grants (remaining null).
  function renderNote(remaining) {
    if (typeof remaining !== 'number') return '';
    const unit = remaining === 1 ? 'extract' : 'extracts';
    return `<p class="quota-note">${remaining} ${unit} left this month.</p>`;
  }

  window.RaidExtractUi = { messageFor, renderNote };
})(window);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `extractUi` tests green.

- [ ] **Step 5: Commit**

```bash
git add public/js/extractUi.js tests/extractUi.unit.test.js
git commit -m "feat(raid): pure extract-response UI-text module (402/403/503 + quota note)"
```

---

## Task 4: Consume the module in `app.js` + load it in `index.html`

This task is browser/DOM glue with no unit harness (RAID has no frontend DOM tests). It is verified behaviourally in Task 5.

**Files:**
- Modify: `public/js/app.js` (`callExtract` near lines 315–337; `onGenerate` near lines 355–374; `renderResultZone` result branch near lines 305–308)
- Modify: `public/index.html` (script tags, lines 14–18)

- [ ] **Step 1: Load the new module before `app.js`**

In `public/index.html`, immediately above:

```html
  <script src="/js/app.js" defer></script>
```

add:

```html
  <script src="/js/extractUi.js" defer></script>
```

- [ ] **Step 2: Route status mapping through `RaidExtractUi` in `callExtract`**

In `public/js/app.js`, replace the status-handling tail of `callExtract` — these lines:

```javascript
    if (res.status === 401) {
      // Session expired or lost — reload so requireAuth bounces us to the hub.
      window.location.reload();
      return { ok: false, error: 'Signed out — redirecting.' };
    }
    if (res.status === 502) return { ok: false, error: 'Extraction failed. Try rephrasing or shortening your notes.' };
    if (res.status === 400) return { ok: false, error: 'The AI service rejected the request. This is likely a temporary configuration issue. Please try again.' };
    if (res.status === 429) return { ok: false, error: 'Too many requests. Please wait a moment and try again.' };
    if (!res.ok)             return { ok: false, error: 'Extraction failed. Try rephrasing or shortening your notes.' };
    const data = await res.json();
    return { ok: true, data };
```

with:

```javascript
    const mapped = window.RaidExtractUi.messageFor(res.status);
    if (mapped) {
      if (mapped.reload) window.location.reload(); // requireAuth bounce on 401
      return { ok: false, error: mapped.error };
    }
    if (!res.ok) return { ok: false, error: 'Extraction failed. Try rephrasing or shortening your notes.' };
    const data = await res.json();
    return { ok: true, data };
```

- [ ] **Step 3: Store `remaining` from a successful response**

In `public/js/app.js`, find the success branch of `onGenerate`:

```javascript
    if (result.ok) {
      state.phase = 'result';
      state.result = result.data;
    } else {
```

and change it to also stash the count:

```javascript
    if (result.ok) {
      state.phase = 'result';
      state.result = result.data;
      state.remaining = result.data.remaining; // number, or undefined/null when unlimited
    } else {
```

- [ ] **Step 4: Render the quota note in the result zone**

In `public/js/app.js`, in `renderResultZone`, replace the result branch:

```javascript
    } else if (state.phase === 'result') {
      dom.resultZone.innerHTML = renderGrid(state.result) + renderActionBar();
      wireActionBar();
    } else if (state.phase === 'error') {
```

with:

```javascript
    } else if (state.phase === 'result') {
      dom.resultZone.innerHTML =
        window.RaidExtractUi.renderNote(state.remaining) + renderGrid(state.result) + renderActionBar();
      wireActionBar();
    } else if (state.phase === 'error') {
```

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/js/app.js
git commit -m "feat(raid): show quota note + limit-reached messaging in UI"
```

---

## Task 5: Full verification on dev

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite green**

Run: `npm test`
Expected: PASS — `extractHandler`, `extractUi`, `exports`, `extract`, `samples` all green; zero failures.

- [ ] **Step 2: Existing e2e still passes (if the dev box has Playwright browsers)**

Run: `npm run test:e2e`
Expected: PASS, or a clean skip if browsers aren't installed on this box. The auth-injection e2e exercises a real session; the gate now calls the hub's consume — if e2e runs against a hub without a seeded entitlement it may surface 402/403. If so, seed a generous grant for the e2e user or note the expected status; do **not** loosen the gate to make e2e pass.

- [ ] **Step 3: Manual behavioural check (run-the-app)**

Use the `run` skill (or `npm start` with a dev `.env` pointing at a hub) and confirm in a browser:
- A normal extract succeeds and a "N left this month" note appears above the result grid.
- Exhausting the grant (or temporarily granting a tiny quota via the hub CLI for a test user) makes the next extract show the limit-reached message, and the server returns 402.
- Stopping the hub makes an extract show "Service temporarily unavailable" (503, fail-closed) rather than running.

- [ ] **Step 4: Tag the dev build**

```bash
git tag post-raid-quota-dev
```

(Reserve `post-raid-quota` for after the prod deploy + click-through, mirroring the `post-suite-auth` / `post-suite-auth-dev` convention.)

---

## Deploy (separate careful prod session — NOT part of this build)

Do not deploy from this build session. The prod deploy is its own step, following the IONOS conventions and the step-by-step shell rules (one command per block, `---`-fenced, no `&&`, no heredocs). Summary for that session:

- RAID app redeploy only — **no hub change, no migration, no hub restart**.
- Push `feat/raid-quota` to origin, then on prod `/var/www/raid`: tag `pre-raid-quota`, fetch + check out the branch, `npm install --omit=dev` (no new deps, but refreshes the `@suite/auth-client` symlink), restart the `raid` systemd service.
- **The 25/month cap becomes real the instant this is live** — both prod users already have `raid` granted at 25/mo. Verify by doing a real extract (observe the "N left this month" note decrement) and confirm `/health` is 200.
- Tag `post-raid-quota` after end-to-end click-through.
- Rollback = check out `pre-raid-quota` + restart; the change is app-only and fully reversible (no data touched).

---

## Notes & deviations from the spec

- **Limit message wording:** the spec sketched "all 25 extracts". The app is never told the numeric limit (the hub's 402 body carries only `{ ok:false, reason:'quota_exceeded' }`, and auth-client drops the body), so hardcoding "25" would couple the UI to the grant value. The plan uses "You've reached your monthly extract limit. Your quota resets on the 1st." instead. The running "N left this month" note (from the success-path `remaining`) gives the user the concrete number.
- **No new frontend DOM test harness** — RAID has none, and introducing one is out of scope. Frontend *logic* (status→message, note rendering) is made pure and unit-tested in `RaidExtractUi`; the DOM glue in `app.js` is verified behaviourally in Task 5.
