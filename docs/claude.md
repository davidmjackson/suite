# Sprint Suite, Centralised Authentication Integration

> **For:** Claude Code CLI
> **Project:** Sprint suite (Sprintpoker, Sprintretro, Sprintsignal, Sprintraid)
> **Goal:** Replace any existing auth with a centralised Clerk-based identity layer using OIDC, passkeys, and SSO across all four apps.

---

## 1. Context

### Environment

- **Host:** Single Ionos Ubuntu VM
- **Web server:** Apache 2.4 (virtual hosts per app)
- **Runtime:** Node.js (apps are plain JS + light Node)
- **App paths on VM:**
  - `/var/www/scrumpoker` → `https://sprintpoker.uk`
  - `/var/www/retrospective` → `https://sprintretro.uk`
  - `/var/www/signal` → `https://sprintsignal.uk`
  - `/var/www/raid` → `https://sprintraid.uk`
- **Dev environment:** WSL mirror of the above paths
- **User base:** Zero users today (greenfield on auth)

### Identity Provider

- **Provider:** Clerk (managed SaaS)
- **Auth subdomain:** `accounts.sprintsuite.uk` (custom domain pointed at Clerk)
- **Methods enabled:** Passkeys (primary), Google SSO, Microsoft SSO, magic link (email fallback)
- **No passwords**

### Architectural Principles

- Apps remain autonomous for domain data (rooms, boards, signals, raid logs)
- All four apps share one Clerk instance, registered as separate applications
- Apps validate JWTs **locally** using JWKS, no per-request calls to Clerk
- Sessions are SSO across the suite, log in once at `accounts.sprintsuite.uk`, access all four apps

---

## 2. Pre-flight Checks

Run these before touching code.

```bash
# Confirm Node version (Clerk SDK needs Node 18+)
node --version

# Confirm app directories exist and are writable
ls -la /var/www/scrumpoker /var/www/retrospective /var/www/signal /var/www/raid

# Confirm Apache is serving each vhost
sudo apachectl -S | grep sprint

# Confirm we can reach the public internet (Clerk API)
curl -I https://api.clerk.com
```

**Stop and report** if any of these fail. Do not proceed.

---

## 3. Repository Layout

For each of the four apps, the integration follows the same pattern. Treat each app directory as an independent Node project. If `package.json` does not exist in an app, initialise it first.

```
/var/www/<app>/
├── package.json
├── server.js                    # Existing entry point (or create)
├── auth/
│   ├── clerk-middleware.js      # NEW, JWT validation middleware
│   ├── jwks-cache.js            # NEW, cached JWKS lookups
│   └── config.js                # NEW, env-loaded Clerk config
├── public/
│   └── ...                      # Existing frontend assets
└── .env                         # NEW, never commit this
```

---

## 4. Environment Variables

Create a `.env` file in each app directory. Values come from the Clerk dashboard once the four applications are registered.

```bash
# /var/www/<app>/.env
CLERK_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxx
CLERK_SECRET_KEY=sk_live_xxxxxxxxxxxxx
CLERK_JWT_ISSUER=https://clerk.sprintsuite.uk
CLERK_JWKS_URL=https://clerk.sprintsuite.uk/.well-known/jwks.json
APP_NAME=sprintpoker            # Change per app
APP_BASE_URL=https://sprintpoker.uk
SESSION_COOKIE_NAME=__sprint_session
NODE_ENV=production
```

**Critical:** Add `.env` to `.gitignore` in every app. If a `.gitignore` does not exist, create it.

```
# .gitignore
.env
node_modules/
*.log
```

---

## 5. Dependencies

For each app, install:

```bash
cd /var/www/<app>
npm install @clerk/clerk-sdk-node express cookie-parser dotenv jose
```

**Package roles:**
- `@clerk/clerk-sdk-node`, official Clerk SDK
- `express`, HTTP routing (use if app is plain HTTP, skip if already using a framework)
- `cookie-parser`, parse session cookies
- `dotenv`, load `.env` at startup
- `jose`, JWT/JWKS verification (used as fallback if SDK falls short)

---

## 6. Implementation, Per App

### 6.1 Config Module

Create `/var/www/<app>/auth/config.js`:

```javascript
require('dotenv').config();

const required = [
  'CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'CLERK_JWT_ISSUER',
  'CLERK_JWKS_URL',
  'APP_BASE_URL'
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

module.exports = {
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  secretKey: process.env.CLERK_SECRET_KEY,
  jwtIssuer: process.env.CLERK_JWT_ISSUER,
  jwksUrl: process.env.CLERK_JWKS_URL,
  appBaseUrl: process.env.APP_BASE_URL,
  sessionCookieName: process.env.SESSION_COOKIE_NAME || '__sprint_session',
  appName: process.env.APP_NAME
};
```

### 6.2 JWKS Cache

Create `/var/www/<app>/auth/jwks-cache.js`:

```javascript
const { createRemoteJWKSet } = require('jose');
const config = require('./config');

// Cached JWKS, refreshes automatically every 10 minutes
const jwks = createRemoteJWKSet(new URL(config.jwksUrl), {
  cacheMaxAge: 600000,        // 10 minutes
  cooldownDuration: 30000     // 30 seconds between refresh attempts on failure
});

module.exports = jwks;
```

### 6.3 Middleware

Create `/var/www/<app>/auth/clerk-middleware.js`:

```javascript
const { jwtVerify } = require('jose');
const jwks = require('./jwks-cache');
const config = require('./config');

async function requireAuth(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return redirectToLogin(req, res);
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.jwtIssuer
    });

    req.auth = {
      userId: payload.sub,
      sessionId: payload.sid,
      email: payload.email,
      orgId: payload.org_id || null
    };

    return next();
  } catch (err) {
    console.warn('JWT validation failed:', err.message);
    return redirectToLogin(req, res);
  }
}

function extractToken(req) {
  // 1. Bearer header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // 2. Session cookie
  return req.cookies?.[config.sessionCookieName] || null;
}

function redirectToLogin(req, res) {
  const returnTo = encodeURIComponent(`${config.appBaseUrl}${req.originalUrl}`);
  const loginUrl = `${config.jwtIssuer}/sign-in?redirect_url=${returnTo}`;
  return res.redirect(302, loginUrl);
}

module.exports = { requireAuth };
```

### 6.4 Wire Into the App

In `server.js` (or whatever the app entry point is), add:

```javascript
const express = require('express');
const cookieParser = require('cookie-parser');
const { requireAuth } = require('./auth/clerk-middleware');

const app = express();
app.use(cookieParser());

// Public routes (landing page, health checks)
app.get('/health', (req, res) => res.json({ ok: true }));

// Everything below requires auth
app.use(requireAuth);

// Existing app routes go here
// ...

app.listen(process.env.PORT || 3000);
```

**If the app is currently served as static files by Apache** (not via Node), this section needs adapting. In that case, run Apache as a reverse proxy in front of a Node process per app. Confirm before changing Apache config.

---

## 7. Apache Configuration

Each vhost should reverse-proxy to the Node process for that app. Example for Sprintpoker:

```apache
# /etc/apache2/sites-available/sprintpoker.uk.conf
<VirtualHost *:443>
    ServerName sprintpoker.uk

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/sprintpoker.uk/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/sprintpoker.uk/privkey.pem

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3001/
    ProxyPassReverse / http://127.0.0.1:3001/

    # Pass cookies through
    ProxyPassReverseCookieDomain 127.0.0.1 sprintpoker.uk
</VirtualHost>
```

**Port assignments:**
- Sprintpoker → `3001`
- Sprintretro → `3002`
- Sprintsignal → `3003`
- Sprintraid → `3004`

Reload Apache: `sudo systemctl reload apache2`

---

## 8. Process Management

Use `pm2` to keep the four Node processes alive:

```bash
sudo npm install -g pm2

# Start each app
pm2 start /var/www/scrumpoker/server.js --name sprintpoker -- --port 3001
pm2 start /var/www/retrospective/server.js --name sprintretro -- --port 3002
pm2 start /var/www/signal/server.js --name sprintsignal -- --port 3003
pm2 start /var/www/raid/server.js --name sprintraid -- --port 3004

# Persist across reboots
pm2 startup
pm2 save
```

---

## 9. Clerk Dashboard Setup

These steps happen in the Clerk dashboard, not in code. Do them before running the integration end-to-end.

1. Create a new Clerk instance, name it `sprint-suite`
2. Under **Domains**, add the custom domain `accounts.sprintsuite.uk` and follow Clerk's DNS instructions (CNAME records)
3. Under **Applications**, register four applications:
   - `sprintpoker` with redirect URI `https://sprintpoker.uk/auth/callback`
   - `sprintretro` with redirect URI `https://sprintretro.uk/auth/callback`
   - `sprintsignal` with redirect URI `https://sprintsignal.uk/auth/callback`
   - `sprintraid` with redirect URI `https://sprintraid.uk/auth/callback`
4. Under **User & Authentication**:
   - Enable **Passkeys**
   - Enable **Email magic link**
   - Enable **Google** OAuth
   - Enable **Microsoft** OAuth
   - **Disable password** authentication
5. Under **Sessions**, set:
   - Access token lifetime: 15 minutes
   - Inactivity timeout: 7 days
6. Copy publishable and secret keys per app into the relevant `.env` files

---

## 10. Verification Checklist

After implementation, run through each item. Do not consider the work complete until all pass.

- [ ] `accounts.sprintsuite.uk` resolves and shows the Clerk-hosted login page
- [ ] Passkey registration works on a modern browser
- [ ] Google SSO completes the round-trip
- [ ] Microsoft SSO completes the round-trip
- [ ] Magic link email arrives within 30 seconds
- [ ] Visiting `sprintpoker.uk` while logged out redirects to `accounts.sprintsuite.uk`
- [ ] After login, the user lands back on the originally requested URL
- [ ] After logging into Poker, visiting Retro, Signal, and Raid does **not** require re-login
- [ ] Logout at any app clears the session across all four apps
- [ ] Each Node process restarts cleanly via `pm2 restart <name>`
- [ ] Apache logs show no proxy errors
- [ ] JWT validation works offline (kill internet briefly, existing sessions keep working until token expiry)

---

## 11. Out of Scope (Do Not Do)

To stay focused, **do not** do any of the following in this pass:

- Building a custom login UI (use Clerk's hosted UI)
- Implementing password auth as a fallback
- Adding RBAC or fine-grained permissions
- Migrating any existing user data (there is none)
- Touching app domain logic (poker rooms, retro boards, etc.)
- Setting up Better Auth or any self-hosted IdP

---

## 12. Reporting Back

After each phase, report:

1. **What was changed**, with file paths
2. **What was verified**, with the command output
3. **Any deviations** from this document and why
4. **Blockers** that need human decisions

If anything in this document is ambiguous, **stop and ask** before improvising.

---

## 13. Reference Links

- Clerk Node SDK: https://www.npmjs.com/package/@clerk/clerk-sdk-node
- Clerk OIDC docs: https://clerk.com/docs/backend-requests/handling/manual-jwt
- JOSE library: https://github.com/panva/jose
- PM2 docs: https://pm2.keymetrics.io/docs/usage/quick-start/
- Apache reverse proxy: https://httpd.apache.org/docs/2.4/mod/mod_proxy.html

---

**End of document.** Begin with Section 2 (Pre-flight Checks).
