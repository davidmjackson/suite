#!/usr/bin/env bash
# scripts/setup-env.sh
# One-shot helper that turns ~/suite-app-keys.txt into /var/www/suite/hub/.env.
# Run from the IONOS box during initial deploy:
#   bash /var/www/suite/hub/scripts/setup-env.sh
set -euo pipefail

KEYS_FILE="$HOME/suite-app-keys.txt"
TARGET="/var/www/suite/hub/.env"

if [ ! -f "$KEYS_FILE" ]; then
  echo "ERROR: $KEYS_FILE not found." >&2
  echo "Generate it first with:" >&2
  echo "  umask 077 && for label in RAID SIGNAL RETRO POKER COOKIE; do echo \"\${label}: \$(openssl rand -hex 32)\"; done | tee ~/suite-app-keys.txt" >&2
  exit 1
fi

# Parse "LABEL: value" lines into shell variables RAID, SIGNAL, RETRO, POKER, COOKIE.
eval "$(awk -F': ' '/^(RAID|SIGNAL|RETRO|POKER|COOKIE): /{print $1"="$2}' "$KEYS_FILE")"

for v in RAID SIGNAL RETRO POKER COOKIE; do
  if [ -z "${!v:-}" ]; then
    echo "ERROR: $v not found in $KEYS_FILE" >&2
    exit 1
  fi
done

echo "Parsed 5 keys from $KEYS_FILE. Writing $TARGET ..."

sudo tee "$TARGET" >/dev/null <<EOF
PORT=3004
NODE_ENV=production
BASE_URL=https://sprintsuite.uk

DB_PATH=./data/suite.db

# Replace this placeholder once you've verified the Resend domain.
RESEND_API_KEY=re_placeholder_replace_after_resend_setup
FROM_EMAIL=login@sprintsuite.uk

HUB_API_KEY_RAID=$RAID
HUB_API_KEY_SIGNAL=$SIGNAL
HUB_API_KEY_RETRO=$RETRO
HUB_API_KEY_POKER=$POKER

COOKIE_SECRET=$COOKIE

ALLOWED_APP_DOMAINS=https://sprintraid.uk,https://sprintsignal.uk,https://sprintretro.uk,https://sprintpoker.uk
EOF

sudo chown "$USER:suite-hub" "$TARGET"
sudo chmod 640 "$TARGET"

echo
echo "Wrote $TARGET:"
sudo wc -l "$TARGET"
ls -la "$TARGET"
echo
echo "Next: replace RESEND_API_KEY placeholder once Resend domain is verified."
