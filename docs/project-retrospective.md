# Sprint Suite, Project Retrospective

> **Status:** Cancelled, 2026-05-28
> **Outcome:** Architectural blocker discovered after ~1 day of setup; reverted with zero application-code impact.
> **Audience:** Future Claude sessions assisting on similar multi-app auth architectures.

---

## TL;DR

Attempted to unify four hobby apps (`sprintraid.uk`, `sprintsignal.uk`, `sprintretro.uk`, `sprintpoker.uk`) under shared Clerk-hosted auth at `sprintsuite.uk`. Reached Stage 7 of the setup runbook before discovering Clerk's free tier doesn't support cross-TLD SSO — that requires the **Pro plan + Satellite Domains** at ~**£50/mo minimum** for four apps. Disproportionate for a one-user hobby project. Reverted cleanly: no application code was touched, only Clerk/Google/Azure/Ionos accounts.

The setup work itself was successful — every individual step worked. The failure was at the **architectural-feasibility-for-budget** layer, which should have been checked at Stage 0.

---

## 1. The project, briefly

| Element | Detail |
|---|---|
| Apps | 4 separate React/Node apps, each on its own `.uk` TLD |
| Goal | Single sign-on across all four; users log in once at a Clerk-hosted page |
| Plan | Use Clerk as identity provider, custom domain at `sprintsuite.uk`, integrate apps one-by-one (raid → signal → retro → poker) |
| Constraint (under-weighted at start) | Hobby project, one user, £0 ongoing budget |

---

## 2. What failed

**Cross-TLD session sharing.** Browser cookies cannot be set for arbitrary cross-TLD origins — that's a same-origin-policy boundary enforced by browsers, not a Clerk-specific limitation. The four apps living on four separate top-level domains meant cookie-based SSO was architecturally impossible without an upstream workaround.

Clerk's workaround is **Satellite Domains**: a paid Pro feature ($10/mo per satellite + ~$25/mo Pro base). For four satellites that's roughly **£50/mo minimum.** Other free-tier Pro-gated features compounded the issue:

- Custom session lifetimes (Stage 6 wanted 15-min tokens — locked at 7 days on free)
- Custom email "from" branding (Stage 8)
- Multi-session handling (Stage 6)
- Account Portal subdomain customization (`auth.` rename — Stage 4.4)
- Limited to 3 social providers (we needed 2, so this didn't bite, but was close)

---

## 3. Root cause

**Architectural assumption never validated against pricing.** The plan was written as if "use Clerk for auth" was free and feature-complete, when in reality the free tier supports a narrow architectural shape (single root domain + subdomains). The mismatch between the project's actual topology (4 TLDs) and the free tier's supported topology (1 root) was the entire failure.

This wasn't a build problem — every individual step we executed worked correctly. It was a **due-diligence-timing** problem: the cost gate should have been verified at Stage 0, not discovered at Stage 7.

---

## 4. Lessons for future projects

These are the generalisable patterns. Future Claude sessions should look for these triggers and flag them **before** any setup work begins.

### 4.1 Verify pricing/feature compatibility BEFORE setup

When a user describes any architecture that depends on a SaaS feature, Stage 0 must include: *"Is this feature available on the plan the user can afford?"* For auth specifically, the canonical questions are:

- How many top-level domains will share a session?
- How many social providers?
- Custom session lifetimes?
- Custom email branding?
- Multi-factor auth?
- Volume of monthly active users?

Each of these has a free-tier ceiling on **every** major provider (Clerk, Auth0, Supabase, Firebase Auth, Cognito). Check before recommending.

**Concrete trigger phrases that should prompt this check:**

- "Unify auth across [multiple domain names]"
- "Single sign-on between [app A] and [app B]"
- "I want users to log in once and access [N apps]"

When you see these, before any architectural recommendation: ask what budget the user has in mind for auth, and verify the proposed provider's free tier supports the topology.

### 4.2 Cross-TLD SSO is universally a paid feature

| Provider | Cross-TLD SSO feature | Free tier? |
|---|---|---|
| Clerk | Satellite Domains | ❌ Pro + per-satellite charge |
| Auth0 | Custom domains | ❌ Paid plan only |
| Supabase Auth | Multiple sites | ⚠️ Possible via cookieDomain hacks, fragile |
| Firebase Auth | Custom auth domain | ❌ Blaze plan + Identity Platform |
| AWS Cognito | Multiple app clients | ⚠️ Possible but token-passing required |

**The free path** for any provider is: put all apps under one root domain (`a.example.com`, `b.example.com`) and use standard cookie-domain sharing. If the user can't or won't restructure to that shape, the cost gate is real and unavoidable.

### 4.3 Plans drift from reality; verify hostnames empirically

The original spec called for a single hostname `auth.sprintsuite.uk` to handle everything. Reality on Clerk's actual product:

- `clerk.sprintsuite.uk` — Frontend API. JWT `iss` claim, JWKS, OAuth callbacks. Programmatic.
- `accounts.sprintsuite.uk` — Account Portal. User-facing hosted sign-in/sign-up.
- `auth.sprintsuite.uk` — **doesn't exist on standard plans**. Cannot be configured.

The naming was a planning placeholder that the user (and the doc author) assumed would be free to choose. Clerk hardcodes these conventions and they can't be renamed without paying for custom-branded Account Portal hosting.

**Verification technique used:**
```bash
curl -s https://clerk.sprintsuite.uk/.well-known/openid-configuration | jq .issuer
# → "https://clerk.sprintsuite.uk"  (the real value, regardless of what the plan said)
```

**Generalisation:** when a doc references a planned URL, verify the URL actually exists/works empirically (curl, dig, browser) before committing to it in env files, integration code, or downstream docs. Naming conventions in plans are often aspirational.

### 4.4 UI documentation goes stale within months

During this single day's work, the Clerk dashboard differed from the doc in at least 5 places:

| Doc said | Actually was |
|---|---|
| "Left sidebar → Domains" | Under **Configure** submenu |
| "Click Add production domain" | First need env toggle to Production; button only then appears |
| "Find Frontend API host, change to..." | Frontend API host is now read-only |
| "After sign-in URL: {{redirect_url}}" | Now called "After sign-in **fallback**", different semantics |
| Google Console: "OAuth consent screen → External" | Now gated behind 2FA setup + project-picker dropdown not visible by default |

**Generalisation:** UI walkthroughs in docs are write-once and rot quickly. When following a UI runbook, the doc's **intent** matters more than its **exact words**. Expect to translate "click X" into "find the page that lets you do Y". When the UI clearly differs, update the doc as you go — don't push through and leave the rot.

### 4.5 Vendor messaging can be actively misleading

Clerk's "Awaiting Deployment" spinner was a recurring pain point: it implied something was happening on Clerk's side (worth waiting for), when in fact the deployment was **awaiting user action** (adding DNS records on the right-hand collapsed panel). The user only found the panel by accident.

**Generalisation:** when a SaaS UI shows a long-running spinner with no progress indicator, *immediately* check if there's a collapsed/hidden panel, secondary tab, or expanded view requesting input. Don't assume the spinner reflects backend state alone.

### 4.6 Doc structure should match decision order, not execution order

The `clerk_setup.md` runbook was structured for clean execution (Stage 1 pre-flight → Stage 10 done). It lacked a Stage 0: "Is this architecture compatible with your plan?" Adding that single-page sanity check would have prevented a full day of wasted setup.

**Pattern to apply:** every multi-stage setup doc should open with a "go/no-go" section that enumerates:
1. The architectural assumptions (number of domains, scale, features needed)
2. The cost implications of each assumption
3. Explicit go/no-go on whether to proceed

If those assumptions don't match the user's reality, stop before Stage 1.

---

## 5. Specific gotchas worth remembering

Things that took time to figure out and would have been faster with prior knowledge:

| Gotcha | What we did | What to do next time |
|---|---|---|
| Google forcing 2FA setup before showing Cloud Console UI | Confused why "new project" option missing | Tell user upfront that fresh Google accounts will be 2FA-prompted; pause setup until completed |
| Clerk's "Use custom credentials" toggle hidden until you click into a specific social provider | Searched 3+ pages for it | Direct path: Social Connections → click provider → toggle in expanded panel |
| Clerk's OAuth redirect URI lives on Frontend API (`clerk.`), not Account Portal (`accounts.`) | Pasted wrong placeholder initially | The pattern: `https://clerk.<your-domain>/v1/oauth_callback` |
| Ionos collapses the DNS records panel by default | Spent 10 min thinking deployment was stuck | Look for "expand" or arrow on the right side of any Clerk page that mentions DNS |
| Google Cloud project shutdown button location varies; the OAuth client trash icon is more reliable | Tried 3 routes, none worked | Just delete the OAuth client in Credentials — leaves an empty inert project, which is fine |

---

## 6. What success would have looked like (the alternatives we identified, too late)

If the user wants unified auth on this same set of apps in future, here are the viable paths in order of cost:

### Option A: Subdomain restructure (free)

Apps move to: `raid.sprintsuite.uk`, `signal.sprintsuite.uk`, `retro.sprintsuite.uk`, `poker.sprintsuite.uk`. The four `.uk` brand domains become 301-redirects to the subdomain equivalents.

- ✅ Free with Clerk Hobby tier
- ✅ Cross-subdomain SSO works out of the box (shared cookie on `.sprintsuite.uk`)
- ✅ Brand `.uk` domains preserved as entry points
- ⚠️ URL bar shows subdomain when using app

This is what Clerk's free tier is designed for, and what we'd recommend if the project ever restarts.

### Option B: Pay for Pro + Satellites (~£50/mo)

Keep `.uk` TLDs as primary. Pay the cost. Cleanest URLs, no architectural change.

### Option C: Self-hosted auth (free, more code)

Lucia / Auth.js / custom JWT with shared signing key, deployed on each app, validates a common token format. No vendor lock-in. Requires writing/maintaining auth code.

### Option D: Per-app independent auth (free, no SSO)

Each app gets its own login. Users sign in separately on each. Defeats the unified-suite goal entirely but fine if SSO isn't actually load-bearing.

---

## 7. What was retained

| Artefact | Status |
|---|---|
| Application code at `/var/www/{raid,signal,retrospective,scrumpoker}/` | Untouched. `pre-clerk-baseline` git tags remain as harmless reference points. |
| `/var/www/suite/` umbrella repo | Retained locally + pushed to GitHub as a reference. Contains annotated docs and integration trigger files that would be ~80% reusable for Option A. |
| Clerk account / Sprint Suite application | Deleted. |
| Google OAuth client (Sprint Suite Clerk) | Deleted. Project shell remains, inert. |
| Azure App Registration (Sprint Suite Auth) | Deleted. |
| Ionos DNS CNAMEs for Clerk subdomains | Removed. Only original A records remain. |
| Memory entries | Saved: `project-sprint-suite` (cancelled), `reference-clerk-multi-tld-cost` (broader lesson). |

---

## 8. Time cost summary

| Stage | Approximate time invested |
|---|---|
| Workspace bootstrap (umbrella project, docs, git, tags on 4 apps) | 45 min |
| Clerk dashboard setup (signup, application, social providers, custom domain, prod instance) | 3 hours |
| DNS at Ionos (records, propagation waits, verification) | 1 hour |
| Discovery of cost gate + decision to cancel | 30 min |
| Revert (DNS, Clerk, Google, Azure, doc updates, push) | 30 min |
| **Total** | **~6 hours** |

The vast majority of that time would have been saved by a 10-minute pricing check at Stage 0.

---

## 9. Key takeaway for Claude

**Before recommending or executing any multi-app auth integration, the very first action should be confirming the proposed architecture is feasible on the user's budget.** Specifically: enumerate the domains, count them, identify TLDs vs subdomains, then check the auth provider's free tier supports that exact topology. If it doesn't, surface the cost trade-off *before* writing any setup doc or running any command.

The pattern is: **architectural decisions have pricing implications; pricing implications are decisions; therefore architectural decisions cannot precede a pricing review.**
