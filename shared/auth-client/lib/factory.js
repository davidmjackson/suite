// lib/factory.js
import { createHubApi } from "./hub-api.js";
import { createSessionsStore } from "./sessions-db.js";
import { createRequireAuth } from "../middleware.js";
import { createLaunchHandler } from "../handlers/launch.js";
import { createLogoutHandler } from "../handlers/logout.js";
import { createHeartbeatHandler } from "../handlers/heartbeat.js";

export function createAuthClient(options) {
  const required = ["appName", "hubBaseUrl", "hubApiKey", "cookieName", "dbPath"];
  for (const k of required) if (!options[k]) throw new Error(`createAuthClient: missing ${k}`);

  const store = createSessionsStore(options.dbPath);
  const hubApi = createHubApi({ baseUrl: options.hubBaseUrl, apiKey: options.hubApiKey });
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
    _ctx: ctx,
  };
}
