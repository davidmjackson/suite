// oscilloscope.js — Instrument signature header. Vanilla ES module.
// Pure geometry (scopePath) + a DOM mount (mountWaves). Ported from the
// design handoff's Waves(variant:'scope').
export const W = 3600;        // path drawn across 3600 so the -600px drift loops seamlessly
export const BASELINE = 110;

// The calm baseline ripple with a gaussian pulse spike every 600px.
export function scopePath() {
  let d = `M0 ${BASELINE}`;
  for (let x = 8; x <= W; x += 8) {
    const seg = x % 600;
    let y = BASELINE + 3 * Math.sin(x / 30);
    if (seg > 250 && seg < 350) {
      const p = (seg - 300) / 50; // -1..1 across the 100px pulse window
      y = BASELINE - 64 * Math.exp(-(p * p) * 6) * Math.cos(p * 3.2);
    }
    d += ` L${x} ${y.toFixed(1)}`;
  }
  return d;
}

// Build the SVG markup string for one header backdrop.
export function scopeSvg() {
  const d = scopePath();
  const baseline = `M0 ${BASELINE} L${W} ${BASELINE}`;
  return (
    `<svg viewBox="0 0 2400 200" preserveAspectRatio="none" width="100%" height="100%">` +
    `<g class="waves-drift">` +
    `<path d="${baseline}" fill="none" stroke="var(--teal)" stroke-width="1" opacity="0.4" stroke-linecap="round"/>` +
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2.2" opacity="0.9" stroke-linecap="round"/>` +
    `<path d="${d}" fill="none" stroke="var(--teal)" stroke-width="6" opacity="0.12" stroke-linecap="round"/>` +
    `</g></svg>`
  );
}

// Mount the trace into every empty `.waves` container on the page.
export function mountWaves(root = (typeof document !== "undefined" ? document : null)) {
  if (!root) return 0;
  const targets = root.querySelectorAll(".band .waves, .authleft .waves");
  targets.forEach((el) => { if (!el.querySelector("svg")) el.innerHTML = scopeSvg(); });
  return targets.length;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => mountWaves());
  } else {
    mountWaves();
  }
}
