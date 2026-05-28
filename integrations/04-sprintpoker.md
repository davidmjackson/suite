# Sprintpoker, Clerk Integration Trigger

> **For:** Claude Code CLI
> **App:** Sprintpoker
> **Order:** 4th of 4 (last, highest visibility)
> **Prerequisite:** Sprintraid, Sprintsignal, and Sprintretro all integrated and soaked
> **Estimated time:** 1-2 hours

This is the integration trigger for Sprintpoker, the final app in the suite. It supplies app-specific values, then defers to the master spec at `../docs/CLAUDE.md`.

---

## 1. App-Specific Values

| Variable | Value |
|---|---|
| **App name** | `sprintpoker` |
| **App directory** | `/var/www/scrumpoker` |
| **Live domain** | `sprintpoker.uk` |
| **Node port** | `3001` |
| **PM2 process name** | `sprintpoker` |
| **Apache vhost file** | `/etc/apache2/sites-available/sprintpoker.uk.conf` |
| **OIDC redirect URI** | `https://sprintpoker.uk/auth/callback` |
| **Clerk application name in dashboard** | `sprintpoker` |

**Note:** The directory name is `scrumpoker`, but the app, domain, and process name use `sprintpoker`. This is the second mismatched case in the suite (Sprintretro is the other).

---

## 2. The `.env` File Contents

Create `/var/www/scrumpoker/.env`:

```bash
# /var/www/scrumpoker/.env
CLERK_PUBLISHABLE_KEY=<from-clerk-dashboard-sprintpoker-app>
CLERK_SECRET_KEY=<from-clerk-dashboard-sprintpoker-app>
CLERK_JWT_ISSUER=https://clerk.sprintsuite.uk
CLERK_JWKS_URL=https://clerk.sprintsuite.uk/.well-known/jwks.json
APP_NAME=sprintpoker
APP_BASE_URL=https://sprintpoker.uk
SESSION_COOKIE_NAME=__sprintsuite_session
NODE_ENV=production
PORT=3001
```

---

## 3. The Apache Vhost

`/etc/apache2/sites-available/sprintpoker.uk.conf`:

```apache
<VirtualHost *:80>
    ServerName sprintpoker.uk
    ServerAlias www.sprintpoker.uk
    Redirect permanent / https://sprintpoker.uk/
</VirtualHost>

<VirtualHost *:443>
    ServerName sprintpoker.uk
    ServerAlias www.sprintpoker.uk

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/sprintpoker.uk/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/sprintpoker.uk/privkey.pem

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3001/
    ProxyPassReverse / http://127.0.0.1:3001/

    RemoteIPHeader X-Forwarded-For

    ErrorLog ${APACHE_LOG_DIR}/sprintpoker.error.log
    CustomLog ${APACHE_LOG_DIR}/sprintpoker.access.log combined
</VirtualHost>
```

Back up first:

```bash
sudo cp /etc/apache2/sites-available/sprintpoker.uk.conf /etc/apache2/sites-available/sprintpoker.uk.conf.pre-clerk
```

---

## 4. PM2 Start Command

```bash
cd /var/www/scrumpoker
pm2 start server.js --name sprintpoker --update-env
pm2 save
```

**Note the directory/name asymmetry**, run from `/var/www/scrumpoker` but name the process `sprintpoker`.

---

## 5. Execution Order

Follow `../docs/CLAUDE.md` Sections 2-8 (skip 9), then Section 10 verification.

---

## 6. Pre-Integration Safety Net

```bash
cd /var/www/scrumpoker

git tag | grep pre-clerk-baseline || { echo "FAIL: pre-clerk-baseline tag missing"; exit 1; }
git checkout -b clerk-integration
git status
```

---

## 7. App-Specific Verification

- [ ] `curl -I https://sprintpoker.uk` returns 200 or 302
- [ ] `curl -I http://127.0.0.1:3001/health` returns 200 locally
- [ ] `pm2 logs sprintpoker --lines 20` shows clean startup
- [ ] Visiting `sprintpoker.uk` in incognito redirects to `accounts.sprintsuite.uk`
- [ ] **Full suite SSO test (4-way):** Sign into Sprintraid, then navigate in sequence to Sprintsignal, Sprintretro, Sprintpoker. All four apps share session, no re-login required at any step.
- [ ] **Existing Sprintpoker functionality still works** (room creation, vote casting, reveal, etc.)

### Planning Poker-Specific Concerns

Planning poker is **highly real-time**. Multiple users vote simultaneously and the reveal must be synchronised. If Sprintpoker uses WebSockets or polling:

- Confirm the auth middleware does not block WebSocket upgrades
- Test a full voting round with two browser windows after integration:
  1. Create a room in window A
  2. Join the same room in window B (as a different test user if possible)
  3. Cast votes from both
  4. Reveal
  5. Confirm both windows see the same result in real time
- If WebSocket auth needs special handling, the token must be passed in the connection query string or initial message, since browsers do not send cookies on WebSocket upgrades in all configurations

**Stop and ask the user** if real-time features break, this is a real problem and not something to work around blindly.

---

## 8. Final Suite Verification (After All 4 Apps Integrated)

This is the moment of truth. Beyond per-app verification, confirm the suite works as a whole:

### 8.1 Cross-App SSO Matrix

Run this in a fresh incognito window. After signing into the first app, navigate to the others **without closing the window**:

| Start at | → Navigate to | Expected |
|---|---|---|
| sprintpoker.uk | sprintretro.uk | Logged in, no prompt |
| sprintretro.uk | sprintsignal.uk | Logged in, no prompt |
| sprintsignal.uk | sprintraid.uk | Logged in, no prompt |
| sprintraid.uk | sprintpoker.uk | Logged in, no prompt |

All 12 combinations should work transparently.

### 8.2 Logout Cascade

1. Sign in to any app
2. Click logout
3. Verify: visiting any of the other three apps requires fresh login

If logout from one app does **not** invalidate sessions on others, Clerk's session revocation is not configured. Check Clerk dashboard → Sessions → confirm "Sign out everywhere on logout" or equivalent.

### 8.3 Token Refresh

Active sessions should silently refresh JWTs:

1. Sign in
2. Use the app normally for 20+ minutes (longer than the 15-minute access token lifetime)
3. Confirm the session continues without interruption

If the user gets bounced to login after 15 minutes, refresh token handling is broken.

### 8.4 Performance Sanity

```bash
# JWT validation should be fast (local JWKS cache)
time curl -I https://sprintpoker.uk
time curl -I https://sprintretro.uk
time curl -I https://sprintsignal.uk
time curl -I https://sprintraid.uk
```

Each should complete in under 200ms after the first warm-up request. If any are consistently above 500ms, JWKS caching is not working and apps are hitting Clerk on every request.

---

## 9. Rollback Trigger Points

```bash
pm2 stop sprintpoker && pm2 delete sprintpoker
sudo cp /etc/apache2/sites-available/sprintpoker.uk.conf.pre-clerk /etc/apache2/sites-available/sprintpoker.uk.conf
sudo apachectl configtest && sudo systemctl reload apache2
cd /var/www/scrumpoker
git checkout main 2>/dev/null || git checkout master
git reset --hard pre-clerk-baseline
```

Full procedures: `../docs/ROLLBACK.md`.

---

## 10. Post-Integration Tasks

Once all four apps are integrated and the suite-wide verification passes:

1. **Merge the clerk-integration branches.** In each app:
   ```bash
   cd /var/www/<app>
   git checkout main 2>/dev/null || git checkout master
   git merge clerk-integration
   git tag post-clerk-integration
   ```

2. **Take a new VM snapshot** named `post-clerk-integration-YYYY-MM-DD` via the Ionos panel. This is the new baseline.

3. **Update the umbrella README** at `/var/www/sprintsuite/README.md` to reflect that all four apps are now on centralised auth.

4. **Run `sudo /var/www/sprintsuite/scripts/healthcheck.sh`** and save the output as the post-integration baseline.

---

## 11. Reporting Back

Report:

1. **Files created or modified**, with full paths
2. **Verification results**, including:
   - Per-app checks (Section 7)
   - Suite-wide checks (Section 8): SSO matrix, logout cascade, token refresh, performance
3. **WebSocket handling** if applicable
4. **Deviations** from spec and why
5. **Confirmation** existing Sprintpoker functionality still works
6. **Post-integration tasks** completion status (Section 10)
7. **Suite status**, are all four apps fully integrated and working?

---

**End of Sprintpoker integration trigger. This completes the four-app rollout.**
