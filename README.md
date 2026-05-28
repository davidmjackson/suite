# Sprint Suite

Umbrella project for the Sprint agile toolkit. Coordinates shared concerns (auth, infrastructure, marketing, documentation) across the four applications.

## Apps in the suite

| App | Path | Live Domain | Purpose |
|---|---|---|---|
| Sprintpoker | `/var/www/scrumpoker` | sprintpoker.uk | Planning poker |
| Sprintretro | `/var/www/retrospective` | sprintretro.uk | Retrospectives |
| Sprintsignal | `/var/www/signal` | sprintsignal.uk | Team signals |
| Sprintraid | `/var/www/raid` | sprintraid.uk | Risks, Assumptions, Issues, Dependencies |

Note: two apps have directory names that don't match their brand names (`scrumpoker` is Sprintpoker; `retrospective` is Sprintretro).

## Repository layout

```
suite/
├── docs/              Architecture and operational documents
├── marketing/         Landing page for sprintsuite.uk (planned)
├── shared/            Shared code (auth, utilities)
├── infrastructure/    Apache configs, deployment scripts
├── scripts/           Operational scripts (health checks, etc.)
└── README.md
```

## Status

Active. Auth approach under design — see `docs/` for current architecture decisions.

A prior attempt to integrate Clerk for cross-TLD SSO was cancelled in May 2026 due to the cost gate (Clerk's free tier doesn't support cross-TLD session sharing; Pro + Satellite Domains would cost ~£50/mo). The artifacts from that effort are archived at `~/clerk-archive/` for reference. The umbrella structure here remains, ready for the next auth approach.
