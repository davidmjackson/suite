// scripts/create-team.js
import config from "../config.js";
import { openDb } from "../db/index.js";
import { createOrg } from "../lib/org.js";

const slug = process.argv[2];
const teamName = process.argv[3];
if (!slug || !teamName) {
  console.error("Usage: node scripts/create-team.js <company-slug> <team-name>");
  process.exit(1);
}
const db = openDb(config.dbPath);
const org = createOrg(db);
const company = org.getCompanyBySlug(slug);
if (!company) { console.error(`No company with slug ${slug}`); process.exit(1); }
const t = org.createTeam({ companyId: company.id, name: teamName });
console.log(`Created team '${t.name}' in '${company.name}' (id=${t.id})`);
db.close();
