// lib/apps.js — the canonical list of launched apps.
//
// One fact, one place. Three route modules each kept their own copy of it:
// launch.js needed key→origin, magic.js needed host→key (literally the inverse),
// dashboard.js needed key+display. They drifted — sprintplan.uk was in two of the
// three, so a Sprintplan magic link silently landed on /dashboard. All three now
// derive from APPS below.
//
// 🚨 Not every app enumeration belongs here. lib/provisioning.js, routes/company.js
// TOGGLABLE_APPS and schemas/request.js APP_KEYS look like more copies but are
// deliberate policy SUBSETS — what a new company gets by default, what a company
// admin may toggle per user, and what the /request form offers. Folding them in
// would silently change behaviour.

export const APPS = [
  {
    key: 'raid',
    name: 'Sprintraid',
    icon: '🛡',
    desc: 'Risks/Issues',
    origin: 'https://sprintraid.uk',
  },
  {
    key: 'signal',
    name: 'Sprintsignal',
    icon: '📡',
    desc: 'Team signals',
    origin: 'https://sprintsignal.uk',
  },
  {
    key: 'retro',
    name: 'Sprintretro',
    icon: '🔄',
    desc: 'Retrospectives',
    origin: 'https://sprintretro.uk',
  },
  {
    key: 'poker',
    name: 'Sprintpoker',
    icon: '🎴',
    desc: 'Planning poker',
    origin: 'https://sprintpoker.uk',
  },
  // Phase 2: plan is a launched app (collaboration requires an account, so the
  // dashboard must hand it a session via /launch/plan, not a direct link). This
  // reverses the Brief 10 free-direct-link tile. The free single-user app is still
  // reachable by visiting sprintplan.uk directly (dual-mode); only the hub tile
  // changes. Entitlement-gated like the other apps (granted liberally — free).
  {
    key: 'plan',
    name: 'Sprintplan',
    icon: '📋',
    desc: 'Delivery planning board',
    origin: 'https://sprintplan.uk',
  },
];

// key → origin, for building the /auth/launch redirect.
export const APP_ORIGIN = Object.fromEntries(APPS.map((a) => [a.key, a.origin]));

// host → key, for turning a stored return_to back into a launch. Derived from the
// same list as APP_ORIGIN, so the two can no longer disagree.
export const APP_BY_HOST = Object.fromEntries(APPS.map((a) => [new URL(a.origin).host, a.key]));
