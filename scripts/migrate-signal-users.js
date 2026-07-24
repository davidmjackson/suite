'use strict';

/**
 * One-off migration: fold Signal's local facilitator accounts into the central
 * hub `users` table, then drop Signal's now-unused auth tables.
 *
 * Signal's ONLY inbound reference to users(id) is auth_tokens.user_id (which
 * goes away with the auth subsystem). No content table (surveys, teams,
 * responses, …) carries a user FK — Signal is a single shared workspace and
 * responses are anonymous by design. So this migration is a pure email upsert
 * plus a table drop: there are NO foreign keys to rewrite.
 *
 * Usage:
 *   node scripts/migrate-signal-users.js <hub-db> <signal-db> [--dry-run]
 *
 * Dev dry-run:
 *   node scripts/migrate-signal-users.js \
 *     /var/www/suite/hub/data/suite.db /var/www/signal/data/signal.db --dry-run
 *
 * --dry-run lists what would change and writes nothing. Without it the script
 * upserts each distinct Signal email into hub.users (ON CONFLICT(email) DO
 * NOTHING) and then DROPs Signal's `auth_tokens` and `users` tables.
 *
 * The live run is destructive and assumes the Signal service is stopped (see
 * the deploy plan). Back up signal.db first (data/signal.db.pre-migration).
 */

// better-sqlite3 is not installed at the suite repo root; resolve it from an
// app that ships it (identical absolute path on dev and prod).
const Database = require('/var/www/signal/node_modules/better-sqlite3');
const { randomBytes } = require('node:crypto');

const HUB_DB = process.argv[2];
const SIGNAL_DB = process.argv[3];
const DRY_RUN = process.argv.includes('--dry-run');

if (!HUB_DB || !SIGNAL_DB) {
  console.error('Usage: node migrate-signal-users.js <hub-db> <signal-db> [--dry-run]');
  process.exit(1);
}

const randomId = () => randomBytes(16).toString('hex');
const now = () => Date.now();

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

const signal = new Database(SIGNAL_DB, { readonly: DRY_RUN });
const hub = new Database(HUB_DB, { readonly: DRY_RUN });
if (!DRY_RUN) {
  // The hub may be serving live traffic (WAL); ride out brief write locks.
  hub.pragma('busy_timeout = 5000');
  signal.pragma('busy_timeout = 5000');
}

// Idempotency: if Signal's users table is already gone, the migration has run.
if (!tableExists(signal, 'users')) {
  console.log('signal.db has no `users` table — already migrated. Nothing to do.');
  signal.close();
  hub.close();
  process.exit(0);
}

// Distinct, lowercased emails from Signal's facilitator table.
const emails = [
  ...new Set(
    signal
      .prepare('SELECT email FROM users')
      .all()
      .map((r) => String(r.email).toLowerCase()),
  ),
];
console.log(`Found ${emails.length} distinct user email(s) in signal.db`);

const lookup = hub.prepare('SELECT 1 FROM users WHERE email = ?');
const tokenCount = tableExists(signal, 'auth_tokens')
  ? signal.prepare('SELECT COUNT(*) c FROM auth_tokens').get().c
  : 0;

if (DRY_RUN) {
  console.log('DRY RUN — no changes will be written.\n');
  for (const email of emails) {
    const present = lookup.get(email);
    console.log(
      `  ${email} — ${present ? 'already in hub (would skip)' : 'would INSERT into hub.users'}`,
    );
  }
  console.log(
    `\nWould then DROP signal.auth_tokens (${tokenCount} row(s)) and signal.users (${emails.length} row(s)).`,
  );
  signal.close();
  hub.close();
  process.exit(0);
}

// --- Live run ------------------------------------------------------------
const upsert = hub.prepare(
  'INSERT INTO users (id,email,created_at) VALUES (?,?,?) ON CONFLICT(email) DO NOTHING',
);
let inserted = 0;
hub.transaction(() => {
  for (const email of emails) {
    const res = upsert.run(randomId(), email, now());
    if (res.changes > 0) inserted += 1;
  }
})();
console.log(
  `Upserted into hub.users: ${inserted} inserted, ${emails.length - inserted} already present.`,
);

// Drop the child (auth_tokens) before the parent (users).
signal.exec('DROP TABLE IF EXISTS auth_tokens; DROP TABLE IF EXISTS users;');
console.log('Dropped signal.auth_tokens and signal.users.');

signal.close();
hub.close();
console.log('Done.');
