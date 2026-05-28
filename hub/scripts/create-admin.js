// scripts/create-admin.js
import config from "../config.js";
import { openDb } from "../db/index.js";
import { randomId, now } from "../lib/tokens.js";

const email = process.argv[2];
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: node scripts/create-admin.js <email>");
  process.exit(1);
}
const db = openDb(config.dbPath);
const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
if (existing) {
  db.prepare("UPDATE users SET is_admin = 1, disabled_at = NULL WHERE id = ?").run(existing.id);
  console.log(`Promoted existing user ${email} to admin (id=${existing.id})`);
} else {
  const id = randomId();
  db.prepare("INSERT INTO users (id,email,is_admin,created_at) VALUES (?,?,1,?)").run(id, email.toLowerCase(), now());
  console.log(`Created admin user ${email} (id=${id})`);
}
db.close();
