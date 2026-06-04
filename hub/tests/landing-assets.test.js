// tests/landing-assets.test.js
// Smoke test: every static asset the landing page references must actually be
// served (no silent 404s on favicon / OG / WebP / CSS / JS wiring).
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";

// Extract local asset URLs (src=, href=, and each srcset candidate) from the HTML.
function assetUrls(html) {
  const urls = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/[^"]+\.(?:css|js|png|svg|webp|ico))"/g)) {
    urls.add(m[1]);
  }
  for (const m of html.matchAll(/srcset="([^"]+)"/g)) {
    for (const part of m[1].split(",")) {
      const url = part.trim().split(/\s+/)[0];
      if (url.startsWith("/")) urls.add(url);
    }
  }
  return [...urls];
}

test("every asset referenced by the landing page resolves (200)", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  const urls = assetUrls(res.text);
  // sanity: the page references the new assets we expect
  assert.ok(urls.includes("/css/landing.css"), "landing.css referenced");
  assert.ok(urls.includes("/js/landing-hero.js"), "landing-hero.js referenced");
  assert.ok(urls.includes("/favicon.svg"), "favicon.svg referenced");
  assert.ok(urls.includes("/img/shot-raid.webp"), "a webp source referenced");
  assert.ok(urls.includes("/img/shot-raid@2x.webp"), "a 2x webp referenced");
  assert.ok(urls.length >= 12, `expected many assets, saw ${urls.length}`);

  for (const url of urls) {
    const r = await request(app).get(url);
    assert.equal(r.status, 200, `${url} should serve 200, got ${r.status}`);
  }
});
