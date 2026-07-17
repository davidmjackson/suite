#!/usr/bin/env bash
# Post-deploy smoke check for sprintsuite.uk. Run ON PROD after any deploy that
# touches the vhost, the hub, or marketing/.
#
# This exists because the landing page's Sprintsight tile links to a page served
# by Apache, not by the hub. No unit test can see an Apache vhost, so a missing
# Alias ships green and the flagship tile lands on a 404. Only a real request
# against real prod can catch it.
#
#   bash infrastructure/smoke-sprintsuite.sh
set -uo pipefail

BASE="${1:-https://sprintsuite.uk}"
fails=0

check () { # url  expected-status  description
  local got
  got=$(curl -s -o /dev/null -w '%{http_code}' "$1")
  if [ "$got" = "$2" ]; then
    printf '  ok    %-3s  %s\n' "$got" "$3"
  else
    printf '  FAIL  %-3s (expected %s)  %s\n' "$got" "$2" "$3"
    fails=$((fails + 1))
  fi
}

contains () { # url  needle  description
  # Body captured first, NOT piped straight into grep -q. `grep -q` exits on the
  # first match and closes the pipe, curl dies of SIGPIPE, and `set -o pipefail`
  # reports that as a failure — a race that fails on large files and passes on
  # small ones. It cried wolf on instrument-core.css while prod was fine.
  local body
  body=$(curl -s "$1")
  if printf '%s' "$body" | grep -q -- "$2"; then
    printf '  ok         %s\n' "$3"
  else
    printf '  FAIL       %s\n' "$3"
    fails=$((fails + 1))
  fi
}

echo "hub:"
check "$BASE/"       200 "landing page"
check "$BASE/login"  200 "sign-in"

echo "sprintsight promo (Apache alias — NOT served by the hub):"
check "$BASE/sprintsight-coming-soon/intro/"              200 "the page the landing tile links to"
check "$BASE/sprintsight-coming-soon/intro/sight.css"     200 "page stylesheet"
check "$BASE/sprintsight-coming-soon/intro/sight.js"      200 "page behaviour"
check "$BASE/sprintsight-coming-soon/intro/sight-og.png"  200 "OG card"
# the parent must NOT be aliased: it would serve a directory listing
check "$BASE/sprintsight-coming-soon/"                    404 "parent path does not list the directory"

echo "shared assets (served by the HUB, consumed by the promo page):"
check "$BASE/css/instrument-core.css"          200 "theme stylesheet"
check "$BASE/illos/glyphs.svg"                 200 "glyph sprite"
check "$BASE/fonts/hanken-grotesk-400.woff2"   200 "a brand font"
# a stale copy renders the promo page colourless while everything returns 200
contains "$BASE/css/instrument-core.css" 'data-app="sight"' "theme carries the sight tokens"
contains "$BASE/illos/glyphs.svg"        'glyph-sight-sm'   "sprite carries the sight glyphs"

echo "the landing tile actually points at a live page:"
href=$(curl -s "$BASE/" | grep -o 'href="/sprintsight-coming-soon[^"]*"' | head -1 | sed 's/href="//; s/"$//')
if [ -z "$href" ]; then
  echo "  FAIL       no Sprintsight tile link found on the landing page"
  fails=$((fails + 1))
else
  check "$BASE$href" 200 "landing tile href resolves ($href)"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "all checks passed"
else
  echo "$fails check(s) FAILED"
  exit 1
fi
