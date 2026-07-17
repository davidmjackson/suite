#!/usr/bin/env bash
# Regenerate public/illos/sight-og.png from tools/sight-og.svg.
#
# Why this exists: the OG card is a committed binary, and a committed binary that
# nobody can rebuild is a trap. Run this after editing sight-og.svg.
#
# Why it is fiddly: the brand faces ship as woff2, which fontconfig (and so
# librsvg) cannot read. They have to be decompressed to TTF and put somewhere
# fontconfig will look, without installing anything system-wide.
#
# Needs: rsvg-convert (librsvg2-bin), python3, and pip access for fonttools+brotli.
#
# NOTE: sight-og.svg hardcodes sRGB hex because librsvg understands neither CSS
# custom properties nor oklch. The values are exact conversions of the Instrument
# tokens. If a token changes, reconvert it — do not eyeball it. The build spec's
# own hand-approximation of --melon was wrong by a visible margin.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../public/sprintsight-coming-soon/intro/sight-og.png"
THEME_FONTS="/var/www/suite/shared/theme/fonts"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

command -v rsvg-convert >/dev/null || { echo "need rsvg-convert (apt install librsvg2-bin)"; exit 1; }

echo "==> decompressing woff2 -> ttf"
python3 -m venv "$WORK/venv" >/dev/null
"$WORK/venv/bin/pip" install --quiet fonttools brotli
mkdir -p "$WORK/fonts"
"$WORK/venv/bin/python" - "$THEME_FONTS" "$WORK/fonts" <<'PY'
import sys, pathlib
from fontTools.ttLib import TTFont
src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
# only the faces the card actually uses
for w in ["bricolage-grotesque-700", "hanken-grotesk-400", "ibm-plex-mono-500"]:
    f = TTFont(src / f"{w}.woff2")
    f.flavor = None
    f.save(out / f"{w}.ttf")
    # the SVG must name the font's REAL family, which is not always the CSS name:
    # Bricolage's is "Bricolage Grotesque 96pt ExtraBold", not "Bricolage Grotesque".
    print(f"    {w}.ttf  family={f['name'].getDebugName(1)!r}")
PY

echo "==> rendering 1200x630"
cat > "$WORK/fonts.conf" <<EOF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>$WORK/fonts</dir>
  <cachedir>$WORK/fccache</cachedir>
</fontconfig>
EOF
export FONTCONFIG_FILE="$WORK/fonts.conf"
rsvg-convert -w 1200 -h 630 "$HERE/sight-og.svg" -o "$OUT"

python3 - "$OUT" <<'PY'
import struct, sys, pathlib
d = pathlib.Path(sys.argv[1]).read_bytes()
assert d[:8] == bytes([137,80,78,71,13,10,26,10]), "not a PNG"
w, h = struct.unpack('>II', d[16:24])
assert (w, h) == (1200, 630), f"expected 1200x630, got {w}x{h}"
assert len(d) < 300_000, f"{len(d)} bytes exceeds the 300KB budget"
print(f"==> ok: {w}x{h}, {len(d)} bytes")
PY
