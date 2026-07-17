// manifest.mjs — single source of truth for which foundation assets get synced
// into each surface, and where each surface lives. Fonts are expanded at runtime
// by reading the fonts/ dir, so adding a weight needs no edit here.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const THEME_DIR = dirname(fileURLToPath(import.meta.url));

// Non-font assets: { src (relative to THEME_DIR), destDir (public subdir) }.
const STATIC_ASSETS = [
  { src: "instrument-core.css", destDir: "css" },
  { src: "oscilloscope.js", destDir: "js" },
  { src: "glyphs.svg", destDir: "illos" },
];

function fontAssets() {
  let files = [];
  try {
    files = readdirSync(join(THEME_DIR, "fonts")).filter((f) => f.endsWith(".woff2"));
  } catch {
    files = [];
  }
  return files.map((f) => ({ src: `fonts/${f}`, destDir: "fonts" }));
}

export const ASSETS = [...STATIC_ASSETS, ...fontAssets()];

// Surface name -> its app repo public/ root. Single-box layout under /var/www.
export const SURFACES = [
  { name: "hub", publicRoot: "/var/www/suite/hub/public" },
  { name: "signal", publicRoot: "/var/www/signal/public" },
  { name: "retro", publicRoot: "/var/www/retrospective/public" },
  { name: "poker", publicRoot: "/var/www/scrumpoker/public" },
  { name: "raid", publicRoot: "/var/www/raid/public" },
  { name: "plan", publicRoot: "/var/www/plan/public" },
  // marketing is a static surface (no app server); it consumes the theme like any other.
  { name: "marketing", publicRoot: "/var/www/suite/marketing/public" },
];
