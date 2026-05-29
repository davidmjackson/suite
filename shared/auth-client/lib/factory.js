// lib/factory.js
const { createHubApi } = require("./hub-api.js");
const { createSessionsStore } = require("./sessions-db.js");
const { createRequireAuth } = require("../middleware.js");
const { createLaunchHandler } = require("../handlers/launch.js");
const { createLogoutHandler } = require("../handlers/logout.js");
const { createHeartbeatHandler } = require("../handlers/heartbeat.js");

function createAuthClient(options) {
  const required = ["appName", "hubBaseUrl", "hubApiKey", "cookieName", "dbPath"];
  for (const k of required) if (!options[k]) throw new Error(`createAuthClient: missing ${k}`);

  const store = createSessionsStore(options.dbPath);
  const hubApi = createHubApi({ baseUrl: options.hubBaseUrl, apiKey: options.hubApiKey, appName: options.appName });
  const ctx = {
    ...options,
    store,
    hubApi,
    cacheTtlMs: options.cacheTtlMs ?? 60_000,
    graceMs: options.graceMs ?? 5 * 60_000,
    sessionMaxMs: options.sessionMaxMs ?? 30 * 24 * 60 * 60 * 1000,
  };

  return {
    requireAuth: createRequireAuth(ctx),
    handleLaunch: createLaunchHandler(ctx),
    handleLogout: createLogoutHandler(ctx),
    handleHeartbeat: createHeartbeatHandler(ctx),
    getCurrentUser: (req) => req.user || null,
    consume: (centralSessionId) => ctx.hubApi.consume(centralSessionId),
    _ctx: ctx,
  };
}

module.exports = { createAuthClient };
