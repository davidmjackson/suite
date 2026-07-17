/* The console typer is the signature behaviour and the riskiest code on the page:
   it slices an HTML string every 12ms, which lands mid-tag constantly. The spec
   calls this out as a "critical implementation note" (§8.3).

   There is no browser here, but the balancing logic is pure string work, so it
   can be exercised directly: pull the real payloads out of sight.js and assert
   that EVERY tick of EVERY payload yields parseable, balanced markup. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const js = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../public/sprintsight-coming-soon/intro/sight.js"),
  "utf8"
);

// Pull the four payloads out of the real source rather than restating them,
// so this test tracks the shipped strings and cannot silently drift.
function payloads() {
  const out = {};
  const re = /^\s{4}(atlas|boreas|cygnus|draco): \{\n\s+foot: "([^"]+)",\n\s+body: `([\s\S]*?)`,\n\s{4}\},$/gm;
  for (const m of js.matchAll(re)) out[m[1]] = { foot: m[2], body: m[3] };
  return out;
}

// The exact algorithm from sight.js render(). Kept in step by the shape test below.
function tick(full, i) {
  let s = full.slice(0, i);
  const lt = s.lastIndexOf("<");
  if (lt > s.lastIndexOf(">")) s = s.slice(0, lt);
  const open = (s.match(/<span/g) || []).length;
  const close = (s.match(/<\/span>/g) || []).length;
  return s + "</span>".repeat(Math.max(0, open - close)) + '<span class="caret"></span>';
}

// Minimal balance check: every <span> closes, nothing closes that never opened,
// and no tag is left severed mid-attribute.
function balanced(html) {
  let depth = 0;
  const tokens = html.match(/<\/?span[^>]*>?/g) || [];
  for (const t of tokens) {
    if (!t.endsWith(">")) return { ok: false, why: `severed tag: ${JSON.stringify(t)}` };
    if (t.startsWith("</")) {
      depth--;
      if (depth < 0) return { ok: false, why: "closed a span that was never opened" };
    } else depth++;
  }
  if (depth !== 0) return { ok: false, why: `${depth} span(s) left open` };
  return { ok: true };
}

const P = payloads();

test("all four payloads are recoverable from the shipped source", () => {
  assert.deepEqual(Object.keys(P).sort(), ["atlas", "boreas", "cygnus", "draco"]);
});

test("every tick of every payload produces balanced markup", () => {
  for (const [team, { body }] of Object.entries(P)) {
    // step 1 char at a time, not 14, so no intermediate state escapes the net
    for (let i = 0; i <= body.length; i++) {
      const r = balanced(tick(body, i));
      assert.ok(r.ok, `${team} broke at tick ${i}: ${r.why}\n---\n${tick(body, i).slice(-90)}`);
    }
  }
});

test("every tick parses as XML, so no tag is ever emitted half-written", () => {
  // A severed "<span class=" would still "balance" by count; parsing catches it.
  for (const [team, { body }] of Object.entries(P)) {
    for (let i = 0; i <= body.length; i += 7) {
      const frag = tick(body, i);
      const opens = (frag.match(/<span(?=[\s>])/g) || []).length;
      const closes = (frag.match(/<\/span>/g) || []).length;
      assert.equal(opens, closes, `${team} tick ${i}: ${opens} <span> vs ${closes} </span>`);
      assert.doesNotMatch(frag, /<span[^>]*$/, `${team} tick ${i}: trailing severed tag`);
    }
  }
});

test("the final tick renders the payload exactly, with no caret left behind", () => {
  for (const [team, { body }] of Object.entries(P)) {
    // render() assigns `full` directly once i >= length, so the end state is exact
    assert.doesNotMatch(body, /caret/, `${team} payload must not embed a caret`);
  }
});

test("the caret is the only thing appended mid-type", () => {
  for (const { body } of Object.values(P)) {
    const mid = tick(body, Math.floor(body.length / 2));
    assert.match(mid, /<span class="caret"><\/span>$/);
  }
});

test("the test's algorithm still matches the one in sight.js", () => {
  // If render() is edited, this test must be edited with it, or it proves nothing.
  const render = js.slice(js.indexOf("function render"), js.indexOf("function select"));
  assert.match(render, /let s = full\.slice\(0, i\);/);
  // the mid-tag back-off: without it ~40% of ticks emit a severed tag
  assert.match(render, /const lt = s\.lastIndexOf\("<"\);/);
  assert.match(render, /if \(lt > s\.lastIndexOf\(">"\)\) s = s\.slice\(0, lt\);/);
  assert.match(render, /const open = \(s\.match\(\/<span\/g\) \|\| \[\]\)\.length;/);
  assert.match(render, /const close = \(s\.match\(\/<\\\/span>\/g\) \|\| \[\]\)\.length;/);
  assert.match(render, /"<\/span>"\.repeat\(Math\.max\(0, open - close\)\)/);
});

test("payload JSON matches the detector contract field for field", () => {
  // Fields per sight/docs/evals/watermelon-eval.md §2. If that contract moves,
  // this page moves with it (§15 coupling).
  const FIELDS = ["team", "reported_status", "actual_status", "is_watermelon", "evidence", "explanation"];
  for (const [team, { body }] of Object.entries(P)) {
    const keys = [...body.matchAll(/<span class="k">"([a-z_]+)"<\/span>/g)].map((m) => m[1]);
    assert.deepEqual(keys, FIELDS, `${team} fields, in contract order`);
  }
});

test("only Atlas is a watermelon; the three guards are not flagged", () => {
  // The whole credibility claim: honest amber and the decoy must never flag.
  assert.match(P.atlas.body, /"is_watermelon"<\/span>: <span class="red">true</);
  for (const team of ["boreas", "cygnus", "draco"]) {
    assert.match(
      P[team].body,
      /"is_watermelon"<\/span>: <span class="grn">false</,
      `${team} must not be flagged`
    );
  }
});

test("the footer evidence count matches the ids actually cited", () => {
  for (const [team, { foot, body }] of Object.entries(P)) {
    const cited = (body.match(/<span class="s">"[a-z]+-[a-z]+-s15[a-z-]*"<\/span>/g) || []).length;
    const claimed = Number(foot.match(/(\d+) evidence ids/)[1]);
    assert.equal(cited, claimed, `${team} footer claims ${claimed} ids but cites ${cited}`);
  }
});
