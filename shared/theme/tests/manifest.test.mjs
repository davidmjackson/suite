import { test } from "node:test";
import assert from "node:assert/strict";
import { ASSETS, SURFACES } from "../manifest.mjs";

test("manifest lists each asset with a source file and a public subdir", () => {
  assert.ok(ASSETS.length >= 3); // 3 static now; becomes 11 once fonts land (Task 3)
  for (const a of ASSETS) {
    assert.match(a.src, /\.(css|js|svg|woff2)$/, `${a.src} has an asset extension`);
    assert.match(a.destDir, /^(css|js|illos|fonts)$/, `${a.destDir} is a known public subdir`);
  }
});

test("the four apps + the hub are registered as surfaces with public roots", () => {
  const names = SURFACES.map((s) => s.name).sort();
  assert.deepEqual(names, ["hub", "poker", "raid", "retro", "signal"]);
  for (const s of SURFACES) assert.match(s.publicRoot, /\/public$/);
});
