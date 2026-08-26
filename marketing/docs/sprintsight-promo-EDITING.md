# Editing the Sprintsight promo page

Rules for `public/sprintsight-coming-soon/intro/`. **Read this before changing
anything on that page.**

They used to live in the page's own source comments. That page is public, so
every visitor received them along with the internal document paths they cite —
a 2026-08-25 ZAP scan reported it. The rules are still binding; only their
location changed.

## Sources

| What            | Where                                                                       |
| --------------- | --------------------------------------------------------------------------- |
| Build spec      | `~/suite-archive/marketing/docs/sprintsight-promo-BUILD-SPEC.md`            |
| Visual target   | `~/suite-archive/marketing/docs/reference/sprintsight-C-evidence-desk.html` |
| Eval figures    | `sight/docs/evals/watermelon-eval.md`                                       |
| Evidence ids    | `sight/docs/data/data-strategy.md`                                          |
| Scope guardrail | `moat-behaviours.md`                                                        |

Section marks (`§7.2.1`, `§11.4`, …) left in the page's source refer to the
build spec. They are kept there because they are useful with the spec open and
say nothing without it.

## The rules that are correctness, not style

Both from BUILD-SPEC §9.5.

1. **The rail and the "coming soon" chip stay while the product does not
   exist.** The page is written in the present tense, and that is only honest
   because the page also says it is in build. Remove either and every
   present-tense claim below it becomes a lie.

2. **The eval scorecard shows target figures, not measured results**
   (`watermelon-eval.md` §8). If a real run scores lower, this page changes
   before launch. A page claiming perfect scores for a detector that has not
   run is itself a watermelon.

## Content that tracks a source

- **Detector console JSON** — shape tracks `watermelon-eval.md` §2.
- **Evidence ids** — track `data-strategy.md` §6. **Do not invent ids.**
- **Scorecard values** — see rule 2 above. Do not edit them in place; change
  the eval first.

## Notify form

There is no backend in `marketing/`. `NOTIFY_ENDPOINT` in `sight.js` is `null`,
so the form reports its error state and warns in the console. That is
deliberate — a form that silently swallows an address is worse than one that
admits it failed. Set it to a real endpoint to go live; the five states already
work against one. A `mailto:` also works, if that is preferred to a queue.

Open item 1, BUILD-SPEC §10.

## Not served

This directory is outside `public/`, and the Apache `Alias` maps only
`/sprintsight-coming-soon/intro` into the filesystem, so nothing here is
reachable over HTTP. Keep editorial notes here rather than in the page.
