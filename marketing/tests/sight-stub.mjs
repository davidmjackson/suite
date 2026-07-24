// tests/sight-stub.mjs
//
// The shipped Sprintsight promo page, and one stub browser to RUN it in.
//
// sight.js is an IIFE against the DOM with no exports, so it cannot be imported
// — but it can be executed. There is no jsdom here, so this module provides the
// smallest browser sight.js will run against: one node factory serving every
// node the page touches, each keeping a write log so a test can assert a whole
// pending -> error -> restored SEQUENCE rather than a resting state that a
// handler which never ran would also satisfy.
//
// Two properties make it hard to fool. Selectors route by SUBSTRING against the
// children a test supplied, and timers are fake and hand-driven — so DOM code
// added to sight.js degrades to a no-op here rather than to a false pass, and
// nothing happens until a test says it does.
//
// It is a module rather than a block at the top of sight-runtime.test.mjs
// because it is a second thing that file would otherwise be doing, and because
// the harness changes when the PAGE changes while the tests change when the
// CLAIMS do.
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

/* Defines `name` on n as a LOGGED property: reads return the current value,
   writes both store it and append to the log. Seeded through the backing
   variable rather than through the setter, so a seed never shows up in the log
   as though the page had written it. */
function defineLogged(n, name, seed, record) {
  let value = seed;
  Object.defineProperty(n, name, {
    enumerable: true,
    get: () => value,
    set(v) {
      value = v;
      record(v);
    },
  });
}

/* The plain seeded fields: what a test hands the node, and what the page may read
   or overwrite without that being an observation worth recording. */
function seedFields(opts) {
  return {
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
  };
}

/* The attribute surface over one Map. READS are logged too (`asked`), because
   "the skip is decided by the stroke-dasharray attribute" is a claim about what
   the page looked at, not only about what it wrote. */
function attrApi(attrs, log) {
  return {
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
  };
}

/* Listener registry plus a hand-driven dispatch: no event ever fires by itself,
   so a test states which handler the page bound and when it runs. */
function eventApi(n) {
  return {
    addEventListener(type, fn) {
      (n.listeners[type] ||= []).push(fn);
    },
    dispatch(type, ev = {}) {
      for (const fn of n.listeners[type] || []) fn({ preventDefault() {}, ...ev });
    },
  };
}

/* Selector routing by SUBSTRING against the keys of `kids`, so a node only
   answers for children a test gave it and new DOM code in sight.js degrades to a
   no-op here rather than to a false pass. */
function queryApi(n) {
  return {
    querySelector: (sel) => n.querySelectorAll(sel)[0] || null,
    querySelectorAll(sel) {
      for (const [key, val] of Object.entries(n.kids)) if (sel.includes(key)) return val;
      return [];
    },
  };
}

/* The SVG line-draw surface, both halves logged: proving the dashed connector is
   skipped means proving it was never measured AND never animated. */
function svgApi(log) {
  return {
    getTotalLength() {
      log.measured++;
      return 120;
    },
    animate(frames, options) {
      log.animated.push({ frames, opts: options });
    },
  };
}

function stubNode(opts = {}) {
  const attrs = new Map(Object.entries(opts.attrs || {}));
  const log = { text: [], html: [], disabled: [], attrs: [], asked: [], animated: [], measured: 0 };

  const n = {
    log,
    ...seedFields(opts),
    ...attrApi(attrs, log),
    ...svgApi(log),
    focus() {},
    remove() {
      n.removed = true;
    },
    checkValidity: () => opts.valid !== false,
  };
  // These three close over n, so they are attached once it exists.
  Object.assign(n, eventApi(n), queryApi(n));
  n.classList = {
    add: (c) => n.classes.add(c),
    remove: (c) => n.classes.delete(c),
    contains: (c) => n.classes.has(c),
  };

  defineLogged(n, "textContent", opts.textContent ?? "", (v) => log.text.push(v));
  defineLogged(n, "innerHTML", "", (v) => log.html.push(v));
  defineLogged(n, "disabled", false, (v) => log.disabled.push(v));
  return n;
}

/* The reveal block: a counter with its suffix markup, a bar, and two .ln paths —
   one already dashed (the chat connector, tell 02) and one plain, so the
   line-draw's skip can be shown to be conditional rather than blanket. */
function revealBlock() {
  const suffix = stubNode({ outerHTML: '<span class="suffix">/4</span>' });
  const counter = stubNode({ dataset: { n: "4" }, kids: { span: [suffix] } });
  const bar = stubNode({ dataset: { w: "100" } });
  const dashedPath = stubNode({ attrs: { "stroke-dasharray": "3 3" } });
  const solidPath = stubNode();
  const reveal = stubNode({
    kids: { "[data-n]": [counter], ".bar i": [bar], ".ln": [dashedPath, solidPath] },
  });
  return { reveal, counter, bar, dashedPath, solidPath };
}

/* The notify form. `label` seeds the button so that "restores the label" is
   testable against a label the handler cannot have hard-coded, and `msg` starts
   empty on purpose so "the user was told something" cannot pass by default. */
function notifyForm(label, valid) {
  const btn = stubNode({ textContent: label });
  return {
    btn,
    form: stubNode({ kids: { button: [btn] } }),
    input: stubNode({ value: "someone@example.com", valid }),
    msg: stubNode(),
  };
}

/* The document sight.js sees. Unknown ids are created on demand, so DOM code
   added to the page degrades to a no-op stub here rather than throwing, and the
   two selector queries it makes are routed to the real nodes above. */
function stubDocument({ tabNodes, reveal, notify }) {
  const byId = {
    conPanel: null,
    footL: null,
    notifyForm: notify.form,
    notifyEmail: notify.input,
    notifyMsg: notify.msg,
  };
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
  return doc;
}

/* What the page did to the BROWSER rather than to the DOM: the queries it asked,
   what it warned about, what it tried to send, the timers it started and the
   observer it registered. One object, shared by the sandbox that records into it
   and the api that reads it back. */
function recorder() {
  return {
    mediaQueries: [],
    warned: [],
    sent: [],
    live: new Map(),
    timeouts: [],
    intervalsStarted: 0,
    ioCallback: null,
    nextId: 1,
  };
}

// Motion: the preference the page asks about, and the observer it registers.
function motionGlobals(rec, reducedMotion) {
  return {
    matchMedia(q) {
      rec.mediaQueries.push(q);
      // only the reduce query flips; anything else this page asks about is false
      return { media: q, matches: reducedMotion && /prefers-reduced-motion\s*:\s*reduce/.test(q) };
    },
    IntersectionObserver: class {
      constructor(cb) {
        rec.ioCallback = cb;
      }
      observe() {}
      unobserve() {}
    },
  };
}

// Fake timers. Nothing fires by itself; runTimers() below drives them by hand.
function timerGlobals(rec) {
  return {
    setInterval(fn) {
      rec.intervalsStarted++;
      const id = rec.nextId++;
      rec.live.set(id, fn);
      return id;
    },
    clearInterval: (id) => void rec.live.delete(id),
    setTimeout(fn) {
      rec.timeouts.push(fn);
      return rec.nextId++;
    },
  };
}

function sightSandbox({ doc, reducedMotion, fetchImpl }, rec) {
  const sandbox = {
    document: doc,
    console: { ...console, warn: (...a) => rec.warned.push(a.join(" ")) },
    ...motionGlobals(rec, reducedMotion),
    ...timerGlobals(rec),
    // Rejects by default, so the catch block is reached whether or not an
    // endpoint is configured; pass fetchImpl to observe the call or to succeed.
    fetch: (...args) => {
      rec.sent.push(args);
      return fetchImpl ? fetchImpl(...args) : Promise.reject(new Error("network down"));
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

/* Drives every pending timer to exhaustion. Bounded, so a runaway animation
   fails the test rather than hanging it. */
function runTimers(rec, limit) {
  let ticks = 0;
  do {
    for (const fn of rec.timeouts.splice(0)) fn();
    for (const [id, fn] of [...rec.live]) if (rec.live.has(id)) fn();
    if (++ticks > limit) throw new Error("timers never settled");
  } while (rec.live.size || rec.timeouts.length);
}

/* Runs the page's own submit handler, and asserts there is exactly one to run: a
   form the page never bound would otherwise satisfy every recovery assertion by
   leaving the button in its untouched initial state. */
async function submitForm(api) {
  const handlers = api.form.listeners.submit || [];
  assert.equal(handlers.length, 1, "sight.js binds a submit handler to #notifyForm");
  await handlers[0]({
    preventDefault() {
      api.prevented++;
    },
  });
  return api;
}

// The nodes and recordings a test reads back, flat, because every assertion in
// this file starts `page.<something>`.
function sightNodes({ doc, rec, tabNodes, rv, notify, label }) {
  return {
    mediaQueries: rec.mediaQueries,
    warned: rec.warned,
    sent: rec.sent,
    label,
    tabNodes,
    counter: rv.counter,
    bar: rv.bar,
    dashedPath: rv.dashedPath,
    solidPath: rv.solidPath,
    form: notify.form,
    btn: notify.btn,
    msg: notify.msg,
    panel: doc.getElementById("conPanel"),
    foot: doc.getElementById("footL"),
  };
}

/* The hand-driven half: scroll, click, let time pass, submit. Each returns the
   api so a test can state its sequence in one line.  */
function sightDrivers(api, rec, reveal) {
  return {
    ariaBusy: () => api.form.getAttribute("aria-busy"),
    busyLog: () => api.form.log.attrs.filter((a) => a.includes("aria-busy")),
    /* Fires the IntersectionObserver for the reveal block, as scrolling would. */
    scrollIntoView() {
      assert.ok(rec.ioCallback, "sight.js observes the reveal blocks");
      rec.ioCallback([{ isIntersecting: true, target: reveal }]);
      return api;
    },
    clickTab(i) {
      api.tabNodes[i].dispatch("click");
      return api;
    },
    drainTimers(limit = 50000) {
      runTimers(rec, limit);
      return api;
    },
    prevented: 0,
    submit: () => submitForm(api),
  };
}

function runSight({ reducedMotion = false, valid = true, fetchImpl, label = SHIPPED_LABEL } = {}) {
  // Without this an extraction that silently returned nothing would seed the
  // button with undefined, and every label assertion would pass vacuously.
  assert.ok(label, "the submit button has a label to restore");
  assert.ok(TABS.length > 0 && TABS.every((t) => t.id && t.key), "the page ships a wired tablist");

  const rec = recorder();
  const tabNodes = TABS.map((t) => stubNode({ id: t.id, dataset: { t: t.key } }));
  const rv = revealBlock();
  const notify = notifyForm(label, valid);
  const doc = stubDocument({ tabNodes, reveal: rv.reveal, notify });

  const sandbox = sightSandbox({ doc, reducedMotion, fetchImpl }, rec);
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox, { filename: "sight.js" });

  const api = {
    ...sightNodes({ doc, rec, tabNodes, rv, notify, label }),
    get intervalsStarted() {
      return rec.intervalsStarted;
    },
  };
  return Object.assign(api, sightDrivers(api, rec, rv.reveal));
}

/* The shipped page, its tablist, and the one way to run it. `stubNode` and the
   rest are deliberately not exported: a test that reaches for them is building
   its own fixture instead of driving the page. */
export { html, js, TABS, runSight };
