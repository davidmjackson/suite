// scripts/seed-default-entitlements.js
// Grants signal (unlimited) + raid (quota) to every existing hub user, as a
// stop-gap so the entitlement-gated dashboard keeps working at deploy time.
// Replace/extend with company-level grants once companies are set up.
import config from '../config.js';
import { openDb } from '../db/index.js';
import { createEntitlements } from '../lib/entitlements.js';

const RAID_QUOTA = parseInt(process.argv[2] || '50', 10); // per-user monthly cap
const db = openDb(config.dbPath);
const ent = createEntitlements(db);
const users = db.prepare('SELECT id, email FROM users WHERE disabled_at IS NULL').all();
for (const u of users) {
  ent.grantEntitlement({ app: 'signal', principalType: 'user', principalId: u.id });
  ent.grantEntitlement({
    app: 'raid',
    principalType: 'user',
    principalId: u.id,
    quotaLimit: RAID_QUOTA,
    quotaPeriod: 'month',
  });
  console.log(`Granted signal(unlimited)+raid(${RAID_QUOTA}/month) to ${u.email}`);
}
console.log(`Done: ${users.length} users.`);
db.close();
