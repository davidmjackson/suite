# Sprintsight promo page — Build Specification

**Direction:** C, "Evidence Desk"
**Target URL:** `https://sprintsuite.uk/sprintsight`
**Status:** Coming-soon promotional page. Standalone. No auth, no app behind it yet.
**Reference mock-up:** `docs/reference/sprintsight-C-evidence-desk.html` (the visual target; see §1.3 for where it differs)
**Written for:** Claude Code, executing against `/var/www/suite`

---

## Plain-English summary

Build one static page that promotes Sprintsight before it exists. It lives on the Sprint
Suite marketing site. The page explains the watermelon idea (a team that reports green
while its delivery is red), shows the three signals Sprintsight looks for, and proves
credibility with a fake-but-accurate detector console that prints the real output format.

The page uses the existing Instrument design system. It adds a small number of new
watermelon-specific colour tokens and one new app glyph to the canonical theme, then
syncs them out like any other surface.

Build order is in §12. Do not skip §2 (locked decisions) or §11 (accessibility).

---

## 1. Locked decisions

### 1.1 Naming

| Thing | Value |
|---|---|
| Product name in copy | `Sprintsight` (one capital, matches repo and `Sprintraid`/`Sprintsignal` pattern) |
| App slug / `data-app` | `sight` |
| Glyph symbol id | `glyph-sight` |
| URL path | `/sprintsight` |

Never write "SprintSight" or "Sprint Sight" in shipped copy.

### 1.2 Scope

In scope: one page, static HTML/CSS/JS, no framework, no build step.
Out of scope: the suite landing page tile (separate work, but the glyph this spec adds is
its dependency), auth, any real detector.

### 1.3 Deviations from the mock-up (intentional, do not "fix" back)

| Mock-up | Build | Why |
|---|---|---|
| IBM Plex Sans (body/headings) | Hanken Grotesk (body) + Bricolage Grotesque (headings) | Adding families to `shared/theme/fonts/` syncs them into all six surfaces via `manifest.mjs`. Not justified for one page. |
| IBM Plex Serif italic (hero accent line) | Bricolage Grotesque 700 in `--melon` | Same reason. The colour carries the emphasis. |
| `--paper: oklch(0.955 0.006 140)` (green-tinted) | `--bone: oklch(0.964 0.004 240)` | Stay on the canonical neutral. The melon tokens carry the fruit. |
| `--faint` on small labels | `--soft` on all informational labels | `--faint` fails WCAG AA at these sizes. See §11.1. |
| Divs styled as tables | Real `<table>` elements | Semantics. See §11.3. |

Everything else in the mock is the target: the graph-paper ground, the spec-sheet hero,
the console, the melon anatomy, the tell grid, the pipeline, the eval scorecard.

---

## 2. Where it lives

`marketing/` currently contains only a README. This page is the first surface built there.

```
/var/www/suite/marketing/
├── README.md                 # update: no longer "to be developed"
├── package.json              # new: scripts only, no runtime deps
├── docs/
│   ├── sprintsight-promo-BUILD-SPEC.md      # this file
│   └── reference/
│       └── sprintsight-C-evidence-desk.html # approved mock-up, visual target
└── public/
    ├── sprintsight/
    │   └── index.html        # the page
    ├── css/
    │   ├── instrument-core.css   # SYNCED — never hand-edit
    │   └── sight.css             # page-specific layer
    ├── js/
    │   ├── oscilloscope.js       # SYNCED — never hand-edit (unused here, sync copies it anyway)
    │   └── sight.js              # page-specific behaviour
    ├── illos/
    │   ├── glyphs.svg            # SYNCED — never hand-edit
    │   └── sight-og.png          # generated, see §5.3
    ├── fonts/                    # SYNCED — never hand-edit
    └── favicon.svg               # see §5.2
```

**CSS layering (two layers only):**
1. `instrument-core.css` — tokens, `@font-face`, `.ins` components. Synced. Source of truth is `shared/theme/`.
2. `sight.css` — everything specific to this page. Scoped under `.ins[data-app="sight"]`.

Do not create a `theme-sight.css`. This page is a marketing surface, not an app.

### 2.1 Register the surface

Add to `shared/theme/manifest.mjs`, in `SURFACES`:

```js
{ name: "marketing", publicRoot: "/var/www/suite/marketing/public" },
```

Then sync and verify:

```bash
node /var/www/suite/shared/theme/sync-theme.mjs /var/www/suite/marketing
node /var/www/suite/shared/theme/check-theme-drift.mjs /var/www/suite/marketing
```

Commit the synced files. `check-theme-drift.mjs` must be added to CI for `marketing`.

### 2.2 Routing

`https://sprintsuite.uk/sprintsight` → `marketing/public/sprintsight/index.html`.

Serve `marketing/public` as the document root for `sprintsuite.uk`. Directory-index
resolution handles the trailing-slash-less path. Ensure `/sprintsight` (no slash)
resolves without a 301 chain to `/sprintsight/index.html`. Canonical URL is the
no-trailing-slash form: `https://sprintsuite.uk/sprintsight`.

---

## 3. Design tokens

### 3.1 Canonical additions to `shared/theme/instrument-core.css`

Add one block, alongside the other `data-app` blocks. Do not alter existing tokens.

```css
.ins[data-app="sight"] {
  --melon:      oklch(0.53 0.19 24);    /* watermelon flesh: the "actual" status */
  --melonwash:  oklch(0.95 0.045 24);   /* flesh tint for chips and callouts */
  --melondeep:  oklch(0.43 0.16 20);    /* flesh shadow, diagram depth */
  --seed:       oklch(0.20 0.02 40);    /* seeds: the evidence */
  --pithcream:  oklch(0.94 0.035 130);  /* pith: the reconciliation layer */
  --rinddark:   oklch(0.28 0.07 148);   /* rind stripe on the anatomy diagram */
  --accent:     var(--melon);
}
```

Reused unchanged from Instrument: `--bone`, `--panel`, `--ink`, `--soft`, `--faint`,
`--line`, `--line2`, `--green`, `--greenwash`, `--teal`, `--amber`, `--amberwash`.

**Semantic mapping (this is the whole concept, get it right):**

| Token | Melon part | Means |
|---|---|---|
| `--green` | rind | the **reported** status. Also the primary CTA colour. |
| `--pithcream` | pith | the **reconciliation** layer |
| `--melon` | flesh | the **actual** status |
| `--seed` | seeds | the **evidence** |

`--green` stays the primary action colour (`.btn-pri` inherits it). `--melon` is the
accent and the "actual/divergence" colour. Never use `--melon` for a primary button.

### 3.2 Page-local tokens (`sight.css`)

```css
.ins[data-app="sight"] {
  /* radii — this page is sharper than the Instrument default of 10px */
  --r-sharp: 3px;   /* chips, inputs, small controls */
  --r-panel: 6px;   /* panels, console, grouped blocks */

  /* graph-paper ground */
  --grid: var(--line);
  --grid-cell: 26px;

  /* console surface (dark) */
  --con-bg:     oklch(0.235 0.013 250);
  --con-chrome: oklch(0.200 0.015 250);
  --con-line:   oklch(0.300 0.020 250);
  --con-text:   oklch(0.800 0.015 250);
  --con-dim:    oklch(0.620 0.015 250);  /* raised from mock for AA, see §11.1 */
  --con-key:    oklch(0.720 0.090 200);  /* JSON keys */
  --con-str:    oklch(0.820 0.110 90);   /* JSON strings */
  --con-red:    oklch(0.680 0.160 25);
  --con-grn:    oklch(0.720 0.130 155);
  --con-amb:    oklch(0.780 0.120 78);

  /* elevation */
  --shadow-console: 0 24px 50px -30px oklch(0.235 0.013 250 / 0.55);
  --focus-ring: 0 0 0 3px var(--greenwash);
}
```

### 3.3 Spacing scale

4px base. Use only these values:

`4, 8, 12, 16, 20, 24, 32, 44, 64, 96`

| Use | Value |
|---|---|
| Chip padding | `4px 8px` |
| Control padding | `9px 15px` |
| Panel padding | `18px 16px` |
| Card padding | `26px 24px` |
| Large panel padding | `36px` |
| Section vertical rhythm | `64px` top and bottom |
| Section header → content | `34px` |
| Container horizontal | `28px` desktop, `18px` below 980px |

### 3.4 Typography scale

All three families are already in `shared/theme/fonts/`. No new font files.

| Role | Family | Weight | Size | Line-height | Letter-spacing | Colour |
|---|---|---|---|---|---|---|
| `h1` | Bricolage Grotesque | 700 | `clamp(32px, 3.8vw, 46px)` | 1.10 | -0.025em | `--ink` |
| `h1 .accent` | Bricolage Grotesque | 700 | inherit | inherit | inherit | `--melon` |
| `h2` | Bricolage Grotesque | 700 | 26px | 1.15 | -0.02em | `--ink` |
| `h3` | Bricolage Grotesque | 700 | 16.5px | 1.30 | -0.01em | `--ink` |
| Lede | Hanken Grotesk | 400 | 16px | 1.55 | 0 | `--soft` |
| Body | Hanken Grotesk | 400 | 14.5px | 1.60 | 0 | `--ink` |
| Body secondary | Hanken Grotesk | 400 | 13.5px | 1.55 | 0 | `--soft` |
| Caption | Hanken Grotesk | 400 | 12.5px | 1.5 | 0 | `--soft` |
| Label / eyebrow | IBM Plex Mono | 500 | 10.5px | 1.4 | 0.14em | `--soft` (uppercase) |
| Chip / data | IBM Plex Mono | 500 | 11px | 1.4 | 0.08em | context |
| Console | IBM Plex Mono | 400 | 12.5px | 1.75 | 0 | `--con-text` |
| Rail | IBM Plex Mono | 400 | 11px | 1.5 | 0.06em | `--bone` on `--ink` |
| Big number | Bricolage Grotesque | 700 | 30px | 1.0 | -0.03em | `--green` |

Body base is `14.5px`. This is denser than Instrument's `15px` and is deliberate.

### 3.5 Border radius

| Element | Radius |
|---|---|
| Chips, inputs, buttons, small controls | `--r-sharp` (3px) |
| Panels, console, tables, grouped blocks | `--r-panel` (6px) |
| Everything else | `0` |

This page overrides the Instrument `.card` 10px radius. Do not use `.ins .card` here.

### 3.6 Shadows

Exactly two.

| Name | Value | Used on |
|---|---|---|
| `--shadow-console` | `0 24px 50px -30px oklch(0.235 0.013 250 / 0.55)` | the console only |
| `--focus-ring` | `0 0 0 3px var(--greenwash)` | focused inputs |

No shadows anywhere else. Depth on this page comes from hairlines, not blur.

### 3.7 Breakpoints

Mobile-first. Three breakpoints.

| Name | Query | Effect |
|---|---|---|
| base | — | single column, everything stacks |
| sm | `min-width: 640px` | chip rows stop wrapping, rail goes one line |
| md | `min-width: 980px` | two-column hero, 3-up grids engage, nav links appear, console goes sticky |
| max | `min-width: 1240px` | container caps at 1240px, gutters stay 28px |

Container: `max-width: 1240px; margin-inline: auto; padding-inline: 28px;`
Below md: `padding-inline: 18px`.

---

## 4. Fonts

All self-hosted, already present, already synced. Declared by `instrument-core.css`.
Do not add `<link>` tags to Google Fonts. Do not add `@font-face` rules to `sight.css`.

| Family | Weights used on this page | File |
|---|---|---|
| Bricolage Grotesque | 700 | `/fonts/bricolage-grotesque-700.woff2` |
| Hanken Grotesk | 400, 500, 600, 700 | `/fonts/hanken-grotesk-{400,500,600,700}.woff2` |
| IBM Plex Mono | 400, 500, 600 | `/fonts/ibm-plex-mono-{400,500,600}.woff2` |

All use `font-display: swap` (already set canonically).

**Preload exactly two** in `<head>`, the faces visible above the fold:

```html
<link rel="preload" href="/fonts/hanken-grotesk-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/ibm-plex-mono-400.woff2" as="font" type="font/woff2" crossorigin>
```

Do not preload more. Bricolage is one heading, it can swap.

---

## 5. Assets

### 5.1 New glyph: `glyph-sight`

Add to `shared/theme/glyphs.svg`. Must follow the existing conventions exactly:
`viewBox="0 0 24 24"`, `currentColor` only, no hardcoded colours, depth via `opacity`.

```svg
<symbol id="glyph-sight" viewBox="0 0 24 24" fill="none">
  <path d="M2.5 8.5h19a9.5 9.5 0 0 1-19 0z" fill="currentColor" opacity="0.42"/>
  <path d="M2.5 8.5h19a9.5 9.5 0 0 1-19 0z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
  <g fill="currentColor">
    <circle cx="8.6" cy="12.4" r="1.15"/>
    <circle cx="12"  cy="14.9" r="1.15"/>
    <circle cx="15.4" cy="12.4" r="1.15"/>
  </g>
</symbol>
```

A half-melon: flat cut face on top, domed rind below, three seeds. Monochrome, so it
works in the topbar, the favicon and the suite tile without variants.

**Small variant** (required: seeds turn to mud below ~20px):

```svg
<symbol id="glyph-sight-sm" viewBox="0 0 24 24" fill="none">
  <path d="M2.5 8.5h19a9.5 9.5 0 0 1-19 0z" fill="currentColor" opacity="0.42"/>
  <path d="M2.5 8.5h19a9.5 9.5 0 0 1-19 0z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
</symbol>
```

Rule: `#glyph-sight` at >=24px, `#glyph-sight-sm` at <24px.

Add both to the canonical `glyphs.svg`, then re-sync **all** surfaces (`--all`), because
the sprite is shared. Verify no existing surface drifts.

Usage on this page:
```html
<svg class="gl" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-sight"></use></svg>
```

### 5.2 Favicon

`marketing/public/favicon.svg`. Inline copy of `glyph-sight-sm` geometry (a favicon
cannot `<use>` an external sprite). Hardcode colours here, this file is outside the theme:

- rind stroke and flesh fill: `#8f2f22` (sRGB approximation of `--melon`)
- background: none (transparent)

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
```

No .ico fallback. All target browsers support SVG favicons.

### 5.3 Open Graph image — NEEDS GENERATING

| Property | Value |
|---|---|
| Path | `marketing/public/illos/sight-og.png` |
| Dimensions | 1200 x 630 |
| Format | PNG, under 300KB |
| Background | `--bone`, with the 26px graph-paper grid in `--line` |
| Content | The melon anatomy diagram (§7.5) at 340px on the left. On the right: "Sprintsight" in Bricolage Grotesque 700 at 64px, and "Find the teams reporting green while delivery is red" in Hanken Grotesk 400 at 30px in `--soft`. A `COMING SOON` chip in IBM Plex Mono 500, 18px, letter-spacing 0.14em, `--melon` on `--melonwash`, bottom-left. |

Generate by rendering an HTML template headlessly at 1200x630, or by hand in the same
tokens. Do not ship a placeholder.

### 5.4 Inline SVG diagrams

Five diagrams are inline in the HTML, not separate files. They are small, they need
`currentColor` and token access, and they must not cost a request.

| Diagram | viewBox | Section |
|---|---|---|
| Melon anatomy (labelled cross-section) | `0 0 320 320` | §7.5 |
| Burndown, flat vs ideal | `0 0 240 76` | §7.6 tell 01 |
| Chat message with no RAID entry | `0 0 240 76` | §7.6 tell 02 |
| Atlas -> Draco dependency | `0 0 240 76` | §7.6 tell 03 |
| Header logo mark | `0 0 22 22` | §7.2 |

Take the geometry verbatim from the mock-up file. Replace every hardcoded colour with the
corresponding token via `currentColor` or `var(--token)` (SVG inline in HTML can read CSS
custom properties; this is why they are inline).

---

## 6. Page structure

```
+----------------------------------------------------+
| RAIL          coming-soon status strip, --ink bg   |
+----------------------------------------------------+
| HEADER        sticky - logo - nav - CTA            |
+----------------------------------------------------+
| HERO          2-col @md                            |
|  |- left  : eyebrow, h1, lede, actions, spec sheet |
|  \- right : DETECTOR CONSOLE (sticky @md)  *       |
+----------------------------------------------------+
| ANATOMY       2-col: diagram | legend              |
+----------------------------------------------------+
| TELLS         3-col grid + callout                 |
+----------------------------------------------------+
| PIPELINE      3-col grid                           |
+----------------------------------------------------+
| EVALS         4-col scorecard + case table + callout|
+----------------------------------------------------+
| SIGNUP        2-col: copy | form                   |
+----------------------------------------------------+
| FOOTER        suite links                          |
+----------------------------------------------------+
```

`*` = the signature element. Everything else stays quiet around it.

**Body setup:**

```html
<body class="ins" data-app="sight">
```

Graph-paper ground on `<body>`:

```css
.ins[data-app="sight"] {
  background-color: var(--bone);
  background-image:
    linear-gradient(var(--grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid) 1px, transparent 1px);
  background-size: var(--grid-cell) var(--grid-cell);
  background-position: -1px -1px;
}
```

Scrolls with content (not fixed). The 1px offset keeps the first line off the viewport edge.

Section wrapper: `<section class="blk">`, `padding: 64px 0; border-top: 1px solid var(--line);`
The hero has no top border.

Section header: `display: grid; grid-template-columns: 170px 1fr; gap: 34px;` at md,
collapsing to one column with `gap: 8px` below md. Left cell is the mono label, right cell
is `h2` plus a `max-width: 62ch` paragraph.

---

## 7. Components

### 7.1 Rail

Full-bleed strip above the header. Not sticky.

- Background `--ink`, text `--bone`, IBM Plex Mono 400 11px, letter-spacing 0.06em
- Padding `7px 28px` (`7px 18px` below md)
- `display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap;`
- Left: a 6px `--amber` dot (pulsing, §8.2) then the status text
- Right: `Showcase data: synthetic`

Copy, left: `Sprintsight is in build - Stage 0 foundation - launching on sprintsuite.uk`
(use the middot character `·`, not a hyphen)

### 7.2 Header

- `position: sticky; top: 0; z-index: 30;` background `--panel`, `border-bottom: 1px solid var(--line2)`
- Inner: container, `display: flex; align-items: center; justify-content: space-between; padding: 12px 0;`
- Left: the **brand breadcrumb** (§7.2.1). Not a plain logo.
- Nav links (md and up only): `Detector`, `The tells`, `Pipeline`, `Evals`. Hanken 400 13.5px, `--soft`, gap 22px. Hover -> `--ink`.
- CTA: `.btn.btn-pri` -> `Get notified`, href `#notify`

The rail is not sticky, so it scrolls away and the header alone remains. Correct.
The header IS sticky, which is what guarantees the return path is always reachable (§7.2.1).

### 7.2.1 Brand breadcrumb — the return path

**The problem this solves.** This page is reached two ways, and they have different needs:

| Arrival | Browser back | Needs an in-page return? |
|---|---|---|
| From the Sprint Suite tile | works | yes, but back is a fallback |
| Shared link, search result, email, social | **nothing to go back to** | **yes, it is the only way out** |

A promo page exists to be shared, so the second row is the majority case. Without an
explicit return, those visitors hit a dead end on the marketing site.

**Why not the usual "click the logo to go home" pattern.** The logo says *Sprintsight* and
the visitor is already on Sprintsight. Pointing it at `/` is a lie about where it goes.
Make the hierarchy visible instead.

**Why not `suite-return.js`.** `shared/auth-client/public/suite-return.js` exists and is
tempting. Do not use it here:
- It fetches `/auth/whoami`. `marketing/` is static and serves no such route, so it 404s on every load.
- It fails safe to **hidden** for anonymous callers. Every promo visitor is anonymous. The button would never appear.
- It targets `hubBaseUrl + "/dashboard"`, which is for signed-in app shells.

That script is correct for Sprintsight's real app shell when it exists. It is wrong for a
public coming-soon page. The return path here must work with no session, no JS and no referrer.

**Markup:**

```html
<nav class="brandcrumb" aria-label="Breadcrumb">
  <ol>
    <li>
      <a href="https://sprintsuite.uk">
        <svg class="gl" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-suite"></use></svg>
        Sprint Suite
      </a>
    </li>
    <li aria-hidden="true" class="sep">/</li>
    <li>
      <span aria-current="page">
        <svg class="gl" aria-hidden="true"><use href="/illos/glyphs.svg#glyph-sight"></use></svg>
        Sprintsight
      </span>
      <span class="ver">coming soon</span>
    </li>
  </ol>
</nav>
```

**Rules:**
- `Sprint Suite` is a real `<a>` to `https://sprintsuite.uk`. Never `href="#"`.
- `Sprintsight` is a `<span>`, not a link. It carries `aria-current="page"`. Never link the page to itself.
- Never `target="_blank"`. Same origin, same tab. Forcing a new tab for a same-site link breaks the back button people expect.
- Both glyphs at 18px. Suite glyph `--soft`, sight glyph `--melon`.
- The whole `Sprint Suite` cell is the hit target, minimum 44x44px effective (pad it, do not shrink the text).

**Styling:**

| Part | Value |
|---|---|
| `<ol>` | `display: flex; align-items: center; gap: 8px; list-style: none;` |
| `Sprint Suite` link | Hanken 500, 14px, `--soft`, no underline |
| `Sprint Suite` hover | `--ink`, underline |
| `.sep` | `--line2`, 14px, `margin-inline: 2px` |
| `Sprintsight` | Bricolage 700, 17px, -0.02em, `--ink` |
| `.ver` chip | IBM Plex Mono 400, 10px, letter-spacing 0.06em, `1px solid var(--line2)`, `--r-sharp`, padding `2px 6px`, colour `--soft` |

**Below md (980px):** the `Sprint Suite` label text hides, the glyph and separator stay.
The link must remain, at full tap-target size. Do not hide the return path on mobile,
mobile is where shared links land.

The footer link (§7.11) stays as a secondary path. It is not sufficient on its own: it
requires scrolling the whole page to find the way out.

**Buttons.** Reuse `.ins .btn`, override radius only:

```css
.ins[data-app="sight"] .btn { border-radius: var(--r-sharp); font-size: 13px; padding: 9px 15px; }
```

States: hover `.btn-pri` -> `background: oklch(0.38 0.1 152)`; `.btn-out` hover -> `border-color: var(--faint)`.
Focus -> §11.2.

### 7.3 Hero

Grid `1fr 1fr`, gap 44px at md. Single column, gap 32px below. `align-items: start`.
Padding `56px 0 44px`.

**Left column, in order:**
1. Label: `SPRINT SUITE · DELIVERY INTELLIGENCE`
2. `h1`: `Your portfolio is all green.` / newline / `<span class="accent">One of those greens is a watermelon.</span>`
3. Lede (max 48ch)
4. Actions: `.btn-pri` -> `Get notified at launch` (`#notify`), `.btn-out` -> `Run the detector` (`#detect`)
5. Spec sheet

**Spec sheet.** A real `<dl>`. `border-top: 1px solid var(--line2)`, each row
`display: grid; grid-template-columns: 118px 1fr; gap: 16px; padding: 9px 0;
border-bottom: 1px solid var(--line2);`

`<dt>`: label style. `<dd>`: 13px `--soft`, with `<b>` in `--ink` weight 600.

| dt | dd |
|---|---|
| Reads | Jira, Confluence, Slack, RAID log, burndown and velocity data |
| Outputs | **Watermelon verdict** with cited evidence · **Audience-tuned status reports** (team, programme, exec) · **Risk radar** and RAID hygiene |
| Never does | Writes to your RAID unprompted. It recommends, a human confirms. |
| Data | Zero Data Retention on all model traffic. Encrypted at rest, UK and EU region. |
| Access | Via your Sprint Suite tile. One sign-in. |

### 7.4 Detector console — SIGNATURE

The most important component. Build it after the shell and before anything else.

**Anatomy:**

```
+--------------------------------------+
| detector · sprint 15          o o o  |  chrome bar
+------+------+------+-----------------+
|ATLAS |BOREAS|CYGNUS| DRACO           |  tablist
+------+------+------+-----------------+
| $ sprintsight detect --team Atlas ... |
| { "team": "Atlas", ... }              |  tabpanel <pre>
| WATERMELON                            |  min-height 352px
+---------------------------------------+
| verdict · 3 evidence ids   deterministic grading |  footer
+---------------------------------------+
```

**Container:** `background: var(--con-bg); border-radius: var(--r-panel); overflow: hidden;
box-shadow: var(--shadow-console);` At md: `position: sticky; top: 76px;` (76px clears the
sticky header). Static below md.

**Chrome bar:** `background: var(--con-chrome); border-bottom: 1px solid var(--con-line);
padding: 11px 14px;` flex, space-between. Left: label style in `oklch(0.66 0.02 250)`,
text `detector · sprint 15`. Right: three 8px dots, `oklch(0.36 0.02 250)`, gap 5px,
`aria-hidden`.

**Tablist:** flex, four equal buttons. Each: transparent bg, `border-right: 1px solid
var(--con-line)` (none on last), colour `--con-dim`, IBM Plex Mono 500 11px,
letter-spacing 0.08em, padding `10px 4px`.
- hover -> colour `oklch(0.85 0.02 250)`
- selected -> `background: var(--con-bg); color: oklch(0.95 0.01 250); box-shadow: inset 0 -2px 0 var(--melon);`

**Panel:** `<pre class="con-body">`, padding 18px, IBM Plex Mono 400 12.5px/1.75,
colour `--con-text`, `min-height: 352px; overflow-x: auto;`
Default tab on load: **ATLAS**.

Syntax colour classes inside the `<pre>`:

| Class | Token | Applies to |
|---|---|---|
| `.k` | `--con-key` | JSON keys |
| `.s` | `--con-str` | JSON string values |
| `.red` | `--con-red` | `"red"`, `true`, the WATERMELON verdict |
| `.grn` | `--con-grn` | `"green"`, `false`, the CLEAR verdict |
| `.amb` | `--con-amb` | `"amber"`, the AMBER verdicts |
| `.p` | `--con-dim` | prompt `$`, trailing notes |
| `.cmt` | `--con-dim` | `//` comment lines, italic |

**Footer:** `background: var(--con-chrome); border-top: 1px solid var(--con-line);
padding: 10px 14px;` flex, space-between, label style, colour `--con-dim`.
Left text is per-tab (see §9.2). Right text is always `deterministic grading`.

**Behaviour:** see §8.3 (typing) and §11.4 (tab a11y).

### 7.5 Melon anatomy

Panel: `background: var(--panel); border: 1px solid var(--line2); border-radius:
var(--r-panel); padding: 36px;` Grid `1fr 1.15fr`, gap 44px at md; single column below,
padding 24px.

Left: the 320x320 inline SVG, `max-width: 320px; margin-inline: auto;`

**SVG construction (outside in):**

| Layer | Geometry | Fill |
|---|---|---|
| Rind | `circle r=128` | `--green` |
| Rind stripes | 5 quadratic paths | `--rinddark`, `stroke-width: 4`, `opacity: 0.3` |
| Pith | `circle r=116` | `--pithcream` |
| Flesh | `circle r=104` | `--melon` |
| Seeds | 8 ellipses `rx=4.5 ry=7`, rotated -32deg to +30deg | `--seed` |
| Leader lines | 3 paths | `--ink`, `stroke-width: 1`, `opacity: 0.55` |
| Labels | `RIND`, `PITH`, `FLESH`, `SEEDS` | IBM Plex Mono 9px, `--soft`, letter-spacing 1 |

Take exact coordinates from the mock.

Right: a `<ul class="legend">`. Each `<li>`: `display: grid; grid-template-columns:
16px 92px 1fr; gap: 14px; padding: 14px 0; border-bottom: 1px solid var(--line2);`
(none on last). Swatch 14x14, `border-radius: 3px`. Name in label style, `--ink`.
Description 13.5px `--soft` with `<b>` in `--ink`.

| Swatch | Name | Description |
|---|---|---|
| `--green` | Rind | **The reported status.** The RAG rating and the narrative your teams submit. Green, week after week. It is what the steering group sees. |
| `--pithcream` (+ `1px solid var(--line2)`) | Pith | **The reconciliation layer.** Where Sprintsight compares the claim against the computed signals: burn ratio, velocity delta, carry-over growth. |
| `--melon` | Flesh | **The actual status.** What the delivery data says, independent of who wrote the update. When flesh and rind disagree, you have a watermelon. |
| `--seed` | Seeds | **The evidence.** Named, citable artifacts. Every verdict points at these, so a delivery lead can check the claim rather than take it on trust. |

### 7.6 Tell grid

Three cells, `display: grid; grid-template-columns: repeat(3, 1fr);` gap 0, wrapped in
`border: 1px solid var(--line2); border-radius: var(--r-panel); overflow: hidden;
background: var(--panel);` Each cell `padding: 26px 24px; border-right: 1px solid
var(--line2);` (none on last).

Below md: one column, `border-right: none; border-bottom: 1px solid var(--line2);`

**Cell anatomy:**
1. Id line: IBM Plex Mono 600 10px, letter-spacing 0.12em, colour `--melon`
2. `h3`
3. Paragraph, 13.5px `--soft`
4. Viz box: `height: 96px; background: var(--bone); border: 1px solid var(--line2);
   border-radius: var(--r-sharp); padding: 10px; margin: 20px 0 16px;`
5. Compare block: `border-top: 1px solid var(--line2); padding-top: 14px;` two rows,
   each `display: grid; grid-template-columns: 74px 1fr; gap: 10px;`
   - "who" cell: IBM Plex Mono 9.5px, letter-spacing 0.08em, uppercase, `--soft`
   - Generic row value: `--soft`
   - Sprintsight row value: `--ink`, weight 500

Content per cell is in §9.3.

**Callout** (below the grid, `margin-top: 24px`):
`background: var(--panel); border: 1px solid var(--line2); border-left: 3px solid
var(--melon); border-radius: var(--r-sharp); padding: 20px 24px;` 14px `--soft`,
`<b>` in `--ink`.

### 7.7 Pipeline

Three panels, `display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;`
One column below md.

Each panel: `background: var(--panel); border: 1px solid var(--line2); border-radius:
var(--r-panel); overflow: hidden;`
- Head: `background: var(--bone); border-bottom: 1px solid var(--line2); padding: 10px 16px;`
  flex space-between. Left `Pass 0N` in label style. Right the pass name in label style, `--green`.
- Body: `padding: 18px 16px;` `h3`, then 13px `--soft`.
- IO block: `border-top: 1px dashed var(--line2); padding-top: 12px; margin-top: 14px;`
  flex column gap 5px. Each line IBM Plex Mono 10.5px `--soft`, with `<b>` in `--green` weight 500.

### 7.8 Eval scorecard

Four cells, `grid-template-columns: repeat(4, 1fr);` gap 0, in a bordered rounded panel.
Each `padding: 22px 20px; border-right: 1px solid var(--line2);` (none on last).
Below md: `1fr 1fr`, remove right border on cell 2, add bottom border to cells 1 and 2.

Cell anatomy:
- Number: Bricolage 700 30px, -0.03em, `--green`. Any `/4` or `%` suffix in `--soft`.
- Title: 12.5px `--soft`, `margin-top: 4px`
- Meta: label style, 9.5px, `margin-top: 10px`
- Bar: `height: 3px; background: var(--line2); border-radius: 2px; margin-top: 12px;
  overflow: hidden;` inner `<i>`: `background: var(--green); width: 0;` animated (§8.4)

| Number | Title | Meta |
|---|---|---|
| `4/4` | Classification accuracy | Correct verdict |
| `4/4` | Evidence accuracy | All required ids cited |
| `100%` | Citation coverage | No uncited claims |
| `Pass` | Fabrication gate | Declines on thin data |

### 7.9 Case table

A real `<table>` (see §11.3). `border: 1px solid var(--line2); border-radius:
var(--r-panel); overflow: hidden; background: var(--panel); margin-top: 20px;`

`<th>`: `background: var(--bone);` label style 9.5px, letter-spacing 0.12em.
`<th>`/`<td>`: `padding: 13px 20px; border-bottom: 1px solid var(--line2); text-align: left;`
Last row: no bottom border.

Columns: `Case | What it guards against | Reported | Assessed | Result`
Widths at md: `100px | auto | 96px | 96px | 110px`
Below md: hide the `What it guards against` column (`display: none` on that `th` and `td`).

RAG chip: IBM Plex Mono 600 11px, letter-spacing 0.06em, uppercase, `padding: 3px 8px`,
`border-radius: var(--r-sharp)`.

| Chip | Background | Colour |
|---|---|---|
| Green | `--greenwash` | `--green` |
| Amber | `--amberwash` | `oklch(0.5 0.11 62)` |
| Red | `--melonwash` | `--melon` |

Result cell: IBM Plex Mono 600 11px, `--green`.

Content in §9.4. A second callout follows, same style as §7.6.

### 7.10 Signup

`border: 1px solid var(--line2); border-radius: var(--r-panel); background: var(--panel);
padding: 40px; margin: 64px 0;` Grid `1fr 380px`, gap 44px, `align-items: center`.
One column below md, padding 26px.

Left: label `COMING SOON`, `h2`, paragraph in `--soft`.
Right: the form, then a hint line (IBM Plex Mono 10.5px `--soft`, letter-spacing 0.06em):
`No marketing list. One email at launch.`

**Form** (see §10 for the endpoint decision):

```html
<form class="form" id="notifyForm" novalidate>
  <label class="sr-only" for="notifyEmail">Email address</label>
  <input id="notifyEmail" name="email" type="email" required
         autocomplete="email" placeholder="you@company.com">
  <button class="btn btn-pri" type="submit">Notify me</button>
</form>
<p class="formmsg" id="notifyMsg" role="status" aria-live="polite"></p>
```

Input: `flex: 1; font: 400 14.5px 'Hanken Grotesk'; padding: 11px 13px; border: 1px solid
var(--line2); border-radius: var(--r-sharp); background: var(--bone); color: var(--ink);`
- placeholder `--faint` (decorative, exempt from §11.1)
- focus: `outline: none; border-color: var(--green); box-shadow: var(--focus-ring);`
- invalid (only after submit attempt): `border-color: var(--melon)`

**States** — all five must be built:

| State | Trigger | Message | Colour |
|---|---|---|---|
| idle | default | empty | — |
| invalid | submit with a failing email | `That email doesn't look right. Check and try again.` | `--melon` |
| pending | submit in flight | button label -> `Sending…`, button `disabled`, `aria-busy="true"` on the form | — |
| success | 2xx | `You're on the list. We'll email you once, the day Sprintsight opens.` | `--green` |
| error | non-2xx or network failure | `That didn't send. Try again, or email hello@sprintsuite.uk.` | `--melon` |

On success, replace the form with the message (do not leave a live form).
Errors never apologise and always say what to do next.

### 7.11 Footer

`border-top: 1px solid var(--line2); background: var(--panel); padding: 26px 0;`
Container, flex, space-between, gap 16px, wrap. 12.5px `--soft`.

Left: `Sprintsight is part of <a>Sprint Suite</a> · Sprintraid · Sprintsignal · Sprintretro · Sprintpoker`
Right: `Showcase runs on fully synthetic data. Zero Data Retention on all model traffic.`

Links: `--green`, no underline, underline on hover.

---

## 8. Motion

Every animation below must be disabled by `prefers-reduced-motion: reduce`, with the
**end state applied immediately**. Never leave content hidden when motion is off.

```css
@media (prefers-reduced-motion: reduce) {
  .ins[data-app="sight"] *,
  .ins[data-app="sight"] *::before,
  .ins[data-app="sight"] *::after {
    animation: none !important;
    transition: none !important;
  }
  .ins[data-app="sight"] .rv { opacity: 1; transform: none; }
  .ins[data-app="sight"] .caret { display: none; }
  .ins[data-app="sight"] .bar i { width: 100%; }
}
```

JS must also branch on `matchMedia('(prefers-reduced-motion: reduce)').matches`, because
the typing and counting effects are JS-driven and CSS cannot stop them.

### 8.1 Section reveal

| Property | Value |
|---|---|
| Class | `.rv` -> `.rv.in` |
| From | `opacity: 0; transform: translateY(12px)` |
| To | `opacity: 1; transform: none` |
| Duration | 500ms |
| Easing | `cubic-bezier(.2, .6, .2, 1)` |
| Trigger | IntersectionObserver, `threshold: 0.15` |
| Repeat | Once. `unobserve` after firing. |

Applied to each `.blk` and the signup panel. **Not** to the hero or the console: those are
above the fold and must render immediately.

### 8.2 Rail dot pulse

`animation: pulse 2s infinite;` where `pulse` sets `opacity: 0.25` at 50%. Purely ambient.

### 8.3 Console typing — SIGNATURE

The signature motion. Get the detail right.

| Property | Value |
|---|---|
| Rate | 14 characters per tick |
| Tick | 12ms |
| Total | ~1.6s for the longest payload |
| Caret | 7x14px block, `--melon`, `animation: blink 1s step-end infinite` (opacity 0 at 50%) |
| Trigger | on load (ATLAS), and on every tab change |
| Reduced motion | render the full payload instantly, no caret |

**Critical implementation note.** The payloads contain HTML (`<span>` colour markup).
Slicing an HTML string mid-tag produces broken markup. Balance the tags on every tick:

```js
let s = full.slice(0, i);
const open  = (s.match(/<span/g)  || []).length;
const close = (s.match(/<\/span>/g) || []).length;
out.innerHTML = s + '</span>'.repeat(Math.max(0, open - close)) + '<span class="caret"></span>';
```

Clear any running interval before starting a new one, or rapid tab clicking interleaves
two payloads.

Set `aria-busy="true"` on the panel while typing, `"false"` when complete. Do **not** use
`aria-live` on the panel: it would announce every tick.

### 8.4 Scorecard bars and counters

| Element | Effect |
|---|---|
| Bar | `width: 0 -> 100%`, 1100ms, `cubic-bezier(.3, 1, .4, 1)`, 120ms delay after reveal |
| Counter | count 0 -> 4, one increment per 130ms |

Both fire from the same IntersectionObserver as §8.1, once.
The counter must preserve its suffix markup (`<span>/4</span>`) on every tick.

### 8.5 Diagram line draw

The three tell diagrams draw their key line on reveal.

| Property | Value |
|---|---|
| Technique | `stroke-dashoffset: length -> 0` via `getTotalLength()` |
| Duration | 900ms |
| Easing | `ease-out` |
| Trigger | parent reveal |

**Note:** paths that already carry a `stroke-dasharray` (the dashed chat connector, tell
02) must be skipped, or the dash pattern is destroyed. Check for the attribute first.

### 8.6 Hover transitions

Buttons, nav links, tabs: `transition: color .15s, background .15s, border-color .15s;`
Nothing else animates on hover. No transforms, no lifts.

---

## 9. Content

All copy is final. Do not paraphrase, do not "improve", do not add exclamation marks.
Sentence case throughout. No em dashes anywhere on this page.

### 9.1 Hero

- **Label:** `SPRINT SUITE · DELIVERY INTELLIGENCE`
- **H1 line 1:** `Your portfolio is all green.`
- **H1 line 2 (accent):** `One of those greens is a watermelon.`
- **Lede:** `Sprintsight reads across Jira, Confluence, Slack and your RAID log, reconciles what each team claims against what its data actually shows, and names the teams reporting healthier than they are. Every verdict ships with its evidence.`
- **Buttons:** `Get notified at launch` / `Run the detector`

### 9.2 Console payloads

Four payloads. Each is an HTML string. The JSON must match the real detector contract in
`/var/www/sight/docs/evals/watermelon-eval.md` §2. If that contract changes, this page changes.

**Structure of every payload:**

```
$ sprintsight detect --team {Team} --sprint 15
// reading 4 sources · {N} artifacts · 2 sprints

{
  "team": "{Team}",
  "reported_status": "...",
  "actual_status": "...",
  "is_watermelon": ...,
  "evidence": [ ... ],
  "explanation": "..."
}

{VERDICT} · {note}
```

| Tab | artifacts | reported | actual | is_watermelon | verdict line | footer left |
|---|---|---|---|---|---|---|
| ATLAS | 61 | `green` | `red` | `true` | `WATERMELON` (`.red`) · `raise with the Atlas delivery lead before the portfolio review` | `verdict · 3 evidence ids` |
| BOREAS | 48 | `green` | `green` | `false` | `CLEAR` (`.grn`) · `a healthy team must never be flagged` | `verdict · 2 evidence ids` |
| CYGNUS | 52 | `amber` | `amber` | `false` | `HONEST AMBER` (`.amb`) · `candour is not punished` | `verdict · 2 evidence ids` |
| DRACO | 57 | `green → amber` | `amber` | `false` | `UNDER CONTROL` (`.amb`) · `the decoy case · precision guard` | `verdict · 2 evidence ids` |

Prefix glyphs as in the mock: `▲` for WATERMELON, `✓` for CLEAR, `◆` for the two ambers.

**Evidence arrays** (these are the real artifact ids from
`/var/www/sight/docs/data/data-strategy.md`, do not invent others):

- Atlas: `burndown-atlas-s15`, `slack-atlas-s15-msg-dep`, `status-atlas-s15`
- Boreas: `burndown-boreas-s15`, `raid-boreas-s15`
- Cygnus: `status-cygnus-s15`, `raid-cygnus-s15`
- Draco: `bugspike-draco-s15`, `triage-draco-s15`

**Explanations** (verbatim, line breaks as shown in the mock to fit the console width):

- **Atlas:** `Reported on track for a second sprint while the burndown stayed flat (12 of 40 points). Velocity down ~30%, carry-over 2 → 5. A dependency on Draco's auth API was raised in chat on 12 Jun and never logged in the RAID.`
- **Boreas:** `Burndown tracking to plan, 38 of 40 points burned. Velocity stable. RAID is current, every risk owned and mitigated. Reported status matches the data.`
- **Cygnus:** `Openly reports amber. The dependency slip and resourcing gap appear in both the status report and the RAID, and the burndown shows the slip honestly. Reported matches actual, so this is not a watermelon.`
- **Draco:** `A late-sprint bug spike looks alarming but is triaged, the burndown still holds, and the risk is logged with an owner. Draco moved itself to amber. Scary signal, under control.`

Take the exact colour-class markup from the mock-up file.

### 9.3 Tells

**Section:** label `DETECTION`, h2 `Three tells a generic tool cannot see`, para
`Search-over-documents retrieves what a document says. Sprintsight reasons about the delivery process behind the documents. That difference is the whole product, and it shows up in three specific places.`

| # | Id | h3 | Body | Generic says | Sprintsight says |
|---|---|---|---|---|---|
| 01 | `TELL 01 · flat_burndown_vs_green` | Flat burndown, green status | Scope is not moving across two sprints while the write-up says on track. Reading a burndown as a delivery signal, rather than as text, is what catches it. | "Atlas reports on track." | "The data contradicts the report. 12 of 40 points burned." |
| 02 | `TELL 02 · risk_in_chat_not_raid` | Risk in chat, not in the RAID | A risk raised in a thread that never reached the log. Catching it needs an understanding of the RAID as a governance process, not just as a document to summarise. | Silent. It was never logged, so there is nothing to retrieve. | "Unlogged risk. Recommend adding it with an owner." |
| 03 | `TELL 03 · cross_team_dependency_slip` | Cross-team dependency slip | Atlas depends on Draco. Draco slips. Atlas's status is silent. The proof sits on both sides of a boundary that single-tool products never cross. | "Atlas is on track." It never left Atlas's own documents. | "No. A cross-team dependency is slipping and Atlas has not surfaced it." |

The three ids match the `moat_behaviours` keys in
`/var/www/sight/docs/moat/moat-behaviours.md`. Keep them exact.

**Callout:** `**Scope, stated plainly.** Sprintsight reconciles dependencies that are actually named somewhere in an artifact, like the Atlas chat message naming Draco's auth API. It does not invent links between teams that nobody wrote down.`

(This is the LOCKED scope guardrail from the moat spec. It must stay on the page. It stops
the promo over-promising a dependency-graph engine that is explicitly out of scope.)

### 9.4 Anatomy, pipeline, evals, signup

**Anatomy section:** label `ANATOMY`, h2 `Why a watermelon`, para
`It is the delivery term for a team that is green on the outside and red on the inside. Nobody set out to mislead. The status report is written from the narrative, and the narrative is always the last thing to change. Sprintsight cuts through and checks the two against each other.`
Legend copy: §7.5 table.

**Pipeline section:** label `HOW IT WORKS`, h2 `Three passes, nothing for your team to fill in`, para
`Sprintsight reads what your teams already produce. No new ceremony, no extra form, no change to how anyone works.`

| Pass | Name | h3 | Body | in | out |
|---|---|---|---|---|---|
| 01 | Retrieval | Read the delivery record | Status reports, RAID entries, ticket and burndown summaries, chat. Indexed together, each item keeping the source ID it will later be cited by. | Jira · Confluence · Slack · RAID | indexed artifacts + ids |
| 02 | Reconciliation | Check the story against the data | Burn ratio, velocity delta and carry-over growth are computed deterministically as facts. Published reference thresholds cue the judgement, they never decide it alone. | indexed artifacts | signals + divergences |
| 03 | Report writer | Write it for the room | Exec (~150 words, outcome and decision), programme (~400 words, governance), or team (granular). Same evidence, different altitude. Thin data returns "insufficient evidence" rather than a guess. | signals + audience | cited report (JSON) |

**Evals section:** label `WHY TRUST IT`, h2 `A right answer with no evidence still counts as a failure`, para
`Telling a delivery director that a team is reporting inaccurately is a serious claim. So the detector is graded on two gates: did it get the call right, and did it cite the specific artifacts that prove it. Lucky guesses fail.`

Case table rows:

| Case | What it guards against | Reported | Assessed | Result |
|---|---|---|---|---|
| Atlas | The one it must never miss. A false negative here is the worst possible failure. | Green | Red | ✓ watermelon |
| Boreas | A genuinely healthy team. Flagging it would be a precision failure. | Green | Green | ✓ not flagged |
| Cygnus | Honest amber. Reports its problems openly, so it is not a watermelon. | Amber | Amber | ✓ not flagged |
| Draco | The decoy. An alarming bug spike that is actually triaged and under control. | Amber | Amber | ✓ not flagged |

**Callout:** `**Honest amber is not a watermelon.** Sprintsight compares reported against actual. A team that reports its problems openly gets left alone. That distinction is graded on every run, precisely so the tool never punishes candour.`

**Signup:** label `COMING SOON`, h2 `Find your watermelon before your steering group does`, para
`Sprintsight is in build and opens on sprintsuite.uk. Leave your email and we'll tell you the day it launches, with early access for Sprint Suite users.`

### 9.5 Honesty constraint

Every claim on this page must be true of the product as specified in `/var/www/sight/docs/`.
Two rules:

1. **Present tense is aspirational, not deceptive, because the rail says "in build".** The
   rail and the coming-soon chip must never be removed while the product does not exist.
2. **The eval scorecard shows target figures from `docs/evals/watermelon-eval.md` §8.**
   If a real run scores below 4/4, this page must be updated to the real number before
   launch. Do not present a target as a result once results exist. A page claiming perfect
   scores for a detector that has not run is itself a watermelon.

---

## 10. Open items (need a decision before launch, do not invent an answer)

| # | Item | Blocking | Default if unresolved |
|---|---|---|---|
| 1 | **Notify endpoint.** No backend exists in `marketing/`. Options: a hub route, a static form service, or a `mailto:`. | The signup form (§7.10) | Build the form fully against `{{NOTIFY_ENDPOINT}}` as a constant at the top of `sight.js`. Until it is set, the submit handler shows the error state and logs a console warning. Do not ship a form that silently does nothing. |
| 2 | **`hello@sprintsuite.uk`** is referenced in the error copy. Confirm it exists. | Error state copy | Remove the second clause from the error message. |
| 3 | **Suite tile** for Sprintsight on the landing page. Out of scope here, but `glyph-sight` is its dependency and now exists. | Nothing on this page | — |
| 4 | **Where `Sprint Suite` sends a signed-in user.** The breadcrumb (§7.2.1) is static and always goes to `https://sprintsuite.uk`. For an anonymous visitor that is correct. For a visitor who is already signed in and came from their hub dashboard, the ideal target is `dashboardUrl` (`hubBaseUrl + "/dashboard"`, per `shared/auth-client/handlers/whoami.js`), not the marketing landing. Resolving this needs either (a) the landing page itself to bounce authed users to the hub, or (b) `marketing/` to proxy `/auth/whoami`. | Nothing. The static link is correct and safe on its own. | **Ship the static link.** It is right for the majority case and never breaks. Option (a) is the better long-term fix because it solves this for every marketing page at once, not just this one. Do not add an auth fetch to a public page for this. |

---

## 11. Accessibility

Target: **WCAG 2.1 AA**. These are requirements, not suggestions.

### 11.1 Contrast — a real inherited bug, fix it here

`--faint` is `oklch(0.6 0.01 250)`, roughly `#8a8f99`. On `--bone` (`#f2f3f5`) that is
about **2.9:1**. It fails AA for normal text (needs 4.5:1). `.ins .micro` uses `--faint`,
and Direction C leans heavily on small uppercase labels.

**Rule for this page:**

| Colour | Allowed on `--bone`/`--panel` for |
|---|---|
| `--ink` | anything |
| `--soft` (~6:1) | **all informational text, including every mono label, eyebrow and caption** |
| `--faint` (~2.9:1) | decorative only: input placeholders, the console chrome dots, non-essential separators |

Do not use `.ins .micro` on this page. Define a local `.lbl` class that is identical
except `color: var(--soft)`.

Console: `--con-dim` is raised to `oklch(0.62 0.015 250)` from the mock's `0.5`, giving
about 4.6:1 on `--con-bg`. It carries the `//` comment lines and the verdict notes, which
are informational.

Verify every pair with a contrast checker before calling this done. Non-text UI (borders,
the scorecard bar, the RAG chip dots) needs 3:1 against its neighbour.

### 11.2 Focus

```css
.ins[data-app="sight"] :focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 2px;
  border-radius: var(--r-sharp);
}
```

Every interactive element must have a visible focus ring. Never `outline: none` without a
replacement. Tab order follows DOM order. Add a skip link as the first focusable element:

```html
<a class="skip" href="#main">Skip to content</a>
```

Visually hidden until focused, then pinned top-left over the rail.

### 11.3 Semantics

- One `<h1>`. Section headings are `<h2>`, component headings `<h3>`. No level skips.
- Spec sheet: `<dl>` / `<dt>` / `<dd>`. Not divs.
- Case table: real `<table>` with `<thead>`, `<th scope="col">`, `<tbody>`. Not a div grid.
- Legend: `<ul>` / `<li>`.
- Console output: `<pre>`. It is preformatted text and must be announced as such.
- Sections: `<section>`, each labelled by its `<h2>` via `aria-labelledby`.
- `<main id="main">` wraps everything between header and footer.
- Decorative SVG: `aria-hidden="true"`. Informative SVG (the anatomy, the three tell
  diagrams): `role="img"` plus an `aria-label` that states the finding, not the shapes.
  Example: `aria-label="Atlas depends on Draco's auth API, which has slipped and is absent from Atlas's status."`

### 11.4 Console tabs

Follow the WAI-ARIA tabs pattern.

- Container: `role="tablist"`, `aria-label="Team"`
- Buttons: `role="tab"`, `aria-selected="true|false"`, `aria-controls="conPanel"`, unique `id`
- Panel: `role="tabpanel"`, `id="conPanel"`, `aria-labelledby="{active tab id}"`, `tabindex="0"` (it scrolls, so it must be reachable)
- Roving tabindex: selected tab `tabindex="0"`, others `tabindex="-1"`
- Keyboard: `ArrowLeft`/`ArrowRight` move between tabs and activate, `Home`/`End` jump to first/last
- `aria-busy` toggles during typing (§8.3). No `aria-live`.

### 11.5 Other

- Zoom to 200% without horizontal scroll or clipping.
- The console `<pre>` is the one permitted horizontal scroll region, and only inside itself.
- Form: real `<label>` (visually hidden is fine), `type="email"`, `autocomplete="email"`.
  Validation messages via `role="status"` and `aria-live="polite"` on the message element.
- Reduced motion: §8.
- Test the whole page with keyboard only, and with the graph paper at 200% zoom.

---

## 12. Build order

Dependencies are real. Do not reorder 1 through 3.

| # | Step | Done when |
|---|---|---|
| 1 | **Canonical theme edits.** Add the `data-app="sight"` token block to `shared/theme/instrument-core.css`. Add `glyph-sight` and `glyph-sight-sm` to `shared/theme/glyphs.svg`. Add `marketing` to `SURFACES` in `manifest.mjs`. | `shared/theme/tests/*` pass. `preview.html` still renders. |
| 2 | **Sync and verify all surfaces.** `sync-theme.mjs` into `marketing`, then `check-theme-drift.mjs --all`. The sprite changed, so every surface needs re-syncing. | `--all` reports `ok` for all seven surfaces. Synced files committed. |
| 3 | **Scaffold `marketing/`.** `package.json` (scripts only), `public/` tree, drift check wired into CI. | `check-theme-drift.mjs /var/www/suite/marketing` is green in CI. |
| 4 | **Page shell.** `index.html` skeleton, `<body class="ins" data-app="sight">`, graph-paper ground, container, rail, header, footer, skip link, `<main>`. No content yet. | Renders at 375px and 1440px. Header sticks. Keyboard reaches every control. |
| 5 | **Hero, left column.** Label, h1, lede, buttons, spec sheet `<dl>`. | Type scale matches §3.4 exactly. |
| 6 | **Console (signature).** Static markup first, ATLAS payload hardcoded, correct colours, correct chrome. Then tabs. Then typing. Then a11y (§11.4). | All four payloads render. Rapid tab clicking never interleaves. Keyboard tab navigation works. |
| 7 | **Anatomy.** Inline SVG, tokenised colours, legend list. | Labels legible at 320px wide. |
| 8 | **Tells.** Grid, three diagrams, compare blocks, callout. | Collapses to one column below md without border artefacts. |
| 9 | **Pipeline.** Three panels. | — |
| 10 | **Evals.** Scorecard, real case `<table>`, callout. | Table is a real table. Column hides below md. |
| 11 | **Signup.** Form, all five states (§7.10), `{{NOTIFY_ENDPOINT}}` constant. | Every state reachable and testable. |
| 12 | **Motion pass.** All of §8, plus the reduced-motion branch in both CSS and JS. | With reduced motion on, everything is visible and static, and the console shows a full payload. |
| 13 | **Assets and SEO.** Favicon, OG image (§5.3), meta, JSON-LD (§13). | OG renders correctly in a card validator. |
| 14 | **Accessibility pass.** §11 end to end. | Contrast verified pair by pair. Keyboard-only run completes. 200% zoom clean. |
| 15 | **Definition of done.** §14. | All boxes ticked. |

---

## 13. SEO and metadata

```html
<title>Sprintsight — find the teams reporting green while delivery is red | Sprint Suite</title>
<meta name="description" content="Sprintsight reads across Jira, Confluence, Slack and your RAID log, reconciles what each team claims against what its data shows, and names the watermelons. Every verdict ships with its evidence. Coming soon to Sprint Suite.">
<link rel="canonical" href="https://sprintsuite.uk/sprintsight">
<meta name="robots" content="index, follow">

<meta property="og:type" content="website">
<meta property="og:site_name" content="Sprint Suite">
<meta property="og:url" content="https://sprintsuite.uk/sprintsight">
<meta property="og:title" content="Sprintsight — green on the outside, red on the inside">
<meta property="og:description" content="AI delivery intelligence that finds the teams reporting healthier than they are, and cites the evidence. Coming soon.">
<meta property="og:image" content="https://sprintsuite.uk/illos/sight-og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="A watermelon cross-section labelled rind, pith, flesh and seeds, next to the Sprintsight name.">

<meta name="twitter:card" content="summary_large_image">
```

**JSON-LD**, in `<head>`:

```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Sprintsight",
  "applicationCategory": "BusinessApplication",
  "applicationSubCategory": "Project Management",
  "operatingSystem": "Web",
  "url": "https://sprintsuite.uk/sprintsight",
  "description": "AI delivery intelligence that reads across Jira, Confluence, Slack and RAID logs to produce cited status reports, risk detection, and watermelon detection (reported green, actually red).",
  "isPartOf": { "@type": "WebSite", "name": "Sprint Suite", "url": "https://sprintsuite.uk" },
  "offers": { "@type": "Offer", "availability": "https://schema.org/PreOrder" }
}
```

`availability: PreOrder` is the honest value while the product is in build. Change it at
launch. Do not add `aggregateRating` or `review`: there are none, and inventing them is
both a Google penalty and a lie.

`<html lang="en-GB">`. Spelling is British throughout (`summarise`, `behaviour`, `prioritise`).

---

## 14. Definition of done

- [ ] `check-theme-drift.mjs --all` exits 0 across all seven surfaces
- [ ] `shared/theme/tests/*` pass; `preview.html` renders unchanged for existing apps
- [ ] `glyph-sight` and `glyph-sight-sm` render correctly at 16px, 24px and 48px
- [ ] No Google Fonts request. No `@font-face` in `sight.css`. Exactly two preloads.
- [ ] No hardcoded hex or oklch literals in `sight.css` outside the token block
- [ ] Console: four tabs, four payloads, no interleaving on rapid clicks, no broken `<span>` markup mid-type
- [ ] Console JSON matches `/var/www/sight/docs/evals/watermelon-eval.md` §2 field for field
- [ ] Evidence ids match `/var/www/sight/docs/data/data-strategy.md` §6 exactly
- [ ] Signup form: all five states reachable; no silent no-op submit
- [ ] Keyboard-only: every control reachable, visible focus everywhere, skip link works, tablist arrow keys work
- [ ] Contrast: every text pair >=4.5:1, every non-text UI pair >=3:1, verified not assumed
- [ ] `prefers-reduced-motion: reduce`: nothing hidden, nothing moving, console fully populated
- [ ] 375px, 768px, 1024px, 1440px all clean. 200% zoom: no horizontal scroll except inside the console `<pre>`.
- [ ] One `<h1>`, no heading level skips, real `<table>`, real `<dl>`
- [ ] OG image exists at 1200x630 and validates in a card checker
- [ ] Rail and coming-soon chip present (removing them while the product does not exist is a correctness bug, not a style choice)
- [ ] `/sprintsight` resolves without a redirect chain
- [ ] Breadcrumb: `Sprint Suite` is a real link to `https://sprintsuite.uk`, opens in the same tab, and works with JS disabled
- [ ] Breadcrumb: `Sprintsight` is not a link and carries `aria-current="page"`
- [ ] No `href="#"` anywhere in the page. No `target="_blank"` on any same-origin link.
- [ ] The return path is reachable at 375px and after scrolling to the page bottom (sticky header)
- [ ] Arriving cold with no history (open the URL in a fresh tab) still leaves an obvious way back to the suite
- [ ] `marketing/README.md` updated

---

## 15. Coupling

This page restates specs that live in `/var/www/sight/docs/`. If those change, this changes.

| This page | Source of truth |
|---|---|
| Console JSON shape | `docs/evals/watermelon-eval.md` §2 |
| Evidence ids, team roster | `docs/data/data-strategy.md` §3, §6 |
| The three tells and their ids | `docs/moat/moat-behaviours.md` §2-4 |
| Scope guardrail callout (§9.3) | `docs/moat/moat-behaviours.md` §2, LOCKED |
| "Recommend-only, never auto-writes" | `docs/moat/moat-behaviours.md` §4, LOCKED, permanent product principle |
| Audience word counts (150/400/none) | `docs/evals/report-quality-eval.md` §4, LOCKED |
| Scorecard target figures | `docs/evals/watermelon-eval.md` §8 |

Add a line to `/var/www/sight/HANDOVER.md` under `Learning queue` if any of these move, so
the promo page gets updated with them.
