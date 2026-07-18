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
const html = readFileSync(join(PUBLIC, "sprintsight-coming-soon/intro/index.html"), "utf8");
const css = readFileSync(join(PUBLIC, "sprintsight-coming-soon/intro/sight.css"), "utf8");
const js = readFileSync(join(PUBLIC, "sprintsight-coming-soon/intro/sight.js"), "utf8");
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

/* ---------- reset and layout ---------- */

test("body's own margin is reset", () => {
  // Instrument's reset is `.ins *`, which matches descendants. <body> IS .ins,
  // so it is never matched and keeps the UA's 8px margin. Harmless behind the
  // hub's centred cards; an 8px gutter around this page's full-bleed rail.
  const block = cssCode.slice(0, cssCode.indexOf("font-size: 14.5px"));
  assert.match(block, /margin: 0;/, ".ins[data-app=sight] must reset its own margin");
});

test("the header shares the container's gutter at every breakpoint", () => {
  // .hd and .wrap have equal specificity, so a padding-inline on .hd wins on
  // source order and knocks the header out of alignment with everything below.
  const hd = cssCode.match(/\.hd \{[^}]*\}/)[0];
  assert.doesNotMatch(hd, /padding-inline/, ".hd must not set padding-inline");
  assert.doesNotMatch(hd, /padding:\s*\d+px\s+\d+px/, ".hd must not set shorthand padding");
  assert.match(hd, /padding-block/, ".hd owns the vertical only");
  assert.doesNotMatch(cssCode, /\.hd \{ padding-inline: 0; \}/, "and never zeroes it at md");
});

test("the breadcrumb return path clears 44x44, which is a mobile-only risk", () => {
  // At base the label is hidden, leaving an 18px glyph: padding alone gives 30x42.
  // §7.2.1 requires 44x44 and singles out mobile as the case that matters most.
  const rule = cssCode.match(/\.bc-home \{[^}]*\}/)[0];
  assert.match(rule, /min-width: 44px/);
  assert.match(rule, /min-height: 44px/);
});

test("the skip link is fixed, not absolute", () => {
  // absolute resolves against the initial containing block, so reverse-tabbing to
  // it after scrolling parks it off-screen.
  const rule = cssCode.match(/\.skip \{[^}]*\}/)[0];
  assert.match(rule, /position: fixed/);
});

test("the section-header rail fits its labels without becoming a gap", () => {
  // The mock and §6 both say 170px. Measured, the labels render at 53-92px in
  // IBM Plex Mono 10.5px/0.14em, so 170 left 46-69% of the column empty and read
  // as dead space rather than an aligned rail. This is a deliberate deviation —
  // the assertion exists so nobody "corrects" it back to the mock's value.
  const rail = cssCode.match(/\.sechd \{ grid-template-columns: (\d+)px 1fr/);
  assert.ok(rail, "the md section-header rail is defined");
  const px = Number(rail[1]);
  assert.ok(px >= 100, `${px}px would clip HOW IT WORKS, which renders at 92px`);
  assert.ok(px <= 130, `${px}px is dead space, not a rail — the widest label is 92px`);
  // the rail itself must survive: all four labels align down one edge
  assert.match(cssCode, /\.sechd \{ grid-template-columns: \d+px 1fr/, "still two columns at md");
});

/* ---------- works without JS ---------- */

test("content below the hero is visible with JS off", () => {
  // .rv is opacity:0 until an IntersectionObserver adds .in. Without a fallback
  // the page is a hero and nothing else — on a page built to be shared and indexed.
  const ns = html.match(/<noscript><style>([\s\S]*?)<\/style><\/noscript>/);
  assert.ok(ns, "a noscript style block exists");
  assert.match(ns[1], /\.rv \{ opacity: 1; transform: none; \}/);
  assert.match(ns[1], /\.bar i \{ width: 100%; \}/);
});

test("the console shows its default payload with JS off, and it matches sight.js", () => {
  // The panel is filled by JS, so without this it is a blank 352px dark box.
  // Embedded via <noscript> so that with JS on it is not rendered at all and the
  // typer still starts from empty — no flash of content.
  const panel = html.match(/<pre class="con-body"[^>]*>([\s\S]*?)<\/pre>/)[1];
  const fallback = panel.match(/<noscript>([\s\S]*)<\/noscript>/);
  assert.ok(fallback, "the panel carries a noscript fallback");
  // It is duplicated from sight.js, so pin it: this is the only thing stopping drift.
  const atlas = js.match(/^\s{4}atlas: \{\n\s+foot: "[^"]+",\n\s+body: `([\s\S]*?)`,\n\s{4}\},$/m);
  assert.ok(atlas, "the atlas payload is readable from sight.js");
  assert.equal(fallback[1], atlas[1], "the no-JS fallback must be the ATLAS payload verbatim");
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

/* ---------- three-passes infographic (marketing/three-passes spec) ---------- */

const TP_ILLO_DIR = "sprintsight-coming-soon/intro";
const TP_PASSES = [
  ["pass-01-retrieval.svg", "Retrieval", "Read the delivery record"],
  ["pass-02-reconciliation.svg", "Reconciliation", "Check the story against the data"],
  ["pass-03-report-writer.svg", "Report writer", "Write it for the room"],
];
const RAG = /oklch\(0\.55 0\.19 25\)|oklch\(0\.55 0\.12 150\)|oklch\(0\.7 0\.13 70\)/; // red / green / amber

test("the pipeline section keeps the shared .blk/.sechd shell (not the spec's standalone header)", () => {
  // The card grid swaps IN; the header must still match the four sibling sections
  // (eyebrow rail + h2), so the section reads as part of the page, not a transplant.
  assert.match(html, /<section class="blk rv" id="pipeline" aria-labelledby="pipeline-h">/);
  const sec = html.match(/id="pipeline"[\s\S]*?<\/section>/)[0];
  assert.match(sec, /<div class="sechd">/, "keeps the section-header rail");
  assert.match(sec, /<h2 id="pipeline-h">Three passes, nothing for your team to fill in<\/h2>/);
  assert.doesNotMatch(sec, /class="pipe"|class="pnode"/, "the old pipe boxes are gone");
});

test("the pipeline lede keeps the two trust claims the lean cards no longer state", () => {
  // The card redesign dropped the per-pass prose; these two claims were preserved
  // in the section lede (David's call at go-live). Guard them so they can't drift
  // out again silently — they are the section's credibility, not decoration.
  const sec = html.match(/id="pipeline"[\s\S]*?<\/section>/)[0];
  assert.match(sec, /computed deterministically/, "the deterministic-signals claim");
  assert.match(sec, /"insufficient evidence" rather than a guess/, "the insufficient-evidence gate");
});

test("three pass cards, each an <article> with pass label, title and in/out (copy verbatim, spec §6)", () => {
  const sec = html.match(/<div class="tp-grid">[\s\S]*?<\/section>/)[0];
  assert.equal((sec.match(/<article class="tp-card">/g) || []).length, 3);
  for (const [, stage, title] of TP_PASSES) {
    assert.match(sec, new RegExp(`<p class="tp-pass">Pass 0\\d · ${stage}</p>`), `${stage} eyebrow`);
    assert.match(sec, new RegExp(`<h3 class="tp-title">${title}</h3>`), `${stage} title`);
  }
  assert.match(sec, /<b>Jira · Confluence · Slack · RAID<\/b>/, "01 in");
  assert.match(sec, /<b>signals \+ divergences<\/b>/, "02 out");
  assert.match(sec, /<b>cited report \(JSON\)<\/b>/, "03 out");
});

test("card images use a bare page-relative filename, never the hub-served /illos/ path", () => {
  // /illos/*, /css/*, /fonts/* are hub-served in prod, not the marketing Alias.
  // An absolute /illos/… would 404 live; the src must resolve under this page.
  // Capture ANY src (not just the good shape) so the guards below are live: a
  // regex that only matches good paths would let a bad one escape via the count.
  const sec = html.match(/<div class="tp-grid">[\s\S]*?<\/section>/)[0];
  const imgs = [...sec.matchAll(/<img src="([^"]+)"[^>]*\balt="([^"]+)"/g)];
  assert.equal(imgs.length, 3, "three images, each with alt");
  for (const [, src, alt] of imgs) {
    assert.doesNotMatch(src, /^(\/|https?:|\.\.\/)/, `${src} must be a page-relative filename, not absolute/external/traversal`);
    assert.match(src, /^pass-0[123]-[a-z-]+\.svg$/, `${src} is a three-passes illustration in this dir`);
    assert.ok(existsSync(join(PUBLIC, TP_ILLO_DIR, src)), `${src} exists on disk`);
    assert.ok(alt.length > 20, "alt is a real description, not a filename");
  }
});

test("the three SVGs are self-contained: no script, no external refs", () => {
  // They ship as <img> (cannot run script), but guard anyway against a future
  // inline, and confirm the uniform 340x220 viewBox the layout assumes.
  for (const [file] of TP_PASSES) {
    const svg = readFileSync(join(PUBLIC, TP_ILLO_DIR, file), "utf8");
    // whitespace-tolerant around `=` (onload = "…" is valid XML) and catches the
    // DOCTYPE/ENTITY XXE shape, so a future hostile SVG cannot slip past the guard.
    assert.doesNotMatch(svg, /<script|<!doctype|<!entity|xlink:href|\bhref\s*=|\son[a-z]+\s*=|<image\b|<foreignObject|url\(|data:/i, `${file} has no active/external content`);
    assert.match(svg, /viewBox="0 0 340 220"/, `${file} viewBox`);
  }
});

test("RAG verdict hues appear only in Pass 02 (spec §1 colour rule)", () => {
  // green/red/amber carry verdict meaning across the product; in 01/03 they would
  // read as decoration. Those two stay indigo + neutral; only 02 reconciles.
  const p02 = readFileSync(join(PUBLIC, TP_ILLO_DIR, "pass-02-reconciliation.svg"), "utf8");
  assert.match(p02, RAG, "Pass 02 carries the RAG hues");
  for (const file of ["pass-01-retrieval.svg", "pass-03-report-writer.svg"]) {
    const svg = readFileSync(join(PUBLIC, TP_ILLO_DIR, file), "utf8");
    assert.doesNotMatch(svg, RAG, `${file} must stay neutral (no RAG hues)`);
  }
});

test("the pass labels use a section-local indigo, never the page-wide green --accent", () => {
  assert.match(css, /--tp-accent:\s*oklch\([^)]*\b262\)/, "--tp-accent defined (indigo)");
  assert.match(css, /\.tp-pass \{[^}]*color: var\(--tp-accent\)/, "the pass label reads --tp-accent");
  assert.doesNotMatch(css, /--accent:/, "sight.css must never redefine the page-wide --accent");
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
  // The current page must never link to itself. Scope to the breadcrumb's own
  // cell and reject ANY anchor in it, rather than one hand-picked arrangement.
  const cell = html.match(/<li class="bc-here">([\s\S]*?)<\/li>/);
  assert.ok(cell, "breadcrumb current-page cell exists");
  assert.doesNotMatch(cell[1], /<a\b/, "the current page cell must contain no link");
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

test("canonical names the URL that actually serves 200", () => {
  // /intro (no slash) 301s to /intro/, so /intro/ is the canonical form.
  assert.match(html, /<link rel="canonical" href="https:\/\/sprintsuite\.uk\/sprintsight-coming-soon\/intro\/">/);
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
  // Scoped to the tablist: a document-wide count of tabindex="-1" also catches
  // unrelated focus targets (the console's own, for the #detect jump link).
  const picker = html.match(/<div class="picker"[\s\S]*?<\/div>/)[0];
  assert.equal((picker.match(/aria-selected="true"/g) || []).length, 1);
  assert.equal((picker.match(/aria-selected="false"/g) || []).length, 3);
  assert.match(picker, /id="tab-atlas"\s+aria-selected="true"[^>]*tabindex="0"/);
  assert.equal((picker.match(/tabindex="-1"/g) || []).length, 3, "the 3 unselected tabs");
});

test("the panel is a pre, reachable, and never aria-live", () => {
  assert.match(html, /<pre class="con-body" id="conPanel" role="tabpanel"[^>]*tabindex="0">/);
  // aria-live would announce every typing tick. Test the panel's OWN opening tag:
  // a regex hunting for aria-live near id="conPanel" cannot cross the '>' and so
  // never fires, whatever the markup says.
  const tag = html.match(/<pre class="con-body"[^>]*>/)[0];
  assert.doesNotMatch(tag, /aria-live/, `panel must not be a live region: ${tag}`);
  assert.match(js, /aria-busy/);
});

test("the hero has a single action and it is not a dead 'Run the detector'", () => {
  // The console runs on load, so a "Run the detector" button only re-ran what had
  // already run — pointless, and removed. The hero keeps one real CTA.
  assert.doesNotMatch(html, /Run the detector/, "the pointless run button is gone");
  assert.doesNotMatch(js, /runDetector|runTimer/, "and its JS with it");
  const acts = html.match(/<div class="acts">([\s\S]*?)<\/div>/)[1];
  const links = acts.match(/<a\b/g) || [];
  assert.equal(links.length, 1, "one CTA in the hero actions");
  assert.match(acts, /<a class="btn btn-pri" href="#notify">Get notified at launch<\/a>/);
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

test("the error path fully restores the form, leaving nothing stuck", () => {
  // The endpoint is null, so EVERY submit lands here. If the catch block forgets
  // any of these the button stays disabled and aria-busy stays true forever, and
  // the form is dead until reload. Assert the recovery, not just the disable.
  const cat = js.slice(js.indexOf("} catch {"), js.indexOf("});", js.indexOf("} catch {")));
  assert.match(cat, /btn\.disabled = false/, "re-enables the button");
  assert.match(cat, /btn\.textContent = label/, "restores the button label");
  assert.match(cat, /form\.removeAttribute\("aria-busy"\)/, "clears aria-busy");
  assert.match(cat, /say\(/, "tells the user what happened");
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

test("no favicon is claimed: the hub owns /favicon.svg on this domain", () => {
  assert.doesNotMatch(html, /rel="icon"/);
});

test("the sight glyph respects its size rule: -sm below 24px", () => {
  // §5.1: #glyph-sight at >=24px, #glyph-sight-sm below. .gl is 18px, so every
  // .gl use of the sight glyph must be the seedless variant or it renders as mud.
  const gl = css.match(/\.gl \{ width: (\d+)px/);
  assert.ok(gl, ".gl sets an explicit size");
  const px = Number(gl[1]);
  const usesSeeded = /class="gl[^"]*"[^>]*>\s*<use href="[^"]*#glyph-sight"/.test(html);
  if (px < 24) {
    assert.ok(!usesSeeded, `.gl is ${px}px, so it must not use the seeded #glyph-sight`);
    assert.match(html, /#glyph-sight-sm/, "uses the seedless variant");
  }
});

test("every glyph referenced by the page exists in the synced sprite", () => {
  const sprite = readFileSync(join(PUBLIC, "illos/glyphs.svg"), "utf8");
  const used = [...html.matchAll(/glyphs\.svg#(glyph-[a-z-]+)/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  for (const id of new Set(used)) {
    assert.ok(sprite.includes(`id="${id}"`), `${id} is in glyphs.svg`);
  }
});

test("the OG image exists at 1200x630 and fits the size budget", () => {
  // §5.3 forbids shipping a placeholder, so check the real bytes, not the path.
  const png = readFileSync(join(PUBLIC, "sprintsight-coming-soon/intro/sight-og.png"));
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
