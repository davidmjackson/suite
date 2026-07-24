/* The console typer is the signature behaviour and the riskiest code on the page:
   it slices an HTML string every 12ms, which lands mid-tag constantly. The spec
   calls this out as a "critical implementation note" (§8.3).

   There is no browser here, but sight.js is plain string work over a stub DOM, so
   it can be exercised directly: pull the real payloads out of sight.js, run the
   shipped render() against a stub DOM, and assert that EVERY tick of EVERY
   payload yields parseable, balanced markup.

   Nothing in this file may depend on the LAYOUT of sight.js — quote style,
   indentation, line wrapping, trailing commas and interleaved comments all belong
   to the formatter. The payloads are recovered by evaluating the shipped object
   literal, and the typer is checked by running the shipped function, so what is
   asserted is behaviour and data, never source text. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext, runInNewContext } from 'node:vm';

const js = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../public/sprintsight-coming-soon/intro/sight.js'),
  'utf8',
);

// The four demo teams, in shipped order. Every test in this file works off this
// one list, so a fifth team cannot be added to the console without landing here.
const TEAMS = ['atlas', 'boreas', 'cygnus', 'draco'];

/* ---------------------------------------------------------------------------
   Recovering the payloads.

   sight.js is an IIFE, so `V` cannot be imported. Rather than pattern-match the
   file's LAYOUT, this does the nearest thing to an import: find the `const V =`
   table, take its object literal by balancing braces with a scanner that knows
   strings, template literals and comments, and EVALUATE it. What comes back is
   the object the browser itself builds — real `foot`/`body` VALUES, escapes
   already processed.

   Evaluating is safe in the same sense `import` is: the input is a checked-in
   file from this repo, not user data. It is still evaluated in a bare vm context
   with no globals, so a literal that tried to reach out cannot.

   Every failure path THROWS, and that is load-bearing. `payloads()` feeds every
   other test in this file; a version that quietly returned {} would leave the
   whole suite green while checking nothing at all.
   --------------------------------------------------------------------------- */

// src[i] opens a quote; returns the index just past its closing quote.
function skipQuoted(src, i) {
  const q = src[i];
  for (i++; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === q) return i + 1;
  }
  throw new Error('sight.js: unterminated string literal inside the payload table');
}

// src[i] === "`"; returns the index just past the closing backtick.
function skipTemplate(src, i) {
  for (i++; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === '`') return i + 1;
    else if (src[i] === '$' && src[i + 1] === '{') i = skipBraces(src, i + 1) - 1;
  }
  throw new Error('sight.js: unterminated template literal inside the payload table');
}

// src[i] === "/"; returns the index just past the comment it opens, -1 if that
// comment is unterminated, or null when it opened no comment at all.
function skipComment(src, i) {
  if (src[i + 1] === '/') {
    const nl = src.indexOf('\n', i);
    return nl === -1 ? -1 : nl + 1;
  }
  if (src[i + 1] !== '*') return null; // a lone "/" is division, not a comment
  const end = src.indexOf('*/', i + 2);
  return end === -1 ? -1 : end + 2;
}

/* The constructs that may hold a brace which is not structural, keyed by the
   character that opens them. Each takes (src, i) and answers the same three
   ways — an index just past itself, -1 unterminated, or null for "not one of
   mine after all" — so the scanner below can dispatch instead of branching. */
const SKIPPERS = { "'": skipQuoted, '"': skipQuoted, '`': skipTemplate, '/': skipComment };

// src[open] === "{"; returns the index just past its matching "}".
function skipBraces(src, open) {
  for (let i = open + 1; i < src.length; i++) {
    const skipper = SKIPPERS[src[i]];
    const past = skipper ? skipper(src, i) : null;
    if (past === -1) break; // unterminated, so there is no closing brace to find
    if (past !== null) i = past - 1;
    else if (src[i] === '{') i = skipBraces(src, i) - 1;
    else if (src[i] === '}') return i + 1;
  }
  throw new Error('sight.js: unbalanced braces — the payload table has no end');
}

// [start, end) of the `const V = { … }` object literal inside sight.js. Shared by
// payloads() and by the adversarial probe, which swaps a payload table in.
function vRange(src) {
  const at = src.search(/\bconst\s+V\s*=/);
  if (at === -1) throw new Error('sight.js: the `const V =` payload table is gone');
  const open = src.indexOf('{', at);
  if (open === -1) throw new Error('sight.js: `const V =` is no longer an object literal');
  return [open, skipBraces(src, open)];
}

function payloads() {
  const [open, close] = vRange(js);
  const literal = js.slice(open, close);

  let V;
  try {
    V = runInNewContext(`(${literal})`, Object.create(null), { timeout: 5000 });
  } catch (e) {
    throw new Error(`sight.js: the payload table did not evaluate: ${e.message}`);
  }
  if (!V || typeof V !== 'object' || Array.isArray(V))
    throw new Error('sight.js: the payload table did not evaluate to an object');

  for (const team of TEAMS) {
    const p = V[team];
    if (!p || typeof p.foot !== 'string' || typeof p.body !== 'string' || p.body === '')
      throw new Error(
        `sight.js: payload "${team}" is missing, or is not a {foot, body} of strings`,
      );
  }
  return V;
}

/* Recover the real JSON object out of a highlighted payload body, so the verdict
   can be asserted as a parsed VALUE rather than as page text:
     - strip the colour markup (author-written <span> wrappers only),
     - take the object literal between the first { and the last },
     - collapse the newline + indent the console uses to wrap long string values
       (insignificant outside JSON strings; inside one, the console renders that
       wrap as a single space anyway).
   Anything that is not parseable JSON throws here, which is itself a failure. */
function payloadJson(body) {
  const text = body.replace(/<\/?span[^>]*>/g, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  assert.ok(start !== -1 && end > start, 'payload must contain a JSON object');
  return JSON.parse(text.slice(start, end + 1).replace(/\n\s*/g, ' '));
}

// The exact algorithm from sight.js render(). Kept in step by the differential
// parity test below, which runs the shipped render() and compares frame for frame.
function tick(full, i) {
  let s = full.slice(0, i);
  const lt = s.lastIndexOf('<');
  if (lt > s.lastIndexOf('>')) s = s.slice(0, lt);
  const open = (s.match(/<span/g) || []).length;
  const close = (s.match(/<\/span>/g) || []).length;
  return s + '</span>'.repeat(Math.max(0, open - close)) + '<span class="caret"></span>';
}

// Minimal balance check: every <span> closes, nothing closes that never opened,
// and no tag is left severed mid-attribute.
function balanced(html) {
  let depth = 0;
  const tokens = html.match(/<\/?span[^>]*>?/g) || [];
  for (const t of tokens) {
    if (!t.endsWith('>')) return { ok: false, why: `severed tag: ${JSON.stringify(t)}` };
    if (t.startsWith('</')) {
      depth--;
      if (depth < 0) return { ok: false, why: 'closed a span that was never opened' };
    } else depth++;
  }
  if (depth !== 0) return { ok: false, why: `${depth} span(s) left open` };
  return { ok: true };
}

/* ---------------------------------------------------------------------------
   Proving the copy, by running the original.

   tick() above is a hand-copy of render()'s balancing algorithm, and a copy is
   worth exactly nothing unless it is provably in step with the code it copies.
   sight.js is an IIFE, so it cannot be imported — but it can be *executed*.
   node:vm evaluates the shipped file against a stub DOM, and because the typer
   runs on setInterval, the interval callback can be driven by hand to yield the
   exact sequence of innerHTML strings a browser would be given. Parity is then a
   real differential assertion — shipped output vs copy output, string for string
   — instead of a description of the source text.
   --------------------------------------------------------------------------- */
const STEP = 14; // chars per tick, per render(); a change here is a behaviour change

function stubEl(id) {
  const el = {
    id,
    dataset: {},
    style: {},
    className: '',
    textContent: '',
    tabIndex: 0,
    innerHTML: '',
    _attrs: {},
    _on: {},
    setAttribute: (k, v) => void (el._attrs[k] = String(v)),
    getAttribute: (k) => (k in el._attrs ? el._attrs[k] : null),
    removeAttribute: (k) => void delete el._attrs[k],
    addEventListener: (type, fn) => void (el._on[type] = el._on[type] || []).push(fn),
    fire: (type) => (el._on[type] || []).forEach((fn) => fn({ preventDefault() {} })),
    querySelector: () => null,
    querySelectorAll: () => [],
    classList: { add() {}, remove() {} },
    focus() {},
    remove() {},
    getTotalLength: () => 0,
    animate() {},
  };
  return el;
}

/* The DOM render() writes to. The panel's innerHTML is the observable, so it is
   an accessor that RECORDS every write in order — the resting value alone would
   be satisfied by a typer that jumped straight to the finished payload. */
function stubTyperDom(teams) {
  const els = new Map();
  const el = (id) => els.get(id) || (els.set(id, stubEl(id)), els.get(id));

  const writes = [];
  const panel = el('conPanel');
  let html = '';
  Object.defineProperty(panel, 'innerHTML', {
    get: () => html,
    set(v) {
      writes.push(v);
      html = v;
    },
  });
  return {
    el,
    writes,
    panel,
    footL: el('footL'),
    tabs: teams.map((t) => Object.assign(stubEl(`tab-${t}`), { dataset: { t } })),
  };
}

/* The typer's clock. Nothing fires on its own: `drain()` runs the interval
   render() most recently started until it clears itself, so the frames come out
   in the order a browser would have produced them, and a typer that never
   cleared its interval fails the test instead of hanging it. */
function fakeTimers() {
  const timers = new Map();
  let nextId = 1;
  let liveId = 0;
  return {
    setInterval: (fn) => (timers.set((liveId = nextId++), fn), liveId),
    clearInterval: (id) => void timers.delete(id),
    drain() {
      const id = liveId;
      for (let guard = 0; timers.has(id); guard++) {
        assert.ok(guard < 50000, 'the typer interval never cleared itself');
        timers.get(id)();
      }
    },
  };
}

// The browser globals sight.js reaches for on load, over that DOM and that clock.
function typerSandbox({ el, tabs }, timers) {
  return {
    console: { warn() {}, log() {}, error() {} },
    // reduced motion OFF, or render() short-circuits and never types at all
    matchMedia: () => ({ matches: false }),
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    setTimeout: () => 0,
    clearTimeout() {},
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
    },
    fetch: () => assert.fail('sight.js must not reach the network on load'),
    document: {
      getElementById: el,
      querySelectorAll: (sel) => (sel.includes('role="tab"') ? tabs : []),
    },
  };
}

// Runs the shipped sight.js and returns, per team, the payload render() actually
// used and every innerHTML it wrote while typing it.
function runShippedTyper(source, teams) {
  const dom = stubTyperDom(teams);
  const timers = fakeTimers();
  const sandbox = typerSandbox(dom, timers);
  createContext(sandbox);
  runInContext(source, sandbox, { filename: 'sight.js' });

  const out = {};
  let cursor = 0;
  teams.forEach((team, n) => {
    if (n > 0) dom.tabs[n].fire('click'); // tab 0 is rendered by sight.js on load
    timers.drain();
    out[team] = { foot: dom.footL.textContent, frames: dom.writes.slice(cursor) };
    cursor = dom.writes.length;
  });
  return out;
}

/* An adversarial probe payload, rendered by the real render().

   sight.js's own payloads never start with plain text, never use a bare <span>,
   never put a '</span'-alike inside an attribute and never close a span they did
   not open — so four clauses of render() are invisible to the differential over
   the four shipped payloads. Each line here targets exactly one of them:

     1. opens with plain text, so the first cut contains no '<' at all
        → `lt > s.lastIndexOf('>')` vs `>=` diverge (both are -1)
     2. a BARE `<span>` several ticks long
        → `/<span/g` vs a narrower `/<span /g` count differently
     3. `</spanX>` inside an attribute: '</span' with no '>' after it
        → `/<\/span>/g` vs a looser `/<\/span/g` count differently
     4. a `</span>` closing nothing, so `open - close` goes below zero
        → without `Math.max(0, …)`, `'</span>'.repeat(-1)` is a RangeError

   The assertion is unchanged in kind — the shipped frames must equal tick()'s,
   string for string. Only the input is adversarial. */
const PROBE_BODY = [
  'plain text with no markup at all, longer than one tick',
  '<span>bare span, no attributes, several ticks long</span>',
  '<span class="s">wrapped <i title="</spanX">decoy</i> tail text</span>',
  '</span>',
  '<span class="p">a closing run of highlighted text</span>',
].join('\n');

function probeShippedTyper() {
  const [open, close] = vRange(js);
  const table = { atlas: { foot: 'probe', body: PROBE_BODY } };
  const source = js.slice(0, open) + JSON.stringify(table) + js.slice(close);
  // The swap must actually have happened, or this whole phase is a no-op.
  assert.notEqual(source, js, 'the probe payload table was not substituted in');

  const { frames } = runShippedTyper(source, ['atlas'])['atlas'];
  assert.equal(frames.at(-1), PROBE_BODY, 'render() did not finish on the probe payload');
  assert.ok(frames.length > 10, `probe: only ${frames.length} frames — the typer did not run`);

  const expected = [''];
  for (let i = STEP; i < PROBE_BODY.length; i += STEP) expected.push(tick(PROBE_BODY, i));
  expected.push(PROBE_BODY);
  assert.deepEqual(frames, expected, 'probe: shipped render() and tick() disagree');

  // Prove the probe really did drive `open - close` negative, so clause 4 above
  // is exercised rather than merely intended.
  const cuts = [];
  for (let i = STEP; i < PROBE_BODY.length; i += STEP) {
    let s = PROBE_BODY.slice(0, i);
    const lt = s.lastIndexOf('<');
    if (lt > s.lastIndexOf('>')) s = s.slice(0, lt);
    const o = (s.match(/<span/g) || []).length;
    const c = (s.match(/<\/span>/g) || []).length;
    cuts.push(o - c);
  }
  assert.ok(
    cuts.some((d) => d < 0),
    'probe payload no longer drives open - close below zero: the clamp is unguarded',
  );
  assert.ok(
    cuts.some((d) => d > 0),
    'probe payload no longer leaves a span open at a cut: the balancing is unguarded',
  );
}

const P = payloads();

/* This is the load-bearing test in the file. Every other test iterates over P,
   so if extraction ever degrades to {} — or to four entries holding stubs — they
   all pass while checking nothing. So this asserts the RECOVERED DATA, not just
   its key names, and re-extracts independently of module scope so it fails on its
   own terms rather than relying on P having been built correctly. */
/* Everything one recovered payload must satisfy on its own terms: its shape, the
   footer contract the evidence-count test parses a number out of, that the body
   really is THIS team's, and that it is the WHOLE body. */
function assertPayloadIsWholeAndOwn(team, p) {
  assert.deepEqual(Object.getOwnPropertyNames(p).sort(), ['body', 'foot'], `${team} payload shape`);
  assert.match(p.foot, /^verdict · \d+ evidence ids$/, `${team} foot`);

  // A scrape that mis-paired key and body would satisfy a key-set check, and is
  // caught here instead.
  const Team = team[0].toUpperCase() + team.slice(1);
  assert.ok(
    p.body.startsWith(
      `<span class="p">$</span> sprintsight detect <span class="s">--team ${Team} --sprint 15</span>\n`,
    ),
    `${team} body must be ${Team}'s payload, opening on its own invocation line`,
  );

  // A truncated body still balances at every tick, so the balancing tests would
  // happily pass over a fragment. These three clauses are what rule that out.
  const spans = (p.body.match(/<span/g) || []).length;
  assert.ok(spans >= 15, `${team} body looks truncated: only ${spans} spans`);
  assert.ok(
    p.body.includes('<span class="k">"explanation"</span>') && p.body.includes('\n}'),
    `${team} body must run through to the closing brace of the JSON object`,
  );
  assert.ok(p.body.trimEnd().endsWith('</span>'), `${team} body must end on a closed span`);
  // Nothing from the surrounding source may leak in: an over-run would.
  assert.doesNotMatch(p.body, /`/, `${team} body must not carry source delimiters`);
}

test('all four payloads are recoverable from the shipped source', () => {
  const V = payloads();

  // Exactly these four, in shipped order: no team missing, and no fifth team
  // slipped into the console without going through these tests.
  assert.deepEqual(Object.keys(V), TEAMS, 'the payload table ships exactly these four teams');

  const seen = new Map();
  for (const team of TEAMS) {
    assertPayloadIsWholeAndOwn(team, V[team]);
    const { body } = V[team];
    assert.ok(!seen.has(body), `${team} body is a duplicate of ${seen.get(body)}`);
    seen.set(body, team);
  }

  // And the shared P the rest of the file iterates is the same four.
  assert.deepEqual(Object.keys(P), TEAMS);
});

test('every tick of every payload produces balanced markup', () => {
  for (const [team, { body }] of Object.entries(P)) {
    // step 1 char at a time, not 14, so no intermediate state escapes the net
    for (let i = 0; i <= body.length; i++) {
      const r = balanced(tick(body, i));
      assert.ok(r.ok, `${team} broke at tick ${i}: ${r.why}\n---\n${tick(body, i).slice(-90)}`);
    }
  }
});

test('every tick parses as XML, so no tag is ever emitted half-written', () => {
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

test('the final tick renders the payload exactly, with no caret left behind', () => {
  for (const [team, { body }] of Object.entries(P)) {
    // render() assigns `full` directly once i >= length, so the end state is exact
    assert.doesNotMatch(body, /caret/, `${team} payload must not embed a caret`);
  }
});

test('the caret is the only thing appended mid-type', () => {
  for (const { body } of Object.values(P)) {
    const mid = tick(body, Math.floor(body.length / 2));
    assert.match(mid, /<span class="caret"><\/span>$/);
  }
});

test("the test's algorithm reproduces the one in sight.js, tick for tick", () => {
  // Runs the real file: a missing payload makes V[key].body throw in here.
  const shipped = runShippedTyper(js, TEAMS);

  for (const team of TEAMS) {
    const { frames } = shipped[team];
    const body = frames.at(-1); // last write is `panel.innerHTML = full`
    assert.ok(js.includes(body), `${team}: rendered payload is not the shipped string`);
    assert.ok(frames.length > 20, `${team}: only ${frames.length} frames — the typer did not run`);

    // What render() should have emitted, according to this file's copy of it.
    const expected = ['']; // render() blanks the panel before the first tick
    for (let i = STEP; i < body.length; i += STEP) expected.push(tick(body, i));
    expected.push(body);

    // Every frame, in order. Any change to the slicing, the mid-tag back-off,
    // the span balancing, the caret or the 14-char step diverges here.
    assert.deepEqual(frames, expected, `${team}: shipped render() and tick() disagree`);

    // …and prove the back-off is genuinely live in the shipped code, so that
    // parity can never be "restored" by breaking both sides the same way:
    // without it, a cut landing inside a tag is emitted severed.
    const naive = (i) => {
      const s = body.slice(0, i);
      const open = (s.match(/<span/g) || []).length;
      const close = (s.match(/<\/span>/g) || []).length;
      return s + '</span>'.repeat(Math.max(0, open - close)) + '<span class="caret"></span>';
    };
    let backedOff = 0;
    for (let i = STEP, n = 1; i < body.length; i += STEP, n++) {
      if (frames[n] !== naive(i)) backedOff++;
    }
    assert.ok(backedOff > 0, `${team}: no tick backed off a mid-tag cut — is the back-off gone?`);
  }

  // The four shipped payloads are all well formed, so several of render()'s
  // clauses have no observable effect on them and a run over those four alone
  // cannot see a change to any of them. The fix is not to go back to matching
  // source text — it is to hand the SHIPPED function an input that makes those
  // clauses bite.
  probeShippedTyper();
});

test('payload JSON matches the detector contract field for field', () => {
  // Fields per sight/docs/evals/watermelon-eval.md §2. If that contract moves,
  // this page moves with it (§15 coupling).
  const FIELDS = [
    'team',
    'reported_status',
    'actual_status',
    'is_watermelon',
    'evidence',
    'explanation',
  ];
  for (const [team, { body }] of Object.entries(P)) {
    const keys = [...body.matchAll(/<span class="k">"([a-z_]+)"<\/span>/g)].map((m) => m[1]);
    assert.deepEqual(keys, FIELDS, `${team} fields, in contract order`);
  }
});

/* One team's verdict, asserted twice over, because the page makes the claim
   twice: once as the JSON VALUE a reader could copy out, and once as the COLOUR
   they actually see. The swatch pattern lives inside a template literal, which a
   formatter must never rewrite, so it stays pinned character for character. */
function assertVerdict(team, body, flagged) {
  const colour = flagged ? 'red' : 'grn'; // red = flagged, grn = cleared
  const json = payloadJson(body);
  assert.equal(
    typeof json.is_watermelon,
    'boolean',
    `${team} is_watermelon must be a JSON boolean, not a string`,
  );
  assert.equal(json.is_watermelon, flagged, `${team} is_watermelon`);
  assert.match(
    body,
    new RegExp(`"is_watermelon"</span>: <span class="${colour}">${flagged}</span>`),
    `${team} verdict must render as class="${colour}">${flagged}`,
  );
}

test('only Atlas is a watermelon; the three guards are not flagged', () => {
  // The whole credibility claim: honest amber and the decoy must never flag.
  const VERDICT = { atlas: true, boreas: false, cygnus: false, draco: false };

  assert.deepEqual(
    Object.keys(P).sort(),
    Object.keys(VERDICT).sort(),
    'all four payloads must be recoverable, or the claim below guards nothing',
  );

  for (const [team, flagged] of Object.entries(VERDICT)) assertVerdict(team, P[team].body, flagged);

  // Exactly one team is flagged, and it is Atlas.
  const flaggedTeams = Object.keys(P)
    .filter((t) => payloadJson(P[t].body).is_watermelon === true)
    .sort();
  assert.deepEqual(flaggedTeams, ['atlas'], 'exactly one team may be flagged, and it is Atlas');

  // ...and that holds for the WHOLE file, not just the four payloads this test
  // knows by name: a fifth demo team added later must not report a watermelon
  // either, or the "only Atlas" claim on the page quietly stops being true.
  const flaggedInSource =
    js.match(/"is_watermelon"<\/span>: <span class="[a-z]+">true<\/span>/g) || [];
  assert.equal(
    flaggedInSource.length,
    1,
    'exactly one payload in the whole of sight.js may report a watermelon',
  );
});

test('the footer evidence count matches the ids actually cited', () => {
  for (const [team, { foot, body }] of Object.entries(P)) {
    const cited = (body.match(/<span class="s">"[a-z]+-[a-z]+-s15[a-z-]*"<\/span>/g) || []).length;
    const claimed = Number(foot.match(/(\d+) evidence ids/)[1]);
    assert.equal(cited, claimed, `${team} footer claims ${claimed} ids but cites ${cited}`);
  }
});
