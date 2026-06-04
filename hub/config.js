// config.js
const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
};

const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  baseUrl: required("BASE_URL"),
  dbPath: required("DB_PATH"),
  resendApiKey: required("RESEND_API_KEY"),
  fromEmail: required("FROM_EMAIL"),
  // Optional: where new access-request notifications are sent. If unset, no
  // operator notification is sent (the request is still recorded as normal).
  adminEmail: process.env.ADMIN_EMAIL || null,
  cookieSecret: required("COOKIE_SECRET"),
  allowedAppDomains: required("ALLOWED_APP_DOMAINS").split(",").map(s => s.trim()),
  apiKeys: {
    raid: required("HUB_API_KEY_RAID"),
    signal: required("HUB_API_KEY_SIGNAL"),
    retro: required("HUB_API_KEY_RETRO"),
    poker: required("HUB_API_KEY_POKER"),
  },
  sessionIdleMs: 30 * 60 * 1000,
  sessionMaxMs: 30 * 24 * 60 * 60 * 1000,
  magicLinkTtlMs: 15 * 60 * 1000,
  inviteTtlMs: 7 * 24 * 60 * 60 * 1000,
  launchTokenTtlMs: 30 * 1000,
};

export default config;
