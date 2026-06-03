// sync-theme.mjs — copy the Instrument foundation assets into a surface's
// public/{css,js,illos,fonts}. Usage:
//   node sync-theme.mjs <publicRoot-or-appRoot>   # one surface
//   node sync-theme.mjs --all                     # every registered surface
import { mkdirSync, copyFileSync } from "node:fs";
import { join, basename } from "node:path";
import { ASSETS, SURFACES, THEME_DIR } from "./manifest.mjs";

// target = an app root (…/signal) OR a public root (…/signal/public). Normalise to public/.
export function syncTo(target) {
  const publicRoot = target.endsWith("/public") ? target : join(target, "public");
  let n = 0;
  for (const a of ASSETS) {
    const destDir = join(publicRoot, a.destDir);
    mkdirSync(destDir, { recursive: true });
    copyFileSync(join(THEME_DIR, a.src), join(destDir, basename(a.src)));
    n++;
  }
  return n;
}

function main(argv) {
  const arg = argv[2];
  if (!arg) { console.error("usage: node sync-theme.mjs <appRoot|publicRoot> | --all"); process.exit(2); }
  const targets = arg === "--all" ? SURFACES.map((s) => s.publicRoot) : [arg];
  for (const t of targets) console.log(`synced ${syncTo(t)} assets -> ${t}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
