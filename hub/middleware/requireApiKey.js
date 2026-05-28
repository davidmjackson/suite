// middleware/requireApiKey.js
export function createRequireApiKey(config) {
  const keyByApp = {};
  for (const [app, key] of Object.entries(config.apiKeys)) keyByApp[key] = app;
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const m = /^Bearer (.+)$/.exec(header);
    if (!m) return res.status(401).json({ error: "missing_auth" });
    const app = keyByApp[m[1]];
    if (!app) return res.status(401).json({ error: "invalid_auth" });
    req.callingApp = app;
    next();
  };
}
