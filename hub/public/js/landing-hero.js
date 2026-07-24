// landing-hero.js — mount the hero scope trace at the approved prototype opacities
// (0.3 / 0.7 / 0.1). Reuses the foundation's path geometry; does NOT edit it.
import { scopePath, W, BASELINE } from '/js/oscilloscope.js';

function mountHero() {
  const g = document.getElementById('scope');
  if (!g || g.querySelector('path')) return; // already mounted
  const ns = 'http://www.w3.org/2000/svg';
  const mk = (d, stroke, sw, op) => {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', stroke);
    p.setAttribute('stroke-width', sw);
    p.setAttribute('opacity', op);
    p.setAttribute('stroke-linecap', 'round');
    return p;
  };
  const d = scopePath();
  g.appendChild(mk(`M0 ${BASELINE} L${W} ${BASELINE}`, 'var(--teal)', 1, 0.3));
  g.appendChild(mk(d, 'var(--green)', 2.2, 0.7));
  g.appendChild(mk(d, 'var(--teal)', 6, 0.1));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountHero);
} else {
  mountHero();
}
