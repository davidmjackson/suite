// scripts/add-company-member.js
import config from "../config.js";
import { openDb } from "../db/index.js";
import { createOrg } from "../lib/org.js";

const email = (process.argv[2] || "").toLowerCase();
const slug = process.argv[3];
const role = process.argv[4];
if (!email || !slug || !role) {
  console.error("Usage: node scripts/add-company-member.js <email> <company-slug> <owner|admin|member>");
  process.exit(1);
}
const db = openDb(config.dbPath);
const org = createOrg(db);
const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
if (!user) { console.error(`No user with email ${email} (create them in the hub first)`); process.exit(1); }
const company = org.getCompanyBySlug(slug);
if (!company) { console.error(`No company with slug ${slug}`); process.exit(1); }
org.addCompanyMember({ userId: user.id, companyId: company.id, role });
console.log(`Added ${email} to '${company.name}' as ${role}`);
db.close();
