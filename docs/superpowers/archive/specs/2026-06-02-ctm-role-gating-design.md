# Sprint Suite — CTM Role-Gating (Slice 2) — Design

**Date:** 2026-06-02
**Status:** Design approved, ready for implementation plan
**Layer:** identity-v2 Layer 3 (onboarding flows) — second slice of the multi-tenant journey

Builds directly on the shared access model in
`2026-06-01-suite-onboarding-front-door-design.md` (Part A) and the live
company-admin console (`2026-05-31-company-admin-console-design.md`). This slice
makes the **CR / CTM** role model real and gives the company owner **per-member
control over Signal and RAID**.

---

## Goal

1. Collapse the company role model to two roles — **`owner` (CR)** and
   **`member` (CTM)** — so that **only owners manage people**.
2. Let the owner **selectively grant Signal and RAID to individual members**.
   Poker and Retro remain available to everyone in the company.

Non-goals (later slices): Poker/Retro per-room anonymous share-links (slice 3);
Signal per-company data scoping (Thread C); any billing/paywall.

---

## Decisions (locked via brainstorming 2026-06-02)

- **Two roles, not three.** `admin` is removed. Anyone currently `admin` becomes
  `member`. Console management (manage teams + members) becomes **owner-only**.
- **Per-member app access uses the existing per-user entitlement machinery** —
  no new tables, no parallel permission layer. A member is "enabled" for
  Signal/RAID ⇔ a `principal_type='user'` entitlement row exists for them.
- **RAID quota is per-member, 25/month.** Each enabled member gets their own
  25/mo pool (not a shared company pool). Rationale: the RAID extraction API is
  **not scoped for live traffic** — the 25/mo cap is a **demo-level guardrail to
  expose functionality, not a billing model**. If RAID gets traction a proper
  paywall replaces this. The owner controls how many members are enabled, so the
  owner controls spend. This deliberately drops the "shared company pool" idea
  from slice-1 Part A as unnecessary complexity (YAGNI).
- **Default access matrix:**

  | | Poker | Retro | Signal | RAID |
  |---|---|---|---|---|
  | **Owner (CR)** | ✅ always | ✅ always | ✅ default on | ✅ default on |
  | **New member (CTM)** | ✅ always | ✅ always | ❌ default off | ❌ default off |

  - Poker + Retro = **company-level** entitlements → everyone always has them;
    not togglable per-member.
  - Signal + RAID = **user-level** entitlements. Owner gets them automatically;
    new members start with neither; owner enables each **independently**.
  - The **owner's own** Signal/RAID cannot be revoked (a company always retains
    its CR's access to every app — avoids locking the company out of its tools).
- **User-facing labels** stay **"Owner"** and **"Member"** in the console
  (CR/CTM are internal names).

---

## Architecture / changes

### A. Role model (`hub/lib/org.js`)

- `COMPANY_ROLES` set: `{ owner, member }` (drop `admin`).
- `adminCompaniesForUser` and any `role IN ('owner','admin')` check → **`owner`
  only**.
- The company-console route mounts that allow `admin` (via
  `requireCompanyRole`) → **`owner` only**.
- Last-owner invariant (`org.js`) is unchanged and still enforced.

### B. Entitlement model (`hub/lib/entitlements.js`, `hub/lib/provisioning.js`)

- Provisioning `approve()`:
  - **Poker + Retro** → `grantEntitlement(principal_type='company')` (unchanged).
  - **Signal + RAID** → `grantEntitlement(principal_type='user', principalId=ownerUserId)`;
    RAID with `quotaLimit=25, quotaPeriod='month'`, Signal unlimited.
- `inviteCompanyMember` (`org.js`): new members get **no** Signal/RAID grants.
  Poker/Retro are inherited from the company entitlement, so nothing to grant.
- No change to `resolveEntitlement` / `consume` logic — they already resolve
  user-principal entitlements and quota. The `consume` 403 (`not_entitled`) /
  402 (`quota_exceeded`) gate keeps working for a member without RAID.

### C. Console per-member toggles (`hub/routes/company.js`, `hub/views/company/console.eta`)

- Members list: each **non-owner** member row shows two independent controls —
  **Signal** and **RAID** — reflecting whether a user-level entitlement exists.
- Owner rows show both as **locked-on** (visible, not togglable).
- New **owner-only** POST handlers (PRG pattern, like existing console mutations):
  - grant: `grantEntitlement({ app, principalType:'user', principalId:userId, quotaLimit, quotaPeriod, grantedBy })`
    (RAID → 25/month, Signal → unlimited).
  - revoke: `revokeEntitlement({ app, principalType:'user', principalId:userId })`
    (sets `status='suspended'`).
  - Guard: reject toggling **owner** rows and apps other than `signal`/`raid`.
  - Audit each mutation: `member_app_granted` / `member_app_revoked` (app + target
    user), visible in operator `/admin/audit`.
- The console must show current per-member Signal/RAID state — add a helper
  (e.g. `entitlements.listUserApps(userId)` or reuse `resolveEntitlement` per
  app) to populate the toggles.

### D. Exchange company-context fix (`hub/routes/api-sessions.js`)

- Today `/api/sessions/exchange` derives `companyId` **only** when the matched
  entitlement principal is `company`-typed. Signal/RAID become **user**-typed, so
  they would lose the company/team context passed to the app.
- Fix: derive `companyId` from the user's **company membership**
  (`company_members`), independent of which principal the entitlement matched, so
  RAID still receives its company context. Makes company/team enrichment
  consistent across all four apps. Current data has **one company per user**, so
  `companyId` = that single `company_members` row. (Future multi-company handling
  is out of scope; if it arises, prefer the entitlement's company principal when
  it has one, else the user's company membership.)

### E. Data migration for the live company (`sprint-suite`) (`hub/db/migrations/`)

A new ordered migration that runs on hub boot:

1. **Role collapse:** `UPDATE company_members SET role='member' WHERE role='admin'`.
2. **Signal/RAID re-home:** for every company that currently has a **company-level**
   Signal or RAID entitlement:
   - grant the same app at **user-level to each `owner`** of that company
     (Signal unlimited; RAID 25/month), then
   - **suspend** the company-level Signal/RAID entitlement (so members no longer
     inherit it).
3. Existing **non-owner** members lose Signal/RAID until the owner re-enables them
   in the console — this is exactly the new model.

   For the only live company `sprint-suite`, the net result: `nirvanadesign`
   (owner) keeps Signal + RAID at user level; any test members lose them.
   Poker/Retro company grants are untouched.

> Migration must be **idempotent / safe to re-run** (guard with existence checks),
> consistent with how existing hub migrations are written.

---

## Testing (TDD)

Keep the hub suite green (currently 161/161). New/updated coverage:

- **Role collapse:** `COMPANY_ROLES` rejects `admin`; `adminCompaniesForUser`
  returns companies only where role = `owner`; a `member` (formerly `admin`) has
  no console access (403).
- **Provisioning:** approve grants poker/retro at company level and signal/raid at
  **user level to the owner only**; a freshly invited member resolves
  `entitled:false` for signal/raid and `true` for poker/retro.
- **Console toggles:** owner can grant/revoke signal & raid for a member
  independently; non-owner gets 403; toggling an owner row or a non-signal/raid
  app is rejected; each mutation writes the expected audit event.
- **Quota:** a member granted RAID gets a fresh 25/month pool; `consume` enforces
  it (402 at limit); a member without RAID gets 403 `not_entitled`.
- **Dashboard:** reflects per-member entitlement (signal/raid tiles entitled only
  when the user-level grant exists).
- **Exchange fix:** company/team context is returned for a user whose RAID/Signal
  entitlement is user-typed (companyId derived from membership).
- **Migration:** on a DB seeded with an `admin` member and company-level
  signal/raid grants, after migration: roles collapsed, owners hold user-level
  signal/raid, company-level signal/raid suspended; re-running the migration is a
  no-op.

---

## Out of scope (explicit)

- Poker/Retro anonymous per-room **share-links** → **slice 3**.
- Signal per-company **data scoping** (surveys/results visibility) → **Thread C**.
- Any **billing / paywall** — the 25/mo cap remains a demo guardrail.
- **Team-tier** management — already collapsed to the company; no change here.

---

## Rollback

Purely hub-internal (code + one migration; no app redeploy). Rollback = redeploy
the previous hub commit. The migration only re-homes entitlement rows and
relabels roles; it does not delete companies, members, or usage history.
