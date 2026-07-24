// routes/magic.js
import { randomToken, now } from '../lib/tokens.js';
import { setSessionCookie } from '../lib/cookies.js';
import { createAuditLogger } from '../lib/audit.js';
import { validate } from '../lib/validate.js';
import { magicPostSchema } from '../schemas/magic.js';

// Every domain the hub accepts as a return_to must appear here, or a sign-in that
// asked for that app silently lands on /dashboard instead. sprintplan.uk was
// missing: it is an allowed return domain and a launched app (see launch.js and
// the dashboard tile), so a Sprintplan magic link dropped its destination.
const APP_BY_DOMAIN = {
  'sprintraid.uk': 'raid',
  'sprintsignal.uk': 'signal',
  'sprintretro.uk': 'retro',
  'sprintpoker.uk': 'poker',
  'sprintplan.uk': 'plan',
};

const expiredError = (res) =>
  res.status(400).render('error', {
    title: 'Link expired',
    message: 'This sign-in link is expired or has already been used.',
    backHref: '/login',
  });

export function mountMagic(app) {
  const db = app.locals.db;
  const config = app.locals.config;
  const audit = createAuditLogger(db);

  // GET is intentionally side-effect-free: it must NOT consume the token. Mailbox
  // security scanners (e.g. Microsoft Defender "Safe Links") blindly GET every URL
  // in an email to scan it; if GET consumed the one-time token the link would be
  // dead before the human clicked. Instead we render a confirm page whose button
  // POSTs back — scanners issue GETs but don't submit forms.
  app.get('/auth/magic', (req, res) => {
    // Inline token check (not validate()): Express 5 makes req.query getter-only, and validate() targets req.body.
    const token = req.query.token;
    if (!token || typeof token !== 'string') {
      return res
        .status(400)
        .render('error', { title: 'Invalid link', message: 'This sign-in link is malformed.' });
    }
    const row = db
      .prepare('SELECT consumed_at, expires_at FROM magic_link_tokens WHERE token = ?')
      .get(token);
    if (!row || row.consumed_at != null || row.expires_at <= now()) {
      return expiredError(res);
    }
    res.render('confirm', { token });
  });

  function magicInvalid(req, res) {
    return res
      .status(400)
      .render('error', { title: 'Invalid link', message: 'This sign-in link is malformed.' });
  }

  // POST performs the actual login: atomically consume the token, then create the session.
  app.post('/auth/magic', validate(magicPostSchema, { onInvalid: magicInvalid }), (req, res) => {
    const token = req.body.token;
    const t = now();
    const consumed = db
      .prepare(
        `
      UPDATE magic_link_tokens SET consumed_at = ?
      WHERE token = ? AND consumed_at IS NULL AND expires_at > ?
    `,
      )
      .run(t, token, t);
    if (consumed.changes === 0) {
      return expiredError(res);
    }
    const tokRow = db
      .prepare('SELECT email, return_to FROM magic_link_tokens WHERE token = ?')
      .get(token);
    const user = db.prepare('SELECT id, disabled_at FROM users WHERE email = ?').get(tokRow.email);
    if (!user || user.disabled_at) {
      return res.status(403).render('error', {
        title: 'Account disabled',
        message: 'Your account is no longer active.',
      });
    }
    const sid = randomToken();
    db.prepare(
      `
      INSERT INTO central_sessions (id, user_id, created_at, last_heartbeat_at, expires_at, user_agent, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(sid, user.id, t, t, t + config.sessionMaxMs, req.headers['user-agent'] || null, req.ip);

    audit.log({ userId: user.id, eventType: 'session_created', ip: req.ip });
    setSessionCookie(res, 'hub_session', sid, { secure: config.nodeEnv === 'production' });

    if (tokRow.return_to) {
      try {
        const host = new URL(tokRow.return_to).host;
        const appName = APP_BY_DOMAIN[host];
        if (appName) {
          return res.redirect(
            `/launch/${appName}?return_to=${encodeURIComponent(tokRow.return_to)}`,
          );
        }
      } catch {}
    }
    res.redirect('/dashboard');
  });
}
