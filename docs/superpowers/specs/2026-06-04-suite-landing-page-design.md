# Spec: sprintsuite.uk landing page ("Instrument" front door)

**Date:** 2026-06-04
**Surface:** hub repo (`/var/www/suite/hub`), Eta templates, server-rendered + progressively enhanced.
**Goal:** Replace the launcher-style `/` with an SEO-bearing marketing front door driving one action — passwordless sign-in.

**Authoritative design reference:** the approved prototype `A2-final.html` and the delivered build spec
`project-design-docs/new-landing-page/landing-page-build-spec.md` (kept verbatim). Where the build spec and
the prototype disagree, the build spec wins. **This codebase-reconciliation spec governs how the build spec
maps onto the existing hub.** The visual design is locked and not re-litigated here.

---

## 1. Context — what the hub already has

The hub already ships the Instrument design system the build spec assumes. These are **synced copies** of the
canonical foundation in `shared/theme/` (manifest in `shared/theme/manifest.mjs`), edit-here-only, drift-tested
by `tests/theme-drift.test.js`:

- `hub/public/css/instrument-core.css` — **this is the build spec's `theme-core.css`.** Tokens match exactly
  (oklch `--bone --panel --ink --soft --faint --line --line2 --green --greenwash --teal --tealwash --amber
  --amberwash`), plus `@font-face` (self-hosted woff2) and `.ins` components (`.btn`, `.btn-pri`, `.band`,
  `.waves`, `.eyebrow`, `.topbar`, `.brand`, …). Per-app accent already wired via `.ins[data-app=…]`.
- `hub/public/js/oscilloscope.js` — **this is the build spec's shared scope generator.** Exports `scopePath()`
  (geometry, `W=3600`, gaussian pulse — identical to the spec's inline generator) and `scopeSvg()`/`mountWaves()`.
- `hub/public/illos/glyphs.svg` — all five glyph `<symbol>`s (`#glyph-suite|raid|signal|retro|poker`).
- Eta templating via `views/partials/header.eta` + `footer.eta` (tuned for app sub-pages: short band, no CTA,
  no scrim). `routes/landing.js` renders `views/landing.eta` at `/`. `routes/dashboard.js` serves `/dashboard`.

**Governing constraint:** the `shared/theme/` foundation is **not edited** for this work. The drift test would
fail and the other four surfaces (signal/retro/poker/raid) would desync. All new CSS/JS is **hub-local landing
assets** that *reference* the foundation (tokens via `class="ins"`, glyphs via `<use>`, geometry via
`import { scopePath }`).

---

## 2. Decisions (resolved 2026-06-04)

| # | Decision | Choice |
|---|---|---|
| D1 | Logged-in user hits `/` | **Redirect to `/dashboard`.** Marketing page is for anonymous prospects only. |
| D2 | WebP asset pipeline (no tooling installed) | **Install `libwebp`/`cwebp`**, convert the four PNGs to WebP @1×/@2×, commit outputs. One-time build step, walked through with the operator. |
| D3 | Footer "Legal" links (no pages exist) | **Stub `/privacy` `/terms` `/license`** pages so links resolve; minimal "coming soon" body. License stub stays content-free pending lawyer-reviewed text (tracked in the licence/consent plan). |
| D4 | Template architecture | **Standalone `landing.eta`** — own `<head>` (SEO/JSON-LD/OG), own bespoke topbar/hero/footer. Does NOT use the shared `header.eta`/`footer.eta` partials. Still `class="ins"` + links `instrument-core.css`. |
| D5 | `{{SIGNIN_URL}}` value (spec §12.1) | **`/login`** (confirmed route). CTA + all four app cards + footer Apps links all point here. |
| D6 | Poker red card backs (spec §12.2) | **No-op.** Screenshot already uses the live red cards. |

The new page deliberately does **not** add the public "Request free access" CTA — single CTA is `/login`, so the
existing onboarding soft-launch posture is unchanged.

---

## 3. Reconciliations / deltas (none change the visual result)

1. **No `theme-core.css`** — it's `instrument-core.css`; "verify tokens exist" = confirmed present. No token file created.
2. **Hero trace** — reuse `scopePath()` from the synced `oscilloscope.js` rather than re-implementing inline.
   The shared `scopeSvg()` renders strokes at `0.4/0.9/0.12`; the **approved prototype** uses `0.3/0.7/0.1` with a
   `.waves{opacity:0.55}` container. To match the prototype faithfully **without editing the foundation**, the
   landing page mounts its **own** hero trace via hub-local `landing-hero.js` that imports `scopePath()` and builds
   the three paths at `0.3/0.7/0.1`. The hero `.waves` div pre-contains the `<svg><g id="scope">` shell so the
   shared `mountWaves()` auto-mount (which skips containers that already hold an `<svg>`) does not double-fill it.
3. **`--green-d` (hover) and `.btn-lg`** — page-local in `landing.css`. Hover darken via
   `color-mix(in oklab, var(--green) 88%, black)` so **no new colour token** is introduced (DoD satisfied).
   `.btn-lg` (`padding:13px 22px; font-size:15px`) scoped under `.ins`.
4. **Progressive enhancement** — eyebrow/H1/lede/CTA are server-rendered static HTML; only the trace is
   JS-injected. Hero is fully legible with JS disabled (spec: "never hide band content waiting on JS").

---

## 4. Files (all in the hub repo)

```
hub/
  routes/landing.js          CHANGED  — valid session → res.redirect('/dashboard'); else render landing
  routes/legal.js            NEW      — mounts GET /privacy /terms /license (render legal stub)
  server.js                  CHANGED  — mountLegal(app)
  views/landing.eta          REWRITE  — standalone marketing template (see §5)
  views/legal.eta            NEW      — shared stub (title + "coming soon"); uses header/footer partials
  public/css/landing.css     NEW      — band-scrim, trust strip, app cards, feature rows, .shot frame,
                                        FAQ, closing CTA, footer grid, .btn-lg, hero hover, responsive.
                                        ZERO colour tokens — all var(--…) from instrument-core.css.
  public/js/landing-hero.js  NEW      — import { scopePath } from '/js/oscilloscope.js'; mount hero trace 0.3/0.7/0.1
  public/img/shot-raid.webp  NEW      (+ shot-raid@2x.webp + shot-raid.png fallback); same for signal/retro/poker
  public/img/og.png          NEW      — 1200×630, panel ground + wordmark + "Agile tools for teams that ship." + faint trace
  public/favicon.svg, favicon-32.png, apple-touch-icon.png  NEW  — suite glyph in --green
  tests/landing.test.js      REWRITE  — new assertions (§6)
  tests/legal.test.js        NEW      — stub routes return 200
```

---

## 5. Page structure (build spec §3, rendered standalone)

```
<head>   SEO: <title>, description, canonical, OG/Twitter, JSON-LD SoftwareApplication (4 apps as featureList),
         font links, /css/instrument-core.css, /css/landing.css, <script type=module> /js/landing-hero.js
<body class="ins">
  header.topbar    brand (glyph + "Sprint" + green "Suite") ......... CTA "Sign in to get started" → /login
  section.band     waves (#scope) + band-scrim + band-in (eyebrow / h1 / lede / CTA + cta-note)
  div.trust        4 mono trust items, each a green .dot + label
  main.wrap
    section        "Four tools, one workflow." + 2×2 app card grid (all cards → /login)
    section.features  4 alternating feature rows (text + framed .shot screenshot)
    section.faq    5 Q&A (static; "free to try" framing verbatim from build spec)
    section.close  centered closing CTA card → /login
  footer           4-col link grid (lead / Apps / Product / Legal) + bottom bar "© 2026 Sprint Suite"
```

One `<h1>` only (hero). Section titles `<h2>`/`<h3>` in order. Screenshots `<img>` with the verbatim `alt` text
from build spec §6. Component specs (sizes, padding, radius, accents, breakpoints) follow build spec §2–§5 exactly.

Per-app accents (tiles + feature-row eyebrows only): Raid `--amber`, Signal `--green`, Retro `--teal`,
Poker `--ink`. Green is the single CTA colour everywhere. App-card tags: Raid `RAID` (amber wash), Signal
`Health` (green wash), Retro `Retro` (teal wash), Poker `Estimate` (neutral). `.shot` URL labels:
`sprintraid.uk` / `sprintsignal.uk` / `sprintretro.uk` / `sprintpoker.uk`.

---

## 6. Testing & QA

**Automated** (`node --test tests/`, supertest — existing style):
- `GET /` (anon) → 200, contains exactly one `<h1>`.
- CTA href, all four app-card hrefs, footer Apps links, footer Sign-in → all `/login`.
- `GET /` with a valid session cookie → 302 redirect to `/dashboard`.
- `GET /privacy`, `/terms`, `/license` → 200.
- Template contains no `data:image/` base64.
- SEO present: `<link rel="canonical">`, `og:title`, JSON-LD `SoftwareApplication`.
- SEO body terms present: "RAID log", "team health check", "retrospective", "scrum poker".
- `prefers-reduced-motion` rule present in served CSS.

**Manual QA** (build spec §10, before merge): contrast, focus order, keyboard nav, reduced-motion, 1120px +
390px layouts, no CLS on image load, Lighthouse (SEO + a11y).

**Process:** subagent-driven development, TDD, two-stage review per task (the SP0–SP5 / Return-to-Suite process).

---

## 7. Definition of done

Build spec §11 in full, plus the codebase-specific checks:
- [ ] `shared/theme/` foundation untouched; `theme-drift.test.js` still green.
- [ ] `landing.css` introduces no colour tokens (all `var(--…)` resolve to `instrument-core.css`).
- [ ] Authed `/` redirects to `/dashboard`; anon `/` renders the marketing page.
- [ ] `/privacy` `/terms` `/license` stubs resolve; no dead footer links.
- [ ] Screenshots served as WebP @1×/@2× (<120KB each), `srcset`, `loading="lazy"`, explicit dimensions, PNG fallback, no base64.
- [ ] Favicon + OG generated from the suite glyph.
- [ ] Hero trace matches the prototype (0.3/0.7/0.1, container 0.55), drift loops seamlessly, reduced-motion disables it.
- [ ] All hub tests pass; manual QA pass at 1120px and 390px.
