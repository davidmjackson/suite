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
  if printf '%s' "$body" | grep -qF -- "$2"; then
    printf '  ok         %s\n' "$3"
  else
    printf '  FAIL       %s\n' "$3"
    fails=$((fails + 1))
  fi
}

header () { # url  header-name  expected-value  description
  # EXACT match, not a substring. "strict-origin" is a substring of the weaker
  # bare Referrer-Policy, and "sha256-" matches a STALE hash — both would pass a
  # needle check while prod served something worse than the repo says.
  local got
  got=$(curl -s -o /dev/null -D - "$1" | grep -i "^$2:" | sed "s/^[^:]*: *//" | tr -d '\r')
  if [ "$got" = "$3" ]; then
    printf '  ok         %s\n' "$4"
  else
    printf '  FAIL       %s\n' "$4"
    printf '             want: %s\n' "$3"
    printf '             got:  %s\n' "${got:-<no $2 header at all>}"
    fails=$((fails + 1))
  fi
}

echo "hub:"
check "$BASE/"       200 "landing page"
check "$BASE/login"  200 "sign-in"
# The only externally-probeable evidence that no-store is live: requireSession
# sets the header before it reads the cookie, so the signed-out 302 to /login
# carries it. Everything else this control covers is behind a session.
header "$BASE/dashboard" Cache-Control "no-store" "authenticated route is not stored"
check "$BASE/sitemap.xml" 200 "sitemap is served"
contains "$BASE/sitemap.xml" "<loc>$BASE/</loc>" "sitemap URLs carry THIS host"
# The host in robots.txt is the one fact about the sitemap no unit test can check:
# the suite runs as https://test, so an equality check there could only pass on a
# robots.txt that was wrong in production. Interpolating $BASE is what makes it
# checkable, and it is only checkable from out here. Deleting this leaves the
# static Sitemap: line in hub/public/robots.txt unguarded — see tests/sitemap.test.js.
contains "$BASE/robots.txt" "Sitemap: $BASE/sitemap.xml" "robots.txt points at the sitemap on this host"
check "$BASE/no-such-page-xyz" 404 "unknown path is a 404"
contains "$BASE/no-such-page-xyz" "Page not found" "404 renders the hub page, not the framework default"

echo "sprintsight promo (Apache alias — NOT served by the hub):"
check "$BASE/sprintsight-coming-soon/intro/"              200 "the page the landing tile links to"
check "$BASE/sprintsight-coming-soon/intro/sight.css"     200 "page stylesheet"
check "$BASE/sprintsight-coming-soon/intro/sight.js"      200 "page behaviour"
check "$BASE/sprintsight-coming-soon/intro/sight-og.png"  200 "OG card"
# three-passes infographic SVGs — bare filenames served by THIS alias, NOT
# /illos/ (which the hub serves). If they 404, the pipeline shows broken images.
check "$BASE/sprintsight-coming-soon/intro/pass-01-retrieval.svg"      200 "three-passes illo 01"
check "$BASE/sprintsight-coming-soon/intro/pass-02-reconciliation.svg" 200 "three-passes illo 02"
check "$BASE/sprintsight-coming-soon/intro/pass-03-report-writer.svg"  200 "three-passes illo 03"
# and the page must actually reference them, or SVGs ship but the section didn't
contains "$BASE/sprintsight-coming-soon/intro/" 'src="pass-01-retrieval.svg"' "pipeline references the illustrations"
# the parent must NOT be aliased: it would serve a directory listing
check "$BASE/sprintsight-coming-soon/"                    404 "parent path does not list the directory"

echo "promo page security headers (vhost <Directory> block — ZAP 2026-08-25):"
# The expected values are READ FROM THE VHOST MIRROR beside this script, never
# copied into it. That is the whole question this check answers: is the live
# server serving what the repo says it should? A hardcoded copy here would be a
# fourth place to drift, and it would go green against a stale prod.
P="$BASE/sprintsight-coming-soon/intro/"
VHOST="$(dirname "$0")/apache/sprintsuite.uk.conf"
if [ ! -r "$VHOST" ]; then
  echo "  FAIL       cannot read $VHOST — run this from the repo checkout"
  fails=$((fails + 1))
else
  expected=0
  while IFS='|' read -r name value; do
    [ -z "$name" ] && continue
    expected=$((expected + 1))
    header "$P" "$name" "$value" "$name"
  done <<EOF
$(sed -n 's/^[[:space:]]*Header always set \([^[:space:]]*\) "\(.*\)"[[:space:]]*$/\1|\2/p' "$VHOST")
EOF
  if [ "$expected" -eq 0 ]; then
    echo "  FAIL       no 'Header always set' lines found in $VHOST — nothing was checked"
    fails=$((fails + 1))
  fi
  # assets under the alias inherit the block too — ZAP flagged these individually
  header "${P}sight.css" X-Content-Type-Options "nosniff" "assets inherit the headers"
fi

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
