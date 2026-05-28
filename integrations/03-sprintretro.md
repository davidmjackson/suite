# Sprintretro, Clerk Integration Trigger

> **For:** Claude Code CLI
> **App:** Sprintretro
> **Order:** 3rd of 4
> **Prerequisite:** Sprintraid and Sprintsignal both integrated and soaked
> **Estimated time:** 1-2 hours

This is the integration trigger for Sprintretro. It supplies app-specific values, then defers to the master spec at `../docs/CLAUDE.md`.

---

## 1. App-Specific Values

| Variable | Value |
|---|---|
| **App name** | `sprintretro` |
| **App directory** | `/var/www/retrospective` |
| **Live domain** | `sprintretro.uk` |
| **Node port** | `3002` |
| **PM2 process name** | `sprintretro` |
| **Apache vhost file** | `/etc/apache2/sites-available/sprintretro.uk.conf` |
| **OIDC redirect URI** | `https://sprintretro.uk/auth/callback` |
| **Clerk application name in dashboard** | `sprintretro` |

**Note:** The directory name is `retrospective`, but the app, domain, and process name use `sprintretro`. Do not get confused by the mismatch.

---

## 2. The `.env` File Contents

Create `/var/www/retrospective/.env`:

```bash
# /var/www/retrospective/.env
CLERK_PUBLISHABLE_KEY=<from-clerk-dashboard-sprintretro-app>
CLERK_SECRET_KEY=<from-clerk-dashboard-sprintretro-app>
CLERK_JWT_ISSUER=https://clerk.sprintsuite.uk
CLERK_JWKS_URL=https://clerk.sprintsuite.uk/.well-known/jwks.json
APP_NAME=sprintretro
APP_BASE_URL=https://sprintretro.uk
SESSION_COOKIE_NAME=__sprintsuite_session
NODE_ENV=production
PORT=3002
```

**`SESSION_COOKIE_NAME` matches the other apps**, do not change it.

---

## 3. The Apache Vhost

`/etc/apache2/sites-available/sprintretro.uk.conf`:

```apache
<VirtualHost *:80>
    ServerName sprintretro.uk
    ServerAlias www.sprintretro.uk
    Redirect permanent / https://sprintretro.uk/
</VirtualHost>

<VirtualHost *:443>
    ServerName sprintretro.uk
    ServerAlias www.sprintretro.uk

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/sprintretro.uk/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/sprintretro.uk/privkey.pem

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3002/
    ProxyPassReverse / http://127.0.0.1:3002/

    RemoteIPHeader X-Forwarded-For

    ErrorLog ${APACHE_LOG_DIR}/sprintretro.error.log
    CustomLog ${APACHE_LOG_DIR}/sprintretro.access.log combined
</VirtualHost>
```

Back up first:

```bash
sudo cp /etc/apache2/sites-available/sprintretro.uk.conf /etc/apache2/sites-available/sprintretro.uk.conf.pre-clerk
```

---

## 4. PM2 Start Command

```bash
cd /var/www/retrospective
pm2 start server.js --name sprintretro --update-env
pm2 save
```

**Note the directory/name asymmetry**, run from `/var/www/retrospective` but name the process `sprintretro`.

If entry point differs from `server.js`, **stop and ask the user**.

---

## 5. Execution Order

Follow `../docs/CLAUDE.md` Sections 2-8 (skip 9), then Section 10 verification.

---

## 6. Pre-Integration Safety Net

```bash
cd /var/www/retrospective

git tag | grep pre-clerk-baseline || { echo "FAIL: pre-clerk-baseline tag missing"; exit 1; }
git checkout -b clerk-integration
git status
```

---

## 7. App-Specific Verification

- [ ] `curl -I https://sprintretro.uk` returns 200 or 302
- [ ] `curl -I http://127.0.0.1:3002/health` returns 200 locally
- [ ] `pm2 logs sprintretro --lines 20` shows clean startup
- [ ] Visiting `sprintretro.uk` in incognito redirects to `accounts.sprintsuite.uk`
- [ ] **3-way SSO test:** Sign into Sprintraid, then navigate to Sprintsignal (no re-login), then navigate to Sprintretro (no re-login). All three apps share session.
- [ ] **Existing Sprintretro functionality still works**

### Retrospective-Specific Concern

Retrospective apps often have **real-time features** (live board updates, WebSocket connections, voting in progress). If Sprintretro uses WebSockets or Server-Sent Events:

- Confirm Apache vhost includes WebSocket proxy directives if needed:
  ```apache
  ProxyPass /ws ws://127.0.0.1:3002/ws
  ProxyPassReverse /ws ws://127.0.0.1:3002/ws
  ```
- Confirm the auth middleware does not block WebSocket upgrade requests
- Test with two browser windows that an in-progress retro still syncs after auth integration

**If WebSockets are not in use**, ignore this section.

---

## 8. Rollback Trigger Points

```bash
pm2 stop sprintretro && pm2 delete sprintretro
sudo cp /etc/apache2/sites-available/sprintretro.uk.conf.pre-clerk /etc/apache2/sites-available/sprintretro.uk.conf
sudo apachectl configtest && sudo systemctl reload apache2
cd /var/www/retrospective
git checkout main 2>/dev/null || git checkout master
git reset --hard pre-clerk-baseline
```

Full procedures: `../docs/ROLLBACK.md`.

---

## 9. Soak Period

Soak for **24 hours** before integrating the final app (Sprintpoker).

---

## 10. Reporting Back

Report:

1. **Files created or modified**, with full paths
2. **Verification results**, including the 3-way SSO test
3. **WebSocket handling** if applicable, did real-time features need adjustment?
4. **Deviations** from spec and why
5. **Confirmation** existing Sprintretro functionality still works
6. **Recommended next step**

---

**End of Sprintretro integration trigger.**
