/* Encodes the statically-checkable half of BUILD-SPEC §14 (definition of done).
   A markdown checklist rots the first time someone edits the page; these do not.
   The rest of §14 (200% zoom, keyboard-only run, card validator) is genuinely
   manual and is not pretended to be covered here. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const html = readFileSync(join(PUBLIC, "sprintsight/index.html"), "utf8");
const css = readFileSync(join(PUBLIC, "css/sight.css"), "utf8");
const js = readFileSync(join(PUBLIC, "js/sight.js"), "utf8");
// Comments discuss the very things these tests forbid, so strip them first or a
// comment saying "no @font-face here" trips the @font-face check.
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "");

/* ---------- fonts ---------- */

test("no Google Fonts, no external font host", () => {
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
});

test("sight.css declares no @font-face (the faces are canonical)", () => {
  assert.doesNotMatch(cssCode, /@font-face/);
});

test("exactly two font preloads, and both files exist", () => {
  const preloads = [...html.matchAll(/<link rel="preload" href="([^"]+)"[^>]*as="font"/g)];
  assert.equal(preloads.length, 2, "exactly two preloads");
  for (const [, href] of preloads) {
    assert.ok(existsSync(join(PUBLIC, href)), `${href} exists on disk`);
  }
});

/* ---------- tokens ---------- */

test("no colour literals outside the token block", () => {
  // Everything before the first component rule is the token block.
  const tokenBlockEnd = cssCode.indexOf("font-size: 14.5px");
  assert.ok(tokenBlockEnd > 0, "token block found");
  const components = cssCode.slice(tokenBlockEnd);
  const literals = [...components.matchAll(/(#[0-9a-fA-F]{3,8}\b|oklch\([^)]*\))/g)]
    .map((m) => m[0])
    // a var() reference is not a literal
    .filter((s) => !s.startsWith("var("));
  assert.deepEqual(literals, [], `component rules must use tokens, found: ${literals.join(", ")}`);
});

/* ---------- semantics (§11.3) ---------- */

test("exactly one h1", () => {
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
});

test("no heading level skips", () => {
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  assert.equal(levels[0], 1, "first heading is the h1");
  for (let i = 1; i < levels.length; i++) {
    assert.ok(
      levels[i] <= levels[i - 1] + 1,
      `h${levels[i - 1]} -> h${levels[i]} skips a level`
    );
  }
});

test("the spec sheet is a real dl, not divs", () => {
  assert.match(html, /<dl class="specs">/);
  assert.equal((html.match(/<dt>/g) || []).length, 5);
  assert.equal((html.match(/<dd>/g) || []).length, 5);
});

test("the case table is a real table with scoped column headers", () => {
  assert.match(html, /<table>/);
  assert.match(html, /<thead>/);
  assert.match(html, /<tbody>/);
  assert.equal((html.match(/<th scope="col"[ >]/g) || []).length, 5);
  assert.equal((html.match(/<tr>/g) || []).length, 5); // 1 head + 4 cases
});

test("main wraps the content and the skip link targets it", () => {
  assert.match(html, /<a class="skip" href="#main">/);
  assert.match(html, /<main id="main">/);
});

test("every section is labelled by its own heading", () => {
  const sections = [...html.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(sections.length >= 6, "all sections labelled");
  for (const id of sections) {
    assert.match(html, new RegExp(`<h[12] id="${id}"`), `#${id} is a heading in the page`);
  }
});

/* ---------- links (§14) ---------- */

test("no href=\"#\" anywhere", () => {
  assert.doesNotMatch(html, /href="#"/);
});

test("no target=_blank on same-origin links", () => {
  assert.doesNotMatch(html, /target="_blank"/);
});

/* ---------- breadcrumb: the return path (§7.2.1) ---------- */

test("Sprint Suite is a real link to the suite, same tab", () => {
  assert.match(html, /<a class="bc-home" href="https:\/\/sprintsuite\.uk">/);
});

test("Sprintsight is not a link and carries aria-current", () => {
  assert.match(html, /<span aria-current="page">/);
  // the current page must never link to itself
  assert.doesNotMatch(html, /<a[^>]*>\s*<svg[^>]*gl-melon/);
});

test("the return path survives at mobile: only the label hides, never the link", () => {
  assert.match(css, /\.bc-label \{ display: none; \}/);
  assert.doesNotMatch(css, /\.bc-home \{[^}]*display:\s*none/);
});

/* ---------- honesty constraints (§9.5) ---------- */

test("the rail and the coming-soon chip are present", () => {
  // Removing these while the product does not exist makes every present-tense
  // claim on the page false. This is correctness, not style.
  assert.match(html, /Sprintsight is in build/);
  assert.match(html, /<span class="ver">coming soon<\/span>/);
});

test("JSON-LD is valid and honest about availability", () => {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(m, "JSON-LD block present");
  const ld = JSON.parse(m[1]);
  assert.equal(ld.name, "Sprintsight");
  // PreOrder is the honest value while the product is in build.
  assert.equal(ld.offers.availability, "https://schema.org/PreOrder");
  // there are no ratings or reviews; inventing them is a penalty and a lie
  assert.ok(!("aggregateRating" in ld) && !("review" in ld));
});

test("canonical URL has no trailing slash", () => {
  assert.match(html, /<link rel="canonical" href="https:\/\/sprintsuite\.uk\/sprintsight">/);
});

/* ---------- console ---------- */

test("four tabs, four payloads, wired to one panel", () => {
  const tabs = [...html.matchAll(/role="tab"/g)];
  assert.equal(tabs.length, 4);
  for (const team of ["atlas", "boreas", "cygnus", "draco"]) {
    assert.match(html, new RegExp(`id="tab-${team}"`), `${team} tab`);
    assert.match(js, new RegExp(`^\\s{4}${team}: \\{`, "m"), `${team} payload`);
  }
  assert.equal((html.match(/aria-controls="conPanel"/g) || []).length, 4);
});

test("exactly one tab is selected on load, with a roving tabindex", () => {
  assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
  assert.equal((html.match(/aria-selected="false"/g) || []).length, 3);
  assert.match(html, /id="tab-atlas"\s+aria-selected="true"[^>]*tabindex="0"/);
  assert.equal((html.match(/tabindex="-1"/g) || []).length, 3);
});

test("the panel is a pre, reachable, and never aria-live", () => {
  assert.match(html, /<pre class="con-body" id="conPanel" role="tabpanel"[^>]*tabindex="0">/);
  // aria-live would announce every typing tick
  assert.doesNotMatch(html, /aria-live="polite"[^>]*id="conPanel"/);
  assert.match(js, /aria-busy/);
});

test("the typer clears its interval before starting, or tabs interleave", () => {
  const render = js.slice(js.indexOf("function render"), js.indexOf("function select"));
  assert.match(render, /clearInterval\(typer\)/);
  assert.ok(
    render.indexOf("clearInterval(typer)") < render.indexOf("setInterval"),
    "clear must come before the new interval starts"
  );
});

test("the typer re-balances spans, so markup never breaks mid-tag", () => {
  assert.match(js, /<\/span>"\.repeat\(Math\.max\(0, open - close\)\)/);
});

/* ---------- evidence ids (§15 coupling) ---------- */

test("Atlas's evidence ids match data-strategy.md, the source of truth", () => {
  const strategy = readFileSync("/var/www/sight/docs/data/data-strategy.md", "utf8");
  for (const id of ["burndown-atlas-s15", "slack-atlas-s15-msg-dep", "status-atlas-s15"]) {
    assert.ok(strategy.includes(id), `${id} is in data-strategy.md`);
    assert.ok(js.includes(id), `${id} is cited by the console`);
  }
});

test("every cited id follows the documented {type}-{team}-s{sprint} convention", () => {
  // NOTE: only Atlas's three ids actually appear in data-strategy.md §6, which
  // gives them as an "Example:". Boreas/Cygnus/Draco have no ids recorded there
  // at all, so §14's "ids match §6 exactly" cannot be satisfied as written.
  // Convention-conformance is the strongest check available until §6 grows the
  // other three teams. See the sight HANDOVER learning queue.
  const ids = [...js.matchAll(/"([a-z]+-(?:atlas|boreas|cygnus|draco)-s15[a-z-]*)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, 9, "9 distinct ids cited (atlas x3 + 2 each x3)");
  for (const id of ids) {
    assert.match(id, /^[a-z]+-(atlas|boreas|cygnus|draco)-s15(-[a-z-]+)?$/, id);
  }
});

/* ---------- reduced motion (§8) ---------- */

test("CSS restores the end state when motion is off, hiding nothing", () => {
  const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(block, /\.rv \{ opacity: 1; transform: none; \}/);
  assert.match(block, /\.caret \{ display: none; \}/);
  assert.match(block, /\.bar i \{ width: 100%; \}/);
});

test("JS branches on reduced motion too, since CSS cannot stop a setInterval", () => {
  assert.match(js, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  // the console must still be fully populated, not left empty
  assert.match(js, /if \(reduce\) \{\s*panel\.innerHTML = full;/);
});

test("the dashed connector is skipped by the line-draw, or its dashes are destroyed", () => {
  assert.match(js, /if \(p\.getAttribute\("stroke-dasharray"\)\) return;/);
});

/* ---------- form (§7.10) ---------- */

test("the form has a real label, email type and autocomplete", () => {
  assert.match(html, /<label class="sr-only" for="notifyEmail">/);
  assert.match(html, /id="notifyEmail"[^>]*type="email"/);
  assert.match(html, /autocomplete="email"/);
});

test("the message element is a polite status region", () => {
  assert.match(html, /id="notifyMsg" role="status" aria-live="polite"/);
});

test("all five form states exist", () => {
  assert.match(js, /doesn't look right/, "invalid");
  assert.match(js, /Sending…/, "pending");
  assert.match(js, /You're on the list/, "success");
  assert.match(js, /That didn't send/, "error");
  assert.match(js, /btn\.disabled = true/, "pending disables submit");
});

test("submit never silently no-ops while the endpoint is unset", () => {
  assert.match(js, /const NOTIFY_ENDPOINT = null/);
  assert.match(js, /console\.warn/);
  assert.match(js, /throw new Error\("NOTIFY_ENDPOINT not configured"\)/);
});

test("success removes the form, leaving no live form behind a result", () => {
  assert.match(js, /form\.remove\(\)/);
});

/* ---------- assets ---------- */

test("every glyph referenced by the page exists in the synced sprite", () => {
  const sprite = readFileSync(join(PUBLIC, "illos/glyphs.svg"), "utf8");
  const used = [...html.matchAll(/glyphs\.svg#(glyph-[a-z-]+)/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  for (const id of new Set(used)) {
    assert.ok(sprite.includes(`id="${id}"`), `${id} is in glyphs.svg`);
  }
});

test("the favicon is declared and present", () => {
  assert.match(html, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/);
  assert.ok(existsSync(join(PUBLIC, "favicon.svg")));
});

test("the OG image exists at 1200x630 and fits the size budget", () => {
  // §5.3 forbids shipping a placeholder, so check the real bytes, not the path.
  const png = readFileSync(join(PUBLIC, "illos/sight-og.png"));
  assert.deepEqual(
    [...png.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    "is a PNG"
  );
  assert.equal(png.readUInt32BE(16), 1200, "width");
  assert.equal(png.readUInt32BE(20), 630, "height");
  assert.ok(png.length < 300_000, `${png.length} bytes is within the 300KB budget`);
  // the meta must agree with the file
  assert.match(html, /<meta property="og:image:width" content="1200">/);
  assert.match(html, /<meta property="og:image:height" content="630">/);
});

test("the OG card and the page tell the same story", () => {
  // They drift silently otherwise: the card is a committed binary built from a
  // separate SVG, so nothing else couples them.
  const og = readFileSync(join(ROOT, "tools/sight-og.svg"), "utf8");
  for (const label of ["RIND", "PITH", "SEEDS", "FLESH"]) {
    assert.ok(og.includes(`>${label}<`), `card labels ${label}`);
    assert.ok(html.includes(`>${label}<`), `page labels ${label}`);
  }
  // the anatomy geometry must match the page's, or the brand mark differs
  for (const geom of ['r="128"', 'r="116"', 'r="104"', 'd="M160 50 L236 50"']) {
    assert.ok(og.includes(geom), `card has ${geom}`);
    assert.ok(html.includes(geom), `page has ${geom}`);
  }
});
