// index.js
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthClient as _create } from "./lib/factory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createAuthClient(options) {
  const c = _create(options);
  c.staticAssets = express.static(path.join(__dirname, "public"));
  return c;
}
