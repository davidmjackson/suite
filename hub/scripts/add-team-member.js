// scripts/add-team-member.js
import config from "../config.js";
import { openDb } from "../db/index.js";
import { createOrg } from "../lib/org.js";

const email = (process.argv[2] || "").toLowerCase();
const slug = process.argv[3];
const teamName = process.argv[4];
const role = process.argv[5];
if (!email || !slug || !teamName || !role) {
  console.error("Usage: node scripts/add-team-member.js <email> <company-slug> <team-name> <lead|member>");
  process.exit(1);
}
const db = openDb(config.dbPath);
const org = createOrg(db);
const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
if (!user) { console.error(`No user with email ${email}`); process.exit(1); }
const company = org.getCompanyBySlug(slug);
if (!company) { console.error(`No company with slug ${slug}`); process.exit(1); }
const team = org.listTeams(company.id).find((t) => t.name === teamName);
if (!team) { console.error(`No team '${teamName}' in company ${slug}`); process.exit(1); }
org.addTeamMember({ userId: user.id, teamId: team.id, role });
console.log(`Added ${email} to team '${teamName}' as ${role}`);
db.close();
