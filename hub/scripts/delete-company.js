// scripts/delete-company.js
// Operator CLI: hard-delete a company and its hub-side dependents by slug.
// NOTE: this does NOT touch app-side data — poker/retro/signal/raid keep their
// own databases keyed by team_id. Intended for empty / test companies. Use with
// care. The DB path is a required arg so you consciously point at the right DB.
//   node scripts/delete-company.js <slug> <dbPath>
import { openDb } from '../db/index.js';

const slug = process.argv[2];
const dbPath = process.argv[3];
if (!slug || !dbPath) {
  console.error('Usage: node scripts/delete-company.js <slug> <dbPath>');
  process.exit(1);
}

const db = openDb(dbPath);
const company = db.prepare('SELECT id, name FROM companies WHERE slug = ?').get(slug);
if (!company) {
  console.log(`No company with slug '${slug}'`);
  process.exit(0);
}

const run = db.transaction(() => {
  const teams = db.prepare('SELECT id FROM teams WHERE company_id = ?').all(company.id);
  for (const t of teams) db.prepare('DELETE FROM team_members WHERE team_id = ?').run(t.id);
  db.prepare('DELETE FROM teams WHERE company_id = ?').run(company.id);
  db.prepare(
    "DELETE FROM app_entitlements WHERE principal_type = 'company' AND principal_id = ?",
  ).run(company.id);
  db.prepare('DELETE FROM company_members WHERE company_id = ?').run(company.id);
  db.prepare('DELETE FROM access_requests WHERE company_id = ?').run(company.id);
  db.prepare('DELETE FROM companies WHERE id = ?').run(company.id);
});
run();

console.log(
  `Deleted company '${company.name}' (slug=${slug}, id=${company.id}) and its hub-side dependents.`,
);
db.close();
