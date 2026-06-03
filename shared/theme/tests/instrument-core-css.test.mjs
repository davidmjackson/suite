import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../instrument-core.css"), "utf8");

test("defines a table component", () => {
  assert.match(css, /\.ins table\.table\b/);
  assert.match(css, /\.ins \.table-wrap\b/);
});

test("styles select, textarea and checkbox-list form controls", () => {
  assert.match(css, /\.ins select\.input\b/);
  assert.match(css, /\.ins textarea\.input\b/);
  assert.match(css, /\.ins \.checks\b/);
  assert.match(css, /\.ins \.check\b/);
});
