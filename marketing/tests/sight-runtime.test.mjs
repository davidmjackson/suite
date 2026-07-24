// tests/sight-runtime.test.mjs
// Executable tests for the Sprintsight promo page runtime (sight.js).
//
// The rest of the promo suite (tests/page.test.mjs) greps the source, because
// sight.js is an IIFE against the DOM and there is no jsdom here. Those greps
// pin the FORM of the implementation rather than its behaviour, which is a weak
// guarantee: `assert.match(js, /if \(p\.getAttribute\("stroke-dasharray"\)\) return;/)`
// passes for a file that never runs, and fails for a working one whose quotes
// changed. Six of them were exactly that shape.
//
// So sight.js is RUN here instead, in the stub browser from ./sight-stub.mjs,
// and the assertions are about what the page DOES. No jsdom, and nothing mocks
// the unit under test.
//
// These live in their own file because page.test.mjs is already a god-file
// asserting across HTML, CSS, JS, SVG, PNG and an external doc. These six are
// the only tests that need a DOM, so they get their own reason to change rather
// than becoming a seventh one for that file. (Same split, same reason, as
// hub/tests/consent-runtime.test.js out of hub/tests/consent-banner.test.js.)
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { html, js, TABS, runSight } from "./sight-stub.mjs";

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

/* Lifts the typewriter tick out of sight.js as a callable: from the slice that
   starts it to the setInterval's closer. Both anchors are code, not formatting,
   and if either moves this THROWS rather than silently passing, so a refactor can
   never quietly disarm the guard. Repo-owned source only — `js` is read from our
   own public/ tree, never user input — and compiled once, so the whole sweep
   below costs a single context. */
function liftTypewriterTick() {
  const from = js.search(/let s = full\.slice\(0, i\);/);
  const rest = from < 0 ? -1 : js.slice(from).search(/\n\s*\},\s*\d+\);/);
  assert.ok(from >= 0 && rest > 0, "typewriter tick not found in sight.js — guard is blind");
  const tickBody = js.slice(from, from + rest);
  assert.match(tickBody, /panel\.innerHTML\s*=/, "the tick must write the panel");
  return new vm.Script(
    `(function (full, i) { const panel = {}; ${tickBody}\n return panel.innerHTML; })`
  ).runInNewContext({});
}

const TAG = /<\/?[a-zA-Z][^<>]*>/g;
const textOf = (s) => s.replace(TAG, "");

/* Every possible cut of one payload must yield parseable, balanced markup whose
   visible text is an untruncated prefix of the payload's. */
function assertEveryCutIsBalanced(tick, full) {
  const wanted = textOf(full);
  let shown = 0;
  for (let i = 1; i <= full.length; i++) {
    const out = tick(full, i);
    const bare = textOf(out);

    // 1. Nothing may be left that is not a complete tag: a cut inside
    //    `<span class="p` leaves a stray angle bracket here, and its
    //    unterminated quote would swallow the next chunk of text as an
    //    attribute in a real browser.
    assert.ok(!/[<>]/.test(bare), `i=${i}: markup cut mid-tag, residue near ${residue(bare)}`);

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

// The 80 characters around the first stray angle bracket, for a failure message.
function residue(bare) {
  const at = bare.search(/[<>]/);
  return JSON.stringify(bare.slice(Math.max(0, at - 40), at + 40));
}

test("the typer re-balances spans, so markup never breaks mid-tag", () => {
  /* This used to grep sight.js for the literal `"</span>".repeat(...)` call, which
     said nothing about whether the markup actually survives a tick — and broke the
     moment a formatter changed the quotes. The typewriter tick is a pure
     string->string function of (full, i), so lift THAT out of the file and run it.
     The assertions are then behavioural, not textual. */
  const tick = liftTypewriterTick();

  // The real payloads, taken from the page as it renders them.
  const page = runSight({ reducedMotion: true });
  const payloads = TABS.map((_, i) => page.clickTab(i).panel.innerHTML);
  assert.equal(payloads.length, 4, "four console payloads to type out");

  for (const full of payloads) assertEveryCutIsBalanced(tick, full);
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
