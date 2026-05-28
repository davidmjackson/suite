# Sprintsignal, Clerk Integration Trigger

> **For:** Claude Code CLI
> **App:** Sprintsignal
> **Order:** 2nd of 4
> **Prerequisite:** Sprintraid integration complete and soaked 24-48 hours
> **Estimated time:** 1-2 hours (faster, since the pattern is now established)

This is the integration trigger for Sprintsignal. It supplies app-specific values, then defers to the master spec at `../docs/CLAUDE.md`.

---

## 1. App-Specific Values

| Variable | Value |
|---|---|
| **App name** | `sprintsignal` |
| **App directory** | `/var/www/signal` |
| **Live domain** | `sprintsignal.uk` |
| **Node port** | `3003` |
| **PM2 process name** | `sprintsignal` |
| **Apache vhost file** | `/etc/apache2/sites-available/sprintsignal.uk.conf` |
| **OIDC redirect URI** | `https://sprintsignal.uk/auth/callback` |
| **Clerk application name in dashboard** | `sprintsignal` |

---

## 2. The `.env` File Contents

Create `/var/www/signal/.env`:

```bash
# /var/www/signal/.env
CLERK_PUBLISHABLE_KEY=<from-clerk-dashboard-sprintsignal-app>
CLERK_SECRET_KEY=<from-clerk-dashboard-sprintsignal-app>
CLERK_JWT_ISSUER=https://auth.sprintsuite.uk
CLERK_JWKS_URL=https://auth.sprintsuite.uk/.well-known/jwks.json
APP_NAME=sprintsignal
APP_BASE_URL=https://sprintsignal.uk
SESSION_COOKIE_NAME=__sprintsuite_session
NODE_ENV=production
PORT=3003
```

**Stop and ask the user** for the Sprintsignal Clerk keys if not provided. Each app has its own publishable/secret key pair in Clerk.

**`SESSION_COOKIE_NAME` must match the value used in Sprintraid** (`__sprintsuite_session`). This is what enables cross-app SSO.

---

## 3. The Apache Vhost

`/etc/apache2/sites-available/sprintsignal.uk.conf`:

```apache
<VirtualHost *:80>
    ServerName sprintsignal.uk
    ServerAlias www.sprintsignal.uk
    Redirect permanent / https://sprintsignal.uk/
</VirtualHost>

<VirtualHost *:443>
    ServerName sprintsignal.uk
    ServerAlias www.sprintsignal.uk

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/sprintsignal.uk/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/sprintsignal.uk/privkey.pem

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3003/
    ProxyPassReverse / http://127.0.0.1:3003/

    RemoteIPHeader X-Forwarded-For

    ErrorLog ${APACHE_LOG_DIR}/sprintsignal.error.log
    CustomLog ${APACHE_LOG_DIR}/sprintsignal.access.log combined
</VirtualHost>
```

Back up the existing vhost first:

```bash
sudo cp /etc/apache2/sites-available/sprintsignal.uk.conf /etc/apache2/sites-available/sprintsignal.uk.conf.pre-clerk
```

Preserve any custom directives from the existing config.

---

## 4. PM2 Start Command

```bash
cd /var/www/signal
pm2 start server.js --name sprintsignal --update-env
pm2 save
```

If the entry point is not `server.js`, **stop and ask the user**.

---

## 5. Execution Order

Same as Sprintraid, follow `../docs/CLAUDE.md` Sections 2-8 (skip 9, Clerk dashboard is manual), then run Section 10 verification.

---

## 6. Pre-Integration Safety Net

```bash
cd /var/www/signal

git tag | grep pre-clerk-baseline || { echo "FAIL: pre-clerk-baseline tag missing"; exit 1; }
git checkout -b clerk-integration
git status
```

---

## 7. App-Specific Verification

Beyond the generic CLAUDE.md Section 10 checks:

- [ ] `curl -I https://sprintsignal.uk` returns 200 or 302
- [ ] `curl -I http://127.0.0.1:3003/health` returns 200 locally
- [ ] `pm2 logs sprintsignal --lines 20` shows clean startup
- [ ] Visiting `sprintsignal.uk` in incognito redirects to `auth.sprintsuite.uk`
- [ ] After login on Sprintraid, navigating directly to `sprintsignal.uk` does **not** require re-login (this is the SSO confirmation, the critical test for app 2+)
- [ ] **Existing Sprintsignal functionality still works**

### The Cross-App SSO Test (Critical)

This is the first integration where you can validate cross-app SSO. Test sequence:

1. Open a fresh incognito window
2. Visit `https://sprintraid.uk`, get redirected to login, sign in
3. Land back on Sprintraid, confirm logged in
4. **Without closing the window**, navigate to `https://sprintsignal.uk`
5. **Expected:** Land directly on Sprintsignal as the authenticated user, no second login required
6. **If a second login is required**, the cookie domain is wrong. Check Clerk dashboard → Sessions → cookie domain should be `.sprintsuite.uk` (with leading dot)

**Stop and ask for help** if SSO does not work. Do not proceed to the next two apps until this is fixed.

---

## 8. Rollback Trigger Points

Same as Sprintraid. If issues occur:

```bash
pm2 stop sprintsignal && pm2 delete sprintsignal
sudo cp /etc/apache2/sites-available/sprintsignal.uk.conf.pre-clerk /etc/apache2/sites-available/sprintsignal.uk.conf
sudo apachectl configtest && sudo systemctl reload apache2
cd /var/www/signal
git checkout main 2>/dev/null || git checkout master
git reset --hard pre-clerk-baseline
```

Full procedures: `../docs/ROLLBACK.md`.

---

## 9. Soak Period

After Sprintsignal integration completes, soak for **24 hours** (shorter than Sprintraid because the pattern is now proven). Monitor:

- `pm2 logs sprintsignal`
- `/var/log/apache2/sprintsignal.error.log`
- SSO flow between Sprintraid and Sprintsignal

Only then move to Sprintretro.

---

## 10. Reporting Back

Report:

1. **Files created or modified**, with full paths
2. **Verification results**, each item from Section 7 including the SSO test
3. **Deviations** from spec and why
4. **Confirmation** existing Sprintsignal functionality still works
5. **SSO test result**, pass/fail with details
6. **Recommended next step**

---

**End of Sprintsignal integration trigger.**
