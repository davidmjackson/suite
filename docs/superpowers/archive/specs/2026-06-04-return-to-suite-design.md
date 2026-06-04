# Return to Suite — cross-app navigation back to the hub dashboard

**Date:** 2026-06-04
**Status:** design approved, ready for implementation plan.

## Goal

Give an authenticated **suite user** (someone who signed in at the hub and launched an app) a one-click, **non-destructive** way back to the hub dashboard from inside any app, so they can switch apps without signing out and re-doing the magic-link/email flow. Anonymous users who reached an app directly via a share link must **not** see the button. Sign Out stays as-is (it intentionally kills the session).

## Background / current behaviour (verified)

- Apps delegate auth to the hub via `@suite/auth-client`. The hub mints a one-time launch token; the app creates a local app-session cookie (`requireAuth` validates it and attaches `req.user`). Anonymous flows (Poker `/join`, Retro `/shared`, Signal `/s/:code`) never establish an app session.
- **Session persistence already works.** The hub central session is a cookie on the hub origin with `sessionIdleMs = 30 min` idle / `sessionMaxMs = 30 days` max (`hub/config.js`); the apps' `/auth-client/heartbeat.js` pings keep it fresh during active use. Navigating back to `https://<hub>/dashboard` while the session is alive lands straight on the launcher — **no re-auth**.
- The hub already serves the launcher at `GET /dashboard` (`requireSession`-gated) — the destination for this feature.
- **Sign Out already fully logs out:** `handleLogout` calls `hubApi.deleteSession(central_session_id)`, clears the app cookie, and redirects to the hub. So the *only* reason users currently re-auth is that Sign Out is the **only** exit — there is no non-destructive way back. This feature adds exactly that.

**Therefore this feature is a navigation affordance, not session engineering.** No change to session lifetime, launch, logout, or the hub dashboard is required.

## Key decision (brainstorm 2026-06-04)

The button's visibility must key off **"does the caller hold a valid suite app-session?"** — not the shell file or URL — because Retro serves the **same** `retrospective.html` to both authed users (`/retrospective`, `requireAuth`) and anonymous viewers (`/shared`, no auth). The chosen mechanism (**Approach A**, approved) puts the decision in the shared `@suite/auth-client` so all four apps behave identically:

1. a shared `whoami` endpoint reports auth state + the dashboard URL as JSON (no redirect);
2. a shared client snippet reveals a hidden topbar button when authed;
3. each app drops in the hidden button + the snippet + mounts the route.

This is correct for the shared-shell case, and an authenticated user who happens to follow a share link still gets the button (they *are* a suite user) — the intended semantic.

Label/destination (approved): **"Return to Suite" → `<hubBaseUrl>/dashboard`**.

## Architecture

**Shared core in `@suite/auth-client`** (one implementation, consumed by all apps) + **thin per-app integration** (hidden button markup + a script include + one route mount).

## Component 1 — `@suite/auth-client` additions

### 1a. `whoami` handler (`handlers/whoami.js`, new)
- Route: `GET /auth/whoami`.
- Behaviour: parse the app session cookie (`ctx.cookieName`), look it up in the local session store (`ctx.store.get`). **No hub heartbeat call, no redirect.**
  - valid session present → `200 { authed: true, dashboardUrl: "<ctx.hubBaseUrl>/dashboard" }`
  - no cookie / unknown / store-miss → `200 { authed: false }`
- It exposes nothing sensitive: only a boolean and a public URL. It is a cheap local lookup (no hub round-trip), safe to call on every page load.
- Wire it through `lib/factory.js` so `createAuthClient(...)` returns `handleWhoami` (mirrors how `handleLaunch`/`handleLogout`/`handleHeartbeat` are exposed). `ctx.hubBaseUrl` is already part of the factory context.

### 1b. Client snippet (`public/suite-return.js`, new)
Served at `/auth-client/suite-return.js` (the `public/` dir is already exposed via `staticAssets`). On DOM-ready:
```js
fetch('/auth/whoami', { credentials: 'same-origin' })
  .then(r => r.ok ? r.json() : { authed: false })
  .then(({ authed, dashboardUrl }) => {
    if (!authed) return;                         // anon → leave hidden
    document.querySelectorAll('[data-suite-return]').forEach(el => {
      if (dashboardUrl) el.setAttribute('href', dashboardUrl);
      el.hidden = false;                          // reveal
    });
  })
  .catch(() => {});                               // fail safe: stay hidden
```
Tiny, dependency-free, fails safe (network error → button stays hidden). No wrong-state flash because the button ships `hidden`.

### 1c. Button markup contract
The button is a hidden `<a data-suite-return hidden>` carrying the `glyph-suite` mark + "Return to Suite". The snippet finds it by `[data-suite-return]`, sets its `href`, and reveals it. Its **visual classes match each app's existing top chrome** (see Component 2) — the contract is the `data-suite-return` attribute + `hidden`, not a fixed class set.

## Component 2 — per-app integration

Each app: (i) mount `app.get('/auth/whoami', auth.handleWhoami)` alongside the existing `/auth/launch` etc.; (ii) add the hidden button to the relevant shells' top chrome, next to the existing Sign Out / Logout, styled to match that app's chrome; (iii) include `<script src="/auth-client/suite-return.js" defer></script>` in those shells.

Per-app shells (working surfaces a signed-in user uses) and chrome style:

| App | Repo | Shells getting the button | Chrome / button style | Anon/public shells (NO button) |
|---|---|---|---|---|
| **Signal** | `/var/www/signal` | `dashboard.html`, `admin.html`, `survey.html` (all `requireAuth`-gated) | foundation `.topbar` `.tbacts`, `.btn-ghost btn-sm` | `respond.html` (`/s/:code`), `license.html` |
| **Retro** | `/var/www/retrospective` | `lobby.html`, `actions.html`, **`retrospective.html`** (shared board; `whoami` gates it) | foundation `.topbar`, `.btn-ghost btn-sm` | `join.html` (`/join`/`/shared` anon path), `license.html` |
| **Poker** | `/var/www/scrumpoker` | `index.html` (authed entry + room) | Poker's room **userbar** uses its own action buttons (`toolbar-action`); place the button there next to Logout, styled to match (NOT a bare foundation class) | `join.html`, `license.html` |
| **Raid** | `/var/www/raid` | `index.html` (its only app page) | foundation `.topbar` `.tbacts`, `.btn-ghost btn-sm` (mirrors the Sign out we just added) | `license.html` |

Notes:
- **Retro `retrospective.html`** is the one shell reached by both authed (`/retrospective`) and anon (`/shared`) — this is exactly why `whoami` (session-presence) is the gate rather than the shell file.
- **Poker** has no foundation `.topbar`; its sign-out is a `toolbar-action` in the room userbar. The button there must use Poker's own button class, not a bare `.btn` (the bare-`.btn` footgun). Exact placement (entry screen vs room userbar) is settled in the plan against Poker's real markup; minimum requirement is that an authed Poker user has the button on their working surface.
- The `glyph-suite` symbol exists in the shared `glyphs.svg` (already synced into every app). Apps reference it as they do their brand glyph.

## What does NOT change

- **Sign Out** — untouched. Authed users see **both** "Return to Suite" (non-destructive) and "Sign out" (destructive, kills the central session).
- **Session lifetime / launch / logout / heartbeat** — unchanged.
- **Hub `/dashboard`** — unchanged; the button links to it.
- **Anonymous flows** — unchanged; `whoami` returns `authed:false` for them, so the button stays hidden.

## Accepted limitation

If a user idles inside an app for longer than the hub `sessionIdleMs` (30 min) without heartbeats keeping it alive, the central session times out and returning to the dashboard will re-auth. This is existing hub behaviour, not introduced here, and is accepted.

## Testing

- **auth-client unit tests** (the critical logic, in `shared/auth-client/tests/`): `whoami` returns `{authed:true, dashboardUrl:"<hubBaseUrl>/dashboard"}` for a valid session cookie; `{authed:false}` for missing/unknown/expired; **asserts it never issues a 3xx redirect** (the distinguishing property vs `requireAuth`); `dashboardUrl` derives from the configured `hubBaseUrl`.
- **Per-app:** existing suites stay green. Add a light per-app assertion that the relevant shells contain a `[data-suite-return]` element that is `hidden` by default and include the `suite-return.js` script. Where an app already has e2e (Poker/Retro), add/extend a check: an authenticated session reveals the button; an anonymous share-link visitor (Retro `/shared`, Poker `/join`) does **not** see it. Raid has no e2e harness (public-only license e2e) — cover Raid via the markup assertion + manual visual pass.
- **Manual visual pass** per app: authed user sees "Return to Suite" + "Sign out"; clicking Return lands on the hub dashboard still logged in; clicking a different app from there works without re-auth; an anonymous share-link user sees no Return button.

## Build & deploy

- **Order:** `@suite/auth-client` first (the shared dependency), then the four apps consume it.
- **`file:` dependency refresh:** each app depends on auth-client via `"@suite/auth-client": "file:../suite/shared/auth-client"`. The plan must determine, per app, whether npm **symlinks** (change picked up automatically) or **copies** (needs `npm install`/`npm ci` to refresh) that dependency, and include the right refresh step in each app's deploy.
- **Per-app deploy** is operator-driven and independent: branch off each repo's live branch, build via the usual flow, merge, then `git pull` + restart + hard-refresh on prod. Each app can ship on its own once auth-client is in place.
- Explicit git staging only; `git status` before each commit. Co-author trailer on commits.

## Non-goals / deferred

- No change to session duration, the launch/logout flow, the hub dashboard, or any app's auth gating.
- No "switch app" dropdown or richer app-switcher inside the apps — just the single "Return to Suite" link (YAGNI; the dashboard is the switcher).
- No change to anonymous-flow chrome beyond ensuring the Return button is absent.
