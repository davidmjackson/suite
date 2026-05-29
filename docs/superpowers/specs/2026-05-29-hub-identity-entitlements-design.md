# Sprint Suite — Hub Identity & Entitlements (v2) — Design

**Date:** 2026-05-29
**Status:** Approved design (Layers 1+2). Build is a **later phase** — not part of the current Phase 3 app-wiring.
**Supersedes/extends:** the flat `users`-only model in `hub/db/migrations/001-initial.sql`.

## Background & motivation

The auth hub (live at https://sprintsuite.uk) currently has a **flat identity model**: a single `users` table (email, `display_name`, `is_admin`) with no notion of organisations or teams, and no per-app access control. Every authenticated user can, in principle, launch every app.

Two pressures make that insufficient:

1. **Per-app access differs.** RAID calls the Anthropic API, which costs money per extraction. Access to RAID must be restricted to approved principals with a capped usage budget — *not* open to any hub user. Team apps (poker, retro, signal) are collaborative and team-scoped. Access is not one policy; it is per-app.
2. **Multi-tenant corporate plans.** Selling to other companies requires real tenancy: a customer company self-manages its own people and teams, with the suite operator sitting above all companies. A flat `users` table cannot express "Acme's Platform Squad" vs "Globex's Platform Squad" without name collisions, and offers no company-level grouping to attach a plan to.

This design introduces a three-tier identity model and a per-principal entitlements system. It deliberately covers only the **foundation** (data model + entitlements + the hub↔app contract). Onboarding flows and per-app enforcement are separate, later specs (see *Scope* below).

## Decisions captured (the "why")

- **Many-companies / many-teams.** A single email (global identity) can belong to multiple companies and multiple teams within each. Chosen over "one company, many teams" because (a) a company namespace prevents team-name collisions, and (b) a first-class company entity unlocks corporate-plan revenue.
- **Customer-owned tenancy (true multi-tenant).** Each company has an external owner/admin who self-manages members and teams. The suite operator (you) approves new companies and sits above them, but does not run them day-to-day.
- **Per-principal entitlements + optional usage quota.** An entitlement attaches to a company, team, OR user — whichever fits the app. Cost-gated apps (RAID) additionally carry a usage quota so API spend is capped. Chosen over per-user-only (too tedious for team apps) and plan-based (pulls billing into this phase prematurely).
- **Hub-authoritative quota.** Usage is checked and counted at the hub per action, not tracked locally per app instance — single source of truth, no drift.

## Scope

**In scope (this spec — Layers 1+2):**
- **Layer 1 — Identity & org core:** `companies`, `teams`, `company_members`, `team_members`; roles; the `002` hub migration.
- **Layer 2 — App entitlements:** `app_entitlements`, `app_usage`; entitlement-resolution logic; RAID quota mechanics; the hub↔app interface contract (exchange payload, dashboard tile gating, `consume` endpoint).

**Out of scope (later, separate specs):**
- **Layer 3 — Onboarding flows:** access-request → approval → provisioning; company creation/claim; team invites. *Who* approves differs per app (operator-only for RAID; company-admin for team apps).
- **Layer 4 — Per-app enforcement wiring:** actually calling `consume` inside RAID's `/extract` hot path; scoping poker rooms / retro boards / signal data to teams; the per-app code changes.
- **Billing / plans / payment.** The model leaves room (company entity, entitlement grants) but defines no plan or payment concept yet.

The current **Phase 3 app-wiring continues against today's email-only hub.** RAID is already wired (identity-only gate) and is unaffected. poker's full team-rooms land when Layer 4 is built on top of this model — that is the natural home for poker's room authorisation, which today relies on shared access keys.

---

## Layer 1 — Identity & org data model

The existing `users` table is unchanged and remains the **global identity** (one row per email). `users.is_admin = 1` denotes the **suite operator** (the platform super-admin, above all companies).

```sql
-- Customer tenants
CREATE TABLE companies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,            -- namespacing, e.g. "acme"
  status      TEXT NOT NULL DEFAULT 'active',  -- active | suspended
  created_at  INTEGER NOT NULL
);

-- Teams live inside a company; name unique per company (no global collisions)
CREATE TABLE teams (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE(company_id, name)
);

-- user <-> company  (a person can be in several companies)
CREATE TABLE company_members (
  user_id     TEXT NOT NULL REFERENCES users(id),
  company_id  TEXT NOT NULL REFERENCES companies(id),
  role        TEXT NOT NULL,                   -- owner | admin | member
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, company_id)
);

-- user <-> team  (several teams within a company)
CREATE TABLE team_members (
  user_id     TEXT NOT NULL REFERENCES users(id),
  team_id     TEXT NOT NULL REFERENCES teams(id),
  role        TEXT NOT NULL,                   -- lead | member
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, team_id)
);

CREATE INDEX idx_teams_company       ON teams(company_id);
CREATE INDEX idx_company_members_co  ON company_members(company_id);
CREATE INDEX idx_team_members_team   ON team_members(team_id);
```

### Roles (three tiers)

| Tier | Roles | Capabilities (summary) |
|---|---|---|
| Suite | operator (`users.is_admin`) | Above all companies. Approves new companies; can grant any entitlement; full admin panel. |
| Company | `owner` / `admin` / `member` | Owner = billing + full control of the company (≥1 per company). Admin = manage members & teams. Member = belongs only. |
| Team | `lead` / `member` | Lead = manage that team's membership/settings. Member = participant. |

### Invariants (enforced in code, not just schema)

- A `team_members` row requires a matching `company_members` row for that team's `company_id` (you cannot be on a team of a company you do not belong to).
- Each `company` has at least one `owner`. The last owner cannot be demoted/removed without transferring ownership.
- Deleting/suspending a company cascades to its teams and memberships (suspension preferred over hard delete; `status='suspended'`).

---

## Layer 2 — App entitlements

```sql
-- "Principal X may use app Y, on these terms"
CREATE TABLE app_entitlements (
  id              TEXT PRIMARY KEY,
  app             TEXT NOT NULL,                   -- 'raid' | 'poker' | 'retro' | 'signal'
  principal_type  TEXT NOT NULL,                   -- 'company' | 'team' | 'user'
  principal_id    TEXT NOT NULL,                   -- companies.id / teams.id / users.id
  status          TEXT NOT NULL DEFAULT 'active',  -- active | suspended
  quota_limit     INTEGER,                         -- NULL = unlimited
  quota_period    TEXT,                            -- 'month' | 'day' | NULL
  granted_by      TEXT REFERENCES users(id),       -- operator or company admin
  granted_at      INTEGER NOT NULL,
  UNIQUE(app, principal_type, principal_id)
);
CREATE INDEX idx_entitlements_principal ON app_entitlements(principal_type, principal_id);
CREATE INDEX idx_entitlements_app       ON app_entitlements(app);

-- Usage counter for quota'd apps (RAID). One bucket per principal+app+period.
CREATE TABLE app_usage (
  app             TEXT NOT NULL,
  principal_type  TEXT NOT NULL,
  principal_id    TEXT NOT NULL,
  period_key      TEXT NOT NULL,                   -- '2026-05' (month) / '2026-05-29' (day)
  count           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (app, principal_type, principal_id, period_key)
);
```

### Entitlement resolution — *"can user U use app A?"*

1. Collect U's principals: `('user', U.id)` + every `('team', t)` U belongs to + every `('company', c)` U belongs to.
2. Select **active** `app_entitlements` for `app = A` whose `(principal_type, principal_id)` is in that set.
3. **None → denied.** (A random hub user cannot touch RAID.)
4. If the matched entitlement has a quota, it applies to **that entitlement's principal**:
   - A company-level RAID grant of `100/month` is a **shared pool** for the whole company.
   - A user-level grant is that person's **personal** cap.
   - `remaining = quota_limit − app_usage[app, principal, period_key]` (missing bucket ⇒ count 0).
5. Multiple matches → access allowed if **any** active entitlement grants it. For quota selection, prefer an **unlimited** entitlement; otherwise the one with the most remaining quota.

### RAID quota mechanics (worked example)

- Typically granted **per-company** (shared team budget) or **per-user** (individual) — operator's choice at grant time.
- `quota_period = 'month'`; `period_key` = `YYYY-MM`.
- **Hard block** at limit: RAID surfaces a clear "monthly limit reached" message; no Anthropic call is made.
- Counted via `consume` (interface #3), called **after input validation but immediately before the Anthropic call** — so requests that fail validation are never counted. If the model call itself then fails, the optional `refund` compensates, making the effective count "per successful extraction."
- A user with **no** RAID entitlement is blocked **before any API call** — cost is never incurred for unentitled users.

---

## Layer 2 — Hub ↔ app interface contract

Extends the existing launch flow (hub issues launch token → app `/auth/launch?token=` → app exchanges at hub → app session created).

### 1. Entitlement rides along at exchange

`POST /api/sessions/exchange` response gains an `entitlement` block scoped to the launch token's `target_app`:

```jsonc
{
  "user": { "id": "...", "email": "...", "display_name": "..." },
  "central_session_id": "...",
  "entitlement": {
    "entitled": true,
    "principal": { "type": "company", "id": "acme" },
    "quota": { "limit": 100, "period": "month", "remaining": 87 }  // null when unlimited
  }
}
```

If `entitled: false`, the app **denies the launch** (defence-in-depth; the dashboard should not have offered the link in the first place — see #2).

### 2. Dashboard shows only entitled tiles

The hub resolves entitlements when rendering `/dashboard`. Apps the user is **not** entitled to are hidden, or rendered with a **"Request access"** affordance (the request flow is Layer 3, deferred). This is the primary gate; #1 and #3 are defence-in-depth.

### 3. Quota'd actions: check + count via the hub (authoritative)

For cost-gated apps, the app makes a server-to-server call **before** doing expensive work:

```
POST /api/apps/:app/consume          (auth: app's HUB_API_KEY, Bearer)
  body: { "central_session_id": "..." }
  → 200 { "ok": true,  "remaining": 86 }
  → 402 { "ok": false, "reason": "quota_exceeded" }
  → 403 { "ok": false, "reason": "not_entitled" }
```

The hub resolves the principal for `(user, app)`, **atomically** checks the quota and increments the matching `app_usage` bucket within a single transaction, and returns the verdict. RAID gates `/extract` on a `200`. If the downstream work later fails in a way that should not be billed, the spec allows an optional compensating `POST /api/apps/:app/refund` (same body) — included as a known extension, not required for v1.

### auth-client additions

The shared library (`@suite/auth-client`, now CommonJS) gains:
- `exchange` surfaces the `entitlement` object to the consuming app (stored on the app session / available to handlers).
- a `consume(centralSessionId)` helper that calls `POST /api/apps/:app/consume` and returns `{ ok, remaining, reason }`.

Wiring `consume` into each app's hot path, and rendering "monthly limit reached" UX, is **Layer 4** (per-app, deferred). This spec fixes only the contract.

---

## Components & boundaries

- **`hub/db/migrations/002-*.sql`** — the new tables above. Idempotent, bumps `schema_version`.
- **`hub` entitlements module** — `resolveEntitlement(userId, app)` and `consume(userId, app)` (atomic). Pure functions over the DB; unit-testable with an in-memory SQLite.
- **`hub` org module** — CRUD + invariant enforcement for companies/teams/memberships. Consumed by the admin panel (operator) and, later (Layer 3), by company-admin self-service.
- **`hub` routes** — extend `/api/sessions/exchange`; add `POST /api/apps/:app/consume`; extend `/dashboard` rendering.
- **`@suite/auth-client`** — surface entitlement at exchange; add `consume()` helper.

Each unit is independently testable: entitlement resolution is a pure DB function; the consume endpoint is an HTTP wrapper around the atomic counter; the org module enforces invariants in isolation.

## Testing strategy

- **Entitlement resolution** — table-driven unit tests over an in-memory hub DB: no grant → denied; user/team/company grants → allowed; quota remaining math; multiple-match precedence (unlimited wins).
- **Consume atomicity** — concurrent `consume` calls against a quota of N must never exceed N (transaction test).
- **Org invariants** — cannot join a team without company membership; cannot remove the last owner; suspend cascades.
- **Interface** — exchange payload includes correct entitlement; dashboard hides unentitled tiles; `consume` returns 200/402/403 appropriately.

## Open questions deferred to later layers

- Company creation/claim mechanics and operator approval UX (Layer 3).
- Access-request data model (`access_requests`?) and per-app approver routing (Layer 3).
- Whether `consume`/`refund` needs idempotency keys for retry safety (Layer 4 hardening).
- Plan/billing entity and how it derives entitlements (future; out of scope).
