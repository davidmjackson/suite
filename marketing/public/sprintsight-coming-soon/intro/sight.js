/* sight.js — Sprintsight promo page behaviour.
   Spec: marketing/docs/sprintsight-promo-BUILD-SPEC.md §8 (motion), §10 (open
   items), §11.4 (tab a11y). */
(() => {
  'use strict';

  /* ---------------------------------------------------------------------
     OPEN ITEM 1 (spec §10). No backend exists in marketing/ yet.
     While this is null the form reports the error state and warns here. That is
     deliberate: a form that silently swallows an address is worse than one that
     admits it failed. Set this to a real endpoint to go live — the five states
     below already work against it.
     A mailto: would also work with no backend, if that is preferred to a queue.
     --------------------------------------------------------------------- */
  const NOTIFY_ENDPOINT = null;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* =====================================================================
     Detector console
     ---------------------------------------------------------------------
     The four payloads are the content source of truth for the console.
     JSON shape tracks sight/docs/evals/watermelon-eval.md §2.
     Evidence ids track sight/docs/data/data-strategy.md §6 — do not invent ids.
     ===================================================================== */
  const V = {
    atlas: {
      foot: 'verdict · 3 evidence ids',
      body: `<span class="p">$</span> sprintsight detect <span class="s">--team Atlas --sprint 15</span>
<span class="cmt">// reading 4 sources · 61 artifacts · 2 sprints</span>

{
  <span class="k">"team"</span>: <span class="s">"Atlas"</span>,
  <span class="k">"reported_status"</span>: <span class="grn">"green"</span>,
  <span class="k">"actual_status"</span>: <span class="red">"red"</span>,
  <span class="k">"is_watermelon"</span>: <span class="red">true</span>,
  <span class="k">"evidence"</span>: [
    <span class="s">"burndown-atlas-s15"</span>,
    <span class="s">"slack-atlas-s15-msg-dep"</span>,
    <span class="s">"status-atlas-s15"</span>
  ],
  <span class="k">"explanation"</span>: <span class="s">"Reported on track for a
    second sprint while the burndown stayed flat
    (12 of 40 points). Velocity down ~30%, carry-over
    2 → 5. A dependency on Draco's auth API was raised
    in chat on 12 Jun and never logged in the RAID."</span>
}

<span class="red">▲ WATERMELON</span> <span class="p">· raise with the Atlas delivery lead before the portfolio review</span>`,
    },

    boreas: {
      foot: 'verdict · 2 evidence ids',
      body: `<span class="p">$</span> sprintsight detect <span class="s">--team Boreas --sprint 15</span>
<span class="cmt">// reading 4 sources · 48 artifacts · 2 sprints</span>

{
  <span class="k">"team"</span>: <span class="s">"Boreas"</span>,
  <span class="k">"reported_status"</span>: <span class="grn">"green"</span>,
  <span class="k">"actual_status"</span>: <span class="grn">"green"</span>,
  <span class="k">"is_watermelon"</span>: <span class="grn">false</span>,
  <span class="k">"evidence"</span>: [
    <span class="s">"burndown-boreas-s15"</span>,
    <span class="s">"raid-boreas-s15"</span>
  ],
  <span class="k">"explanation"</span>: <span class="s">"Burndown tracking to plan,
    38 of 40 points burned. Velocity stable. RAID is
    current, every risk owned and mitigated. Reported
    status matches the data."</span>
}

<span class="grn">✓ CLEAR</span> <span class="p">· a healthy team must never be flagged</span>`,
    },

    cygnus: {
      foot: 'verdict · 2 evidence ids',
      body: `<span class="p">$</span> sprintsight detect <span class="s">--team Cygnus --sprint 15</span>
<span class="cmt">// reading 4 sources · 52 artifacts · 2 sprints</span>

{
  <span class="k">"team"</span>: <span class="s">"Cygnus"</span>,
  <span class="k">"reported_status"</span>: <span class="amb">"amber"</span>,
  <span class="k">"actual_status"</span>: <span class="amb">"amber"</span>,
  <span class="k">"is_watermelon"</span>: <span class="grn">false</span>,
  <span class="k">"evidence"</span>: [
    <span class="s">"status-cygnus-s15"</span>,
    <span class="s">"raid-cygnus-s15"</span>
  ],
  <span class="k">"explanation"</span>: <span class="s">"Openly reports amber. The
    dependency slip and resourcing gap appear in both
    the status report and the RAID, and the burndown
    shows the slip honestly. Reported matches actual,
    so this is not a watermelon."</span>
}

<span class="amb">◆ HONEST AMBER</span> <span class="p">· candour is not punished</span>`,
    },

    draco: {
      foot: 'verdict · 2 evidence ids',
      body: `<span class="p">$</span> sprintsight detect <span class="s">--team Draco --sprint 15</span>
<span class="cmt">// reading 4 sources · 57 artifacts · 2 sprints</span>

{
  <span class="k">"team"</span>: <span class="s">"Draco"</span>,
  <span class="k">"reported_status"</span>: <span class="amb">"green → amber"</span>,
  <span class="k">"actual_status"</span>: <span class="amb">"amber"</span>,
  <span class="k">"is_watermelon"</span>: <span class="grn">false</span>,
  <span class="k">"evidence"</span>: [
    <span class="s">"bugspike-draco-s15"</span>,
    <span class="s">"triage-draco-s15"</span>
  ],
  <span class="k">"explanation"</span>: <span class="s">"A late-sprint bug spike looks
    alarming but is triaged, the burndown still holds,
    and the risk is logged with an owner. Draco moved
    itself to amber. Scary signal, under control."</span>
}

<span class="amb">◆ UNDER CONTROL</span> <span class="p">· the decoy case · precision guard</span>`,
    },
  };

  /* The console renders with innerHTML because the payloads carry colour markup.
     That is only safe because every string above is an author-written constant:
     nothing user-supplied or fetched ever reaches it, and the form's message
     element uses textContent. If these payloads ever become dynamic — served by
     a real detector, say — this must switch to building nodes or sanitising. */
  const panel = document.getElementById('conPanel');
  const footL = document.getElementById('footL');
  const tabs = Array.from(document.querySelectorAll('.picker [role="tab"]'));
  let typer = null;

  function render(key, tabId) {
    // Clear first, or rapid tab clicking interleaves two payloads into one <pre>.
    clearInterval(typer);
    const full = V[key].body;
    footL.textContent = V[key].foot;
    panel.setAttribute('aria-labelledby', tabId);

    if (reduce) {
      panel.innerHTML = full;
      panel.setAttribute('aria-busy', 'false');
      return;
    }

    let i = 0;
    panel.innerHTML = '';
    panel.setAttribute('aria-busy', 'true');
    typer = setInterval(() => {
      i += 14;
      if (i >= full.length) {
        panel.innerHTML = full;
        panel.setAttribute('aria-busy', 'false');
        clearInterval(typer);
        return;
      }
      // Two distinct ways a sliced HTML string breaks, and both bite here:
      //
      // 1. The cut lands INSIDE a tag ('<span class="p'). Balancing cannot fix
      //    this — the count sees an open <span, appends </span>, and yields
      //    '<span class="p</span>', whose unterminated quote swallows the next
      //    chunk of text as an attribute. ~40% of ticks land here, including the
      //    first. So back off to the last complete tag; the text simply arrives
      //    a tick later, which is invisible at 12ms.
      // 2. The cut lands after a complete <span> but before its </span>. That IS
      //    a balancing job: close the stragglers so the markup parses.
      let s = full.slice(0, i);
      const lt = s.lastIndexOf('<');
      if (lt > s.lastIndexOf('>')) s = s.slice(0, lt);
      const open = (s.match(/<span/g) || []).length;
      const close = (s.match(/<\/span>/g) || []).length;
      panel.innerHTML =
        s + '</span>'.repeat(Math.max(0, open - close)) + '<span class="caret"></span>';
    }, 12);
  }

  function select(tab, focus) {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1; // roving tabindex
    });
    if (focus) tab.focus();
    render(tab.dataset.t, tab.id);
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => select(tab, false));
    tab.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(tab);
      let next = null;
      if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      select(next, true);
    });
  });

  if (tabs.length) select(tabs[0], false);

  /* =====================================================================
     Reveals, counters, bars, line draws. All fire once, then unobserve.
     ===================================================================== */
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');

        e.target.querySelectorAll('.bar i').forEach((b) => {
          setTimeout(() => (b.style.width = b.dataset.w + '%'), 120);
        });

        e.target.querySelectorAll('[data-n]').forEach((el) => {
          const to = Number(el.dataset.n);
          // keep the suffix markup ("/4") intact on every tick
          const tail = el.querySelector('span')?.outerHTML || '';
          if (reduce) {
            el.innerHTML = to + tail;
            return;
          }
          let n = 0;
          const t = setInterval(() => {
            n++;
            el.innerHTML = n + tail;
            if (n >= to) clearInterval(t);
          }, 130);
        });

        e.target.querySelectorAll('.ln').forEach((p) => {
          if (reduce) return;
          // A path that already carries stroke-dasharray (the dashed chat
          // connector, tell 02) must be skipped or the dash pattern is destroyed.
          if (p.getAttribute('stroke-dasharray')) return;
          const L = p.getTotalLength();
          p.style.strokeDasharray = L;
          p.style.strokeDashoffset = L;
          p.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }], {
            duration: 900,
            fill: 'forwards',
            easing: 'ease-out',
          });
        });

        io.unobserve(e.target);
      });
    },
    { threshold: 0.15 },
  );
  document.querySelectorAll('.rv').forEach((el) => io.observe(el));

  /* =====================================================================
     Notify form — five states: idle, invalid, pending, success, error.
     Errors never apologise and always say what to do next.
     ===================================================================== */
  const form = document.getElementById('notifyForm');
  const input = document.getElementById('notifyEmail');
  const msg = document.getElementById('notifyMsg');

  function say(text, kind) {
    msg.textContent = text;
    msg.className = 'formmsg' + (kind ? ' ' + kind : '');
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      form.classList.add('attempted'); // only style :invalid after a real attempt

      if (!input.checkValidity()) {
        say("That email doesn't look right. Check and try again.", 'err');
        input.focus();
        return;
      }

      const btn = form.querySelector('button[type=submit]');
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Sending…';
      form.setAttribute('aria-busy', 'true');
      say('', null);

      try {
        if (!NOTIFY_ENDPOINT) {
          // Open item 1. Never let this look like it worked.
          console.warn(
            '[sprintsight] NOTIFY_ENDPOINT is not set — the signup form cannot ' +
              'deliver. See sight.js and BUILD-SPEC §10 item 1.',
          );
          throw new Error('NOTIFY_ENDPOINT not configured');
        }
        const res = await fetch(NOTIFY_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: input.value }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);

        // On success the form goes: never leave a live form behind a result.
        form.remove();
        say("You're on the list. We'll email you once, the day Sprintsight opens.", 'ok');
      } catch {
        btn.disabled = false;
        btn.textContent = label;
        form.removeAttribute('aria-busy');
        say("That didn't send. Try again in a moment.", 'err');
      }
    });
  }
})();
