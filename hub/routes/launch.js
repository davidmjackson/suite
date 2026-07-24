// routes/launch.js
import { randomToken, now } from '../lib/tokens.js';
import { createRequireSession } from '../middleware/requireSession.js';
import { createAuditLogger } from '../lib/audit.js';

const APP_DOMAIN = {
  raid: 'https://sprintraid.uk',
  signal: 'https://sprintsignal.uk',
  retro: 'https://sprintretro.uk',
  poker: 'https://sprintpoker.uk',
  plan: 'https://sprintplan.uk',
};

export function mountLaunch(app) {
  const db = app.locals.db;
  const config = app.locals.config;
  const requireSession = createRequireSession(db);
  const audit = createAuditLogger(db);

  function handle(req, res) {
    const appName = req.params.app;
    const domain = APP_DOMAIN[appName];
    if (!domain)
      return res.status(404).render('error', { title: 'Unknown app', message: 'No such app.' });

    const token = randomToken();
    const t = now();
    db.prepare(
      `
      INSERT INTO launch_tokens (token, central_session_id, target_app, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    ).run(token, req.sessionId, appName, t, t + config.launchTokenTtlMs);

    audit.log({ userId: req.user.id, eventType: 'app_launched', app: appName, ip: req.ip });

    let returnTo = '';
    if (req.query.return_to) {
      try {
        const u = new URL(req.query.return_to);
        if (`${u.protocol}//${u.host}` === domain)
          returnTo = `&return_to=${encodeURIComponent(req.query.return_to)}`;
      } catch {}
    }
    res.redirect(`${domain}/auth/launch?token=${token}${returnTo}`);
  }

  app.get('/launch/:app', requireSession, handle);
  app.post('/launch/:app', requireSession, handle);
}
