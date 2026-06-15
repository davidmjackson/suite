// tests/config.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

test("config rejects when required env missing", async () => {
  process.env.BASE_URL = "https://sprintsuite.uk";
  process.env.DB_PATH = ":memory:";
  process.env.FROM_EMAIL = "a@b";
  process.env.COOKIE_SECRET = "x";
  process.env.ALLOWED_APP_DOMAINS = "https://a.com";
  process.env.HUB_API_KEY_RAID = "k1";
  process.env.HUB_API_KEY_SIGNAL = "k2";
  process.env.HUB_API_KEY_RETRO = "k3";
  process.env.HUB_API_KEY_POKER = "k4";
  process.env.HUB_API_KEY_PLAN = "k5";
  const prev = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  await assert.rejects(
    async () => (await import("../config.js?t=" + Date.now())).default,
    /RESEND_API_KEY/,
  );
  if (prev !== undefined) process.env.RESEND_API_KEY = prev;
});

test("config parses ALLOWED_APP_DOMAINS to array", async () => {
  process.env.RESEND_API_KEY = "test";
  process.env.FROM_EMAIL = "a@b";
  process.env.COOKIE_SECRET = "x";
  process.env.DB_PATH = ":memory:";
  process.env.BASE_URL = "https://sprintsuite.uk";
  process.env.ALLOWED_APP_DOMAINS = "https://a.com,https://b.com";
  process.env.HUB_API_KEY_RAID = "k1";
  process.env.HUB_API_KEY_SIGNAL = "k2";
  process.env.HUB_API_KEY_RETRO = "k3";
  process.env.HUB_API_KEY_POKER = "k4";
  process.env.HUB_API_KEY_PLAN = "k5";
  const cfg = (await import("../config.js?t=" + Date.now())).default;
  assert.deepEqual(cfg.allowedAppDomains, ["https://a.com", "https://b.com"]);
  assert.equal(cfg.apiKeys.raid, "k1");
});
