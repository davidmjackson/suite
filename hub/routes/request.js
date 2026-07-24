// routes/request.js
import { createAccessRequests } from '../lib/access-requests.js';
import { createLimiter } from '../lib/rate-limit.js';
import { createAuditLogger } from '../lib/audit.js';
import { validate } from '../lib/validate.js';
import { requestSchema, APP_KEYS } from '../schemas/request.js';
import logger from '../lib/logger.js';

const ipLimiter = createLimiter({ max: 5, windowMs: 60 * 60 * 1000 });

// Third arg is the ZodError from validate(); unused here — the form shows a fixed message rather than per-field errors.
function requestInvalid(req, res, _zodError) {
  const b = req.body || {};
  let apps = b.apps;
  if (typeof apps === 'string') apps = [apps];
  apps = Array.isArray(apps) ? apps.filter((a) => APP_KEYS.includes(a)) : [];
  return res.status(400).render('request', {
    error: 'Please provide a company, your name, and a valid email.',
    values: {
      company_name: (b.company_name || '').trim(),
      contact_name: (b.contact_name || '').trim(),
      email: (b.email || '').trim().toLowerCase(),
      job_title: (b.job_title || '').trim() || null,
      team_size: (b.team_size || '').trim() || null,
      message: (b.message || '').trim() || null,
      apps,
    },
  });
}

export function mountRequest(app, { emailSender, marketing = [] } = {}) {
  const db = app.locals.db;
  const config = app.locals.config;
  const reqs = createAccessRequests(db);
  const audit = createAuditLogger(db);

  app.get('/request', marketing, (req, res) => {
    res.render('request', { error: null, values: {} });
  });

  function honeypotAndLimit(req, res, next) {
    if ((req.body.website || '').trim() !== '') {
      return res.render('request-received', {});
    }
    if (!ipLimiter.check(req.ip)) {
      return res.status(429).render('error', {
        title: 'Too many requests',
        message: 'Please wait a little while and try again.',
      });
    }
    next();
  }

  app.post(
    '/request',
    marketing,
    honeypotAndLimit,
    validate(requestSchema, { onInvalid: requestInvalid }),
    async (req, res) => {
      const { company_name, contact_name, email, job_title, team_size, message, apps } = req.body;
      reqs.createRequest({
        companyName: company_name,
        contactName: contact_name,
        email,
        jobTitle: job_title,
        teamSize: team_size,
        appsInterest: apps,
        message,
      });
      audit.log({
        userId: null,
        eventType: 'access_requested',
        metadata: { company: company_name, email },
        ip: req.ip,
      });

      // Best-effort operator notification — never block or fail the request on it.
      if (config && config.adminEmail && emailSender) {
        try {
          await emailSender.sendAccessRequestNotification({
            to: config.adminEmail,
            request: {
              companyName: company_name,
              contactName: contact_name,
              email,
              jobTitle: job_title,
              teamSize: team_size,
              apps,
              message,
            },
            reviewUrl: `${config.baseUrl}/admin/companies`,
          });
        } catch (err) {
          (req.log || logger).error({ err }, 'access request notification failed');
        }
      }
      res.render('request-received', {});
    },
  );
}
