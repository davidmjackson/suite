// server.js — process entry point. Opens the resources the app needs, hands them
// to createApp(), and listens. The wiring itself lives in app.js so the test
// suite can build the same app instead of copying it.
import config from './config.js';
import { openDb } from './db/index.js';
import { createApp } from './app.js';
import { createEmailSender } from './lib/email.js';
import logger from './lib/logger.js';

const db = openDb(config.dbPath);
const emailSender = createEmailSender({ apiKey: config.resendApiKey, from: config.fromEmail });
const app = createApp({ config, db, logger, emailSender });

app.listen(config.port, () => logger.info({ port: config.port }, 'hub listening'));
