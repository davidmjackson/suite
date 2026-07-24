// scripts/grant-entitlement.js
import config from '../config.js';
import { openDb } from '../db/index.js';
import { createOrg } from '../lib/org.js';
import { createEntitlements } from '../lib/entitlements.js';

const [app, principalType, ref, quotaLimitArg, quotaPeriodArg] = process.argv.slice(2);
if (!app || !principalType || !ref) {
  console.error(
    'Usage: node scripts/grant-entitlement.js <app> <user|company|team> <ref> [quotaLimit] [quotaPeriod]',
  );
  console.error('  ref: user=email, company=slug, team=slug:teamName');
  console.error('  e.g. grant-entitlement.js raid company acme 100 month');
  process.exit(1);
}
const db = openDb(config.dbPath);
const org = createOrg(db);
const ent = createEntitlements(db);

let principalId;
if (principalType === 'user') {
  const u = db.prepare('SELECT id FROM users WHERE email = ?').get(ref.toLowerCase());
  if (!u) {
    console.error(`No user with email ${ref}`);
    process.exit(1);
  }
  principalId = u.id;
} else if (principalType === 'company') {
  const c = org.getCompanyBySlug(ref);
  if (!c) {
    console.error(`No company with slug ${ref}`);
    process.exit(1);
  }
  principalId = c.id;
} else if (principalType === 'team') {
  const [slug, teamName] = ref.split(':');
  const c = slug ? org.getCompanyBySlug(slug) : null;
  if (!c) {
    console.error(`No company with slug ${slug}`);
    process.exit(1);
  }
  const team = org.listTeams(c.id).find((t) => t.name === teamName);
  if (!team) {
    console.error(`No team '${teamName}' in company ${slug}`);
    process.exit(1);
  }
  principalId = team.id;
} else {
  console.error(`Invalid principal type '${principalType}' (use user|company|team)`);
  process.exit(1);
}

const quotaLimit = quotaLimitArg ? parseInt(quotaLimitArg, 10) : null;
const quotaPeriod = quotaPeriodArg || (quotaLimit != null ? 'month' : null);
ent.grantEntitlement({ app, principalType, principalId, quotaLimit, quotaPeriod });
console.log(
  `Granted ${app} to ${principalType}:${ref}` +
    (quotaLimit != null ? ` (quota ${quotaLimit}/${quotaPeriod})` : ' (unlimited)'),
);
db.close();
