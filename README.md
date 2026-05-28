> ## ⚠️ Status: cancelled May 2026
>
> This umbrella project aimed to unify four agile apps (Sprintraid, Sprintsignal, Sprintretro, Sprintpoker) under shared Clerk auth at `sprintsuite.uk`. Cross-TLD SSO turned out to require Clerk's paid Pro plan + Satellite Domains (~£50/mo), disproportionate for a one-user hobby project.
>
> **No application code was touched** — only Clerk dashboard / Google Cloud / Azure / Ionos DNS setup was created and then reverted. The four app repos at `/var/www/{raid,signal,retrospective,scrumpoker}` remain untouched, each tagged `pre-clerk-baseline` as a no-op reference point.
>
> The docs in this repo (`docs/clerk_setup.md`, `docs/claude.md`, `docs/rollback.md`, the four `integrations/` trigger files) are retained as a reference for the architecture that was attempted and the gotchas encountered along the way — particularly the Clerk subdomain conventions (`clerk.` for the Frontend API / JWT issuer, `accounts.` for the hosted sign-in UI, with `auth.` not achievable on standard plans). If you ever pick this up again, the free-tier-compatible path would be moving all four apps to subdomains of one root domain (e.g. `raid.sprintsuite.uk`).

---

# Integration Triggers

> **For:** Human operator + Claude Code CLI
> **Purpose:** Per-app instruction files that wrap `../docs/CLAUDE.md` with app-specific values

This directory contains four integration trigger files, one per Sprint app. Each file supplies the specific values (paths, ports, redirect URIs) needed for that app's Clerk integration, then defers to the master spec at `../docs/CLAUDE.md` for the actual implementation steps.

---

## Files

| File | App | Order | Risk Level |
|---|---|---|---|
| `01-sprintraid.md` | Sprintraid | 1st | Lowest, smallest surface area |
| `02-sprintsignal.md` | Sprintsignal | 2nd | Low, first SSO validation |
| `03-sprintretro.md` | Sprintretro | 3rd | Medium, real-time features |
| `04-sprintpoker.md` | Sprintpoker | 4th | Highest, most user-facing |

**Order matters.** Do not integrate out of sequence.

---

## Execution Sequence

### Prerequisites (do once, before any integration)

1. `../docs/CLERK_SETUP.md` completed end-to-end
2. `accounts.sprintsuite.uk` verified working
3. `../scripts/healthcheck.sh` runs cleanly
4. All four apps under git with `pre-clerk-baseline` tag (handled by `WORKSPACE_SETUP.md`)
5. VM snapshot taken via Ionos panel
6. Four Clerk applications registered in dashboard with their respective publishable/secret keys ready

### Per-App Sequence

For each app in order (Sprintraid → Sprintsignal → Sprintretro → Sprintpoker):

1. **Copy the trigger to the app's root.** Example for Sprintraid:
   ```bash
   cp /var/www/sprintsuite/integrations/01-sprintraid.md /var/www/raid/CLAUDE.md
   ```
   This makes the trigger visible to Claude Code when it runs from the app directory.

2. **Open Claude Code in the app directory:**
   ```bash
   cd /var/www/raid
   claude
   ```

3. **Prompt Claude Code:**
   > Read CLAUDE.md (which is the integration trigger for this app) and follow the execution order. Begin with Section 6 (pre-integration safety net). Stop and report after each major section. Refer to /var/www/sprintsuite/docs/CLAUDE.md for implementation details when the trigger says to.

4. **Soak for 24-48 hours.** Monitor logs, run health checks, test SSO.

5. **Only then** move to the next app.

---

## Why This Pattern?

Three reasons.

### 1. Reduces Ambiguity

The master `CLAUDE.md` describes the integration in generic terms. The trigger files lock in **exact values** for each app (the right directory, the right port, the right Clerk redirect URI), so Claude Code never has to guess.

### 2. Staged Rollout Discipline

Having four separate trigger files (rather than one document covering all four apps) forces you to integrate one at a time. There is no "do them all in one go" option.

### 3. App-Specific Concerns

Some apps have concerns the generic spec doesn't cover:
- **Sprintretro** may have WebSockets for live retros
- **Sprintpoker** has real-time voting and reveal
- **Sprintraid** and **Sprintsignal** are likely simpler

Each trigger has a section flagging the specific things to watch out for.

---

## The Two Directory/Name Mismatches

Two apps have directory names that don't match their brand names. **Do not get confused by this.**

| Brand / Domain | Directory |
|---|---|
| Sprintpoker (sprintpoker.uk) | `/var/www/scrumpoker` |
| Sprintretro (sprintretro.uk) | `/var/www/retrospective` |
| Sprintsignal (sprintsignal.uk) | `/var/www/signal` |
| Sprintraid (sprintraid.uk) | `/var/www/raid` |

The trigger files use the correct values throughout, but if anything looks off, this is why.

---

## Port Allocation Reference

| App | Port |
|---|---|
| Sprintpoker | 3001 |
| Sprintretro | 3002 |
| Sprintsignal | 3003 |
| Sprintraid | 3004 |

These are referenced in both the Apache vhost configs and the PM2 start commands. Do not change them mid-stream.

---

## After All Four Are Integrated

The final trigger (`04-sprintpoker.md`) Section 10 has post-integration tasks:

1. Merge `clerk-integration` branches back to main in each app
2. Tag each app's HEAD as `post-clerk-integration`
3. Take a new VM snapshot
4. Update the umbrella README
5. Save a clean healthcheck baseline

---

## If Something Goes Wrong

- **Per-app issues:** see the rollback section in that app's trigger file
- **Suite-wide issues:** see `../docs/ROLLBACK.md`
- **SSO not working between apps:** check that `SESSION_COOKIE_NAME=__sprintsuite_session` is identical in all four `.env` files, and that Clerk's cookie domain is `.sprintsuite.uk` (with leading dot)

---

**Start here:** `01-sprintraid.md`
