// scripts/set-company-member-role.js
import config from '../config.js';
import { openDb } from '../db/index.js';
import { createOrg } from '../lib/org.js';

const email = (process.argv[2] || '').toLowerCase();
const slug = process.argv[3];
const role = process.argv[4];
if (!email || !slug || !role) {
  console.error(
    'Usage: node scripts/set-company-member-role.js <email> <company-slug> <owner|admin|member>',
  );
  process.exit(1);
}
const db = openDb(config.dbPath);
const org = createOrg(db);
const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (!user) {
  console.error(`No user with email ${email}`);
  process.exit(1);
}
const company = org.getCompanyBySlug(slug);
if (!company) {
  console.error(`No company with slug ${slug}`);
  process.exit(1);
}
try {
  org.setCompanyMemberRole({ userId: user.id, companyId: company.id, role });
} catch (e) {
  if (e.message === 'not_a_member') {
    console.error(
      `${email} is not a member of '${company.name}' — use add-company-member.js first`,
    );
    process.exit(1);
  }
  if (e.message === 'last_owner') {
    console.error(`Refusing: ${email} is the last owner of '${company.name}'`);
    process.exit(1);
  }
  if (e.message === 'invalid_company_role') {
    console.error(`Invalid role '${role}' (use owner|admin|member)`);
    process.exit(1);
  }
  throw e;
}
console.log(`Set ${email} role in '${company.name}' to ${role}`);
db.close();
