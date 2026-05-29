// scripts/create-company.js
import config from "../config.js";
import { openDb } from "../db/index.js";
import { createOrg } from "../lib/org.js";

const name = process.argv[2];
const slug = process.argv[3];
if (!name || !slug) {
  console.error("Usage: node scripts/create-company.js <name> <slug>");
  process.exit(1);
}
const db = openDb(config.dbPath);
const org = createOrg(db);
const existing = org.getCompanyBySlug(slug);
if (existing) {
  console.log(`Company slug '${slug}' already exists (id=${existing.id})`);
} else {
  const c = org.createCompany({ name, slug });
  console.log(`Created company '${c.name}' slug=${c.slug} (id=${c.id})`);
}
db.close();
