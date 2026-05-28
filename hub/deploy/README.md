# Deploying the Sprint Suite hub to sprintsuite.uk (IONOS, Apache, systemd, Let's Encrypt)

One-time setup on the IONOS box. Subsequent deploys are `git pull && sudo systemctl restart suite-hub`.

The hub follows the same pattern as raid/scrumpoker/signal/retrospective:
**you** own the code under `/var/www/suite`, the system user `suite-hub` only
reads it (plus a small `ReadWritePaths` carve-out for the SQLite DB and logs).

## Prerequisites

- Apache 2.4+ with `proxy`, `proxy_http`, `headers`, `ssl`, `rewrite` modules enabled:
  ```bash
  sudo a2enmod proxy proxy_http headers ssl rewrite
  ```
- Node.js 20+ (`node --version`) — needed for `--env-file` flag and Express 5.
- `certbot` (`sudo apt install certbot python3-certbot-apache`).
- DNS for `sprintsuite.uk` and `www.sprintsuite.uk` already pointing at this box.
- A Resend account with API key; domain verification done separately (step 4).

## 1. Create the service user

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin suite-hub
```

## 2. Clone the repo and install

The repo is private. Use the **SSH URL** to match the rest of the suite — the
IONOS box already has an SSH key registered with GitHub, so no extra credential
setup is needed.

```bash
# As yourself, NOT sudo — sudo runs as root and root doesn't have your SSH key.
cd ~
git clone git@github.com:davidmjackson/suite.git
cd suite
git checkout feat/auth-hub   # until this merges to main

# /var/www/suite already exists (empty). Replace it with the clone:
sudo rmdir /var/www/suite                    # only succeeds if truly empty
sudo mv ~/suite /var/www/suite
sudo chown -R $USER:suite-hub /var/www/suite # you own files, suite-hub is the group
sudo chmod -R g+rX /var/www/suite            # group can read + enter dirs

cd /var/www/suite/hub
npm install --omit=dev
```

If the IONOS box doesn't have SSH set up for GitHub yet, fall back to
HTTPS with a credential helper:

```bash
git config --global credential.helper store
gh auth login                              # if gh is installed
# OR enter a Personal Access Token when prompted on the first pull
```

Avoid `sudo git clone` either way — root has no GitHub auth.

## 3. Create the `.env` file

Generate strong secrets first (one 32-byte hex string per `HUB_API_KEY_*`
plus `COOKIE_SECRET` — five separate values):

```bash
# Run this 5 times, paste each result into the appropriate slot below.
openssl rand -hex 32
```

```bash
# Owned by you (so you can edit), readable by suite-hub, nobody else.
sudo touch /var/www/suite/hub/.env
sudo chown $USER:suite-hub /var/www/suite/hub/.env
sudo chmod 640 /var/www/suite/hub/.env
sudo tee /var/www/suite/hub/.env >/dev/null <<'EOF'
# Server
PORT=3004
NODE_ENV=production
BASE_URL=https://sprintsuite.uk

# DB
DB_PATH=./data/suite.db

# Email — set RESEND_API_KEY after step 4
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FROM_EMAIL=login@sprintsuite.uk

# Per-app API keys (each must match the app's own HUB_API_KEY env)
HUB_API_KEY_RAID=paste-32-byte-hex
HUB_API_KEY_SIGNAL=paste-32-byte-hex
HUB_API_KEY_RETRO=paste-32-byte-hex
HUB_API_KEY_POKER=paste-32-byte-hex

# Cookie secret (reserved for v2, but required by config validator)
COOKIE_SECRET=paste-32-byte-hex

# Allowed app domains (used to validate return_to params)
ALLOWED_APP_DOMAINS=https://sprintraid.uk,https://sprintsignal.uk,https://sprintretro.uk,https://sprintpoker.uk
EOF
```

Keep a copy of the four `HUB_API_KEY_*` values somewhere safe — each app's
`.env` will need the matching value during Phase 3 wiring.

## 4. Set up Resend domain verification

1. Log in to https://resend.com → Domains → Add Domain → `sprintsuite.uk`.
2. Resend returns 3-4 TXT records (DKIM × 2, SPF, DMARC). At Ionos DNS, add each one exactly as shown.
3. Wait a few minutes, click Verify in Resend.
4. Create an API key and paste it into `/var/www/suite/hub/.env` as `RESEND_API_KEY`.

Record the records added in `/var/www/suite/infrastructure/README.md` for audit.

## 5. Install the systemd service

```bash
# data/ must be writable by suite-hub before first start.
sudo mkdir -p /var/www/suite/hub/data
sudo chown -R suite-hub:suite-hub /var/www/suite/hub/data

sudo cp /var/www/suite/hub/deploy/systemd/suite-hub.service /etc/systemd/system/suite-hub.service
sudo systemctl daemon-reload
sudo systemctl enable suite-hub
sudo systemctl start suite-hub
sudo systemctl status suite-hub    # confirm it's active (running)
```

Smoke-test the Node app behind localhost before Apache is wired up:

```bash
curl -s http://127.0.0.1:3004/healthz
# Expected: {"ok":true}
```

## 6. Bootstrap your admin user

```bash
sudo -u suite-hub /usr/bin/node /var/www/suite/hub/scripts/create-admin.js you@yourdomain.example
```

## 7. Wire up Apache (HTTP first, then TLS)

```bash
sudo cp /var/www/suite/hub/deploy/apache/sprintsuite.conf /etc/apache2/sites-available/sprintsuite.conf
sudo a2ensite sprintsuite
sudo apache2ctl configtest
sudo systemctl reload apache2
```

Test it works over plain HTTP:

```bash
curl -s -H "Host: sprintsuite.uk" http://localhost/healthz
# Expected: {"ok":true}
```

## 8. Issue the TLS certificate

```bash
sudo certbot --apache -d sprintsuite.uk -d www.sprintsuite.uk
```

Pick "Redirect HTTP to HTTPS" when prompted. certbot will rewrite the vhost
in place (or create `sprintsuite-le-ssl.conf`).

## 9. Schedule pruning

The hub ships a prune script that removes expired sessions, expired
magic/launch tokens, and audit events older than 90 days.

```bash
( crontab -l 2>/dev/null; echo "*/5 * * * * cd /var/www/suite/hub && /usr/bin/node --env-file=.env scripts/prune.js >> /tmp/suite-hub-prune.log 2>&1" ) | crontab -
crontab -l | grep prune
```

Note: this cron runs as **your** user, which is fine for read-only reporting,
but the actual DELETE statements require write access to the sqlite DB. If
your user isn't in the `suite-hub` group, run the cron as the `suite-hub` user
via root crontab instead:

```bash
sudo crontab -e -u suite-hub
# Add: */5 * * * * cd /var/www/suite/hub && /usr/bin/node --env-file=.env scripts/prune.js >> /var/log/suite-hub-prune.log 2>&1
```

## 10. Verify end-to-end

Visit `https://sprintsuite.uk/`:

- Landing page renders, four tiles visible.
- Click "Sign in" → enter your admin email.
- Inbox: magic-link email arrives via Resend.
- Click the link → land on `/dashboard`.
- Bottom of dashboard: "Admin" link visible (because you bootstrapped admin in step 6).
- `/admin` shows your user; `/admin/sessions` shows your live session; `/admin/audit` shows the events emitted so far.

If any of those fail, see Troubleshooting below.

## Subsequent deploys

You own the code, `suite-hub` only reads it. Deploys are plain `git pull`
under your own login.

```bash
cd /var/www/suite
git pull                                          # your gh-authenticated git, no sudo
cd hub && npm install --omit=dev                  # only if package.json changed
sudo systemctl restart suite-hub
```

In-memory rate limiter and login bucket counts reset on restart — that's by
design. Central sessions live in sqlite and survive restarts.

## Troubleshooting

- `systemctl status suite-hub` — see startup errors.
- `journalctl -u suite-hub -n 100 --no-pager` — recent logs.
- `tail -f /var/log/apache2/sprintsuite-error.log` — Apache-side errors.
- 502 from Apache → check the Node service is up on `127.0.0.1:3004`.
- "Missing required env: X" on boot → `.env` file isn't being read; confirm
  `EnvironmentFile=` path in the systemd unit and that the file is readable
  by the `suite-hub` user.
- Magic-link email never arrives → check Resend dashboard for the send (it
  may have been rejected by SPF/DKIM if step 4 wasn't completed). Also check
  `journalctl -u suite-hub` for any Resend SDK errors.
- "Permission denied" writing to data/ → the directory must be owned by
  `suite-hub:suite-hub` (see step 5).
- `git pull` says "Permission denied" → the working tree is owned by
  `suite-hub`, not by you. Fix once:
  `sudo chown -R $USER:suite-hub /var/www/suite && sudo chmod -R g+rX /var/www/suite`.
- `git clone` prompts for username/password → the repo is private and you
  used the HTTPS URL. Use `git@github.com:...` instead, or run
  `git remote set-url origin git@github.com:davidmjackson/suite.git`.
