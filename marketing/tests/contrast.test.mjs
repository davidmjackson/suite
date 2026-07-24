/* §14: "Contrast: every text pair >=4.5:1, every non-text UI pair >=3:1, VERIFIED
   NOT ASSUMED." A one-off script run once and thrown away does not verify
   anything a week later, and a review found two real contrast failures that had
   already survived a manual pass — the console's focus ring at 2.33:1 and the
   input's border at 1.47:1. So the maths lives here, over the real token values.

   The conversion is exact, not approximate: oklch -> OKLab -> linear sRGB ->
   WCAG relative luminance. It is validated against known landmarks below, because
   an unvalidated colour converter is worse than none — the build spec's own
   hand-approximation of --melon was wrong by a visible margin. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = join(HERE, '../../shared/theme/instrument-core.css');
const SIGHT = join(HERE, '../public/sprintsight-coming-soon/intro/sight.css');

/* ---------- colour maths ---------- */

function linearRgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const clamp = (x) => Math.min(1, Math.max(0, x));
const lum = (c) => {
  const [r, g, b] = linearRgb(...c).map(clamp);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (fg, bg) => {
  const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const hex = (c) =>
  '#' +
  linearRgb(...c)
    .map((x) => {
      const v = clamp(x);
      const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
      return Math.round(s * 255)
        .toString(16)
        .padStart(2, '0');
    })
    .join('');

/* ---------- tokens, read from the real stylesheets ---------- */

function tokens() {
  const css = readFileSync(THEME, 'utf8') + readFileSync(SIGHT, 'utf8');
  const out = {};
  for (const m of css.matchAll(/--([a-z0-9-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}
const T = tokens();

test('the converter is exact against known oklch/sRGB landmarks', () => {
  // If this drifts, every ratio below is fiction.
  assert.equal(hex([0.628, 0.2577, 29.23]), '#ff0000', 'red');
  assert.equal(hex([0.52, 0.177, 142.5]), '#008000', 'green');
  assert.equal(hex([1, 0, 0]), '#ffffff', 'white');
  assert.equal(hex([0, 0, 0]), '#000000', 'black');
});

test('every token the page relies on was actually parsed', () => {
  const need = [
    'bone',
    'panel',
    'ink',
    'soft',
    'faint',
    'line',
    'line2',
    'green',
    'greenwash',
    'amber',
    'amberwash',
    'melon',
    'melonwash',
    'seed',
    'pithcream',
    'rinddark',
    'con-bg',
    'con-chrome',
    'con-text',
    'con-dim',
    'con-key',
    'con-str',
    'con-red',
    'con-grn',
    'con-amb',
    'con-label',
    'con-tabon',
    'green-hov',
    'amber-ink',
  ];
  const missing = need.filter((n) => !T[n]);
  assert.deepEqual(missing, [], `tokens not found in the stylesheets: ${missing}`);
});

/* ---------- the pairs that actually ship ---------- */

const TEXT = [
  ['soft', 'bone', 'every mono label, eyebrow and caption'],
  ['soft', 'panel', 'labels on panels'],
  ['ink', 'bone', 'body'],
  ['melon', 'bone', 'tell id line'],
  ['melon', 'panel', 'tell id on panel'],
  ['green', 'panel', 'footer links'],
  ['green', 'bone', 'scorecard big number'],
  ['green', 'greenwash', 'green RAG chip'],
  ['amber-ink', 'amberwash', 'amber RAG chip'],
  ['melon', 'melonwash', 'red RAG chip'],
  ['con-text', 'con-bg', 'console body'],
  ['con-dim', 'con-bg', 'console comments and verdict notes'],
  ['con-dim', 'con-chrome', 'console footer'],
  ['con-key', 'con-bg', 'JSON keys'],
  ['con-str', 'con-bg', 'JSON strings'],
  ['con-red', 'con-bg', 'watermelon verdict'],
  ['con-grn', 'con-bg', 'clear verdict'],
  ['con-amb', 'con-bg', 'amber verdicts'],
  ['con-label', 'con-chrome', 'console chrome label'],
  ['con-tabon', 'con-bg', 'selected tab'],
  ['tp-accent', 'panel', 'three-passes pass label on the card'],
];

for (const [fg, bg, what] of TEXT) {
  test(`text >=4.5:1 — ${fg} on ${bg} (${what})`, () => {
    const r = ratio(T[fg], T[bg]);
    assert.ok(r >= 4.5, `${hex(T[fg])} on ${hex(T[bg])} is ${r.toFixed(2)}:1, needs 4.5:1`);
  });
}

/* Non-text: SC 1.4.11 covers UI components and their state, NOT decoration.
   Panel hairlines and the graph-paper ground are decorative and are deliberately
   not asserted here; the input's border is the sole boundary of the only control
   on the page, so it is. */
const NONTEXT = [
  ['faint', 'bone', "the notify input's border, against its own fill"],
  ['faint', 'panel', "the notify input's border, against the card behind it"],
  ['green', 'line2', 'scorecard bar against its track'],
  ['green', 'bone', 'focus ring on the page'],
  ['green', 'panel', 'focus ring on panels'],
  ['con-tabon', 'con-bg', 'focus ring inside the console (panel)'],
  ['con-tabon', 'con-chrome', 'focus ring inside the console (tabs)'],
];

for (const [fg, bg, what] of NONTEXT) {
  test(`non-text >=3:1 — ${fg} on ${bg} (${what})`, () => {
    const r = ratio(T[fg], T[bg]);
    assert.ok(r >= 3, `${hex(T[fg])} on ${hex(T[bg])} is ${r.toFixed(2)}:1, needs 3:1`);
  });
}

/* ---------- regressions we have already been bitten by ---------- */

test('--con-dim stays above AA: 0.62 is load-bearing, not a round number', () => {
  const r = ratio(T['con-dim'], T['con-bg']);
  assert.ok(r >= 4.5, `${r.toFixed(2)}:1 — the mock's 0.5 fails, and 0.61 also drops under`);
});

test('--green is NOT used as a focus ring inside the console', () => {
  // It is 2.33:1 there. This is the exact defect a manual pass missed.
  const css = readFileSync(SIGHT, 'utf8');
  const block = css.match(/\.console :focus-visible \{[^}]*\}/);
  assert.ok(block, 'the console overrides the global focus ring');
  assert.match(block[0], /outline-color: var\(--con-tabon\)/, 'uses a token that clears 3:1');
  // outline-offset must be negative: .console has overflow:hidden, which clips
  // an outward ring off the panel and the end tabs.
  assert.match(block[0], /outline-offset: -/, 'drawn inward so overflow:hidden cannot clip it');
});

test("the input's border is not --line2, which is 1.47:1 on its own fill", () => {
  assert.ok(ratio(T.line2, T.bone) < 3, 'premise: --line2 really does fail here');
  const css = readFileSync(SIGHT, 'utf8');
  const rule = css.match(/\.form input \{[^}]*\}/)[0];
  assert.doesNotMatch(rule, /border: 1px solid var\(--line2\)/);
});

test("primary button text stays white, not clobbered to ink by the page's a{} rule", () => {
  // sight's `a { color: inherit }` once matched the ANCHOR buttons too, overriding
  // instrument's .btn-pri {color:#fff} and dropping them to ink-on-green: 2.33:1,
  // black-on-dark-green, unreadable. White-on-green is 7.15:1. The rule must spare
  // .btn so the buttons keep white. (The form's <button> was never an <a>, so only
  // the link-buttons broke — which hid it from a quick glance at one button.)
  const white = [1, 0, 0];
  assert.ok(
    ratio(white, T.green) >= 4.5,
    `white on --green is ${ratio(white, T.green).toFixed(2)}:1`,
  );
  assert.ok(ratio(T.ink, T.green) < 3, 'premise: ink on --green really does fail (2.33:1)');
  const css = readFileSync(SIGHT, 'utf8');
  assert.match(css, /a:not\(\.btn\) \{ color: inherit; \}/, 'the a{} rule must exclude .btn');
  assert.doesNotMatch(css, /\ba \{ color: inherit; \}/, 'the unscoped rule must be gone');
});

test('no rule suppresses focus with outline:none', () => {
  // outline:none out-specifies the global :focus-visible ring. The --greenwash
  // halo left behind is 1.13:1 on --panel, i.e. no indicator at all.
  const code = readFileSync(SIGHT, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /outline:\s*none/);
});
