// check-theme-drift.mjs — verify a surface's synced copy matches the source.
// Exit non-zero if any asset is missing or differs. Usage:
//   node check-theme-drift.mjs <appRoot|publicRoot>
//   node check-theme-drift.mjs --all
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';
import { ASSETS, SURFACES, THEME_DIR } from './manifest.mjs';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

export function driftReport(target) {
  const publicRoot = target.endsWith('/public') ? target : join(target, 'public');
  const mismatched = [];
  const missing = [];
  for (const a of ASSETS) {
    const rel = `${a.destDir}/${basename(a.src)}`;
    const srcHash = sha(readFileSync(join(THEME_DIR, a.src)));
    let copy;
    try {
      copy = readFileSync(join(publicRoot, a.destDir, basename(a.src)));
    } catch {
      missing.push(rel);
      continue;
    }
    if (sha(copy) !== srcHash) mismatched.push(rel);
  }
  return { ok: mismatched.length === 0 && missing.length === 0, mismatched, missing };
}

function main(argv) {
  const arg = argv[2];
  if (!arg) {
    console.error('usage: node check-theme-drift.mjs <appRoot|publicRoot> | --all');
    process.exit(2);
  }
  const targets = arg === '--all' ? SURFACES.map((s) => s.publicRoot) : [arg];
  let bad = false;
  for (const t of targets) {
    const r = driftReport(t);
    if (r.ok) {
      console.log(`ok: ${t}`);
    } else {
      bad = true;
      console.error(`DRIFT: ${t}`);
      for (const m of r.mismatched) console.error(`  changed: ${m}`);
      for (const m of r.missing) console.error(`  missing: ${m}`);
    }
  }
  process.exit(bad ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
