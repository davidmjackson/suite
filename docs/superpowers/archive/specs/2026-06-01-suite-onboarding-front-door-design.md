# Sprint Suite — Onboarding Front Door (Slice 1) — Design

**Date:** 2026-06-01
**Status:** Design approved, ready for implementation plan
**Layer:** identity-v2 Layer 3 (onboarding flows) — first slice of the multi-tenant journey

This spec captures the shared **access & permission model** for the whole
multi-tenant product (so every later slice inherits it), then specifies the
**first buildable slice — the onboarding front door** — in full.

---

## Part A — Shared access & permission model (all slices inherit this)

Worked out during brainstorming on 2026-06-01. Supersedes the loose
CR/CTM/CM braindump and reconciles it with what is already LIVE.

### Roles

| Role | = existing model | Capabilities |
|---|---|---|
| **Operator** (you, David) | `users.is_admin`, `/admin` | Above all companies. Approves access requests, sees every company, grants entitlements. |
| **CR** — Company Representative | company `owner` | Senior manager. Requests access; creates/deletes CTMs; full app use; company-wide oversight. **The only role that manages people.** |
| **CTM** — Company Team Manager (Scrum Master / Delivery Manager) | app-using role, **narrower than today's `admin`** | Hands-on facilitator. Uses all apps, mints room links, sees everything company-wide, **manages no people.** |
| **Player** | no account | Joins a Poker/Retro room by link; anonymous, self-named, self-declared in-app role. |

The CR↔CTM relationship is a **delegation hierarchy**: the CR provisions and
reviews; the CTM executes day-to-day. Both share the same in-app facilitator
role. "Company Member" from the braindump is **not** a hub account tier — for
Poker/Retro it collapses into "a person holding a room link."

### App access & scoping

- **Poker / Retro** — company-scoped. CR + CTM create rooms; anyone joins by a
  **per-room share link** (anonymous, self-named).
- **Signal / RAID** — specialist. **CR + CTM only, account-gated, never
  link-shared.** RAID runs on a **shared company quota** (25/month).
- **Visibility** — every CR + CTM in a company sees **all** that company's
  rooms / surveys / RAID logs. Scope = the company. **No team rosters to
  manage** (the "team" tier collapses to the company).

### Authentication

- **CR & CTM invites** = one-time **magic link + long-lived session** (reuses
  the live `magic_link_tokens` path). **No permanent bearer tokens in links.**
  Revocation = disable the user.
- **Players** = no auth; the room share link is the credential, scoped to one
  room only — it **never** grants access to the admin console.

### Per-app retention & share-link lifecycle

| App | Retention | Link / access |
|---|---|---|
| **Poker** | None — disposable, ~fortnightly throwaway | Link **dies with the room**, automatically. |
| **Retro** | Mixed — usually export & bin; some keep boards | Link valid **while the board is open**; facilitator ends/archives → link dead. (Optional inactivity auto-expiry.) |
| **Signal** | Persistent in-app | Account-gated, no link. |
| **RAID** | None — fire, analyse, export, forget | Account-gated, no link. |

### Decomposition (each its own spec → plan → build)

1. **Front door (onboarding)** — *this spec*. Request form → operator approve →
   provisioned CR. Chosen first: unblocks the whole journey.
2. **CTM role-gating** — introduce the CTM role; restrict Signal/RAID to CR+CTM;
   lock member-management to the CR.
3. **Poker/Retro share-links** — per-room anonymous links; Poker dies-with-room,
   Retro end/archive kills link; reverses the shipped membership-gating.

(Signal company-scoping = the previously-tracked Thread C; folds into slice 2/4.)

---

## Part B — Slice 1: Onboarding front door (full design)

### Goal

A stranger can request access; the operator approves; a provisioned CR receives
a sign-in link and lands in the **already-live** company console. This closes a
loop that is **CLI-only today** (companies are created via
`scripts/create-company.js`; the operator `/admin` plane has no companies UI).

### Scope

**In scope:**
- Public **Request Free Access** form → `access_requests` record.
- **Operator companies/requests view** under `/admin`: list all companies, list
  pending requests, **Approve** / **Reject**.
- **Approve** provisions: company + first CR (owner) + all four entitlements +
  magic-link invite email, in one transaction.
- Honeypot + rate-limit on the public form; full audit logging.

**Out of scope (later slices / already shipped):**
- CTM role-gating + Signal/RAID restriction (slice 2).
- Poker/Retro share-links (slice 3).
- The CR managing CTMs — **reuses the already-shipped company console**
  (`routes/company.js`, `/company/:slug`); slice 1 only delivers the CR into it.
- Self-service entitlement management by companies (operator-controlled).
- Email double-opt-in / captcha (honeypot + rate-limit only for v1).

### Key codebase grounding

- Operator plane = `routes/admin.js` (users / sessions / audit only — **no
  companies UI**), guarded by `requireSession` + `requireAdmin`
  (`hub/middleware/`). Views under `views/admin/`.
- Companies created via `lib/org.js` `createOrg(db)`:
  `createCompany({name, slug})`, `getCompanyBySlug(slug)`,
  `addCompanyMember({...})`. Entitlements via `lib/entitlements.js`
  `createEntitlements(db)` `grantEntitlement({app, principalType, principalId,
  quotaLimit?, quotaPeriod?})`.
- Login never auto-creates users (`routes/login.js:40`); an invite must create
  the `users` row first, then mint a `magic_link_tokens` row → email a
  `/auth/magic?token=` link (the **Approach A** pattern already used by the
  company console).
- Email via Resend (`lib/email.js`, `createEmailSender`); only `sendMagicLink`
  exists today. Templates under `views/emails/`.
- Rate limiting: `lib/rate-limit.js` `createLimiter({max, windowMs})` (used in
  `routes/login.js`).
- Landing page (`routes/landing.js`, `views/landing.eta`) has a static
  "Request access" affordance to wire up.
- Migrations at `db/migrations/001`, `002` → this slice adds **`003`**.
- Tests: `node:test` + supertest, `tests/helpers.js` `buildTestApp` (in-memory
  DB). Keep the suite green.

### Data model — migration `003-access-requests.sql`

No changes to existing tables. One new table, idempotent, bumps
`schema_version`.

```sql
CREATE TABLE access_requests (
  id            TEXT PRIMARY KEY,
  company_name  TEXT NOT NULL,
  contact_name  TEXT NOT NULL,
  email         TEXT NOT NULL,
  job_title     TEXT,
  team_size     TEXT,                              -- banded, e.g. "1-10"
  apps_interest TEXT,                              -- JSON array of app keys
  message       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  created_at    INTEGER NOT NULL,
  reviewed_by   TEXT REFERENCES users(id),
  reviewed_at   INTEGER,
  review_note   TEXT,
  company_id    TEXT REFERENCES companies(id)      -- set on approve
);
CREATE INDEX idx_access_requests_status ON access_requests(status);
```

### Provisioning — the Approve action (one transaction)

Composed from existing primitives; new orchestration only.

1. Guard: request must be `pending` (re-approve → no-op + friendly message).
2. Derive `slug` from `company_name` (kebab-case; collision → numeric suffix via
   `getCompanyBySlug` probe).
3. `org.createCompany({ name, slug })`.
4. Find-or-create the CR `users` row by email (reuse existing row if the email is
   already a user — no duplicate).
5. `org.addCompanyMember({ userId, companyId, role: 'owner' })`.
6. `entitlements.grantEntitlement` ×4: `poker`, `retro`, `signal` (unlimited),
   `raid` (`quotaLimit: 25, quotaPeriod: 'month'`), all `principalType:
   'company'`, `principalId: companyId`. **Confirmed default: all four,
   RAID capped.**
7. Mint a `magic_link_tokens` row for the CR's email + send the **access-approved**
   email containing the `/auth/magic?token=` sign-in link.
8. Mark the request `approved`, set `reviewed_by`, `reviewed_at`, `company_id`.
9. Audit-log `company_provisioned` / `access_request_approved` via `lib/audit.js`.

All wrapped in a single DB transaction; the email send is best-effort
(logged on failure, mirroring `routes/login.js`).

### Routes & views

**Public** — new `routes/request.js`, `mountRequest(app, { emailSender })`:
- `GET /request` → `views/request.eta` (form: company, name, email, job title,
  team-size band, apps-of-interest checkboxes, optional message, hidden honeypot).
- `POST /request` → validate (email regex as elsewhere; required fields;
  honeypot empty), rate-limit per IP (`lib/rate-limit.js`), insert
  `access_requests` row, optional courtesy email to applicant + operator
  notification, PRG → a "thanks, we'll be in touch" confirmation page.
- Landing page "Request access" affordance now links to `/request`.

**Operator** — extend `routes/admin.js`:
- `GET /admin/companies` → `views/admin/companies.eta`: a table of **all
  companies** (name, slug, status, member count, entitlement summary) + a table
  of **pending requests** with Approve/Reject controls.
- `POST /admin/requests/:id/approve` → runs provisioning above → redirect back
  with a flash.
- `POST /admin/requests/:id/reject` → set `rejected` + optional `review_note`;
  terminal (a fresh request may be filed later).
- Add a nav link to `/admin/companies` from the existing `/admin` views.
- All guarded by `requireSession` + `requireAdmin`.

### Email

`lib/email.js` gains (same Resend pattern as `sendMagicLink`):
- `sendAccessApproved({ to, url })` → template `views/emails/access-approved.eta`
  (the CR's sign-in link).
- *(optional)* `sendAccessReceived({ to })` courtesy to applicant, and/or
  `sendOperatorNewRequest({ to })` notification to the operator.

### Edge cases (resolved during brainstorming)

- **Duplicate company** (two people from IBM): the operator sees existing
  companies on the same screen and chooses Approve-as-new vs. Reject. **No
  automatic email-domain matching** (gmail / contractor traps).
- **Approved email already a hub user**: reuse the existing `users` row; just add
  the company membership — no duplicate user.
- **Re-approving / rejecting a non-pending request**: guarded → friendly
  message, not a 500.
- **One person, many companies**: already supported by the model; the dashboard
  already lists each company the user manages.
- **Spam**: honeypot + per-IP rate limit; operator approval is the real filter.

### Permissions & guards

- Public routes (`/request`) are unauthenticated but honeypot- + rate-limited.
- All `/admin/*` routes require `requireSession` + `requireAdmin` (operator
  only). A non-admin hitting them → existing behaviour (redirect/403).

### Testing

`node:test` + supertest via `buildTestApp` (in-memory DB), mirroring the hub
harness. Keep the suite green.

- **Request creation**: valid POST inserts a `pending` row; missing/invalid
  fields → 400; honeypot filled → silently dropped (no row); rate-limit → 429.
- **Approve** (the core): provisions company + owner membership + **all four**
  entitlements (assert each, incl. RAID `25/month`) + a `magic_link_tokens` row;
  marks request `approved` with `company_id`; is **idempotent** (second approve
  → no-op); **existing-email** path reuses the user row (no duplicate).
- **Reject**: sets `rejected`; provisions nothing.
- **Authz**: non-admin → blocked on `/admin/companies` and the approve/reject
  POSTs.
- **Slug derivation**: collision produces a unique suffixed slug.

### Deployment

Hub-internal: migration `003` + `suite-hub` restart. **No app redeploy, no new
service.** Follow the IONOS deploy conventions and the step-by-step / no-heredoc
shell rules at deploy time. Rollback = checkout prior hub SHA + restart; the
migration is additive (safe to leave in place).
