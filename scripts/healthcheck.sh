#!/bin/bash
# Sprint Suite, Health Check
# Usage: sudo /var/www/suite/scripts/healthcheck.sh

echo "=== Sprint Suite Health Check ==="
echo "Time: $(date)"
echo ""

# HTTP status per site
echo "--- Site reachability ---"
for site in sprintpoker.uk sprintretro.uk sprintsignal.uk sprintraid.uk; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 https://$site)
  if [ "$code" = "200" ] || [ "$code" = "302" ]; then
    echo "  ✓ $site → $code"
  else
    echo "  ✗ $site → $code"
  fi
done

# Auth domain
echo ""
echo "--- Auth subdomain ---"
code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 https://accounts.sprintsuite.uk)
if [ "$code" = "200" ] || [ "$code" = "302" ]; then
  echo "  ✓ accounts.sprintsuite.uk → $code"
else
  echo "  ✗ accounts.sprintsuite.uk → $code (not yet configured?)"
fi

# Node processes
echo ""
echo "--- Node processes (pm2) ---"
if command -v pm2 >/dev/null 2>&1; then
  pm2 list 2>/dev/null
else
  echo "  pm2 not installed yet"
fi

# Apache
echo ""
echo "--- Apache status ---"
systemctl is-active apache2

# Clerk reachability
echo ""
echo "--- External dependencies ---"
curl -s -o /dev/null -w "  Clerk API: %{http_code}\n" -m 5 https://api.clerk.com
