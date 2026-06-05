# Sprint Suite — Architecture Docs

Per-app architecture references for a Claude Architect picking up this codebase cold.
Each doc is grounded against the actual code (not just memory) as of **2026-06-05**;
where code and convention disagree, the doc flags it. Verify live prod details against
the box before relying on them.

## The apps

| App | Doc | Repo | What it is |
|-----|-----|------|------------|
| **Hub** | [hub.md](hub.md) | `/var/www/suite` (`hub/`) | Central auth/identity/admin/landing service + public front door |
| **Sprintsignal** | [signal.md](signal.md) | `/var/www/signal` | Anonymous team survey / sentiment tool |
| **Sprintpoker** | [poker.md](poker.md) | `/var/www/scrumpoker` | Real-time planning-poker estimation (WebSocket, in-memory) |
| **Sprintretro** | [retro.md](retro.md) | `/var/www/retrospective` | Real-time sprint-retrospective boards (WebSocket) |
| **Sprintraid** | [raid.md](raid.md) | `/var/www/raid` | AI-assisted RAID-log generator (Anthropic API) |

## Services at a glance

| App | systemd unit | Run-as user | Port | Domain | Domain DB |
|-----|--------------|-------------|------|--------|-----------|
| Hub | `suite-hub` | `suite-hub` (verify) | 3000 / 3004 ⚠ | sprintsuite.uk | `/var/www/suite/hub/data/suite.db` |
| Signal | `signal.service` | `signal` | 3002 | sprintsignal.uk | `/var/lib/signal/*.db` |
| Poker | `scrumpoker` | `davidj` | 3000 | sprintpoker.uk | none — **in-memory** rooms |
| Retro | `retrospective.service` | `retrospective` | 3001 | sprintretro.uk | `/var/lib/retrospective/{retros.db,retro-sessions.db}` |
| Raid | `raid.service` | (verify) | 3003 | sprintraid.uk | none — **persists no user content** |

⚠ Hub port: live `.env` sets `PORT=3000` but the committed vhost/`.env.example`/systemd
comments say `3004`. Reconcile against the live box. (Hub and Poker both claiming :3000
is a loopback-namespacing question worth confirming on prod.)

## Shared architecture (read this first)

All four satellite apps are **thin clients of the hub for identity**. The common shape:

- **Stack:** Node + Express, `better-sqlite3`, server-rendered (Eta/EJS/static + vanilla
  JS clients). No build step, no SPA framework. CommonJS throughout. Behind Apache + Certbot
  on per-app `.uk` domains (see [reference-ionos-deploy]).
- **Auth via the hub:** apps embed the shared **`@suite/auth-client`** package
  (`/var/www/suite/shared/auth-client`, symlinked into each app on prod — deploy the
  auth-client **before** the apps). Flow: hub mints a short-lived **launch token** →
  app exchanges it for its own `*_session` cookie → app reads `req.user` (incl. company)
  for scoping. `GET /auth/whoami` powers the **Return-to-Suite** reveal (shown only to
  authed suite users; anonymous share-link users never see it).
- **Company scoping & roles:** data is scoped per **company**; roles are **owner (CR)**
  and **member (CTM)**. Signal & Raid are **CR+CTM-only account-gated**; Poker & Retro
  add **anonymous per-room/board share links** for guests with no hub account.
- **Entitlements / quota:** the hub grants per-company entitlements to each app; **Raid**
  additionally enforces a **25/month quota** via the hub's atomic `consume()`.

For the identity model, launch-token mechanics, entitlements, and admin/onboarding
surface, **start with [hub.md](hub.md)** — it is the source of truth the others depend on.

## Cross-cutting notes

- **Visual system:** all surfaces use the **"Instrument"** redesign (per-app accent —
  Poker=green, Raid=amber; white-on-amber fails AA → ink labels).
- **Default branches differ:** Raid is **`master`**; the others are `main` (Signal is
  currently on `feat/suite-auth`). Check before branching.
- **Stale READMEs:** several app READMEs predate the auth-hub migration and describe
  retired standalone access-key/admin models. Trust these architecture docs + the code
  over the in-repo READMEs.
- **Destructive migrations shipped:** Signal (v2 tenant wipe) and Retro (schema v7 board
  wipe) both clean-cut on deploy. Backups noted in the per-app docs.
