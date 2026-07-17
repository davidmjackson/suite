import { test } from "node:test";
import assert from "node:assert/strict";
import { ASSETS, SURFACES } from "../manifest.mjs";

test("manifest lists each asset with a source file and a public subdir", () => {
  assert.ok(ASSETS.length >= 11); // 3 static + 8 fonts
  for (const a of ASSETS) {
    assert.match(a.src, /\.(css|js|svg|woff2)$/, `${a.src} has an asset extension`);
    assert.match(a.destDir, /^(css|js|illos|fonts)$/, `${a.destDir} is a known public subdir`);
  }
});

// The list is spelled out on purpose: adding a surface should be a deliberate
// edit here, not something that slips in unnoticed.
test("every surface is registered with a public root", () => {
  const names = SURFACES.map((s) => s.name).sort();
  assert.deepEqual(names, ["hub", "marketing", "plan", "poker", "raid", "retro", "signal"]);
  for (const s of SURFACES) assert.match(s.publicRoot, /\/public$/);
});
