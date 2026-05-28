# Clerk Dashboard Setup Runbook

> **For:** Human operator (you)
> **Project:** Sprint suite centralised authentication
> **Time required:** 45-60 minutes
> **Prerequisites:** DNS access to `sprintsuite.uk` domain, Google Cloud Console access, Microsoft Azure access

This runbook walks through every click in the Clerk dashboard. Do this **before** Claude Code runs Section 4 of `CLAUDE.md`, because the integration needs the keys produced here.

---

## Stage 1, Account Creation

### 1.1 Sign Up

1. Go to **https://dashboard.clerk.com/sign-up**
2. Sign up using your own Google or Microsoft account (use a business account if you have one, easier to transfer ownership later)
3. Verify the email if prompted

**You should see:** The Clerk dashboard home screen with a "Create application" prompt.

---

## Stage 2, Create the Instance

### 2.1 Create Application

1. Click **Create application** (top right or centre, depending on layout)
2. **Application name:** `Sprint Suite`
3. **Sign-in options screen appears.** Configure as follows:

   **Enable these:**
   - Email address (toggle ON)
   - Google (toggle ON)
   - Microsoft (toggle ON)
   - Passkey (toggle ON)

   **Disable these:**
   - Password (toggle OFF) ← important
   - Phone number (toggle OFF, unless you want SMS)
   - Username (toggle OFF)
   - All other social providers (toggle OFF for now)

4. Click **Create application**

**You should see:** A dashboard for the new `Sprint Suite` application with API keys visible.

### 2.2 Note the Default Keys (Development)

The dashboard shows two keys by default:

- **Publishable key**, starts with `pk_test_...`
- **Secret key**, starts with `sk_test_...`

**These are development keys.** Do not put them in production `.env` files. Production keys come later in Stage 5.

---

## Stage 3, Configure Authentication Methods

### 3.1 Passkeys

1. Left sidebar → **User & authentication** → **Email, phone, username**
2. Confirm **Passkey** is enabled
3. Under **Passkey settings**, set:
   - **Allow sign-up via passkey:** ON
   - **Require passkey for sign-in:** OFF (leave optional, so users can also use SSO/magic link)

### 3.2 Email Magic Link

1. Same screen → **Email address** section
2. **Verification methods:** Select **Email verification link** (this is the magic link)
3. Disable **Email verification code** (one method is cleaner)

### 3.3 Google OAuth

1. Left sidebar → **User & authentication** → **Social connections**
2. Click **Google** → toggle ON
3. Clerk offers two modes:
   - **Use Clerk's shared credentials** (fastest, fine for development)
   - **Use custom credentials** (required for production, do this)
4. Choose **custom credentials** and you'll see fields for **Client ID** and **Client Secret**

**To create the Google credentials:**

1. Open https://console.cloud.google.com/ in a new tab
2. Create a new project named `Sprint Suite Auth`
3. Navigate to **APIs & Services** → **OAuth consent screen**
4. Choose **External**, click Create
5. Fill in:
   - **App name:** Sprint Suite
   - **User support email:** your email
   - **Authorized domains:** `sprintsuite.uk`
   - **Developer contact:** your email
6. Save and continue through the scopes screen (no changes needed)
7. Navigate to **APIs & Services** → **Credentials**
8. **Create Credentials** → **OAuth client ID**
9. **Application type:** Web application
10. **Name:** Sprint Suite Clerk
11. **Authorized redirect URIs:** Paste the redirect URI Clerk shows on its Google config screen (it looks like `https://accounts.sprintsuite.uk/v1/oauth_callback`)
12. Save, copy the **Client ID** and **Client secret**
13. Back in Clerk, paste these into the Google connector form
14. Click **Save**

### 3.4 Microsoft OAuth

1. Back in Clerk → **Social connections** → **Microsoft** → toggle ON
2. Choose **custom credentials**
3. Open https://portal.azure.com in a new tab
4. Navigate to **Microsoft Entra ID** → **App registrations** → **New registration**
5. Fill in:
   - **Name:** Sprint Suite Auth
   - **Supported account types:** Accounts in any organizational directory and personal Microsoft accounts
   - **Redirect URI:** Web, paste the URI Clerk shows on its Microsoft config screen
6. Click Register
7. On the app's overview page, copy the **Application (client) ID**
8. Navigate to **Certificates & secrets** → **New client secret**
9. Description: `Clerk integration`, expiry: 24 months
10. Copy the secret **value** immediately (it's only shown once)
11. Back in Clerk, paste the Client ID and Client Secret
12. Click **Save**

---

## Stage 4, Custom Domain Setup

This makes login appear at `auth.sprintsuite.uk` instead of `sprint-suite.clerk.accounts.dev`.

### 4.1 Add Domain in Clerk

1. Left sidebar → **Domains**
2. You'll see the default development domain (e.g. `sprint-suite-12345.clerk.accounts.dev`)
3. Click **Add production domain**
4. Enter: `sprintsuite.uk`
5. Click Continue

**You should see:** A list of DNS records Clerk wants you to add. There will be roughly 5-7 CNAME and TXT records.

### 4.2 Add DNS Records at Ionos

1. Log in to your Ionos control panel
2. Navigate to **Domains & SSL** → `sprintsuite.uk` → **DNS**
3. For each record Clerk listed, add it. Typical records:

   | Type | Host | Points to |
   |---|---|---|
   | CNAME | `clerk` | `frontend-api.clerk.services` |
   | CNAME | `accounts` | `accounts.clerk.services` |
   | CNAME | `clk._domainkey` | `dkim1.<your-clerk-id>.clerk.services` |
   | CNAME | `clk2._domainkey` | `dkim2.<your-clerk-id>.clerk.services` |
   | CNAME | `clkmail` | `mail.<your-clerk-id>.clerk.services` |

   **Copy exact values from your Clerk dashboard**, the above is illustrative.

4. Set TTL to 3600 (1 hour) or default
5. Save changes

### 4.3 Wait and Verify

1. DNS propagation: **5 minutes to 2 hours**, usually fast
2. Back in Clerk → **Domains**, click **Verify**
3. When all records show green checkmarks, Clerk will automatically provision SSL certificates for the subdomains
4. **Test:** Visit `https://accounts.sprintsuite.uk` in a browser. You should see Clerk's sign-in page branded with your app name.

### 4.4 Configure Custom Auth Subdomain

By default Clerk uses `accounts.sprintsuite.uk`. To use `auth.sprintsuite.uk` instead:

1. In **Domains** settings, find **Frontend API host**
2. Change `accounts.sprintsuite.uk` → `auth.sprintsuite.uk`
3. Add an additional CNAME at Ionos: `auth` → `accounts.clerk.services`
4. Wait for verification

**Test:** `https://auth.sprintsuite.uk` shows the Clerk sign-in page.

---

## Stage 5, Production Keys

### 5.1 Generate Production Keys

1. Top of dashboard, there's an environment toggle: **Development | Production**
2. Switch to **Production**
3. Clerk will create a fresh set of keys for the production environment
4. You'll see new keys:
   - **Publishable key**, starts with `pk_live_...`
   - **Secret key**, starts with `sk_live_...`

### 5.2 Copy Keys for `.env` Files

These are the same four `.env` files for all four apps (same Clerk instance, same keys). Copy:

```bash
CLERK_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxx
CLERK_SECRET_KEY=sk_live_xxxxxxxxxxxxx
CLERK_JWT_ISSUER=https://auth.sprintsuite.uk
CLERK_JWKS_URL=https://auth.sprintsuite.uk/.well-known/jwks.json
```

**Save the secret key somewhere safe.** Clerk will show it once. If you lose it, you have to rotate.

---

## Stage 6, Session Configuration

1. Left sidebar → **Sessions**
2. Set:
   - **Session token lifetime:** 15 minutes (short = better security)
   - **Inactivity timeout:** 7 days
   - **Maximum session lifetime:** 30 days
3. **Multi-session handling:** Enable, so users can be logged in on multiple devices
4. Click Save

---

## Stage 7, Redirect URLs

This tells Clerk where users should land after authenticating.

1. Left sidebar → **Paths**
2. Configure:
   - **Sign-in URL:** `/sign-in`
   - **Sign-up URL:** `/sign-up`
   - **After sign-in URL:** Leave as `{{redirect_url}}` (Clerk handles dynamic redirects)
   - **After sign-up URL:** `{{redirect_url}}`
   - **After sign-out URL:** `https://sprintsuite.uk` (or wherever your marketing site lives)

3. Add allowed redirect origins (otherwise Clerk blocks redirects to your apps):
   - `https://sprintpoker.uk`
   - `https://sprintretro.uk`
   - `https://sprintsignal.uk`
   - `https://sprintraid.uk`

4. Save

---

## Stage 8, Email Branding

Magic-link emails should look like they come from Sprint, not Clerk.

1. Left sidebar → **Customization** → **Emails**
2. Set:
   - **From name:** `Sprint`
   - **From email:** `noreply@sprintsuite.uk` (Clerk handles DKIM via the DNS records you added earlier)
   - **Reply-to:** `support@sprintsuite.uk` (or your support address)
3. Optionally customise the email template colours and logo to match Sprint branding
4. Send a test email to yourself to verify

---

## Stage 9, Hosted UI Branding

The sign-in page at `auth.sprintsuite.uk` should also look like Sprint.

1. Left sidebar → **Customization** → **Account Portal** / **Components**
2. Upload Sprint logo (square, 256x256 PNG recommended)
3. Set brand colour to match Sprint's visual identity
4. Preview the sign-in page

---

## Stage 10, Final Verification

Before handing the keys to Claude Code, verify:

- [ ] `https://auth.sprintsuite.uk` shows the Sprint-branded sign-in page
- [ ] Passkey option appears on the sign-in page
- [ ] Google button appears and clicking it opens Google's consent screen
- [ ] Microsoft button appears and clicking it opens Microsoft's login
- [ ] Magic link option appears
- [ ] No password field visible
- [ ] Production keys (`pk_live_...`, `sk_live_...`) copied somewhere safe
- [ ] Allowed redirect origins include all four `.uk` domains
- [ ] Test sign-up with your own email works end-to-end

When all ten items pass, **you're ready for Claude Code to run Section 4 of `CLAUDE.md`.**

---

## Common Issues

**"Domain verification stuck on pending"**

DNS propagation can take up to 2 hours. Use https://dnschecker.org to see if records have propagated globally. If still stuck after 4 hours, double-check the record values, the most common cause is a typo or trailing dot.

**"Google sign-in returns 'redirect_uri_mismatch'"**

The redirect URI in Google Cloud Console must **exactly** match what Clerk shows. Including `https://` and no trailing slash. Re-copy from Clerk.

**"Magic link email goes to spam"**

The DKIM CNAME records (`clk._domainkey`, `clk2._domainkey`) handle this. If they're not verified, emails will be flagged. Re-check those records at Ionos.

**"Lost the production secret key"**

Go to **API Keys** → **Rotate**. Generate a new pair. Update all four `.env` files with the new key. Restart all four Node processes via `pm2 restart all`.

---

**End of runbook.**
