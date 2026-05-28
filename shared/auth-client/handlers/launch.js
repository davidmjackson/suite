// handlers/launch.js
import { setSessionCookie } from "../lib/cookies.js";
import { randomBytes } from "node:crypto";

export function createLaunchHandler(ctx) {
  return async function handleLaunch(req, res) {
    const token = req.query?.token;
    if (!token || typeof token !== "string") {
      return res.status(400).send("Missing launch token");
    }
    let info;
    try {
      info = await ctx.hubApi.exchange(token);
    } catch {
      return res.status(400).send("Sign-in link expired or invalid. Please try again.");
    }
    const sessionId = randomBytes(32).toString("hex");
    ctx.store.create({
      id: sessionId,
      userId: info.user.id,
      centralSessionId: info.central_session_id,
      expiresAt: Date.now() + ctx.sessionMaxMs,
    });
    setSessionCookie(res, { name: ctx.cookieName, value: sessionId, domain: ctx.cookieDomain });
    let dest = "/";
    if (req.query.return_to) {
      try {
        const u = new URL(req.query.return_to);
        if (req.headers.host && u.host === req.headers.host) dest = u.pathname + u.search;
      } catch {}
    }
    res.redirect(302, dest);
  };
}
