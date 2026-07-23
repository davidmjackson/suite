/* Every other landing test goes through supertest and only sees rendered HTML,
   so nothing reads landing.css at all. That is a categorical gap, not a missing
   case: delete .tag-sight, or .appcard[data-app="sight"], or the focus rule, and
   the whole suite still passes while the page is visibly or accessibly broken.
   These tests read the stylesheet itself. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HUB = join(dirname(fileURLToPath(import.meta.url)), "..");
const landing = readFileSync(join(HUB, "public/css/landing.css"), "utf8");
const theme = readFileSync(join(HUB, "../shared/theme/instrument-core.css"), "utf8");

const token = (name) => {
  const m = theme.match(new RegExp(`--${name}:\\s*(oklch\\([^)]*\\))`));
  assert.ok(m, `--${name} not found in shared/theme/instrument-core.css`);
  return m[1].replace(/\s+/g, " ");
};
const rule = (selector) => {
  const m = landing.match(new RegExp(`${selector.replace(/[.[\]"^$*+?()|{}\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `${selector} missing from landing.css`);
  return m[1];
};

/* ---------- the mirrored literals (the real trap) ---------- */

/* landing.css hand-copies per-app accents as literals, because the hub body is
   plain .ins and the shared tokens are scoped to .ins[data-app="…"]. landing.css
   is NOT synced and NOT covered by check-theme-drift.mjs, so those copies can
   drift from the source forever without failing a build.

   For --plum that was cosmetic. For --melon it is not: the Sprintsight tile
   mirrors the literal while the page it LINKS TO (marketing/…/sight.css) uses
   var(--melon). Change the token and the promo page follows while the tile that
   links to it silently does not — a mismatch across a single click, all green.
   These assertions make the mirror a checked invariant instead of a comment. */

test("the melon mirror still matches shared/theme — the promo page uses the live token", () => {
  const melon = token("melon");
  const melonwash = token("melonwash");
  assert.match(rule('.appcard[data-app="sight"]').replace(/\s+/g, " "), new RegExp(`--accent:\\s*${melon.replace(/[()]/g, "\\$&")}`));
  const tag = rule(".tag-sight").replace(/\s+/g, " ");
  assert.ok(tag.includes(melonwash), `.tag-sight background must mirror --melonwash (${melonwash})`);
  assert.ok(tag.includes(melon), `.tag-sight colour must mirror --melon (${melon})`);
});

test("the plum mirror still matches shared/theme", () => {
  // Pre-existing and unguarded until now; same failure mode, lower stakes.
  const plum = token("plum");
  const plumwash = token("plumwash");
  assert.ok(rule('.appcard[data-app="plan"]').includes(plum), `plan accent must mirror --plum (${plum})`);
  const tag = rule(".tag-plan").replace(/\s+/g, " ");
  assert.ok(tag.includes(plumwash), `.tag-plan background must mirror --plumwash (${plumwash})`);
  assert.ok(tag.includes(plum), `.tag-plan colour must mirror --plum (${plum})`);
});

/* ---------- the CSS half of the tile ---------- */

test("the linked tile has a focus indicator that is not the invisible one", () => {
  // The foundation's link ring is box-shadow:0 0 0 3px var(--greenwash) —
  // 1.13:1 on --panel, 1.03:1 on --bone. Deleting this rule silently reverts to
  // that and is a WCAG 2.4.7 regression, so assert the override explicitly.
  const r = rule(".ins .appcard:focus-visible").replace(/\s+/g, " ");
  assert.match(r, /outline:\s*2px solid var\(--green\)/, "a visible ring, not the greenwash halo");
  assert.match(r, /box-shadow:\s*none/, "must cancel the foundation's invisible halo");
  // generic, not sight-scoped: the next five tiles get it for free
  assert.doesNotMatch(landing, /\.appcard\[data-app="sight"\]:focus-visible/);
});

test("only a LINKED tile advertises that it is clickable", () => {
  // A div that lifts under the cursor promises a click it cannot honour; a tile
  // whose whole job is click-through must advertise it. Keyed off element type.
  assert.match(landing, /\.ins a\.appcard:hover\s*\{[^}]*border-color/);
  // no bare .appcard:hover — that would give the five non-links a false affordance
  assert.doesNotMatch(landing, /(^|[^a])\.appcard:hover/m);
});

test("the app grid stays two columns, so six tiles fill three rows", () => {
  assert.match(rule(".appgrid"), /grid-template-columns:\s*1fr 1fr/);
});

test("every app tile in the grid has an accent defined", () => {
  for (const app of ["raid", "signal", "retro", "poker", "plan", "sight"]) {
    assert.match(
      landing,
      new RegExp(`\\.appcard\\[data-app="${app}"\\]\\s*\\{[^}]*--accent`),
      `${app} tile has no --accent, so its glyph falls back to inherited --ink`
    );
  }
});

test("every tag variant used by the grid is styled", () => {
  for (const app of ["raid", "signal", "retro", "poker", "plan", "sight"]) {
    assert.match(landing, new RegExp(`\\.tag-${app}\\s*\\{`), `.tag-${app} is unstyled`);
  }
});
