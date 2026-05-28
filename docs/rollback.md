# Sprint Suite, Rollback Plan

> **For:** Human operator + Claude Code CLI
> **Project:** Sprint suite centralised authentication
> **Purpose:** Get back to a working state if the Clerk integration breaks production

This document covers **what can go wrong**, **how to detect it fast**, and **how to roll back cleanly**. Read it before starting integration, not after something breaks.

---

## 1. Pre-Integration Safety Net

**Do these before Claude Code touches anything.**

### 1.1 Snapshot the VM

Ionos provides snapshot backups. Take one before integration starts.

1. Log in to Ionos Cloud Panel
2. Navigate to **Servers** → select the Sprint VM
3. **Snapshots** → **Create snapshot**
4. Name it: `pre-clerk-integration-YYYY-MM-DD`
5. Wait for completion (typically 5-15 minutes)

**Restore time if needed:** 10-20 minutes. This is your nuclear option.

### 1.2 Git Commit Each App

For each of the four app directories, commit current state.

```bash
cd /var/www/scrumpoker && git add -A && git commit -m "Pre-Clerk integration baseline"
cd /var/www/retrospective && git add -A && git commit -m "Pre-Clerk integration baseline"
cd /var/www/signal && git add -A && git commit -m "Pre-Clerk integration baseline"
cd /var/www/raid && git add -A && git commit -m "Pre-Clerk integration baseline"
```

If any app is **not under git**, initialise it now:

```bash
cd /var/www/<app>
git init
git add -A
git commit -m "Initial baseline before Clerk integration"
```

Also tag the baseline:

```bash
git tag pre-clerk-baseline
```

### 1.3 Backup Apache Config

```bash
sudo cp -r /etc/apache2/sites-available /etc/apache2/sites-available.backup-$(date +%Y%m%d)
sudo cp -r /etc/apache2/sites-enabled /etc/apache2/sites-enabled.backup-$(date +%Y%m%d)
```

### 1.4 Document Current State

Run and save the output:

```bash
# Save baseline state to home directory
{
  echo "=== Apache status ==="
  sudo systemctl status apache2 --no-pager
  echo ""
  echo "=== Apache vhosts ==="
  sudo apachectl -S
  echo ""
  echo "=== Listening ports ==="
  sudo ss -tlnp
  echo ""
  echo "=== Disk usage ==="
  df -h
  echo ""
  echo "=== Running Node processes ==="
  ps aux | grep -i node
} > ~/baseline-state-$(date +%Y%m%d).txt
```

Keep this file. It's your reference for "what working looked like."

### 1.5 Verify Each Site Works

Before changing anything, confirm all four sites currently load:

```bash
for site in sprintpoker.uk sprintretro.uk sprintsignal.uk sprintraid.uk; do
  echo -n "$site: "
  curl -s -o /dev/null -w "%{http_code}\n" https://$site
done
```

Expected: `200` for all four. If anything is broken **before** integration, fix that first.

---

## 2. Detection, How to Know Something's Wrong

### 2.1 Symptoms by Severity

| Severity | Symptom | Action |
|---|---|---|
| **Critical** | All four sites return 502/503/504 | Immediate rollback (Section 3.1) |
| **Critical** | All four sites time out | Immediate rollback (Section 3.1) |
| **High** | One app down, three working | Partial rollback (Section 3.2) |
| **High** | Login redirects loop infinitely | Fix or partial rollback (Section 3.2) |
| **Medium** | Login works but session doesn't persist | Diagnose first (Section 4) |
| **Medium** | SSO works for 3 of 4 apps | Diagnose first (Section 4) |
| **Low** | Magic link emails delayed | No rollback, fix Clerk config |
| **Low** | Styling broken on hosted login UI | No rollback, fix Clerk branding |

### 2.2 Quick Health Check Script

Save this as `/root/healthcheck.sh` and make executable:

```bash
#!/bin/bash
# /root/healthcheck.sh

echo "=== Sprint Suite Health Check ==="
echo "Time: $(date)"
echo ""

# HTTP status per site
for site in sprintpoker.uk sprintretro.uk sprintsignal.uk sprintraid.uk; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 https://$site)
  if [ "$code" = "200" ] || [ "$code" = "302" ]; then
    echo "✓ $site → $code"
  else
    echo "✗ $site → $code"
  fi
done

echo ""
echo "=== Node processes (pm2) ==="
pm2 list 2>/dev/null || echo "pm2 not running"

echo ""
echo "=== Apache status ==="
systemctl is-active apache2

echo ""
echo "=== Clerk reachability ==="
curl -s -o /dev/null -w "Clerk API: %{http_code}\n" https://api.clerk.com
curl -s -o /dev/null -w "auth.sprintsuite.uk: %{http_code}\n" https://auth.sprintsuite.uk
```

```bash
chmod +x /root/healthcheck.sh
```

Run it any time you suspect a problem: `sudo /root/healthcheck.sh`

---

## 3. Rollback Procedures

### 3.1 Full Rollback (All Four Apps Broken)

**When to use:** Multiple apps down, time pressure, integration is clearly broken.

**Estimated downtime:** 5-10 minutes.

#### Step 1: Stop the Node Processes

```bash
pm2 stop all
pm2 delete all
```

#### Step 2: Restore Apache Config

```bash
sudo rm -rf /etc/apache2/sites-available /etc/apache2/sites-enabled
sudo cp -r /etc/apache2/sites-available.backup-YYYYMMDD /etc/apache2/sites-available
sudo cp -r /etc/apache2/sites-enabled.backup-YYYYMMDD /etc/apache2/sites-enabled
sudo apachectl configtest
sudo systemctl restart apache2
```

#### Step 3: Revert App Code

For each app:

```bash
cd /var/www/scrumpoker && git reset --hard pre-clerk-baseline
cd /var/www/retrospective && git reset --hard pre-clerk-baseline
cd /var/www/signal && git reset --hard pre-clerk-baseline
cd /var/www/raid && git reset --hard pre-clerk-baseline
```

#### Step 4: Verify

```bash
sudo /root/healthcheck.sh
```

All four sites should return 200/302.

#### Step 5: If That Didn't Work, Restore VM Snapshot

This is the nuclear option:

1. Ionos panel → Server → Snapshots
2. Select `pre-clerk-integration-YYYY-MM-DD`
3. **Restore**
4. Wait 10-20 minutes
5. VM comes back exactly as it was

---

### 3.2 Partial Rollback (One App Broken)

**When to use:** Three apps fine, one broken. Don't take everything down.

**Example:** Sprintretro is broken, the other three are fine.

#### Step 1: Stop That App's Node Process

```bash
pm2 stop sprintretro
```

#### Step 2: Revert That App's Code

```bash
cd /var/www/retrospective
git reset --hard pre-clerk-baseline
```

#### Step 3: Restore That Vhost Config

```bash
sudo cp /etc/apache2/sites-available.backup-YYYYMMDD/sprintretro.uk.conf /etc/apache2/sites-available/sprintretro.uk.conf
sudo systemctl reload apache2
```

#### Step 4: Verify

```bash
curl -I https://sprintretro.uk
```

Should return 200/302. The other three apps remain on the new integration.

---

### 3.3 Emergency Bypass (Disable Auth Without Reverting)

**When to use:** You want to keep the Clerk integration code in place but temporarily let users in without auth, for example to debug a separate production issue.

In each app's `server.js`, comment out the middleware temporarily:

```javascript
// app.use(requireAuth);  // BYPASSED, see incident ticket #XXX
```

Restart that app:

```bash
pm2 restart <app-name>
```

**Warning:** This exposes the app fully. Use only briefly and with a clear plan to re-enable. Log the bypass start time and re-enable as soon as the unrelated issue is resolved.

---

## 4. Diagnostic Procedures Before Rolling Back

Sometimes the right move is to **fix forward**, not roll back. Here are the most common issues and quick diagnostics.

### 4.1 "Infinite Redirect Loop"

**Symptom:** Visiting any app bounces between app → `auth.sprintsuite.uk` → app → `auth.sprintsuite.uk`.

**Likely cause:** JWT cookie domain mismatch. The cookie is being set for `auth.sprintsuite.uk` but apps expect it on `sprintpoker.uk` etc.

**Diagnose:**

```bash
# Check what cookies are being set
curl -I -c - https://auth.sprintsuite.uk
```

**Fix:** In Clerk dashboard → Sessions → ensure **cookie domain** is set to `.sprintsuite.uk` (with leading dot, so subdomains share).

### 4.2 "JWT Validation Fails"

**Symptom:** Logs show `JWT validation failed: signature verification failed`.

**Likely cause:** JWKS cache stale, or wrong issuer URL.

**Diagnose:**

```bash
# Verify the JWKS endpoint responds correctly
curl https://auth.sprintsuite.uk/.well-known/jwks.json | jq .
```

If that returns 404, the custom domain isn't fully configured. If it returns JSON, the issue is in app config.

**Fix:** Confirm `CLERK_JWT_ISSUER` in each `.env` exactly matches `https://auth.sprintsuite.uk` (no trailing slash). Restart apps:

```bash
pm2 restart all
```

### 4.3 "Sessions Don't Carry Across Apps"

**Symptom:** Login to Poker works, but Retro asks for login again.

**Likely cause:** Cookies not shared across subdomains (subdomain cookies vs apex cookies issue).

**Diagnose:**

```bash
# Check cookie attributes
curl -I -c cookies.txt https://sprintpoker.uk/anything
cat cookies.txt
```

Look at the `Domain` attribute. Should be `.sprintsuite.uk`, not `sprintpoker.uk`.

**Fix:** In Clerk dashboard → Sessions → set cookie domain to `.sprintsuite.uk`.

### 4.4 "Node Process Keeps Crashing"

**Symptom:** `pm2 list` shows the app in `errored` state with restart count climbing.

**Diagnose:**

```bash
pm2 logs <app-name> --lines 100
```

Look for the actual stack trace. Common causes:
- Missing env var (check `.env` file exists and is loaded)
- Port already in use (check `sudo ss -tlnp`)
- Wrong Node version (check `node --version`, needs 18+)

**Fix:** Address the root cause. If can't fix in 15 minutes, partial rollback (Section 3.2).

### 4.5 "Apache 502 Bad Gateway"

**Symptom:** Browser shows 502.

**Likely cause:** Apache can't reach the Node process on the expected port.

**Diagnose:**

```bash
# Is Node actually listening?
sudo ss -tlnp | grep -E '3001|3002|3003|3004'

# Apache error log
sudo tail -50 /var/log/apache2/error.log
```

**Fix:** If Node isn't running, `pm2 restart <app>`. If port mismatch, fix the Apache vhost config to match the actual Node port.

---

## 5. Communication Plan

If the integration breaks **after** launch (users present), follow this sequence:

1. **First minute:** Run `/root/healthcheck.sh`, confirm scope (one app vs all)
2. **First 5 minutes:** Decide rollback vs fix-forward based on Section 2.1 severity table
3. **First 10 minutes:** Execute the rollback
4. **First 15 minutes:** Post a status notice on any user-facing channel (X/Twitter, status page if you have one, in-app banner if possible)
5. **Post-incident:** Write a brief incident note covering what broke, what was done, and what to change next time

For a brand-new product with no users yet, only step 1-3 apply. **You can be more aggressive about rolling back since there's no user impact.**

---

## 6. Post-Rollback Checklist

After rolling back, before re-attempting:

- [ ] All four sites return 200/302 in healthcheck
- [ ] User sessions on the live sites (if any) are working
- [ ] You understand **what broke** (don't try again without knowing why)
- [ ] You've documented the failure in writing for next attempt
- [ ] You've checked Clerk dashboard for any error logs on their side
- [ ] You've decided what to do differently next attempt (more incremental? one app at a time?)

---

## 7. Recommended: Stage the Rollout

Rather than integrating all four apps at once, **integrate one app, soak it for 24-48 hours, then do the next.** This naturally limits blast radius.

Suggested order:

1. **Sprintraid** first, smallest user-facing surface area, lowest risk
2. **Sprintsignal** next
3. **Sprintretro** third
4. **Sprintpoker** last, likely the most user-facing one

Each stage has a clean rollback window because the other apps are still on their original code.

---

## 8. When to Call for Help

If you've tried the rollback procedures and the VM is still broken:

1. **Ionos support** for VM-level issues (snapshot restore, network problems)
2. **Clerk support** at https://clerk.com/support for IdP-side issues
3. **DNS issues** at Ionos DNS panel, or use https://dnschecker.org for diagnostics

Have ready:
- Snapshot ID (if VM restore needed)
- Clerk instance ID (visible in dashboard)
- Approximate time the issue started
- Output of `/root/healthcheck.sh`

---

**End of rollback plan.** Read this before starting, keep it open during integration.
