// tests/sight-runtime.test.mjs
// Executable tests for the Sprintsight promo page's runtime (sight.js).
//
// The rest of the promo suite (tests/page.test.mjs) greps the source, because
// sight.js is an IIFE against the DOM and there is no jsdom here. Those greps
// pin the FORM of the implementation rather than its behaviour, which is a weak
// guarantee: `assert.match(js, /if \(p\.getAttribute\("stroke-dasharray"\)\) return;/)`
// passes for a file that never runs, and fails for a working one whose quotes
// changed. Six of them were exactly that shape.
//
// So sight.js is RUN here instead: executed in a vm over ONE stub browser that
// records what it did, and the assertions are about what the page does. No
// jsdom, and nothing mocks the unit under test.
//
// These live in their own file because page.test.mjs is already a god-file
// asserting across HTML, CSS, JS, SVG, PNG and an external doc. These six are
// the only tests that need a DOM, so they get their own reason to change rather
// than becoming a seventh one for that file. (Same split, same reason, as
// hub/tests/consent-runtime.test.js out of hub/tests/consent-banner.test.js.)
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "public");
const INTRO = join(PUBLIC, "sprintsight-coming-soon/intro");
const html = readFileSync(join(INTRO, "index.html"), "utf8");
const js = readFileSync(join(INTRO, "sight.js"), "utf8");

// The real tab buttons — ids and payload keys — straight from the page, so the
// harness drives the tablist the page actually ships rather than a fixture of it.
const TABS = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => ({
  id: (m[0].match(/id="([^"]+)"/) || [])[1],
  key: (m[0].match(/data-t="([^"]+)"/) || [])[1],
}));

/* Seeded from the copy the page actually ships, not a constant that can drift
   away from it — and overridable, because "restores the label" must mean the
   button's OWN label. A handler that re-assigns today's literal instead of the
   value it captured is invisible to a stub seeded with that same literal, and is
   a live bug the day the button's copy changes. */
const SHIPPED_LABEL = (html.match(/<button[^>]*type="submit"[^>]*>([^<]+)<\/button>/) || [])[1];

/* ---------- the stub browser -----------------------------------------------
   sight.js is an IIFE with no exports, so it cannot be imported — but it can be
   RUN. One node factory serves every node the page touches; each node keeps a
   write log, so a test can assert the whole pending -> error -> restored
   SEQUENCE rather than a resting state that a handler which never ran would also
   satisfy. Selectors route by substring and timers are fake and hand-driven, so
   adding DOM code to sight.js degrades to a no-op here rather than a false pass. */

function stubNode(opts = {}) {
  const attrs = new Map(Object.entries(opts.attrs || {}));
  // Seeded through the backing fields, never the setters: a seed must not show
  // up in the log as though the page had written it.
  let textContent = opts.textContent ?? "";
  let innerHTML = "";
  let disabled = false;

  const log = { text: [], html: [], disabled: [], attrs: [], asked: [], animated: [], measured: 0 };
  const n = {
    log,
    id: opts.id || "",
    dataset: { ...(opts.dataset || {}) },
    outerHTML: opts.outerHTML || "",
    kids: opts.kids || {},
    style: {},
    className: "",
    value: opts.value ?? "",
    tabIndex: 0,
    removed: false,
    classes: new Set(),
    listeners: Object.create(null),

    get textContent() {
      return textContent;
    },
    set textContent(v) {
      textContent = v;
      log.text.push(v);
    },
    get innerHTML() {
      return innerHTML;
    },
    set innerHTML(v) {
      innerHTML = v;
      log.html.push(v);
    },
    get disabled() {
      return disabled;
    },
    set disabled(v) {
      disabled = v;
      log.disabled.push(v);
    },

    setAttribute(k, v) {
      attrs.set(k, String(v));
      log.attrs.push(`+${k}=${v}`);
    },
    getAttribute(k) {
      log.asked.push(k);
      return attrs.has(k) ? attrs.get(k) : null;
    },
    removeAttribute(k) {
      attrs.delete(k);
      log.attrs.push(`-${k}`);
    },

    addEventListener(type, fn) {
      (n.listeners[type] ||= []).push(fn);
    },
    dispatch(type, ev = {}) {
      for (const fn of n.listeners[type] || []) fn({ preventDefault() {}, ...ev });
    },

    querySelector: (sel) => n.querySelectorAll(sel)[0] || null,
    querySelectorAll(sel) {
      for (const [key, val] of Object.entries(n.kids)) if (sel.includes(key)) return val;
      return [];
    },

    focus() {},
    remove() {
      n.removed = true;
    },
    checkValidity: () => opts.valid !== false,
    getTotalLength() {
      log.measured++;
      return 120;
    },
    animate(frames, options) {
      log.animated.push({ frames, opts: options });
    },
  };
  n.classList = {
    add: (c) => n.classes.add(c),
    remove: (c) => n.classes.delete(c),
    contains: (c) => n.classes.has(c),
  };
  return n;
}

function runSight({ reducedMotion = false, valid = true, fetchImpl, label = SHIPPED_LABEL } = {}) {
  // Without this an extraction that silently returned nothing would seed the
  // button with undefined, and every label assertion would pass vacuously.
  assert.ok(label, "the submit button has a label to restore");
  assert.ok(TABS.length > 0 && TABS.every((t) => t.id && t.key), "the page ships a wired tablist");

  const mediaQueries = [];
  const warned = [];
  const sent = [];
  const live = new Map();
  const timeouts = [];
  let nextId = 1;
  let intervalsStarted = 0;

  const tabNodes = TABS.map((t) => stubNode({ id: t.id, dataset: { t: t.key } }));

  // The reveal block: counter with its suffix markup, a bar, and two .ln paths —
  // one already dashed (the chat connector, tell 02) and one plain.
  const suffix = stubNode({ outerHTML: '<span class="suffix">/4</span>' });
  const counter = stubNode({ dataset: { n: "4" }, kids: { span: [suffix] } });
  const bar = stubNode({ dataset: { w: "100" } });
  const dashedPath = stubNode({ attrs: { "stroke-dasharray": "3 3" } });
  const solidPath = stubNode();
  const reveal = stubNode({
    kids: { "[data-n]": [counter], ".bar i": [bar], ".ln": [dashedPath, solidPath] },
  });

  // The notify form. `label` seeds the button so that "restores the label" is
  // testable against a label the handler cannot have hard-coded.
  const btn = stubNode({ textContent: label });
  const form = stubNode({ kids: { button: [btn] } });
  const input = stubNode({ value: "someone@example.com", valid });
  // starts empty on purpose: "the user was told something" must not pass by default
  const msg = stubNode();

  const byId = { conPanel: null, footL: null, notifyForm: form, notifyEmail: input, notifyMsg: msg };
  const doc = {
    getElementById(id) {
      if (!(id in byId) || byId[id] === null) byId[id] = stubNode({ id });
      return byId[id];
    },
    querySelectorAll(sel) {
      if (/role=["']tab["']/.test(sel)) return tabNodes;
      if (sel.includes(".rv")) return [reveal];
      return [];
    },
    querySelector: (sel) => doc.querySelectorAll(sel)[0] || null,
  };

  let ioCallback = null;
  const sandbox = {
    document: doc,
    console: { ...console, warn: (...a) => warned.push(a.join(" ")) },
    matchMedia(q) {
      mediaQueries.push(q);
      // only the reduce query flips; anything else this page asks about is false
      return { media: q, matches: reducedMotion && /prefers-reduced-motion\s*:\s*reduce/.test(q) };
    },
    IntersectionObserver: class {
      constructor(cb) {
        ioCallback = cb;
      }
      observe() {}
      unobserve() {}
    },
    setInterval(fn) {
      intervalsStarted++;
      const id = nextId++;
      live.set(id, fn);
      return id;
    },
    clearInterval: (id) => void live.delete(id),
    setTimeout(fn) {
      timeouts.push(fn);
      return nextId++;
    },
    // Rejects by default, so the catch block is reached whether or not an
    // endpoint is configured; pass fetchImpl to observe the call or to succeed.
    fetch: (...args) => {
      sent.push(args);
      return fetchImpl ? fetchImpl(...args) : Promise.reject(new Error("network down"));
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox, { filename: "sight.js" });

  const api = {
    mediaQueries,
    warned,
    sent,
    label,
    tabNodes,
    counter,
    bar,
    dashedPath,
    solidPath,
    form,
    btn,
    msg,
    panel: doc.getElementById("conPanel"),
    foot: doc.getElementById("footL"),
    get intervalsStarted() {
      return intervalsStarted;
    },
    ariaBusy: () => form.getAttribute("aria-busy"),
    busyLog: () => form.log.attrs.filter((a) => a.includes("aria-busy")),
    /* Fires the IntersectionObserver for the reveal block, as scrolling would. */
    scrollIntoView() {
      assert.ok(ioCallback, "sight.js observes the reveal blocks");
      ioCallback([{ isIntersecting: true, target: reveal }]);
      return api;
    },
    clickTab(i) {
      tabNodes[i].dispatch("click");
      return api;
    },
    /* Drives every pending timer to exhaustion. Bounded, so a runaway animation
       fails the test rather than hanging it. */
    drainTimers(limit = 50000) {
      let ticks = 0;
      do {
        for (const fn of timeouts.splice(0)) fn();
        for (const [id, fn] of [...live]) if (live.has(id)) fn();
        if (++ticks > limit) throw new Error("timers never settled");
      } while (live.size || timeouts.length);
      return api;
    },
    prevented: 0,
    async submit() {
      const handlers = form.listeners.submit || [];
      assert.equal(handlers.length, 1, "sight.js binds a submit handler to #notifyForm");
      await handlers[0]({
        preventDefault() {
          api.prevented++;
        },
      });
      return api;
    },
  };
  return api;
}

/* ---------- the no-JS console ---------------------------------------------- */

test("the console shows its default payload with JS off, and it matches sight.js", () => {
  // The panel is filled by JS, so without this it is a blank 352px dark box.
  // Embedded via <noscript> so that with JS on it is not rendered at all and the
  // typer still starts from empty — no flash of content.
  const panel = html.match(/<pre class="con-body"[^>]*>([\s\S]*?)<\/pre>/)[1];
  const fallback = panel.match(/<noscript>([\s\S]*)<\/noscript>/);
  assert.ok(fallback, "the panel carries a noscript fallback");

  // WHICH payload this has to be is not a constant: sight.js renders `tabs[0]`
  // on load, so the default is the FIRST tab in the markup. Derive it the way the
  // code does, then check the markup's own three claims about it agree — first
  // tab, the one aria-selected tab, and the panel's aria-labelledby.
  const picker = html.match(/<div class="picker"[\s\S]*?<\/div>/)[0];
  const tags = [...picker.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(tags.length > 0, "the tablist has tabs");
  const teams = tags.map((t) => t.match(/data-t="([a-z]+)"/)?.[1]);
  assert.ok(teams.every(Boolean), `every tab names its payload: ${JSON.stringify(teams)}`);
  const selected = tags.filter((t) => /aria-selected="true"/.test(t));
  assert.equal(selected.length, 1, "exactly one tab is selected on load");
  assert.equal(selected[0], tags[0], "sight.js renders tabs[0], so tabs[0] is the selected one");
  const team = teams[0];
  assert.equal(team, "atlas", "atlas is the default payload");
  const panelTag = html.match(/<pre class="con-body"[^>]*>/)[0];
  assert.match(panelTag, new RegExp(`aria-labelledby="tab-${team}"`), "panel names its tab");

  // The payload is duplicated from sight.js, so pin it: this is the only thing
  // stopping drift. Run the real file rather than matching its source text, so
  // the comparison is against what the page genuinely renders on load.
  const page = runSight({ reducedMotion: true });
  assert.ok(page.panel.innerHTML.length > 0, "the payload is not empty");
  assert.equal(page.panel.innerHTML, fallback[1], "the no-JS fallback must be ATLAS verbatim");

  // The footer line is typed by JS from the same payload; with JS off it is
  // whatever the HTML hard-codes, so it drifts just as silently.
  const footL = html.match(/<span id="footL">([\s\S]*?)<\/span>/);
  assert.ok(footL, "the console footer exists");
  assert.equal(page.foot.textContent, footL[1], "the no-JS footer must be that payload's foot");

  // Every tab the markup names must have a payload behind it, not just the
  // default one — a missing key throws inside render rather than rendering blank.
  for (let i = 0; i < teams.length; i++) {
    page.clickTab(i);
    assert.ok(page.panel.innerHTML.length > 0, `sight.js carries a ${teams[i]} payload`);
  }
});

/* ---------- the typer ------------------------------------------------------- */

test("the typer re-balances spans, so markup never breaks mid-tag", () => {
  /* This used to grep sight.js for the literal `"</span>".repeat(...)` call, which
     said nothing about whether the markup actually survives a tick — and broke the
     moment a formatter changed the quotes. The typewriter tick is a pure
     string->string function of (full, i), so lift THAT out of the file and run it.
     The assertions below are behavioural: every possible cut of every real payload
     must yield parseable, balanced markup whose visible text is an untruncated
     prefix of the payload's. */

  // Lift the tick body: from the slice that starts it to the setInterval's closer.
  // Both anchors are code, not formatting; if either moves the test throws rather
  // than silently passing, so a refactor can never quietly disarm this guard.
  const from = js.search(/let s = full\.slice\(0, i\);/);
  const rest = from < 0 ? -1 : js.slice(from).search(/\n\s*\},\s*\d+\);/);
  assert.ok(from >= 0 && rest > 0, "typewriter tick not found in sight.js — guard is blind");
  const tickBody = js.slice(from, from + rest);
  assert.match(tickBody, /panel\.innerHTML\s*=/, "the tick must write the panel");

  // Repo-owned source only; `js` is read from our own public/ tree, never user
  // input. Compiled once into a callable so the whole sweep costs one context.
  const tick = new vm.Script(
    `(function (full, i) { const panel = {}; ${tickBody}\n return panel.innerHTML; })`
  ).runInNewContext({});

  // The real payloads, taken from the page as it renders them.
  const page = runSight({ reducedMotion: true });
  const payloads = TABS.map((_, i) => page.clickTab(i).panel.innerHTML);
  assert.equal(payloads.length, 4, "four console payloads to type out");

  const TAG = /<\/?[a-zA-Z][^<>]*>/g;
  const textOf = (s) => s.replace(TAG, "");

  for (const full of payloads) {
    const wanted = textOf(full);
    let shown = 0;
    for (let i = 1; i <= full.length; i++) {
      const out = tick(full, i);
      const bare = textOf(out);

      // 1. Nothing may be left that is not a complete tag: a cut inside
      //    `<span class="p` leaves a stray angle bracket here, and its
      //    unterminated quote would swallow the next chunk of text as an
      //    attribute in a real browser.
      assert.ok(
        !/[<>]/.test(bare),
        `i=${i}: markup cut mid-tag, residue near ${JSON.stringify(
          bare.slice(Math.max(0, bare.search(/[<>]/) - 40), bare.search(/[<>]/) + 40)
        )}`
      );

      // 2. Every <span opened in the emitted string is closed again.
      const open = (out.match(/<span\b/g) || []).length;
      const close = (out.match(/<\/span>/g) || []).length;
      assert.equal(close, open, `i=${i}: ${open} <span> vs ${close} </span> — unbalanced`);

      // 3. What the reader sees is genuinely the start of the payload, not text
      //    mangled or eaten by a broken tag.
      assert.ok(wanted.startsWith(bare), `i=${i}: rendered text is not a prefix of the payload`);

      // 4. The console never goes backwards mid-type.
      assert.ok(bare.length >= shown, `i=${i}: text shrank from ${shown} to ${bare.length}`);
      shown = bare.length;
    }
    // 5. Backing off a partial tag costs text for at most one tick: by the last
    //    tick before the payload completes, every visible character has arrived.
    assert.equal(
      textOf(tick(full, full.length - 1)).length,
      wanted.length,
      "the final tick must have revealed the whole payload"
    );
  }
});

/* ---------- reduced motion (§8) --------------------------------------------- */

test("JS branches on reduced motion too, since CSS cannot stop a setInterval", () => {
  // Run the real file twice over the stub DOM: once as a reduced-motion user sees
  // it, once as everyone else does. CSS can suppress a transition; it cannot
  // suppress a setInterval, so the only proof is that no interval is ever
  // scheduled — and that the content arrives anyway, in full.
  const reduced = runSight({ reducedMotion: true }).scrollIntoView();
  const normal = runSight({ reducedMotion: false }).scrollIntoView();

  // 1. the preference is actually consulted, and consulted correctly
  assert.ok(
    reduced.mediaQueries.some((q) => /^\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)$/.test(q)),
    `sight.js must ask for (prefers-reduced-motion: reduce); it asked for: ${
      reduced.mediaQueries.join(", ") || "nothing"
    }`
  );

  // 2. nothing is left ticking. This is the whole point of the test.
  assert.equal(reduced.intervalsStarted, 0, "reduced motion must schedule no setInterval");

  // 3. ...and the animated path really does use one, so (2) is not vacuous.
  assert.ok(normal.intervalsStarted > 0, "the animated path is driven by setInterval");

  // 4. the console is fully populated immediately, not left empty or partial, and
  //    not left claiming to be busy. Compare against the settled animated result:
  //    reduced motion must lose motion, never content.
  normal.drainTimers();
  assert.ok(reduced.panel.innerHTML.length > 0, "the console is not left empty");
  assert.equal(reduced.panel.innerHTML, normal.panel.innerHTML, "same payload, no typing");
  assert.equal(reduced.panel.getAttribute("aria-busy"), "false");

  // 5. every tab's payload, not just the one that happens to render first
  for (let i = 0; i < reduced.tabNodes.length; i++) {
    reduced.clickTab(i);
    normal.clickTab(i).drainTimers();
    assert.equal(reduced.intervalsStarted, 0, `tab ${i} must not start a typer`);
    assert.equal(reduced.panel.innerHTML, normal.panel.innerHTML, `tab ${i} payload is complete`);
    assert.equal(reduced.foot.textContent, normal.foot.textContent, `tab ${i} footer is set`);
  }

  // 6. the counters land on their final value with their suffix markup intact
  assert.equal(reduced.counter.innerHTML, normal.counter.innerHTML);
  assert.match(reduced.counter.innerHTML, /^4</, "counter jumps straight to its target");
  assert.ok(reduced.counter.innerHTML.includes("/4"), "the suffix markup survives");

  // 7. the line-draw leaves the path alone rather than animating it
  assert.equal(reduced.solidPath.log.animated.length, 0, "no line-draw under reduced motion");
  assert.equal(normal.solidPath.log.animated.length, 1, "the line-draw does animate otherwise");
});

test("the dashed connector is skipped by the line-draw, or its dashes are destroyed", () => {
  // sight.js seeds every .ln path with strokeDasharray = getTotalLength() and
  // animates strokeDashoffset. A path that already carries stroke-dasharray (the
  // dashed chat connector, tell 02) must be skipped, or that seeding overwrites
  // the author's dash pattern and it renders as a solid line on the live page.
  // Assert the behaviour by scrolling the reveal into view for real.
  const { dashedPath: dashed, solidPath: solid } = runSight({ reducedMotion: false })
    .scrollIntoView();

  // The dashed chat connector: untouched, start to finish.
  assert.deepEqual(dashed.style, {}, "its dash pattern is never overwritten");
  assert.equal(dashed.log.measured, 0, "a dashed path is never measured");
  assert.equal(dashed.log.animated.length, 0, "a dashed path is never animated");
  assert.ok(
    dashed.log.asked.includes("stroke-dasharray"),
    "the skip is decided by the stroke-dasharray attribute itself"
  );

  // Positive control: the skip must be conditional, not a blanket early return,
  // or every solid path silently loses its line-draw and this test proves nothing.
  assert.equal(solid.log.measured, 1, "a plain path is measured");
  assert.equal(String(solid.style.strokeDasharray), "120", "seeded with its full length");
  assert.equal(String(solid.style.strokeDashoffset), "120", "and offset by it");
  assert.equal(solid.log.animated.length, 1, "a plain path is still line-drawn");
  const { frames, opts } = solid.log.animated[0];
  // Spread into a host array first: `frames` was built inside the vm, so its own
  // .map() returns an object with the sandbox's Array.prototype and deepEqual —
  // which compares prototypes — would reject a structurally identical result.
  assert.deepEqual(
    [...frames].map((f) => Number(f.strokeDashoffset)),
    [120, 0],
    "draws from fully-offset to 0"
  );
  assert.equal(opts.fill, "forwards", "the drawn line stays drawn");
});

/* ---------- the notify form (§7.10, spec §10 open item 1) -------------------- */

test("the error path fully restores the form, leaving nothing stuck", async () => {
  // NOTIFY_ENDPOINT is null, so EVERY real submit lands in the catch block. If it
  // forgets any of these the button stays disabled, its label stays "Sending…",
  // aria-busy stays true (screen readers keep announcing a busy region that never
  // settles) and/or the user is never told anything — the form is dead until a
  // page reload, with no visible reason. Assert the recovery, not just the
  // disable, and assert the pending state was genuinely entered first, so a
  // handler that silently did nothing at all cannot pass by omission.
  const page = runSight({ reducedMotion: true });
  await page.submit();

  assert.equal(page.prevented, 1, "ran, and stopped the native navigation");

  // the pending state was really entered ...
  assert.deepEqual(page.btn.log.disabled, [true, false], "disabled to send, re-enabled after");
  assert.equal(page.btn.log.text.length, 2, "label swapped for a pending label, then swapped back");
  assert.notEqual(page.btn.log.text[0], page.label, "showed a distinct pending label");
  assert.deepEqual(page.busyLog(), ["+aria-busy=true", "-aria-busy"], "busy set, then cleared");

  // ... and nothing is left stuck behind
  assert.equal(page.btn.disabled, false, "re-enables the button");
  assert.equal(page.btn.textContent, page.label, "restores the original button label");
  assert.equal(page.ariaBusy(), null, "clears aria-busy");
  assert.equal(page.form.removed, false, "leaves the form in place to retry with");
  assert.ok(page.msg.textContent.length > 0, "tells the user what happened");
  assert.match(page.msg.className, /\berr\b/, "and marks it as an error");

  // ... and the label it restores is the one that was THERE, not a re-typed copy
  // of today's copy. Same run against a different label: a handler that assigns a
  // literal passes above and fails here.
  const recopy = runSight({ reducedMotion: true, label: "Join the waiting list" });
  await recopy.submit();
  assert.equal(
    recopy.btn.textContent,
    "Join the waiting list",
    "restores the button's own label, whatever it is"
  );
});

test("submit never silently no-ops while the endpoint is unset", async () => {
  // Honesty guard, BUILD-SPEC §10 open item 1. There is no backend, so a submit
  // must ADMIT it failed: swallowing someone's address while showing a tick is
  // the one outcome worse than an error. Run the real handler and watch it.

  // The precondition the guard exists for: the endpoint is still unconfigured.
  // Quote- and whitespace-agnostic, but no vaguer — the initialiser must be null.
  const decl = js.match(/\bconst\s+NOTIFY_ENDPOINT\s*=\s*([^;]+);/);
  assert.ok(decl, "sight.js declares NOTIFY_ENDPOINT");
  assert.equal(decl[1].trim(), "null", "the endpoint is still unconfigured");

  // The fetch stub SUCCEEDS on purpose. The default one rejects, which would let a
  // deleted guard fall into the same catch block and fake this test green; with an
  // ok response, dropping the guard produces the success state instead and every
  // assertion below fires.
  const page = runSight({
    reducedMotion: true,
    fetchImpl: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
  });

  await page.submit();
  assert.equal(page.prevented, 1, "the handler ran and stopped the native post");

  // Nothing left the browser: there is nowhere to send it.
  assert.deepEqual(page.sent, [], "no request is made while NOTIFY_ENDPOINT is null");

  // It is loud for developers ...
  assert.equal(page.warned.length, 1, "exactly one console warning");
  assert.match(page.warned[0], /NOTIFY_ENDPOINT/, "and it names what is unset");

  // ... and honest to the user. Empty message = silent no-op; success copy or a
  // removed form = a lie. Both are failures.
  assert.ok(page.msg.textContent.length > 0, "the user is told the submit failed");
  assert.match(page.msg.className, /\berr\b/, "and it is marked as an error");
  assert.doesNotMatch(page.msg.textContent, /on the list/i, "never claims success");
  assert.equal(page.form.removed, false, "the form stays, so nothing looks accepted");
  assert.equal(page.btn.disabled, false, "and the button is usable again");

  // The mechanism stays the documented throw, so the shared catch renders the
  // error state rather than a second copy of it. Matched independently of quote style.
  assert.match(js, /throw new Error\(\s*(['"])NOTIFY_ENDPOINT not configured\1\s*\)/);
});
