# Company-admin self-service console (identity-v2 Layer 3, first slice)

**Date:** 2026-05-31
**Status:** Design approved, ready for implementation plan
**Layer:** identity-v2 Layer 3 (self-service admin UI) — first slice

## Summary

Add a customer-facing **company-admin console** so that the owners and admins of a
company can self-manage their own **teams** and **members**, without operator
involvement. This is distinct from the existing operator admin plane (`/admin`,
gated by `users.is_admin`). It builds directly on the identity-v2 Layer 1/2
primitives already shipped (`lib/org.js`, migration 002 tables) and ships as a
hub-internal change (no app redeploy, no new service).

## Scope (what this slice is and is NOT)

**In scope:**
- A console at `/company/:slug` where company owners/admins manage their company.
- Member management: list members, invite by email, change role, remove.
- Team management: list/create/rename teams, add/remove team members.
- Owner-protection and last-owner safety rules.
- Audit logging of all mutations into the existing audit trail.

**Explicitly OUT of scope (decided during brainstorming):**
- **Self-serve company signup / onboarding.** Companies + their first owner are
  **operator-provisioned** via the existing CLIs (`create-company.js`,
  `add-company-member.js`). No public "create a company" flow.
- **Self-service entitlement management.** The **operator controls all app
  entitlements and quotas** (existing `grant-entitlement.js`). Company members
  inherit company-level entitlements. The console does NOT show or manage app
  access. (A read-only entitlement view could be a later addition.)
- **Access-request flow.** The dashboard's static "Request access" tile is left
  as-is; wiring it to a real request/approval workflow is a separate future slice.
- **Team deletion** — deferred (see Data model).
- **Team `lead`/`member` role toggle** — deferred (see Data model, YAGNI).

## Key codebase findings (grounding)

- **Login does NOT auto-create users.** `routes/login.js:40` only sends a magic
  link to a *pre-existing, non-disabled* user (it always renders "check your
  email" but only sends if the user exists — anti-enumeration). The only place a
  `users` row is created today is the operator's `POST /admin/users`
  (`routes/admin.js:30`). This shapes the invite design (see below).
- **`lib/org.js` already has all the mutators** needed: `createCompany`,
  `getCompanyBySlug`, `suspendCompany`, `addCompanyMember`, `setCompanyMemberRole`,
  `removeCompanyMember` (with last-owner invariant), `createTeam`, `listTeams`,
  `teamsForUser`, `addTeamMember`, `removeTeamMember`. Roles:
  `COMPANY_ROLES` (owner|admin|member), `TEAM_ROLES` (lead|member).
- **Tables already exist** from migration `002-identity-entitlements.sql`:
  `companies`, `teams`, `company_members`, `team_members`. No new migration.
- **Operator admin plane** lives at `/admin` (`routes/admin.js`, views under
  `views/admin/`, middleware `requireSession` + `requireAdmin`). The customer
  console must use a separate namespace.
- **Test harness:** `node:test` + `supertest`, `tests/helpers.js` `buildTestApp`
  (in-memory DB, mount the route, seed sessions/users via raw inserts). Hub
  currently 94/94 green.

## Architecture & routing

A new **customer-facing console**, separate from the operator `/admin` plane,
at the `/company/:slug` namespace.

- **New route module** `routes/company.js` exporting `mountCompany(app)`, mounted
  alongside the other route modules.
- **New views** under `views/company/`:
  - `console.eta` — company overview (members section + teams section).
  - `team.eta` — a single team's members.
  - Reuse existing layout/header partials in `views/partials/`.
- **Dashboard entry point:** `routes/dashboard.js` gains a query for the companies
  in which the logged-in user is `owner` or `admin`, and renders a
  "Manage &lt;company&gt;" link per company. The multi-company case falls out
  naturally — one link each, slug in the URL.
- **No new app/service.** Hub-internal; ships with the next `suite-hub` restart.
  No raid/signal/poker/retro redeploy.

The route layer is thin glue; it reuses `lib/org.js` and `lib/audit.js` wholesale.

## Data model & `org.js` additions

**No migration needed.** The four tables already exist from migration 002.
Invites reuse the existing `users` + `company_members` tables (Approach A below);
there is **no `pending_invitations` table**.

New read/helper functions added to `lib/org.js` (mutators already exist):

- `listCompanyMembers(companyId)` → rows of
  `{ userId, email, display_name, role, hasLoggedIn }`. Joins `users`;
  `hasLoggedIn` is derived from whether any `central_sessions` row has ever
  existed for that user, and drives the "Invited — not joined yet" badge.
- `listTeamMembers(teamId)` → same shape, scoped to a team.
- `renameTeam(teamId, name)` — small addition. **Create + rename only.**
- `inviteCompanyMember({ email, companyId, role, invitedBy })` — a single
  transaction: create the `users` row if the email is absent, then
  `addCompanyMember`. Returns `{ user, alreadyMember }`.
  **Note:** `addCompanyMember` is a plain `INSERT` with no conflict handling and
  `company_members` is unique on `(user_id, company_id)` — so re-inviting an
  existing member would throw. `inviteCompanyMember` therefore **checks for an
  existing membership first**: if the user is already a company member it does
  NOT call `addCompanyMember` (leaving their current role untouched) and returns
  `alreadyMember: true`, which the route surfaces as a friendly "already a member"
  message. Role changes go through the dedicated role control, not re-invite.

### Invite mechanism — Approach A (create user immediately)

Because login never auto-creates users, an invite to an unknown email must create
the user row so that the magic-link path will work for them. Inviting therefore
runs one transaction: **create the `users` row if absent + `addCompanyMember`
(+ optional team adds)**. The membership is **dormant** — it exists immediately,
but the person can do nothing until they magic-link in (which now works, because
the user row exists).

- No changes to the security-critical magic-link path; reuses `org.js` as-is; no
  realize hook; no new table.
- **"Pending" is derived for display** — a member with no `central_sessions`
  history = "invited, not joined yet".
- An invited user exists in `users` before first login — identical to what the
  operator's own `/admin/users` flow already does, so it is not a new system
  property.

(Rejected: Approach B — a `pending_invitations` table plus a login/verify-path
realize hook. Same UX, but more code and it touches the auth-critical path.)

### Deliberately deferred (YAGNI)

- **Team deletion** — `team_id` keys live board/survey data in poker & retro;
  deleting a team in the hub would orphan app content. Defer until there's a
  defined cross-app cleanup story.
- **Team `lead`/`member` role toggle** — team leads have no console power
  (owners+admins manage all), and the apps use *self-declared* roles, so the hub
  team-role is currently unused metadata. Team membership is just add/remove.

## Permissions & guards

New middleware `requireCompanyRole(allowedRoles)` (a factory, like
`createRequireSession`):

- Loads the company by `:slug`. Not found → **404**.
- Looks up `req.user`'s `company_members` row for that company. Not a member, or
  role not in `allowedRoles` → **403** (renders the existing `error` view).
- On success, attaches `req.company` and `req.companyRole`.

All `/company/:slug/*` routes use `requireSession` → `requireCompanyRole(["owner","admin"])`.

**Owner-protection rule** (enforced at the action level, not just the route):

- Only an **owner** may set a member's role to or from `owner`, or remove/demote
  an owner. An **admin** attempting any owner-targeting action → **403**.
- `org.js` already enforces the **last-owner invariant** (cannot demote/remove the
  final owner). The route catches that and shows a friendly message, never a 500.

Permission matrix:

| Actor          | Manage teams | Manage members | Manage owners |
|----------------|:------------:|:--------------:|:-------------:|
| Company owner  | ✓            | ✓              | ✓             |
| Company admin  | ✓            | ✓ (non-owner)  | ✗ (403)       |
| Member / team lead | ✗ (no console access) | ✗ | ✗ |

## Views & UX

Plain server-rendered Eta + HTML forms (matches the existing operator admin — no
client framework). PRG pattern (POST → redirect back) so refreshes don't
re-submit. Minimal styling — reuse the operator admin's stylesheet.

**`/company/:slug` — console home:**
- Header with the company name + a **"← Back to dashboard"** link.
- **Members** section: a table of email · role · status
  ("Active" / "Invited — not joined yet"). Per-row controls (role dropdown,
  remove) gated by the viewer's role and the owner-protection rule. An
  **"Invite member"** form (email + role select).
- **Teams** section: list of teams (each links to its team page) + a
  **"Create team"** form.

**`/company/:slug/teams/:teamId` — team page:**
- Team name (+ a rename form) and a back link to the console.
- Team members table (email + remove). An **"Add to team"** picker limited to
  existing company members (matches the `org.js` invariant that team membership
  requires company membership).

## Error handling

- **Validation:** bad email → re-render with an inline error (or 400). Unknown
  slug → 404. Permission failure → 403.
- **Invariant/org errors:** wrap `org.js` mutator calls; known invariant
  violations (last owner, duplicate member, team-membership-requires-company) →
  friendly flash message, not a stack trace.
- **Audit:** every mutation logs via the existing `lib/audit.js`
  (`company_member_invited`, `company_member_role_changed`,
  `company_member_removed`, `team_created`, `team_renamed`, `team_member_added`,
  `team_member_removed`) with actor `req.user.id`, so they appear in the
  operator's existing `/admin/audit` view.

## Testing

Mirrors the existing hub harness: **`node:test` + supertest**, `buildTestApp`
with an in-memory DB.

- **`org.test.js` additions** (unit): `listCompanyMembers` / `listTeamMembers`
  shapes including `hasLoggedIn`; `renameTeam`; `inviteCompanyMember` (creates
  user + membership when email absent; adds membership for an existing user;
  returns `alreadyMember: true` and does NOT throw or change role when the user is
  already a member).
- **`company.test.js`** (new, route/integration via supertest):
  - owner can invite, change roles, create teams, manage team members;
  - admin can do member/team ops **but** is 403 on owner-targeting actions;
  - a plain member / non-member → 403; unknown slug → 404;
  - last-owner demote/remove → friendly error, not 500;
  - **cross-company isolation:** owner of company A gets 403/404 on company B's URLs;
  - invite of an unknown email creates a dormant user + membership; that user can
    then be magic-linked in (membership already live).
- Keep the suite green (currently hub 94/94) with the new tests added on top.

## Deployment

Hub-internal change — ships with the next `suite-hub` restart. No migration, no
app redeploy. Follow the IONOS deploy conventions and step-by-step shell rules at
deploy time. Rollback = checkout the prior hub SHA + restart (new routes/views are
purely additive; no data is altered).
