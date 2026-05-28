# Sprintraid, Clerk Integration Trigger

> **For:** Claude Code CLI
> **App:** Sprintraid
> **Order:** 1st of 4 (start here, smallest blast radius)
> **Estimated time:** 2-4 hours including verification

This is the integration trigger for Sprintraid. It supplies app-specific values, then defers to the master spec at `../docs/CLAUDE.md` for the actual implementation.

---

## 1. App-Specific Values

These values override and supplement the generic ones in `CLAUDE.md`.

| Variable | Value |
|---|---|
| **App name** | `sprintraid` |
| **App directory** | `/var/www/raid` |
| **Live domain** | `sprintraid.uk` |
| **Node port** | `3004` |
| **PM2 process name** | `sprintraid` |
| **Apache vhost file** | `/etc/apache2/sites-available/sprintraid.uk.conf` |
| **OIDC redirect URI** | `https://sprintraid.uk/auth/callback` |
| **Clerk application name in dashboard** | `sprintraid` |

---

## 2. The `.env` File Contents

Create `/var/www/raid/.env` with these exact values. Replace `<from-clerk-dashboard>` with the keys the user provides from the Clerk dashboard.

```bash
# /var/www/raid/.env
CLERK_PUBLISHABLE_KEY=<from-clerk-dashboard>
CLERK_SECRET_KEY=<from-clerk-dashboard>
CLERK_JWT_ISSUER=https://clerk.sprintsuite.uk
CLERK_JWKS_URL=https://clerk.sprintsuite.uk/.well-known/jwks.json
APP_NAME=sprintraid
APP_BASE_URL=https://sprintraid.uk
SESSION_COOKIE_NAME=__sprintsuite_session
NODE_ENV=production
PORT=3004
```

**Stop and ask the user** for the Clerk keys if they have not been provided. Do not proceed without them.

**Important:** `SESSION_COOKIE_NAME` is intentionally identical across all four apps (`__sprintsuite_session`). This enables cross-app session sharing via the parent cookie domain.

---

## 3. The Apache Vhost

Expected content for `/etc/apache2/sites-available/sprintraid.uk.conf`:

```apache
<VirtualHost *:80>
    ServerName sprintraid.uk
    ServerAlias www.sprintraid.uk
    Redirect permanent / https://sprintraid.uk/
</VirtualHost>

<VirtualHost *:443>
    ServerName sprintraid.uk
    ServerAlias www.sprintraid.uk

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/sprintraid.uk/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/sprintraid.uk/privkey.pem

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3004/
    ProxyPassReverse / http://127.0.0.1:3004/

    # Forward client IP for logging
    RemoteIPHeader X-Forwarded-For

    ErrorLog ${APACHE_LOG_DIR}/sprintraid.error.log
    CustomLog ${APACHE_LOG_DIR}/sprintraid.access.log combined
</VirtualHost>
```

**Before overwriting the existing vhost:**

1. Back it up: `sudo cp /etc/apache2/sites-available/sprintraid.uk.conf /etc/apache2/sites-available/sprintraid.uk.conf.pre-clerk`
2. Compare the existing config with the above. If the existing config has custom directives (rewrite rules, security headers, etc.), **preserve them**. The proxy lines and SSL config are the only mandatory additions/changes.
3. Validate before reload: `sudo apachectl configtest`

---

## 4. PM2 Start Command

```bash
cd /var/www/raid
pm2 start server.js --name sprintraid --update-env
pm2 save
```

If `server.js` does not exist or has a different name, **stop and ask the user** what the entry point is. Do not guess.

---

## 5. Execution Order

Follow `../docs/CLAUDE.md` in order, but with this app's values substituted. Specifically:

1. **CLAUDE.md Section 2** (Pre-flight checks), run for `/var/www/raid`
2. **CLAUDE.md Section 3** (Repository layout), confirm or create the `auth/` directory in `/var/www/raid`
3. **CLAUDE.md Section 4** (Environment variables), use the `.env` from Section 2 of this document
4. **CLAUDE.md Section 5** (Dependencies), run `npm install` in `/var/www/raid`
5. **CLAUDE.md Section 6** (Implementation), create the three auth modules in `/var/www/raid/auth/`
6. **CLAUDE.md Section 7** (Apache config), use the vhost from Section 3 of this document
7. **CLAUDE.md Section 8** (PM2), use the command from Section 4 of this document
8. **Skip CLAUDE.md Section 9** (Clerk dashboard setup), the user does this manually
9. **CLAUDE.md Section 10** (Verification), run the full checklist for this app

---

## 6. Pre-Integration Safety Net

Before changing **anything** in `/var/www/raid`:

```bash
cd /var/www/raid

# Confirm we're on the baseline tag
git tag | grep pre-clerk-baseline || { echo "FAIL: pre-clerk-baseline tag missing"; exit 1; }

# Create a working branch for this integration
git checkout -b clerk-integration

# Confirm clean working tree
git status
```

All work happens on the `clerk-integration` branch. The `pre-clerk-baseline` tag stays untouched, so rollback is one command.

---

## 7. App-Specific Verification

In addition to the generic verification in CLAUDE.md Section 10, verify these Sprintraid-specific items:

- [ ] `curl -I https://sprintraid.uk` returns 200 (logged in) or 302 to `accounts.sprintsuite.uk` (logged out)
- [ ] `curl -I http://127.0.0.1:3004/health` returns 200 from the VM itself
- [ ] `pm2 logs sprintraid --lines 20` shows clean startup, no auth errors
- [ ] Apache error log `/var/log/apache2/sprintraid.error.log` shows no proxy errors after first request
- [ ] Visiting `sprintraid.uk` in a fresh incognito window redirects to `accounts.sprintsuite.uk`
- [ ] After logging in via Clerk, the redirect lands back on `sprintraid.uk` correctly
- [ ] `req.auth.userId` is populated in any test route that requires auth
- [ ] **Existing Sprintraid functionality still works** after auth is added (this is critical, do not just verify auth, verify the app itself)

---

## 8. Rollback Trigger Points

Roll back to `pre-clerk-baseline` immediately if any of the following occur:

- The site returns 502/503/504 for more than 5 minutes
- Login produces an infinite redirect loop
- Existing Sprintraid features stop working (raid log, item creation, etc.)
- Apache fails `configtest` after the vhost change

Rollback command:

```bash
# Stop the new process
pm2 stop sprintraid
pm2 delete sprintraid

# Restore vhost
sudo cp /etc/apache2/sites-available/sprintraid.uk.conf.pre-clerk /etc/apache2/sites-available/sprintraid.uk.conf
sudo apachectl configtest && sudo systemctl reload apache2

# Revert code
cd /var/www/raid
git checkout main 2>/dev/null || git checkout master
git reset --hard pre-clerk-baseline
```

Full rollback procedures: `../docs/ROLLBACK.md`

---

## 9. Soak Period

After Sprintraid integration completes successfully, **do not immediately move on to the next app**. Soak Sprintraid for **24-48 hours**:

- Monitor `pm2 logs sprintraid` for warnings
- Check `/var/log/apache2/sprintraid.error.log` daily
- Run `sudo /var/www/sprintsuite/scripts/healthcheck.sh` morning and evening
- Test the SSO flow yourself at least once per day

Only after a clean soak should integration on Sprintsignal (next app) begin.

---

## 10. Reporting Back

After completing the integration, report:

1. **Files created or modified**, with full paths
2. **Verification results**, each item from Section 7 with a pass/fail
3. **Any deviations** from the spec and why
4. **Confirmation** that existing Sprintraid functionality still works
5. **Recommended next step**, soak period start, or rollback if issues

---

**End of Sprintraid integration trigger.** Refer to `../docs/CLAUDE.md` for implementation details.
