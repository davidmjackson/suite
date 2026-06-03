import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncTo } from "../sync-theme.mjs";
import { ASSETS } from "../manifest.mjs";

test("syncTo copies every manifest asset into the target's public subdirs", () => {
  const target = mkdtempSync(join(tmpdir(), "theme-sync-"));
  const copied = syncTo(target);
  assert.equal(copied, ASSETS.length);
  for (const a of ASSETS) {
    const base = a.src.split("/").pop();
    assert.ok(existsSync(join(target, "public", a.destDir, base)), `${a.destDir}/${base} exists`);
  }
  // content matches source
  const css = readFileSync(join(target, "public", "css", "instrument-core.css"), "utf8");
  assert.match(css, /@font-face/);
});

test("syncTo is idempotent (re-running overwrites, same count)", () => {
  const target = mkdtempSync(join(tmpdir(), "theme-sync-"));
  syncTo(target);
  assert.equal(syncTo(target), ASSETS.length);
});
