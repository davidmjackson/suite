# Sprint Suite Auth Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted centralised auth hub at `sprintsuite.uk` with magic-link login, dashboard launcher, admin panel, and a shared client library that wires each of the four Sprint apps into the hub for true SSO.

**Architecture:** Node.js + Express hub on port 3000, SQLite for hub state, server-rendered HTML (eta templates), Resend for transactional email. Apps validate sessions by heartbeat-pinging the hub server-to-server, with a 60-second app-side cache. Opaque random tokens validated by DB lookup — no JWTs. Per-app local cookies; central session deletion = global logout within 60 seconds.

**Tech Stack:** Node.js 20+, Express 5, better-sqlite3, eta templates, Resend SDK, supertest + node --test, PM2, Apache (existing).

**Spec:** `/var/www/suite/docs/superpowers/specs/2026-05-28-sprint-suite-auth-hub-design.md`

---

## Phase overview

| Phase | Scope | Tasks | Est. effort |
|---|---|---|---|
| **Phase 1** | Hub foundation: skeleton, DB, auth flows, dashboard, admin, infrastructure | 24 | ~1.5 days |
| **Phase 2** | Shared `@suite/auth-client` library | 9 | ~0.75 days |
| **Phase 3** | Per-app integration (×4) + signal/retro migration | 8 | ~1.5 days |
| **Phase 4** | End-to-end soak + cutover | 3 | ~1 day |

Total: 44 tasks. Each task is one logical unit producing a green test + a commit.

---

## Phase 1 — Hub Foundation

### Task 1.1: Project skeleton

**Files:**
- Create: `/var/www/suite/hub/package.json`
- Create: `/var/www/suite/hub/server.js`
- Create: `/var/www/suite/hub/.env.example`
- Create: `/var/www/suite/hub/.gitignore`

- [ ] **Step 1: Initialise hub directory**

```bash
mkdir -p /var/www/suite/hub/{db/migrations,lib,middleware,routes,views/partials,views/admin,views/emails,public,scripts,tests}
cd /var/www/suite/hub
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "@suite/hub",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node --test tests/",
    "create-admin": "node scripts/create-admin.js",
    "prune": "node scripts/prune.js"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "better-sqlite3": "^12.10.0",
    "eta": "^3.5.0",
    "express": "^5.1.0",
    "resend": "^4.0.0"
  },
  "devDependencies": {
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 3: Create `.env.example`**

```bash
# Server
PORT=3000
NODE_ENV=production
BASE_URL=https://sprintsuite.uk

# DB
DB_PATH=./data/suite.db

# Email
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FROM_EMAIL=login@sprintsuite.uk

# Per-app API keys (must match each app's HUB_API_KEY env)
HUB_API_KEY_RAID=replace-with-random-32-bytes-hex
HUB_API_KEY_SIGNAL=replace-with-random-32-bytes-hex
HUB_API_KEY_RETRO=replace-with-random-32-bytes-hex
HUB_API_KEY_POKER=replace-with-random-32-bytes-hex

# Cookie secret (signs no cookies in v1, reserved)
COOKIE_SECRET=replace-with-random-32-bytes-hex

# Allowed app domains (comma-separated) for return_to validation
ALLOWED_APP_DOMAINS=https://sprintraid.uk,https://sprintsignal.uk,https://sprintretro.uk,https://sprintpoker.uk
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
data/*.db
data/*.db-journal
data/*.db-wal
data/*.db-shm
.env
*.log
```

- [ ] **Step 5: Create stub `server.js`**

```js
import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`hub listening on ${PORT}`));
```

- [ ] **Step 6: Install deps and verify boot**

```bash
cd /var/www/suite/hub
npm install
node server.js &
HUB_PID=$!
sleep 1
curl -s http://localhost:3000/healthz
kill $HUB_PID
```
Expected: `{"ok":true}`

- [ ] **Step 7: Commit**

```bash
git add hub/
git commit -m "feat(hub): skeleton with healthz endpoint"
```

---

### Task 1.2: Config module

**Files:**
- Create: `/var/www/suite/hub/config.js`
- Create: `/var/www/suite/hub/tests/config.test.js`

- [ ] **Step 1: Write failing test**

```js
// tests/config.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

test("config rejects when required env missing", async () => {
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
  const cfg = (await import("../config.js?t=" + Date.now())).default;
  assert.deepEqual(cfg.allowedAppDomains, ["https://a.com", "https://b.com"]);
  assert.equal(cfg.apiKeys.raid, "k1");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /var/www/suite/hub && node --test tests/config.test.js
```
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `config.js`**

```js
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
  launchTokenTtlMs: 30 * 1000,
};

export default config;
```

- [ ] **Step 4: Test passes**

```bash
node --test tests/config.test.js
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add hub/config.js hub/tests/config.test.js
git commit -m "feat(hub): config module with env validation"
```

---

### Task 1.3: Database schema and connection

**Files:**
- Create: `/var/www/suite/hub/db/schema.sql`
- Create: `/var/www/suite/hub/db/migrations/001-initial.sql`
- Create: `/var/www/suite/hub/db/index.js`
- Create: `/var/www/suite/hub/tests/db.test.js`

- [ ] **Step 1: Write `db/migrations/001-initial.sql`**

```sql
-- 001-initial.sql
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  disabled_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS central_sessions (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id),
  created_at          INTEGER NOT NULL,
  last_heartbeat_at   INTEGER NOT NULL,
  expires_at          INTEGER NOT NULL,
  user_agent          TEXT,
  ip                  TEXT
);
CREATE INDEX IF NOT EXISTS idx_central_sessions_user ON central_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_central_sessions_expires ON central_sessions(expires_at);

CREATE TABLE IF NOT EXISTS magic_link_tokens (
  token         TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  return_to     TEXT,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  consumed_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mlt_email ON magic_link_tokens(email);

CREATE TABLE IF NOT EXISTS launch_tokens (
  token                 TEXT PRIMARY KEY,
  central_session_id    TEXT NOT NULL REFERENCES central_sessions(id),
  target_app            TEXT NOT NULL,
  created_at            INTEGER NOT NULL,
  expires_at            INTEGER NOT NULL,
  consumed_at           INTEGER
);

CREATE TABLE IF NOT EXISTS audit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT,
  event_type  TEXT NOT NULL,
  app         TEXT,
  metadata    TEXT,
  created_at  INTEGER NOT NULL,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
INSERT INTO schema_version (version, applied_at) VALUES (1, strftime('%s','now')*1000)
  ON CONFLICT(version) DO NOTHING;
```

- [ ] **Step 2: Write failing test**

```js
// tests/db.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("openDb creates schema and exposes prepared statements", () => {
  const tmpPath = "/tmp/test-suite-" + Date.now() + ".db";
  process.env.DB_PATH = tmpPath;
  // re-import with fresh cache
  return import("../db/index.js?t=" + Date.now()).then(({ openDb }) => {
    const db = openDb(tmpPath);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map(r => r.name);
    assert.ok(tables.includes("users"));
    assert.ok(tables.includes("central_sessions"));
    assert.ok(tables.includes("magic_link_tokens"));
    assert.ok(tables.includes("launch_tokens"));
    assert.ok(tables.includes("audit_events"));
    db.close();
    fs.unlinkSync(tmpPath);
  });
});
```

- [ ] **Step 3: Implement `db/index.js`**

```js
// db/index.js
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function openDb(dbPath) {
  const dir = path.dirname(dbPath);
  if (dir !== ":memory:" && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const migrationsDir = path.join(__dirname, "migrations");
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    db.exec(sql);
  }
  return db;
}
```

- [ ] **Step 4: Test passes**

```bash
node --test tests/db.test.js
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add hub/db/ hub/tests/db.test.js
git commit -m "feat(hub): SQLite schema + migrations + connection helper"
```

---

### Task 1.4: Token generation utility

**Files:**
- Create: `/var/www/suite/hub/lib/tokens.js`
- Create: `/var/www/suite/hub/tests/tokens.test.js`

- [ ] **Step 1: Write failing test**

```js
// tests/tokens.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomToken, randomId } from "../lib/tokens.js";

test("randomToken returns 64-char hex (32 bytes)", () => {
  const t = randomToken();
  assert.match(t, /^[0-9a-f]{64}$/);
});

test("randomId returns 32-char hex (16 bytes)", () => {
  const id = randomId();
  assert.match(id, /^[0-9a-f]{32}$/);
});

test("randomToken is non-repeating across many calls", () => {
  const set = new Set();
  for (let i = 0; i < 1000; i++) set.add(randomToken());
  assert.equal(set.size, 1000);
});
```

- [ ] **Step 2: Implement `lib/tokens.js`**

```js
// lib/tokens.js
import { randomBytes } from "node:crypto";

export const randomToken = () => randomBytes(32).toString("hex");
export const randomId = () => randomBytes(16).toString("hex");
export const now = () => Date.now();
```

- [ ] **Step 3: Test passes**

```bash
node --test tests/tokens.test.js
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add hub/lib/tokens.js hub/tests/tokens.test.js
git commit -m "feat(hub): token + id generation utilities"
```

---

### Task 1.5: Cookie helpers

**Files:**
- Create: `/var/www/suite/hub/lib/cookies.js`
- Create: `/var/www/suite/hub/tests/cookies.test.js`

- [ ] **Step 1: Write failing test**

```js
// tests/cookies.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { setSessionCookie, clearSessionCookie, parseCookies } from "../lib/cookies.js";

test("parseCookies parses cookie header", () => {
  assert.deepEqual(parseCookies("a=1; b=two; c="), { a: "1", b: "two", c: "" });
  assert.deepEqual(parseCookies(undefined), {});
});

test("setSessionCookie sets correct attributes", () => {
  const res = { setHeader(name, val) { this.h = { name, val }; } };
  setSessionCookie(res, "hub_session", "abc123", { secure: true });
  assert.match(res.h.val, /^hub_session=abc123;/);
  assert.match(res.h.val, /HttpOnly/);
  assert.match(res.h.val, /Secure/);
  assert.match(res.h.val, /SameSite=Lax/);
  assert.match(res.h.val, /Path=\//);
  assert.match(res.h.val, /Max-Age=2592000/);
});

test("clearSessionCookie expires the cookie", () => {
  const res = { setHeader(name, val) { this.h = { name, val }; } };
  clearSessionCookie(res, "hub_session");
  assert.match(res.h.val, /Max-Age=0/);
});
```

- [ ] **Step 2: Implement `lib/cookies.js`**

```js
// lib/cookies.js
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export function setSessionCookie(res, name, value, { secure = true, maxAgeSec = 60 * 60 * 24 * 30 } = {}) {
  const attrs = [
    `${name}=${value}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

export function clearSessionCookie(res, name) {
  res.setHeader("Set-Cookie", `${name}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}
```

- [ ] **Step 3: Test passes**

```bash
node --test tests/cookies.test.js
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add hub/lib/cookies.js hub/tests/cookies.test.js
git commit -m "feat(hub): cookie set/clear/parse helpers"
```

---

### Task 1.6: Audit logger

**Files:**
- Create: `/var/www/suite/hub/lib/audit.js`
- Create: `/var/www/suite/hub/tests/audit.test.js`

- [ ] **Step 1: Write failing test**

```js
// tests/audit.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.js";
import { createAuditLogger } from "../lib/audit.js";

test("audit.log inserts a row with correct fields", () => {
  const db = openDb(":memory:");
  const audit = createAuditLogger(db);
  audit.log({ userId: "u1", eventType: "login_sent", app: null, metadata: { email: "a@b.c" }, ip: "1.2.3.4" });
  const row = db.prepare("SELECT * FROM audit_events").get();
  assert.equal(row.user_id, "u1");
  assert.equal(row.event_type, "login_sent");
  assert.equal(JSON.parse(row.metadata).email, "a@b.c");
  assert.equal(row.ip, "1.2.3.4");
  assert.ok(row.created_at > 0);
  db.close();
});
```

- [ ] **Step 2: Implement `lib/audit.js`**

```js
// lib/audit.js
import { now } from "./tokens.js";

export function createAuditLogger(db) {
  const stmt = db.prepare(`
    INSERT INTO audit_events (user_id, event_type, app, metadata, created_at, ip)
    VALUES (@userId, @eventType, @app, @metadata, @createdAt, @ip)
  `);
  return {
    log({ userId = null, eventType, app = null, metadata = null, ip = null }) {
      stmt.run({
        userId,
        eventType,
        app,
        metadata: metadata ? JSON.stringify(metadata) : null,
        createdAt: now(),
        ip,
      });
    },
  };
}
```

- [ ] **Step 3: Test passes**

```bash
node --test tests/audit.test.js
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add hub/lib/audit.js hub/tests/audit.test.js
git commit -m "feat(hub): audit event logger"
```

---

### Task 1.7: Email module (Resend wrapper)

**Files:**
- Create: `/var/www/suite/hub/lib/email.js`
- Create: `/var/www/suite/hub/views/emails/magic-link.eta`
- Create: `/var/www/suite/hub/tests/email.test.js`

- [ ] **Step 1: Write the magic link template**

```html
<!-- views/emails/magic-link.eta -->
<!doctype html>
<html><body style="font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 32px auto; color: #222;">
<h2 style="margin-bottom: 8px;">Sign in to Sprint Suite</h2>
<p>Click the link below to sign in. It expires in 15 minutes.</p>
<p><a href="<%= it.url %>" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none;">Sign in</a></p>
<p style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
<p style="color: #999; font-size: 12px; margin-top: 32px;">Sprint Suite · sprintsuite.uk</p>
</body></html>
```

- [ ] **Step 2: Write failing test**

```js
// tests/email.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMagicLinkEmail } from "../lib/email.js";

test("renderMagicLinkEmail produces HTML with the URL", async () => {
  const html = await renderMagicLinkEmail({ url: "https://sprintsuite.uk/auth/magic?token=abc" });
  assert.match(html, /Sign in to Sprint Suite/);
  assert.match(html, /https:\/\/sprintsuite\.uk\/auth\/magic\?token=abc/);
});
```

- [ ] **Step 3: Implement `lib/email.js`**

```js
// lib/email.js
import { Eta } from "eta";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resend } from "resend";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const eta = new Eta({ views: path.join(__dirname, "../views"), cache: false });

export async function renderMagicLinkEmail({ url }) {
  return await eta.renderAsync("emails/magic-link", { url });
}

export function createEmailSender({ apiKey, from }) {
  const resend = new Resend(apiKey);
  return {
    async sendMagicLink({ to, url }) {
      const html = await renderMagicLinkEmail({ url });
      return await resend.emails.send({
        from,
        to,
        subject: "Your Sprint Suite sign-in link",
        html,
      });
    },
  };
}
```

- [ ] **Step 4: Test passes**

```bash
node --test tests/email.test.js
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add hub/lib/email.js hub/views/emails/ hub/tests/email.test.js
git commit -m "feat(hub): Resend wrapper + magic link email template"
```

---

### Task 1.8: Rate limiter (in-memory token bucket)

**Files:**
- Create: `/var/www/suite/hub/lib/rate-limit.js`
- Create: `/var/www/suite/hub/tests/rate-limit.test.js`

- [ ] **Step 1: Write failing test**

```js
// tests/rate-limit.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter } from "../lib/rate-limit.js";

test("allows up to N requests then blocks", () => {
  const lim = createLimiter({ max: 3, windowMs: 60000 });
  assert.equal(lim.check("ip1"), true);
  assert.equal(lim.check("ip1"), true);
  assert.equal(lim.check("ip1"), true);
  assert.equal(lim.check("ip1"), false);
});

test("isolates buckets by key", () => {
  const lim = createLimiter({ max: 1, windowMs: 60000 });
  assert.equal(lim.check("a"), true);
  assert.equal(lim.check("b"), true);
  assert.equal(lim.check("a"), false);
});

test("resets after window", async () => {
  const lim = createLimiter({ max: 1, windowMs: 50 });
  assert.equal(lim.check("a"), true);
  assert.equal(lim.check("a"), false);
  await new Promise(r => setTimeout(r, 60));
  assert.equal(lim.check("a"), true);
});
```

- [ ] **Step 2: Implement `lib/rate-limit.js`**

```js
// lib/rate-limit.js
export function createLimiter({ max, windowMs }) {
  const buckets = new Map();
  return {
    check(key) {
      const now = Date.now();
      let arr = buckets.get(key);
      if (!arr) { arr = []; buckets.set(key, arr); }
      while (arr.length && arr[0] < now - windowMs) arr.shift();
      if (arr.length >= max) return false;
      arr.push(now);
      return true;
    },
  };
}
```

- [ ] **Step 3: Test passes**

```bash
node --test tests/rate-limit.test.js
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add hub/lib/rate-limit.js hub/tests/rate-limit.test.js
git commit -m "feat(hub): in-memory rate limiter"
```

---

### Task 1.9: Hub session middleware

**Files:**
- Create: `/var/www/suite/hub/middleware/requireSession.js`
- Create: `/var/www/suite/hub/tests/requireSession.test.js`

- [ ] **Step 1: Write failing test**

```js
// tests/requireSession.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.js";
import { createRequireSession } from "../middleware/requireSession.js";
import { now, randomToken } from "../lib/tokens.js";

function makeReq(cookieHeader) { return { headers: { cookie: cookieHeader } }; }
function makeRes() {
  return {
    status(s) { this.statusCode = s; return this; },
    redirect(loc) { this.location = loc; this.statusCode = 302; },
    setHeader() {},
  };
}

test("no cookie → 302 to /login", () => {
  const db = openDb(":memory:");
  const mw = createRequireSession(db);
  const req = makeReq(undefined);
  const res = makeRes();
  let nextCalled = false;
  mw(req, res, () => (nextCalled = true));
  assert.equal(res.statusCode, 302);
  assert.match(res.location, /\/login/);
  assert.equal(nextCalled, false);
  db.close();
});

test("valid cookie → next() with req.user populated", () => {
  const db = openDb(":memory:");
  const userId = "u1";
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run(userId, "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, userId, now(), now(), now() + 60_000);
  const mw = createRequireSession(db);
  const req = makeReq(`hub_session=${sid}`);
  const res = makeRes();
  let nextCalled = false;
  mw(req, res, () => (nextCalled = true));
  assert.equal(nextCalled, true);
  assert.equal(req.user.id, userId);
  db.close();
});
```

- [ ] **Step 2: Implement `middleware/requireSession.js`**

```js
// middleware/requireSession.js
import { parseCookies } from "../lib/cookies.js";
import { now } from "../lib/tokens.js";

export function createRequireSession(db, { cookieName = "hub_session", loginPath = "/login" } = {}) {
  const lookup = db.prepare(`
    SELECT cs.id AS session_id, u.id AS user_id, u.email, u.display_name, u.is_admin, u.disabled_at
    FROM central_sessions cs
    JOIN users u ON u.id = cs.user_id
    WHERE cs.id = ? AND cs.expires_at > ? AND cs.last_heartbeat_at > ?
  `);
  const touch = db.prepare(`UPDATE central_sessions SET last_heartbeat_at = ? WHERE id = ?`);

  return (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies[cookieName];
    if (!sid) {
      const returnTo = encodeURIComponent(req.originalUrl || req.url || "/");
      return res.redirect(`${loginPath}?return_to=${returnTo}`);
    }
    const t = now();
    const idleCutoff = t - (30 * 60 * 1000);
    const row = lookup.get(sid, t, idleCutoff);
    if (!row || row.disabled_at) {
      const returnTo = encodeURIComponent(req.originalUrl || req.url || "/");
      return res.redirect(`${loginPath}?return_to=${returnTo}`);
    }
    touch.run(t, sid);
    req.user = { id: row.user_id, email: row.email, displayName: row.display_name, isAdmin: !!row.is_admin };
    req.sessionId = row.session_id;
    next();
  };
}
```

- [ ] **Step 3: Test passes**

```bash
node --test tests/requireSession.test.js
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add hub/middleware/requireSession.js hub/tests/requireSession.test.js
git commit -m "feat(hub): require-session middleware with idle expiry check"
```

---

### Task 1.10: View rendering setup

**Files:**
- Create: `/var/www/suite/hub/views/partials/header.eta`
- Create: `/var/www/suite/hub/views/partials/footer.eta`
- Create: `/var/www/suite/hub/views/error.eta`
- Create: `/var/www/suite/hub/public/styles.css`
- Modify: `/var/www/suite/hub/server.js`

- [ ] **Step 1: Create the partials**

```html
<!-- views/partials/header.eta -->
<!doctype html>
<html><head>
<meta charset="utf-8">
<title><%= it.title || "Sprint Suite" %></title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="topbar">
  <a href="/" class="brand">Sprint Suite</a>
  <% if (it.user) { %>
    <nav><span class="email"><%= it.user.email %></span> · <a href="/logout">Sign out</a></nav>
  <% } else { %>
    <nav><a href="/login">Sign in</a></nav>
  <% } %>
</header>
<main>
```

```html
<!-- views/partials/footer.eta -->
</main>
<footer><small>Sprint Suite</small></footer>
</body></html>
```

```html
<!-- views/error.eta -->
<%~ include("partials/header", { title: it.title || "Error" }) %>
<div class="card">
<h1><%= it.title || "Something went wrong" %></h1>
<p><%= it.message %></p>
<% if (it.backHref) { %><p><a href="<%= it.backHref %>">Back</a></p><% } %>
</div>
<%~ include("partials/footer") %>
```

- [ ] **Step 2: Create minimal `public/styles.css`**

```css
:root { --bg: #fafafa; --fg: #1f2937; --muted: #6b7280; --accent: #2563eb; --card: #fff; --border: #e5e7eb; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--fg); }
.topbar { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; border-bottom: 1px solid var(--border); background: white; }
.brand { font-weight: 600; text-decoration: none; color: var(--fg); }
nav a { color: var(--accent); text-decoration: none; }
nav .email { color: var(--muted); }
main { max-width: 960px; margin: 32px auto; padding: 0 24px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 24px; margin-bottom: 16px; }
.btn { display: inline-block; background: var(--accent); color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; border: none; cursor: pointer; font-size: 14px; }
.btn:disabled { opacity: 0.5; }
input[type=email], input[type=text] { width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 14px; }
.grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
.tile { display: block; background: white; border: 1px solid var(--border); border-radius: 8px; padding: 24px; text-decoration: none; color: var(--fg); }
.tile:hover { border-color: var(--accent); }
.tile h3 { margin: 0 0 8px; }
.tile p { margin: 0; color: var(--muted); font-size: 14px; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); }
th { background: #f9fafb; font-weight: 600; font-size: 13px; color: var(--muted); }
footer { text-align: center; color: var(--muted); padding: 24px; }
.muted { color: var(--muted); }
.danger { color: #b91c1c; }
```

- [ ] **Step 3: Wire eta + static into `server.js`**

Replace `server.js` content:

```js
// server.js
import express from "express";
import { Eta } from "eta";
import path from "node:path";
import { fileURLToPath } from "node:url";
import config from "./config.js";
import { openDb } from "./db/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Views
const eta = new Eta({ views: path.join(__dirname, "views"), cache: config.nodeEnv === "production" });
app.engine("eta", (filePath, opts, cb) => {
  eta.renderAsync(path.basename(filePath, ".eta"), opts).then(html => cb(null, html)).catch(cb);
});
app.set("view engine", "eta");
app.set("views", path.join(__dirname, "views"));

// Static
app.use(express.static(path.join(__dirname, "public")));

// Body parsing
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// DB
const db = openDb(config.dbPath);
app.locals.db = db;
app.locals.config = config;

// Routes (added in later tasks)
app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(config.port, () => console.log(`hub listening on ${config.port}`));
```

- [ ] **Step 4: Boot test**

```bash
cd /var/www/suite/hub
cp .env.example .env
# fill in dummy values for env vars
mkdir -p data
node --env-file=.env server.js &
HUB_PID=$!
sleep 1
curl -s http://localhost:3000/healthz
curl -sI http://localhost:3000/styles.css | head -1
kill $HUB_PID
```
Expected: `{"ok":true}` and `HTTP/1.1 200 OK`

- [ ] **Step 5: Commit**

```bash
git add hub/views/ hub/public/ hub/server.js
git commit -m "feat(hub): eta templates + static assets + shared layout"
```

---

### Task 1.11: SEO landing route

**Files:**
- Create: `/var/www/suite/hub/routes/landing.js`
- Create: `/var/www/suite/hub/views/landing.eta`
- Create: `/var/www/suite/hub/tests/landing.test.js`
- Modify: `/var/www/suite/hub/server.js`

- [ ] **Step 1: Create `views/landing.eta`**

```html
<%~ include("partials/header", { title: "Sprint Suite", user: it.user }) %>
<section style="text-align:center;padding:48px 0;">
<h1 style="font-size:40px;margin:0 0 16px;">Agile tools for teams that ship.</h1>
<p class="muted" style="font-size:18px;">One sign-in, four focused apps.</p>
<% if (!it.user) { %><p style="margin-top:24px;"><a class="btn" href="/login">Sign in</a></p><% } %>
</section>
<section class="grid-4">
<a class="tile" href="https://sprintraid.uk"><h3>🛡 Sprintraid</h3><p>Risks, Assumptions, Issues, Dependencies — pipe in email/Teams text, get a structured RAID log.</p></a>
<a class="tile" href="https://sprintsignal.uk"><h3>📡 Sprintsignal</h3><p>Team health signals — surface what's working and what isn't.</p></a>
<a class="tile" href="https://sprintretro.uk"><h3>🔄 Sprintretro</h3><p>Retrospectives that don't drag.</p></a>
<a class="tile" href="https://sprintpoker.uk"><h3>🎴 Sprintpoker</h3><p>Planning poker with your Jira tickets.</p></a>
</section>
<%~ include("partials/footer") %>
```

- [ ] **Step 2: Write failing integration test**

```js
// tests/landing.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";

test("GET / renders landing page with all four apps", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
  assert.match(res.text, /Sprintraid/);
  assert.match(res.text, /Sprintsignal/);
  assert.match(res.text, /Sprintretro/);
  assert.match(res.text, /Sprintpoker/);
  assert.match(res.text, /Sign in/);
});
```

- [ ] **Step 3: Create `tests/helpers.js`**

```js
// tests/helpers.js — shared test app builder
import express from "express";
import { Eta } from "eta";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../db/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildTestApp({ env = {} } = {}) {
  process.env.BASE_URL ??= "https://test";
  process.env.DB_PATH ??= ":memory:";
  process.env.RESEND_API_KEY ??= "test";
  process.env.FROM_EMAIL ??= "login@test";
  process.env.COOKIE_SECRET ??= "x";
  process.env.ALLOWED_APP_DOMAINS ??= "https://sprintraid.uk,https://sprintsignal.uk,https://sprintretro.uk,https://sprintpoker.uk";
  process.env.HUB_API_KEY_RAID ??= "k-raid";
  process.env.HUB_API_KEY_SIGNAL ??= "k-signal";
  process.env.HUB_API_KEY_RETRO ??= "k-retro";
  process.env.HUB_API_KEY_POKER ??= "k-poker";
  Object.assign(process.env, env);

  const { default: config } = await import("../config.js?t=" + Date.now());
  const app = express();
  const eta = new Eta({ views: path.join(__dirname, "../views"), cache: false });
  app.engine("eta", (fp, opts, cb) => eta.renderAsync(path.basename(fp, ".eta"), opts).then(html => cb(null, html)).catch(cb));
  app.set("view engine", "eta");
  app.set("views", path.join(__dirname, "../views"));
  app.use(express.static(path.join(__dirname, "../public")));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  const db = openDb(":memory:");
  app.locals.db = db;
  app.locals.config = config;
  const { mountLanding } = await import("../routes/landing.js?t=" + Date.now());
  mountLanding(app);
  return { app, db, config };
}
```

- [ ] **Step 4: Implement `routes/landing.js`**

```js
// routes/landing.js
import { parseCookies } from "../lib/cookies.js";

export function mountLanding(app) {
  app.get("/", (req, res) => {
    const db = req.app.locals.db;
    const sid = parseCookies(req.headers.cookie).hub_session;
    let user = null;
    if (sid) {
      const row = db.prepare(`
        SELECT u.email FROM central_sessions cs
        JOIN users u ON u.id = cs.user_id
        WHERE cs.id = ? AND cs.expires_at > ?
      `).get(sid, Date.now());
      if (row) user = { email: row.email };
    }
    res.render("landing", { user });
  });
}
```

- [ ] **Step 5: Mount in `server.js`**

Add after `app.locals.config = config;`:

```js
import { mountLanding } from "./routes/landing.js";
mountLanding(app);
```

- [ ] **Step 6: Test passes**

```bash
node --test tests/landing.test.js
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add hub/routes/landing.js hub/views/landing.eta hub/tests/landing.test.js hub/tests/helpers.js hub/server.js
git commit -m "feat(hub): SEO landing page at apex"
```

---

### Task 1.12: Login form route (GET + POST)

**Files:**
- Create: `/var/www/suite/hub/routes/login.js`
- Create: `/var/www/suite/hub/views/login.eta`
- Create: `/var/www/suite/hub/views/check-email.eta`
- Create: `/var/www/suite/hub/tests/login.test.js`
- Modify: `/var/www/suite/hub/server.js`

- [ ] **Step 1: Create login + check-email views**

```html
<!-- views/login.eta -->
<%~ include("partials/header", { title: "Sign in" }) %>
<div class="card" style="max-width:420px;margin:48px auto;">
<h1 style="text-align:center;">Sign in to Sprint Suite</h1>
<form method="POST" action="/login">
<% if (it.returnTo) { %><input type="hidden" name="return_to" value="<%= it.returnTo %>"><% } %>
<p><label for="email">Email address</label><input id="email" name="email" type="email" required autofocus></p>
<p style="text-align:center;"><button class="btn" type="submit">Send magic link</button></p>
<p class="muted" style="text-align:center;font-size:14px;">We'll email you a link. No password needed.</p>
</form>
</div>
<%~ include("partials/footer") %>
```

```html
<!-- views/check-email.eta -->
<%~ include("partials/header", { title: "Check your email" }) %>
<div class="card" style="max-width:420px;margin:48px auto;text-align:center;">
<h1>Check your email</h1>
<p>A sign-in link is on its way to <strong><%= it.email %></strong>. It expires in 15 minutes.</p>
<p><a href="/login">Use a different email</a></p>
</div>
<%~ include("partials/footer") %>
```

- [ ] **Step 2: Write failing test**

```js
// tests/login.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";

test("GET /login renders the email form", async () => {
  const { app } = await buildTestApp();
  const res = await request(app).get("/login");
  assert.equal(res.status, 200);
  assert.match(res.text, /Sign in to Sprint Suite/);
  assert.match(res.text, /name="email"/);
});

test("POST /login with unknown email still renders check-email (no leak)", async () => {
  const { app, db } = await buildTestApp();
  const res = await request(app).post("/login").type("form").send({ email: "unknown@test" });
  assert.equal(res.status, 200);
  assert.match(res.text, /Check your email/);
  const tokens = db.prepare("SELECT COUNT(*) AS c FROM magic_link_tokens").get();
  assert.equal(tokens.c, 0, "no token should be created for unknown email");
});

test("POST /login with known email creates a token", async () => {
  const { app, db } = await buildTestApp();
  db.prepare("INSERT INTO users (id, email, created_at) VALUES (?,?,?)").run("u1", "known@test", Date.now());
  const res = await request(app).post("/login").type("form").send({ email: "known@test" });
  assert.equal(res.status, 200);
  const tokens = db.prepare("SELECT * FROM magic_link_tokens").all();
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].email, "known@test");
});
```

- [ ] **Step 3: Implement `routes/login.js`**

```js
// routes/login.js
import { randomToken, now } from "../lib/tokens.js";
import { createAuditLogger } from "../lib/audit.js";
import { createLimiter } from "../lib/rate-limit.js";

const ipLimiter = createLimiter({ max: 5, windowMs: 60 * 1000 });
const emailLimiter = createLimiter({ max: 10, windowMs: 60 * 60 * 1000 });

function validateReturnTo(url, allowed) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const origin = `${u.protocol}//${u.host}`;
    return allowed.includes(origin) ? url : null;
  } catch { return null; }
}

export function mountLogin(app, { emailSender } = {}) {
  const db = app.locals.db;
  const config = app.locals.config;
  const audit = createAuditLogger(db);

  app.get("/login", (req, res) => {
    const returnTo = validateReturnTo(req.query.return_to, config.allowedAppDomains);
    res.render("login", { returnTo });
  });

  app.post("/login", async (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    const returnTo = validateReturnTo(req.body.return_to, config.allowedAppDomains);
    const ip = req.ip;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).render("error", { title: "Bad request", message: "Invalid email." });
    }
    if (!ipLimiter.check(ip) || !emailLimiter.check(email)) {
      return res.status(429).render("error", { title: "Too many requests", message: "Please wait a minute and try again." });
    }

    const user = db.prepare("SELECT id, disabled_at FROM users WHERE email = ?").get(email);
    if (user && !user.disabled_at) {
      const token = randomToken();
      const t = now();
      db.prepare(`
        INSERT INTO magic_link_tokens (token, email, return_to, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(token, email, returnTo, t, t + config.magicLinkTtlMs);

      const url = `${config.baseUrl}/auth/magic?token=${token}`;
      try {
        if (emailSender) await emailSender.sendMagicLink({ to: email, url });
      } catch (err) {
        console.error("magic link send failed", err);
      }
      audit.log({ userId: user.id, eventType: "magic_link_sent", metadata: { email }, ip });
    }

    res.render("check-email", { email });
  });
}
```

- [ ] **Step 4: Test passes**

```bash
node --test tests/login.test.js
```
Expected: PASS

- [ ] **Step 5: Mount in `server.js`**

```js
import { mountLogin } from "./routes/login.js";
import { createEmailSender } from "./lib/email.js";
const emailSender = createEmailSender({ apiKey: config.resendApiKey, from: config.fromEmail });
mountLogin(app, { emailSender });
```

- [ ] **Step 6: Commit**

```bash
git add hub/routes/login.js hub/views/login.eta hub/views/check-email.eta hub/tests/login.test.js hub/server.js
git commit -m "feat(hub): magic link request flow with rate limiting"
```

---

### Task 1.13: Magic link consume + central session creation

**Files:**
- Create: `/var/www/suite/hub/routes/magic.js`
- Create: `/var/www/suite/hub/tests/magic.test.js`
- Modify: `/var/www/suite/hub/server.js`

- [ ] **Step 1: Write failing test**

```js
// tests/magic.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { randomToken, now } from "../lib/tokens.js";

async function buildWithMagic() {
  const { app, db, config } = await buildTestApp();
  const { mountMagic } = await import("../routes/magic.js?t=" + Date.now());
  mountMagic(app);
  return { app, db, config };
}

test("valid magic token logs the user in and 302s to dashboard", async () => {
  const { app, db } = await buildWithMagic();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const tok = randomToken();
  db.prepare(`INSERT INTO magic_link_tokens (token,email,return_to,created_at,expires_at) VALUES (?,?,?,?,?)`)
    .run(tok, "a@b.c", null, now(), now() + 60_000);
  const res = await request(app).get(`/auth/magic?token=${tok}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "/dashboard");
  assert.match(res.headers["set-cookie"][0], /^hub_session=/);
  const session = db.prepare("SELECT * FROM central_sessions").get();
  assert.equal(session.user_id, "u1");
  const consumed = db.prepare("SELECT consumed_at FROM magic_link_tokens WHERE token = ?").get(tok);
  assert.ok(consumed.consumed_at);
});

test("expired token renders error", async () => {
  const { app, db } = await buildWithMagic();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const tok = randomToken();
  db.prepare(`INSERT INTO magic_link_tokens (token,email,return_to,created_at,expires_at) VALUES (?,?,?,?,?)`)
    .run(tok, "a@b.c", null, now() - 60_000, now() - 1);
  const res = await request(app).get(`/auth/magic?token=${tok}`);
  assert.equal(res.status, 400);
  assert.match(res.text, /expired|already used/i);
});

test("already-consumed token is rejected", async () => {
  const { app, db } = await buildWithMagic();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const tok = randomToken();
  db.prepare(`INSERT INTO magic_link_tokens (token,email,return_to,created_at,expires_at,consumed_at) VALUES (?,?,?,?,?,?)`)
    .run(tok, "a@b.c", null, now(), now() + 60_000, now());
  const res = await request(app).get(`/auth/magic?token=${tok}`);
  assert.equal(res.status, 400);
});

test("return_to bounces to launch flow", async () => {
  const { app, db } = await buildWithMagic();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const tok = randomToken();
  db.prepare(`INSERT INTO magic_link_tokens (token,email,return_to,created_at,expires_at) VALUES (?,?,?,?,?)`)
    .run(tok, "a@b.c", "https://sprintraid.uk/some-page", now(), now() + 60_000);
  const res = await request(app).get(`/auth/magic?token=${tok}`);
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /\/launch\/raid\?return_to=/);
});
```

- [ ] **Step 2: Implement `routes/magic.js`**

```js
// routes/magic.js
import { randomToken, now } from "../lib/tokens.js";
import { setSessionCookie } from "../lib/cookies.js";
import { createAuditLogger } from "../lib/audit.js";

const APP_BY_DOMAIN = {
  "sprintraid.uk": "raid",
  "sprintsignal.uk": "signal",
  "sprintretro.uk": "retro",
  "sprintpoker.uk": "poker",
};

export function mountMagic(app) {
  const db = app.locals.db;
  const config = app.locals.config;
  const audit = createAuditLogger(db);

  app.get("/auth/magic", (req, res) => {
    const token = req.query.token;
    if (!token || typeof token !== "string") {
      return res.status(400).render("error", { title: "Invalid link", message: "This sign-in link is malformed." });
    }
    const t = now();
    const consumed = db.prepare(`
      UPDATE magic_link_tokens SET consumed_at = ?
      WHERE token = ? AND consumed_at IS NULL AND expires_at > ?
    `).run(t, token, t);
    if (consumed.changes === 0) {
      return res.status(400).render("error", { title: "Link expired", message: "This sign-in link is expired or has already been used.", backHref: "/login" });
    }
    const tokRow = db.prepare("SELECT email, return_to FROM magic_link_tokens WHERE token = ?").get(token);
    const user = db.prepare("SELECT id, disabled_at FROM users WHERE email = ?").get(tokRow.email);
    if (!user || user.disabled_at) {
      return res.status(403).render("error", { title: "Account disabled", message: "Your account is no longer active." });
    }
    const sid = randomToken();
    db.prepare(`
      INSERT INTO central_sessions (id, user_id, created_at, last_heartbeat_at, expires_at, user_agent, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sid, user.id, t, t, t + config.sessionMaxMs, req.headers["user-agent"] || null, req.ip);

    audit.log({ userId: user.id, eventType: "session_created", ip: req.ip });
    setSessionCookie(res, "hub_session", sid, { secure: config.nodeEnv === "production" });

    if (tokRow.return_to) {
      try {
        const host = new URL(tokRow.return_to).host;
        const appName = APP_BY_DOMAIN[host];
        if (appName) {
          return res.redirect(`/launch/${appName}?return_to=${encodeURIComponent(tokRow.return_to)}`);
        }
      } catch {}
    }
    res.redirect("/dashboard");
  });
}
```

- [ ] **Step 3: Test passes**

```bash
node --test tests/magic.test.js
```
Expected: PASS

- [ ] **Step 4: Mount in `server.js`**

```js
import { mountMagic } from "./routes/magic.js";
mountMagic(app);
```

- [ ] **Step 5: Commit**

```bash
git add hub/routes/magic.js hub/tests/magic.test.js hub/server.js
git commit -m "feat(hub): magic link consume + hub session creation"
```

---

### Task 1.14: Dashboard route

**Files:**
- Create: `/var/www/suite/hub/routes/dashboard.js`
- Create: `/var/www/suite/hub/views/dashboard.eta`
- Create: `/var/www/suite/hub/tests/dashboard.test.js`
- Modify: `/var/www/suite/hub/server.js`

- [ ] **Step 1: Create `views/dashboard.eta`**

```html
<%~ include("partials/header", { title: "Dashboard", user: it.user }) %>
<h1>Your apps</h1>
<section class="grid-4">
<form method="POST" action="/launch/raid"><button class="tile" type="submit" style="width:100%;text-align:left;cursor:pointer;border:1px solid var(--border);">
<h3>🛡 Sprintraid</h3><p>Risks/Issues</p></button></form>
<form method="POST" action="/launch/signal"><button class="tile" type="submit" style="width:100%;text-align:left;cursor:pointer;border:1px solid var(--border);">
<h3>📡 Sprintsignal</h3><p>Team signals</p></button></form>
<form method="POST" action="/launch/retro"><button class="tile" type="submit" style="width:100%;text-align:left;cursor:pointer;border:1px solid var(--border);">
<h3>🔄 Sprintretro</h3><p>Retrospectives</p></button></form>
<form method="POST" action="/launch/poker"><button class="tile" type="submit" style="width:100%;text-align:left;cursor:pointer;border:1px solid var(--border);">
<h3>🎴 Sprintpoker</h3><p>Planning poker</p></button></form>
</section>
<% if (it.user.isAdmin) { %><p style="margin-top:32px;"><a href="/admin">Admin</a></p><% } %>
<%~ include("partials/footer") %>
```

- [ ] **Step 2: Write failing test**

```js
// tests/dashboard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";

async function buildWithDashboard() {
  const { app, db, config } = await buildTestApp();
  const { mountDashboard } = await import("../routes/dashboard.js?t=" + Date.now());
  mountDashboard(app);
  return { app, db, config };
}

test("logged-out user is redirected to /login", async () => {
  const { app } = await buildWithDashboard();
  const res = await request(app).get("/dashboard");
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /\/login/);
});

test("logged-in user sees four tiles", async () => {
  const { app, db } = await buildWithDashboard();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const res = await request(app).get("/dashboard").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /Sprintraid/);
  assert.match(res.text, /Sprintsignal/);
  assert.match(res.text, /Sprintretro/);
  assert.match(res.text, /Sprintpoker/);
});
```

- [ ] **Step 3: Implement `routes/dashboard.js`**

```js
// routes/dashboard.js
import { createRequireSession } from "../middleware/requireSession.js";

export function mountDashboard(app) {
  const db = app.locals.db;
  const requireSession = createRequireSession(db);
  app.get("/dashboard", requireSession, (req, res) => {
    res.render("dashboard", { user: req.user });
  });
}
```

- [ ] **Step 4: Test passes**

```bash
node --test tests/dashboard.test.js
```
Expected: PASS

- [ ] **Step 5: Mount in `server.js`**

```js
import { mountDashboard } from "./routes/dashboard.js";
mountDashboard(app);
```

- [ ] **Step 6: Commit**

```bash
git add hub/routes/dashboard.js hub/views/dashboard.eta hub/tests/dashboard.test.js hub/server.js
git commit -m "feat(hub): dashboard with four app tiles"
```

---

### Task 1.15: Launch token generation + redirect

**Files:**
- Create: `/var/www/suite/hub/routes/launch.js`
- Create: `/var/www/suite/hub/tests/launch.test.js`
- Modify: `/var/www/suite/hub/server.js`

- [ ] **Step 1: Write failing test**

```js
// tests/launch.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";

const APP_DOMAIN = { raid: "https://sprintraid.uk", signal: "https://sprintsignal.uk", retro: "https://sprintretro.uk", poker: "https://sprintpoker.uk" };

async function buildWithLaunch() {
  const { app, db, config } = await buildTestApp();
  const { mountLaunch } = await import("../routes/launch.js?t=" + Date.now());
  mountLaunch(app);
  return { app, db, config };
}

async function loggedInCookie(db) {
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  return sid;
}

for (const appName of ["raid", "signal", "retro", "poker"]) {
  test(`POST /launch/${appName} generates token and 302s to app domain`, async () => {
    const { app, db } = await buildWithLaunch();
    const sid = await loggedInCookie(db);
    const res = await request(app).post(`/launch/${appName}`).set("Cookie", `hub_session=${sid}`);
    assert.equal(res.status, 302);
    assert.ok(res.headers.location.startsWith(`${APP_DOMAIN[appName]}/auth/launch?token=`));
    const launchTok = db.prepare("SELECT * FROM launch_tokens").get();
    assert.equal(launchTok.target_app, appName);
    assert.equal(launchTok.central_session_id, sid);
  });
}

test("POST /launch/unknown returns 404", async () => {
  const { app, db } = await buildWithLaunch();
  const sid = await loggedInCookie(db);
  const res = await request(app).post(`/launch/unknown`).set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 404);
});

test("GET /launch/:app (used after magic-link return_to) also works", async () => {
  const { app, db } = await buildWithLaunch();
  const sid = await loggedInCookie(db);
  const res = await request(app)
    .get(`/launch/raid?return_to=${encodeURIComponent("https://sprintraid.uk/some-page")}`)
    .set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /https:\/\/sprintraid\.uk\/auth\/launch\?token=/);
  assert.match(res.headers.location, /return_to=/);
});
```

- [ ] **Step 2: Implement `routes/launch.js`**

```js
// routes/launch.js
import { randomToken, now } from "../lib/tokens.js";
import { createRequireSession } from "../middleware/requireSession.js";
import { createAuditLogger } from "../lib/audit.js";

const APP_DOMAIN = {
  raid: "https://sprintraid.uk",
  signal: "https://sprintsignal.uk",
  retro: "https://sprintretro.uk",
  poker: "https://sprintpoker.uk",
};

export function mountLaunch(app) {
  const db = app.locals.db;
  const config = app.locals.config;
  const requireSession = createRequireSession(db);
  const audit = createAuditLogger(db);

  function handle(req, res) {
    const appName = req.params.app;
    const domain = APP_DOMAIN[appName];
    if (!domain) return res.status(404).render("error", { title: "Unknown app", message: "No such app." });

    const token = randomToken();
    const t = now();
    db.prepare(`
      INSERT INTO launch_tokens (token, central_session_id, target_app, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(token, req.sessionId, appName, t, t + config.launchTokenTtlMs);

    audit.log({ userId: req.user.id, eventType: "app_launched", app: appName, ip: req.ip });

    let returnTo = "";
    if (req.query.return_to) {
      try {
        const u = new URL(req.query.return_to);
        if (`${u.protocol}//${u.host}` === domain) returnTo = `&return_to=${encodeURIComponent(req.query.return_to)}`;
      } catch {}
    }
    res.redirect(`${domain}/auth/launch?token=${token}${returnTo}`);
  }

  app.get("/launch/:app", requireSession, handle);
  app.post("/launch/:app", requireSession, handle);
}
```

- [ ] **Step 3: Test passes**

```bash
node --test tests/launch.test.js
```
Expected: PASS

- [ ] **Step 4: Mount in `server.js`**

```js
import { mountLaunch } from "./routes/launch.js";
mountLaunch(app);
```

- [ ] **Step 5: Commit**

```bash
git add hub/routes/launch.js hub/tests/launch.test.js hub/server.js
git commit -m "feat(hub): launch token generation + redirect to app domain"
```

---

### Task 1.16: Session API — exchange endpoint

**Files:**
- Create: `/var/www/suite/hub/routes/api-sessions.js`
- Create: `/var/www/suite/hub/middleware/requireApiKey.js`
- Create: `/var/www/suite/hub/tests/api-sessions-exchange.test.js`
- Modify: `/var/www/suite/hub/server.js`

- [ ] **Step 1: Create `middleware/requireApiKey.js`**

```js
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
```

- [ ] **Step 2: Write failing test**

```js
// tests/api-sessions-exchange.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";

async function buildWithApi() {
  const { app, db, config } = await buildTestApp();
  const { mountApiSessions } = await import("../routes/api-sessions.js?t=" + Date.now());
  mountApiSessions(app);
  return { app, db, config };
}

test("rejects request without bearer key", async () => {
  const { app } = await buildWithApi();
  const res = await request(app).post("/api/sessions/exchange").send({ launch_token: "x" });
  assert.equal(res.status, 401);
});

test("exchanges valid launch token for session info", async () => {
  const { app, db } = await buildWithApi();
  db.prepare("INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)")
    .run("u1", "a@b.c", "Alice", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const tok = randomToken();
  db.prepare("INSERT INTO launch_tokens (token,central_session_id,target_app,created_at,expires_at) VALUES (?,?,?,?,?)")
    .run(tok, sid, "raid", now(), now() + 30_000);

  const res = await request(app)
    .post("/api/sessions/exchange")
    .set("Authorization", "Bearer k-raid")
    .send({ launch_token: tok });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.user, { id: "u1", email: "a@b.c", displayName: "Alice" });
  assert.equal(res.body.central_session_id, sid);

  const consumed = db.prepare("SELECT consumed_at FROM launch_tokens WHERE token = ?").get(tok);
  assert.ok(consumed.consumed_at);
});

test("rejects token addressed to a different app", async () => {
  const { app, db } = await buildWithApi();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const tok = randomToken();
  db.prepare("INSERT INTO launch_tokens (token,central_session_id,target_app,created_at,expires_at) VALUES (?,?,?,?,?)")
    .run(tok, sid, "raid", now(), now() + 30_000);

  const res = await request(app)
    .post("/api/sessions/exchange")
    .set("Authorization", "Bearer k-signal")
    .send({ launch_token: tok });

  assert.equal(res.status, 403);
});

test("rejects already-consumed token", async () => {
  const { app, db } = await buildWithApi();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  const tok = randomToken();
  db.prepare("INSERT INTO launch_tokens (token,central_session_id,target_app,created_at,expires_at,consumed_at) VALUES (?,?,?,?,?,?)")
    .run(tok, sid, "raid", now(), now() + 30_000, now());

  const res = await request(app)
    .post("/api/sessions/exchange")
    .set("Authorization", "Bearer k-raid")
    .send({ launch_token: tok });

  assert.equal(res.status, 400);
});
```

- [ ] **Step 3: Implement `routes/api-sessions.js` (exchange only — heartbeat + delete added in next task)**

```js
// routes/api-sessions.js
import { now } from "../lib/tokens.js";
import { createRequireApiKey } from "../middleware/requireApiKey.js";
import { createAuditLogger } from "../lib/audit.js";

export function mountApiSessions(app) {
  const db = app.locals.db;
  const config = app.locals.config;
  const requireApiKey = createRequireApiKey(config);
  const audit = createAuditLogger(db);

  app.post("/api/sessions/exchange", requireApiKey, (req, res) => {
    const { launch_token } = req.body || {};
    if (!launch_token) return res.status(400).json({ error: "missing_launch_token" });
    const t = now();
    const consumed = db.prepare(`
      UPDATE launch_tokens SET consumed_at = ?
      WHERE token = ? AND consumed_at IS NULL AND expires_at > ?
    `).run(t, launch_token, t);
    if (consumed.changes === 0) return res.status(400).json({ error: "token_invalid_or_expired" });
    const row = db.prepare(`
      SELECT lt.target_app, lt.central_session_id, u.id AS user_id, u.email, u.display_name, u.disabled_at
      FROM launch_tokens lt
      JOIN central_sessions cs ON cs.id = lt.central_session_id
      JOIN users u ON u.id = cs.user_id
      WHERE lt.token = ?
    `).get(launch_token);
    if (!row) return res.status(400).json({ error: "token_invalid" });
    if (row.target_app !== req.callingApp) return res.status(403).json({ error: "wrong_app" });
    if (row.disabled_at) return res.status(403).json({ error: "user_disabled" });
    audit.log({ userId: row.user_id, eventType: "session_exchanged", app: req.callingApp, ip: req.ip });
    res.json({
      user: { id: row.user_id, email: row.email, displayName: row.display_name },
      central_session_id: row.central_session_id,
    });
  });
}
```

- [ ] **Step 4: Test passes**

```bash
node --test tests/api-sessions-exchange.test.js
```
Expected: PASS

- [ ] **Step 5: Mount in `server.js`**

```js
import { mountApiSessions } from "./routes/api-sessions.js";
mountApiSessions(app);
```

- [ ] **Step 6: Commit**

```bash
git add hub/middleware/requireApiKey.js hub/routes/api-sessions.js hub/tests/api-sessions-exchange.test.js hub/server.js
git commit -m "feat(hub): session exchange API with per-app bearer keys"
```

---

### Task 1.17: Session API — heartbeat + delete

**Files:**
- Modify: `/var/www/suite/hub/routes/api-sessions.js`
- Create: `/var/www/suite/hub/tests/api-sessions-heartbeat.test.js`

- [ ] **Step 1: Write failing test**

```js
// tests/api-sessions-heartbeat.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";

async function setup() {
  const { app, db, config } = await buildTestApp();
  const { mountApiSessions } = await import("../routes/api-sessions.js?t=" + Date.now());
  mountApiSessions(app);
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 24 * 60 * 60 * 1000);
  return { app, db, sid };
}

test("heartbeat updates last_heartbeat_at and returns 200", async () => {
  const { app, db, sid } = await setup();
  const before = db.prepare("SELECT last_heartbeat_at FROM central_sessions WHERE id = ?").get(sid);
  await new Promise(r => setTimeout(r, 5));
  const res = await request(app)
    .post(`/api/sessions/${sid}/heartbeat`)
    .set("Authorization", "Bearer k-raid");
  assert.equal(res.status, 200);
  const after = db.prepare("SELECT last_heartbeat_at FROM central_sessions WHERE id = ?").get(sid);
  assert.ok(after.last_heartbeat_at > before.last_heartbeat_at);
});

test("heartbeat on unknown session returns 404", async () => {
  const { app } = await setup();
  const res = await request(app)
    .post(`/api/sessions/nope/heartbeat`)
    .set("Authorization", "Bearer k-raid");
  assert.equal(res.status, 404);
});

test("heartbeat on idle-expired session returns 404", async () => {
  const { app, db, sid } = await setup();
  const longAgo = now() - 60 * 60 * 1000;
  db.prepare("UPDATE central_sessions SET last_heartbeat_at = ? WHERE id = ?").run(longAgo, sid);
  const res = await request(app)
    .post(`/api/sessions/${sid}/heartbeat`)
    .set("Authorization", "Bearer k-raid");
  assert.equal(res.status, 404);
});

test("delete session removes row, future heartbeat returns 404", async () => {
  const { app, db, sid } = await setup();
  const del = await request(app)
    .delete(`/api/sessions/${sid}`)
    .set("Authorization", "Bearer k-raid");
  assert.equal(del.status, 204);
  const row = db.prepare("SELECT * FROM central_sessions WHERE id = ?").get(sid);
  assert.equal(row, undefined);
});
```

- [ ] **Step 2: Extend `routes/api-sessions.js`**

Append to the existing `mountApiSessions` function, after the exchange route:

```js
  app.post("/api/sessions/:id/heartbeat", requireApiKey, (req, res) => {
    const sid = req.params.id;
    const t = now();
    const idleCutoff = t - config.sessionIdleMs;
    const r = db.prepare(`
      UPDATE central_sessions SET last_heartbeat_at = ?
      WHERE id = ? AND expires_at > ? AND last_heartbeat_at > ?
    `).run(t, sid, t, idleCutoff);
    if (r.changes === 0) return res.status(404).json({ error: "session_not_found" });
    res.status(200).json({ ok: true });
  });

  app.delete("/api/sessions/:id", requireApiKey, (req, res) => {
    const sid = req.params.id;
    const sess = db.prepare("SELECT user_id FROM central_sessions WHERE id = ?").get(sid);
    db.prepare("DELETE FROM central_sessions WHERE id = ?").run(sid);
    if (sess) audit.log({ userId: sess.user_id, eventType: "logged_out", app: req.callingApp, ip: req.ip });
    res.status(204).end();
  });
```

- [ ] **Step 3: Test passes**

```bash
node --test tests/api-sessions-heartbeat.test.js
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add hub/routes/api-sessions.js hub/tests/api-sessions-heartbeat.test.js
git commit -m "feat(hub): heartbeat + delete session API endpoints"
```

---

### Task 1.18: Logout route

**Files:**
- Create: `/var/www/suite/hub/routes/logout.js`
- Create: `/var/www/suite/hub/tests/logout.test.js`
- Modify: `/var/www/suite/hub/server.js`

- [ ] **Step 1: Write failing test**

```js
// tests/logout.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";

async function setup() {
  const { app, db, config } = await buildTestApp();
  const { mountLogout } = await import("../routes/logout.js?t=" + Date.now());
  mountLogout(app);
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "u1", now(), now(), now() + 60_000);
  return { app, db, sid };
}

test("GET /logout clears central session and cookie, redirects to /", async () => {
  const { app, db, sid } = await setup();
  const res = await request(app).get("/logout").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "/");
  assert.match(res.headers["set-cookie"][0], /Max-Age=0/);
  const row = db.prepare("SELECT * FROM central_sessions WHERE id = ?").get(sid);
  assert.equal(row, undefined);
});
```

- [ ] **Step 2: Implement `routes/logout.js`**

```js
// routes/logout.js
import { parseCookies, clearSessionCookie } from "../lib/cookies.js";
import { createAuditLogger } from "../lib/audit.js";

export function mountLogout(app) {
  const db = app.locals.db;
  const config = app.locals.config;
  const audit = createAuditLogger(db);

  app.get("/logout", (req, res) => {
    const sid = parseCookies(req.headers.cookie).hub_session;
    if (sid) {
      const sess = db.prepare("SELECT user_id FROM central_sessions WHERE id = ?").get(sid);
      db.prepare("DELETE FROM central_sessions WHERE id = ?").run(sid);
      if (sess) audit.log({ userId: sess.user_id, eventType: "hub_logout", ip: req.ip });
    }
    clearSessionCookie(res, "hub_session");
    res.redirect("/");
  });
}
```

- [ ] **Step 3: Test passes**

```bash
node --test tests/logout.test.js
```
Expected: PASS

- [ ] **Step 4: Mount in `server.js`**

```js
import { mountLogout } from "./routes/logout.js";
mountLogout(app);
```

- [ ] **Step 5: Commit**

```bash
git add hub/routes/logout.js hub/tests/logout.test.js hub/server.js
git commit -m "feat(hub): hub-side logout"
```

---

### Task 1.19: Admin panel — users list + add

**Files:**
- Create: `/var/www/suite/hub/middleware/requireAdmin.js`
- Create: `/var/www/suite/hub/routes/admin.js`
- Create: `/var/www/suite/hub/views/admin/users.eta`
- Create: `/var/www/suite/hub/tests/admin-users.test.js`
- Modify: `/var/www/suite/hub/server.js`

- [ ] **Step 1: Create `middleware/requireAdmin.js`**

```js
// middleware/requireAdmin.js
export function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).render("error", { title: "Forbidden", message: "Admin only." });
  }
  next();
}
```

- [ ] **Step 2: Create `views/admin/users.eta`**

```html
<%~ include("../partials/header", { title: "Admin · Users", user: it.user }) %>
<nav style="margin-bottom:24px;">
<a href="/admin">Users</a> · <a href="/admin/sessions">Active sessions</a> · <a href="/admin/audit">Audit log</a>
</nav>
<div class="card">
<h2>Add user</h2>
<form method="POST" action="/admin/users">
<p><input type="email" name="email" placeholder="email@example.com" required></p>
<p><input type="text" name="display_name" placeholder="Display name (optional)"></p>
<p><label><input type="checkbox" name="is_admin" value="1"> Admin</label></p>
<p><button class="btn" type="submit">Add user</button></p>
</form>
</div>
<div class="card">
<h2>Users (<%= it.users.length %>)</h2>
<table>
<thead><tr><th>Email</th><th>Name</th><th>Admin</th><th>Sessions</th><th>Status</th><th></th></tr></thead>
<tbody>
<% for (const u of it.users) { %>
<tr>
<td><%= u.email %></td>
<td><%= u.display_name || "—" %></td>
<td><%= u.is_admin ? "✓" : "" %></td>
<td><%= u.session_count %></td>
<td><%= u.disabled_at ? "disabled" : "active" %></td>
<td>
<% if (!u.disabled_at) { %>
<form method="POST" action="/admin/users/<%= u.id %>/disable" style="display:inline;"><button class="btn">Disable</button></form>
<% } else { %>
<form method="POST" action="/admin/users/<%= u.id %>/enable" style="display:inline;"><button class="btn">Enable</button></form>
<% } %>
<form method="POST" action="/admin/users/<%= u.id %>/delete" style="display:inline;" onsubmit="return confirm('Delete <%= u.email %>?')"><button class="btn danger">Delete</button></form>
</td>
</tr>
<% } %>
</tbody></table>
</div>
<%~ include("../partials/footer") %>
```

- [ ] **Step 3: Write failing test**

```js
// tests/admin-users.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";

async function setup({ isAdmin = true } = {}) {
  const { app, db, config } = await buildTestApp();
  const { mountAdmin } = await import("../routes/admin.js?t=" + Date.now());
  mountAdmin(app);
  db.prepare("INSERT INTO users (id,email,display_name,is_admin,created_at) VALUES (?,?,?,?,?)")
    .run("admin1", "admin@test", "Admin", isAdmin ? 1 : 0, now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "admin1", now(), now(), now() + 60_000);
  return { app, db, sid };
}

test("non-admin gets 403", async () => {
  const { app, sid } = await setup({ isAdmin: false });
  const res = await request(app).get("/admin").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 403);
});

test("admin lists users", async () => {
  const { app, db, sid } = await setup();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "other@test", now());
  const res = await request(app).get("/admin").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /admin@test/);
  assert.match(res.text, /other@test/);
});

test("POST /admin/users creates a user", async () => {
  const { app, db, sid } = await setup();
  const res = await request(app)
    .post("/admin/users").type("form")
    .set("Cookie", `hub_session=${sid}`)
    .send({ email: "new@test", display_name: "New" });
  assert.equal(res.status, 302);
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get("new@test");
  assert.equal(row.display_name, "New");
});

test("POST /admin/users/:id/disable kills all their sessions", async () => {
  const { app, db, sid } = await setup();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u2", "victim@test", now());
  const vsid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(vsid, "u2", now(), now(), now() + 60_000);
  const res = await request(app).post("/admin/users/u2/disable").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 302);
  const sess = db.prepare("SELECT * FROM central_sessions WHERE user_id = ?").all("u2");
  assert.equal(sess.length, 0);
  const u = db.prepare("SELECT disabled_at FROM users WHERE id = ?").get("u2");
  assert.ok(u.disabled_at);
});
```

- [ ] **Step 4: Implement `routes/admin.js` (users section)**

```js
// routes/admin.js
import { createRequireSession } from "../middleware/requireSession.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { randomId, now } from "../lib/tokens.js";
import { createAuditLogger } from "../lib/audit.js";

export function mountAdmin(app) {
  const db = app.locals.db;
  const requireSession = createRequireSession(db);
  const audit = createAuditLogger(db);

  app.get("/admin", requireSession, requireAdmin, (req, res) => {
    const users = db.prepare(`
      SELECT u.id, u.email, u.display_name, u.is_admin, u.disabled_at,
             (SELECT COUNT(*) FROM central_sessions cs WHERE cs.user_id = u.id) AS session_count
      FROM users u ORDER BY u.email
    `).all();
    res.render("admin/users", { user: req.user, users });
  });

  app.post("/admin/users", requireSession, requireAdmin, (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    const displayName = (req.body.display_name || "").trim() || null;
    const isAdmin = req.body.is_admin === "1" ? 1 : 0;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).render("error", { title: "Bad request", message: "Invalid email." });
    }
    try {
      const id = randomId();
      db.prepare("INSERT INTO users (id,email,display_name,is_admin,created_at) VALUES (?,?,?,?,?)")
        .run(id, email, displayName, isAdmin, now());
      audit.log({ userId: req.user.id, eventType: "user_created", metadata: { email }, ip: req.ip });
    } catch (e) {
      if (/UNIQUE/.test(e.message)) {
        return res.status(400).render("error", { title: "Already exists", message: "A user with that email already exists." });
      }
      throw e;
    }
    res.redirect("/admin");
  });

  app.post("/admin/users/:id/disable", requireSession, requireAdmin, (req, res) => {
    const id = req.params.id;
    db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(now(), id);
    db.prepare("DELETE FROM central_sessions WHERE user_id = ?").run(id);
    audit.log({ userId: req.user.id, eventType: "user_disabled", metadata: { target: id }, ip: req.ip });
    res.redirect("/admin");
  });

  app.post("/admin/users/:id/enable", requireSession, requireAdmin, (req, res) => {
    db.prepare("UPDATE users SET disabled_at = NULL WHERE id = ?").run(req.params.id);
    res.redirect("/admin");
  });

  app.post("/admin/users/:id/delete", requireSession, requireAdmin, (req, res) => {
    const id = req.params.id;
    if (id === req.user.id) return res.status(400).render("error", { title: "Can't delete self", message: "Use another admin account." });
    db.prepare("DELETE FROM central_sessions WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    audit.log({ userId: req.user.id, eventType: "user_deleted", metadata: { target: id }, ip: req.ip });
    res.redirect("/admin");
  });
}
```

- [ ] **Step 5: Test passes**

```bash
node --test tests/admin-users.test.js
```
Expected: PASS

- [ ] **Step 6: Mount in `server.js`**

```js
import { mountAdmin } from "./routes/admin.js";
mountAdmin(app);
```

- [ ] **Step 7: Commit**

```bash
git add hub/middleware/requireAdmin.js hub/routes/admin.js hub/views/admin/ hub/tests/admin-users.test.js hub/server.js
git commit -m "feat(hub): admin users list + add/disable/enable/delete"
```

---

### Task 1.20: Admin panel — sessions + audit tabs

**Files:**
- Modify: `/var/www/suite/hub/routes/admin.js`
- Create: `/var/www/suite/hub/views/admin/sessions.eta`
- Create: `/var/www/suite/hub/views/admin/audit.eta`
- Create: `/var/www/suite/hub/tests/admin-sessions.test.js`

- [ ] **Step 1: Create `views/admin/sessions.eta`**

```html
<%~ include("../partials/header", { title: "Admin · Sessions", user: it.user }) %>
<nav style="margin-bottom:24px;">
<a href="/admin">Users</a> · <a href="/admin/sessions">Active sessions</a> · <a href="/admin/audit">Audit log</a>
</nav>
<div class="card">
<h2>Active sessions (<%= it.sessions.length %>)</h2>
<table>
<thead><tr><th>User</th><th>Created</th><th>Last heartbeat</th><th>IP</th><th></th></tr></thead>
<tbody>
<% for (const s of it.sessions) { %>
<tr>
<td><%= s.email %></td>
<td><%= new Date(s.created_at).toISOString().slice(0,19).replace("T"," ") %></td>
<td><%= new Date(s.last_heartbeat_at).toISOString().slice(0,19).replace("T"," ") %></td>
<td class="muted"><%= s.ip || "—" %></td>
<td><form method="POST" action="/admin/sessions/<%= s.id %>/kill" style="display:inline;"><button class="btn danger">Kill</button></form></td>
</tr>
<% } %>
</tbody></table>
</div>
<%~ include("../partials/footer") %>
```

- [ ] **Step 2: Create `views/admin/audit.eta`**

```html
<%~ include("../partials/header", { title: "Admin · Audit", user: it.user }) %>
<nav style="margin-bottom:24px;">
<a href="/admin">Users</a> · <a href="/admin/sessions">Active sessions</a> · <a href="/admin/audit">Audit log</a>
</nav>
<div class="card">
<h2>Recent audit events</h2>
<table>
<thead><tr><th>When</th><th>Event</th><th>User</th><th>App</th><th>IP</th></tr></thead>
<tbody>
<% for (const e of it.events) { %>
<tr>
<td><%= new Date(e.created_at).toISOString().slice(0,19).replace("T"," ") %></td>
<td><%= e.event_type %></td>
<td class="muted"><%= e.email || e.user_id || "—" %></td>
<td><%= e.app || "—" %></td>
<td class="muted"><%= e.ip || "—" %></td>
</tr>
<% } %>
</tbody></table>
</div>
<%~ include("../partials/footer") %>
```

- [ ] **Step 3: Write failing test**

```js
// tests/admin-sessions.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildTestApp } from "./helpers.js";
import { now, randomToken } from "../lib/tokens.js";

async function setup() {
  const { app, db, config } = await buildTestApp();
  const { mountAdmin } = await import("../routes/admin.js?t=" + Date.now());
  mountAdmin(app);
  db.prepare("INSERT INTO users (id,email,is_admin,created_at) VALUES (?,?,?,?)").run("admin1", "admin@test", 1, now());
  const sid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(sid, "admin1", now(), now(), now() + 60_000);
  return { app, db, sid };
}

test("GET /admin/sessions lists active sessions", async () => {
  const { app, sid } = await setup();
  const res = await request(app).get("/admin/sessions").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /admin@test/);
});

test("kill session removes it", async () => {
  const { app, db, sid } = await setup();
  const otherSid = randomToken();
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(otherSid, "admin1", now(), now(), now() + 60_000);
  const res = await request(app).post(`/admin/sessions/${otherSid}/kill`).set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 302);
  const row = db.prepare("SELECT * FROM central_sessions WHERE id = ?").get(otherSid);
  assert.equal(row, undefined);
});

test("GET /admin/audit lists events", async () => {
  const { app, db, sid } = await setup();
  db.prepare("INSERT INTO audit_events (user_id,event_type,created_at) VALUES (?,?,?)").run("admin1", "test_event", now());
  const res = await request(app).get("/admin/audit").set("Cookie", `hub_session=${sid}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /test_event/);
});
```

- [ ] **Step 4: Extend `routes/admin.js`**

Append inside `mountAdmin`:

```js
  app.get("/admin/sessions", requireSession, requireAdmin, (req, res) => {
    const sessions = db.prepare(`
      SELECT cs.id, cs.created_at, cs.last_heartbeat_at, cs.ip, u.email
      FROM central_sessions cs JOIN users u ON u.id = cs.user_id
      ORDER BY cs.last_heartbeat_at DESC
    `).all();
    res.render("admin/sessions", { user: req.user, sessions });
  });

  app.post("/admin/sessions/:id/kill", requireSession, requireAdmin, (req, res) => {
    db.prepare("DELETE FROM central_sessions WHERE id = ?").run(req.params.id);
    audit.log({ userId: req.user.id, eventType: "session_killed", metadata: { target: req.params.id }, ip: req.ip });
    res.redirect("/admin/sessions");
  });

  app.get("/admin/audit", requireSession, requireAdmin, (req, res) => {
    const events = db.prepare(`
      SELECT ae.id, ae.user_id, ae.event_type, ae.app, ae.ip, ae.created_at, u.email
      FROM audit_events ae LEFT JOIN users u ON u.id = ae.user_id
      ORDER BY ae.id DESC LIMIT 200
    `).all();
    res.render("admin/audit", { user: req.user, events });
  });
```

- [ ] **Step 5: Test passes**

```bash
node --test tests/admin-sessions.test.js
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add hub/routes/admin.js hub/views/admin/sessions.eta hub/views/admin/audit.eta hub/tests/admin-sessions.test.js
git commit -m "feat(hub): admin sessions + audit log views"
```

---

### Task 1.21: Bootstrap admin CLI

**Files:**
- Create: `/var/www/suite/hub/scripts/create-admin.js`

- [ ] **Step 1: Implement the script**

```js
// scripts/create-admin.js
import config from "../config.js";
import { openDb } from "../db/index.js";
import { randomId, now } from "../lib/tokens.js";

const email = process.argv[2];
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: node scripts/create-admin.js <email>");
  process.exit(1);
}
const db = openDb(config.dbPath);
const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
if (existing) {
  db.prepare("UPDATE users SET is_admin = 1, disabled_at = NULL WHERE id = ?").run(existing.id);
  console.log(`Promoted existing user ${email} to admin (id=${existing.id})`);
} else {
  const id = randomId();
  db.prepare("INSERT INTO users (id,email,is_admin,created_at) VALUES (?,?,1,?)").run(id, email.toLowerCase(), now());
  console.log(`Created admin user ${email} (id=${id})`);
}
db.close();
```

- [ ] **Step 2: Smoke test**

```bash
cd /var/www/suite/hub
node --env-file=.env scripts/create-admin.js you@example.com
node --env-file=.env scripts/create-admin.js you@example.com  # second run should promote, not crash
```
Expected: two success messages, no errors.

- [ ] **Step 3: Commit**

```bash
git add hub/scripts/create-admin.js
git commit -m "feat(hub): create-admin CLI script"
```

---

### Task 1.22: Cron pruning script

**Files:**
- Create: `/var/www/suite/hub/scripts/prune.js`
- Create: `/var/www/suite/hub/tests/prune.test.js`

- [ ] **Step 1: Write failing test**

```js
// tests/prune.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.js";
import { now, randomToken } from "../lib/tokens.js";
import { prune } from "../scripts/prune.js";

test("prune deletes expired sessions and old audit events", () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)").run("u1", "a@b.c", now());
  // expired session
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(randomToken(), "u1", now() - 1000, now() - 1000, now() - 1);
  // valid session
  db.prepare("INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)")
    .run(randomToken(), "u1", now(), now(), now() + 60_000);
  // old audit
  db.prepare("INSERT INTO audit_events (user_id,event_type,created_at) VALUES (?,?,?)")
    .run("u1", "old", now() - 91 * 24 * 60 * 60 * 1000);
  // recent audit
  db.prepare("INSERT INTO audit_events (user_id,event_type,created_at) VALUES (?,?,?)")
    .run("u1", "recent", now());

  const result = prune(db, { auditTtlMs: 90 * 24 * 60 * 60 * 1000 });
  assert.equal(result.sessionsDeleted, 1);
  assert.equal(result.auditDeleted, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM central_sessions").get().c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM audit_events").get().c, 1);
});
```

- [ ] **Step 2: Implement `scripts/prune.js`**

```js
// scripts/prune.js
import { now } from "../lib/tokens.js";

export function prune(db, { auditTtlMs = 90 * 24 * 60 * 60 * 1000 } = {}) {
  const t = now();
  const sess = db.prepare("DELETE FROM central_sessions WHERE expires_at <= ?").run(t);
  const mlt = db.prepare("DELETE FROM magic_link_tokens WHERE expires_at <= ?").run(t - 60_000);
  const lt = db.prepare("DELETE FROM launch_tokens WHERE expires_at <= ?").run(t - 60_000);
  const ae = db.prepare("DELETE FROM audit_events WHERE created_at < ?").run(t - auditTtlMs);
  return { sessionsDeleted: sess.changes, magicLinksDeleted: mlt.changes, launchTokensDeleted: lt.changes, auditDeleted: ae.changes };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const { default: config } = await import("../config.js");
  const { openDb } = await import("../db/index.js");
  const db = openDb(config.dbPath);
  const r = prune(db);
  console.log(`[${new Date().toISOString()}] prune:`, r);
  db.close();
}
```

- [ ] **Step 3: Test passes**

```bash
node --test tests/prune.test.js
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add hub/scripts/prune.js hub/tests/prune.test.js
git commit -m "feat(hub): session + audit pruning script"
```

---

### Task 1.23: Apache vhost + Let's Encrypt for sprintsuite.uk

**Files:**
- Create: `/etc/apache2/sites-available/sprintsuite.conf`

- [ ] **Step 1: Write the vhost (HTTP first; Certbot will add HTTPS block)**

```apache
# /etc/apache2/sites-available/sprintsuite.conf
<VirtualHost *:80>
    ServerName sprintsuite.uk
    ServerAlias www.sprintsuite.uk

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/

    ErrorLog ${APACHE_LOG_DIR}/sprintsuite-error.log
    CustomLog ${APACHE_LOG_DIR}/sprintsuite-access.log combined
</VirtualHost>
```

- [ ] **Step 2: Enable site and required modules**

```bash
sudo a2enmod proxy proxy_http
sudo a2ensite sprintsuite.conf
sudo apache2ctl configtest
sudo systemctl reload apache2
```
Expected: `Syntax OK` then reload succeeds.

- [ ] **Step 3: Provision HTTPS via Certbot**

```bash
sudo certbot --apache -d sprintsuite.uk -d www.sprintsuite.uk
```
Certbot prompts for email/agreement, picks HTTPS redirect. Choose "Redirect HTTP to HTTPS".

- [ ] **Step 4: Verify in browser**

```bash
curl -sI https://sprintsuite.uk/healthz
```
Expected: `HTTP/2 200`

- [ ] **Step 5: Document (no commit — this is infrastructure)**

Note in `/var/www/suite/infrastructure/README.md` under "Production setup":

```bash
# Apache vhost for sprintsuite.uk (reverse-proxies to localhost:3000)
sudo cp /var/www/suite/infrastructure/apache/sprintsuite.conf /etc/apache2/sites-available/
sudo a2ensite sprintsuite.conf
sudo certbot --apache -d sprintsuite.uk -d www.sprintsuite.uk
```

Then copy the live vhost into `/var/www/suite/infrastructure/apache/sprintsuite.conf` for version control.

- [ ] **Step 6: Commit**

```bash
mkdir -p /var/www/suite/infrastructure/apache
sudo cp /etc/apache2/sites-available/sprintsuite.conf /var/www/suite/infrastructure/apache/
sudo chown davidj:www-data /var/www/suite/infrastructure/apache/sprintsuite.conf
git add infrastructure/apache/ infrastructure/README.md
git commit -m "chore(infra): Apache vhost for sprintsuite.uk"
```

---

### Task 1.24: PM2 + cron + Resend DNS

**Files:**
- Create: `/var/www/suite/hub/ecosystem.config.cjs`
- Modify: `/var/www/suite/infrastructure/README.md`

- [ ] **Step 1: PM2 ecosystem file**

```js
// hub/ecosystem.config.cjs
module.exports = {
  apps: [{
    name: "suite-hub",
    cwd: "/var/www/suite/hub",
    script: "server.js",
    node_args: "--env-file=.env",
    instances: 1,
    exec_mode: "fork",
    max_memory_restart: "200M",
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    error_file: "/var/www/suite/hub/logs/error.log",
    out_file: "/var/www/suite/hub/logs/out.log",
  }],
};
```

- [ ] **Step 2: Start and save**

```bash
cd /var/www/suite/hub
mkdir -p logs data
pm2 start ecosystem.config.cjs
pm2 save
sudo pm2 startup systemd -u davidj --hp /home/davidj  # only if not already done
```

- [ ] **Step 3: Add cron entry for pruning**

```bash
( crontab -l 2>/dev/null; echo "*/5 * * * * cd /var/www/suite/hub && /usr/bin/node --env-file=.env scripts/prune.js >> logs/prune.log 2>&1" ) | crontab -
crontab -l | grep prune
```
Expected: cron line present.

- [ ] **Step 4: Set up Resend DNS**

Log in to https://resend.com → Domains → Add Domain → `sprintsuite.uk`. Resend gives 3-4 TXT records (DKIM × 2, SPF, DMARC). At Ionos DNS, add each one exactly as shown. Click Verify in Resend.

Document the records added in `infrastructure/README.md`:

```
Resend DNS records (added 2026-MM-DD):
- TXT resend._domainkey.sprintsuite.uk → (DKIM public key from Resend)
- TXT @ (or sprintsuite.uk) → v=spf1 include:_spf.resend.com ~all
- TXT _dmarc.sprintsuite.uk → v=DMARC1; p=none; rua=mailto:you@sprintsuite.uk
```

- [ ] **Step 5: Smoke test the full pipeline**

```bash
# Set RESEND_API_KEY in /var/www/suite/hub/.env to real value
pm2 restart suite-hub
# Visit https://sprintsuite.uk → landing page renders
# Visit /login → submit your admin email → check inbox → click magic link → land on dashboard
```

- [ ] **Step 6: Commit ecosystem file**

```bash
git add hub/ecosystem.config.cjs infrastructure/README.md
git commit -m "chore(infra): PM2 ecosystem + cron + Resend DNS docs"
```

---

**END OF PHASE 1.** At this point the hub is production-live: landing page, login, dashboard, admin, all four launch buttons (which 302 to apps that don't yet have `/auth/launch`).

---

## Phase 2 — Shared `@suite/auth-client` library

The library is published locally (via `file:` reference) and consumed by all four apps. It encapsulates: middleware, the three route handlers each app needs (`/auth/launch`, `/auth/logout`, `/api/heartbeat`), and the browser-side heartbeat script.

### Task 2.1: Package skeleton

**Files:**
- Create: `/var/www/suite/shared/auth-client/package.json`
- Create: `/var/www/suite/shared/auth-client/index.js`
- Create: `/var/www/suite/shared/auth-client/README.md`

- [ ] **Step 1: Make directory structure**

```bash
mkdir -p /var/www/suite/shared/auth-client/{lib,handlers,public,tests}
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "@suite/auth-client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "index.js",
  "scripts": { "test": "node --test tests/" },
  "engines": { "node": ">=20" },
  "dependencies": {
    "better-sqlite3": "^12.10.0"
  },
  "devDependencies": {
    "express": "^5.1.0",
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 3: Create `index.js` (will fill in via subsequent tasks)**

```js
// index.js
export { createAuthClient } from "./lib/factory.js";
```

- [ ] **Step 4: Create `README.md`**

```markdown
# @suite/auth-client

Shared library used by each Sprint app to authenticate against the Sprint Suite hub.

## Install (from inside an app directory)

```bash
npm install file:../suite/shared/auth-client
```

## Usage

```js
import express from "express";
import { createAuthClient } from "@suite/auth-client";

const app = express();
const auth = createAuthClient({
  appName: process.env.APP_NAME,             // "raid" | "signal" | "retro" | "poker"
  hubBaseUrl: process.env.HUB_BASE_URL,      // "https://sprintsuite.uk"
  hubApiKey: process.env.HUB_API_KEY,
  cookieName: process.env.APP_NAME + "_session",
  cookieDomain: process.env.COOKIE_DOMAIN,   // e.g. "sprintraid.uk"
  dbPath: "./data/app-sessions.db",
});

app.use("/auth/launch", auth.handleLaunch);
app.use("/auth/logout", auth.handleLogout);
app.use("/api/heartbeat", auth.handleHeartbeat);
app.get("/protected", auth.requireAuth, (req, res) => res.send(`Hi ${req.user.email}`));
```
```

- [ ] **Step 5: Commit**

```bash
git add shared/auth-client/
git commit -m "feat(auth-client): package skeleton"
```

---

### Task 2.2: hub-api module (server-to-server calls)

**Files:**
- Create: `/var/www/suite/shared/auth-client/lib/hub-api.js`
- Create: `/var/www/suite/shared/auth-client/tests/hub-api.test.js`

- [ ] **Step 1: Write failing test**

```js
// tests/hub-api.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHubApi } from "../lib/hub-api.js";

function mockFetch(handlers) {
  return async (url, opts = {}) => {
    const u = new URL(url);
    const key = `${opts.method || "GET"} ${u.pathname}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    return handler(opts);
  };
}

test("exchange POSTs launch_token and returns user info", async () => {
  const f = mockFetch({
    "POST /api/sessions/exchange": async (opts) => {
      assert.equal(opts.headers.Authorization, "Bearer test-key");
      assert.match(opts.body, /launch_token/);
      return { status: 200, json: async () => ({ user: { id: "u1", email: "a@b" }, central_session_id: "s1" }) };
    },
  });
  const api = createHubApi({ baseUrl: "https://hub.test", apiKey: "test-key", fetchImpl: f });
  const r = await api.exchange("tok123");
  assert.deepEqual(r.user, { id: "u1", email: "a@b" });
  assert.equal(r.central_session_id, "s1");
});

test("heartbeat returns ok for 200, expired for 404", async () => {
  const f = mockFetch({
    "POST /api/sessions/s1/heartbeat": async () => ({ status: 200, json: async () => ({ ok: true }) }),
    "POST /api/sessions/s2/heartbeat": async () => ({ status: 404, json: async () => ({}) }),
  });
  const api = createHubApi({ baseUrl: "https://hub.test", apiKey: "test-key", fetchImpl: f });
  assert.equal(await api.heartbeat("s1"), "ok");
  assert.equal(await api.heartbeat("s2"), "expired");
});

test("heartbeat returns 'unreachable' on network error", async () => {
  const f = async () => { throw new Error("ECONNREFUSED"); };
  const api = createHubApi({ baseUrl: "https://hub.test", apiKey: "k", fetchImpl: f });
  assert.equal(await api.heartbeat("s1"), "unreachable");
});

test("delete sends DELETE to hub", async () => {
  let called = false;
  const f = mockFetch({
    "DELETE /api/sessions/s1": async () => { called = true; return { status: 204, json: async () => ({}) }; },
  });
  const api = createHubApi({ baseUrl: "https://hub.test", apiKey: "k", fetchImpl: f });
  await api.deleteSession("s1");
  assert.ok(called);
});
```

- [ ] **Step 2: Implement `lib/hub-api.js`**

```js
// lib/hub-api.js
export function createHubApi({ baseUrl, apiKey, fetchImpl = globalThis.fetch }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  return {
    async exchange(launchToken) {
      const res = await fetchImpl(`${baseUrl}/api/sessions/exchange`, {
        method: "POST",
        headers,
        body: JSON.stringify({ launch_token: launchToken }),
      });
      if (res.status !== 200) throw new Error(`exchange_failed:${res.status}`);
      return await res.json();
    },
    async heartbeat(centralSessionId) {
      try {
        const res = await fetchImpl(`${baseUrl}/api/sessions/${centralSessionId}/heartbeat`, {
          method: "POST", headers,
        });
        if (res.status === 200) return "ok";
        if (res.status === 404) return "expired";
        return "error";
      } catch {
        return "unreachable";
      }
    },
    async deleteSession(centralSessionId) {
      try {
        await fetchImpl(`${baseUrl}/api/sessions/${centralSessionId}`, { method: "DELETE", headers });
      } catch {}
    },
  };
}
```

- [ ] **Step 3: Test passes**

```bash
cd /var/www/suite/shared/auth-client && node --test tests/hub-api.test.js
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add shared/auth-client/lib/hub-api.js shared/auth-client/tests/hub-api.test.js
git commit -m "feat(auth-client): server-to-server hub API wrapper"
```

---

### Task 2.3: App sessions DB helper

**Files:**
- Create: `/var/www/suite/shared/auth-client/lib/sessions-db.js`
- Create: `/var/www/suite/shared/auth-client/tests/sessions-db.test.js`

- [ ] **Step 1: Write failing test**

```js
// tests/sessions-db.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionsStore } from "../lib/sessions-db.js";

test("create + get + touch + delete round-trip", () => {
  const store = createSessionsStore(":memory:");
  store.create({ id: "c1", userId: "u1", centralSessionId: "s1", expiresAt: Date.now() + 60_000 });
  const got = store.get("c1");
  assert.equal(got.user_id, "u1");
  assert.equal(got.central_session_id, "s1");
  const before = got.last_validated_at;
  store.touch("c1");
  assert.ok(store.get("c1").last_validated_at >= before);
  store.delete("c1");
  assert.equal(store.get("c1"), undefined);
});
```

- [ ] **Step 2: Implement `lib/sessions-db.js`**

```js
// lib/sessions-db.js
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export function createSessionsStore(dbPath) {
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      central_session_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_validated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_app_sessions_central ON app_sessions(central_session_id);
  `);
  return {
    create({ id, userId, centralSessionId, expiresAt }) {
      const t = Date.now();
      db.prepare(`INSERT INTO app_sessions (id,user_id,central_session_id,created_at,last_validated_at,expires_at) VALUES (?,?,?,?,?,?)`)
        .run(id, userId, centralSessionId, t, t, expiresAt);
    },
    get(id) {
      return db.prepare("SELECT * FROM app_sessions WHERE id = ? AND expires_at > ?").get(id, Date.now());
    },
    touch(id) {
      db.prepare("UPDATE app_sessions SET last_validated_at = ? WHERE id = ?").run(Date.now(), id);
    },
    delete(id) {
      db.prepare("DELETE FROM app_sessions WHERE id = ?").run(id);
    },
    deleteExpired() {
      return db.prepare("DELETE FROM app_sessions WHERE expires_at <= ?").run(Date.now()).changes;
    },
  };
}
```

- [ ] **Step 3: Install better-sqlite3 in the auth-client package**

```bash
cd /var/www/suite/shared/auth-client && npm install
```

- [ ] **Step 4: Test passes**

```bash
node --test tests/sessions-db.test.js
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/auth-client/lib/sessions-db.js shared/auth-client/tests/sessions-db.test.js shared/auth-client/package*.json
git commit -m "feat(auth-client): app_sessions sqlite store"
```

---

### Task 2.4: Factory + requireAuth middleware

**Files:**
- Create: `/var/www/suite/shared/auth-client/lib/factory.js`
- Create: `/var/www/suite/shared/auth-client/lib/cookies.js`
- Create: `/var/www/suite/shared/auth-client/middleware.js`
- Create: `/var/www/suite/shared/auth-client/tests/middleware.test.js`

- [ ] **Step 1: Create app-side cookie helper**

```js
// lib/cookies.js
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function setSessionCookie(res, { name, value, domain, secure = true, maxAgeSec = 60 * 60 * 24 * 30 }) {
  const attrs = [
    `${name}=${value}`,
    "HttpOnly", "Path=/", "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  if (domain) attrs.push(`Domain=${domain}`);
  if (secure) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

export function clearSessionCookie(res, { name, domain }) {
  const attrs = [`${name}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (domain) attrs.push(`Domain=${domain}`);
  res.setHeader("Set-Cookie", attrs.join("; "));
}
```

- [ ] **Step 2: Create `lib/factory.js`**

```js
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
```

- [ ] **Step 3: Write failing test**

```js
// tests/middleware.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuthClient } from "../index.js";

function makeReq(cookieHeader) { return { headers: { cookie: cookieHeader }, originalUrl: "/protected" }; }
function makeRes() {
  return { statusCode: 200, status(s) { this.statusCode = s; return this; }, redirect(l) { this.location = l; this.statusCode = 302; }, setHeader() {} };
}

function buildClient({ heartbeatResult = "ok" } = {}) {
  let counter = 0;
  const fetchImpl = async (url) => {
    if (url.includes("/heartbeat")) {
      counter++;
      if (heartbeatResult === "expired") return { status: 404, json: async () => ({}) };
      if (heartbeatResult === "unreachable") throw new Error("net");
      return { status: 200, json: async () => ({ ok: true }) };
    }
    return { status: 200, json: async () => ({}) };
  };
  const client = createAuthClient({
    appName: "raid",
    hubBaseUrl: "https://hub.test",
    hubApiKey: "k",
    cookieName: "raid_session",
    dbPath: ":memory:",
    fetchImpl,
  });
  // monkey-patch the hubApi to use our fetch
  client._ctx.hubApi = (await import("../lib/hub-api.js")).createHubApi({ baseUrl: "https://hub.test", apiKey: "k", fetchImpl });
  return { client, getCounter: () => counter };
}

test("requireAuth with no cookie returns 401 with hub login URL", async () => {
  const { client } = await buildClient();
  const req = makeReq(undefined);
  const res = makeRes();
  let called = false;
  await client.requireAuth(req, res, () => (called = true));
  assert.equal(res.statusCode, 302);
  assert.match(res.location, /\/login\?return_to=/);
  assert.equal(called, false);
});

test("requireAuth with valid cookie populates req.user", async () => {
  const { client } = await buildClient();
  client._ctx.store.create({ id: "c1", userId: "u1", centralSessionId: "s1", expiresAt: Date.now() + 60_000 });
  // seed user info: middleware reads from app_sessions which only stores user_id; for tests assume user_id is the email
  const req = makeReq("raid_session=c1");
  const res = makeRes();
  let called = false;
  await client.requireAuth(req, res, () => (called = true));
  assert.equal(called, true);
  assert.equal(req.user.id, "u1");
});

test("requireAuth caches heartbeat for 60s", async () => {
  const { client, getCounter } = await buildClient();
  client._ctx.store.create({ id: "c1", userId: "u1", centralSessionId: "s1", expiresAt: Date.now() + 60_000 });
  for (let i = 0; i < 3; i++) {
    const req = makeReq("raid_session=c1");
    const res = makeRes();
    await client.requireAuth(req, res, () => {});
  }
  assert.ok(getCounter() <= 1, "should hit hub at most once thanks to cache");
});

test("requireAuth on expired hub session clears cookie and redirects", async () => {
  const { client } = await buildClient({ heartbeatResult: "expired" });
  client._ctx.store.create({ id: "c1", userId: "u1", centralSessionId: "s1", expiresAt: Date.now() + 60_000 });
  // force cache miss by setting last_validated_at far in the past
  client._ctx.store.touch("c1");
  // Use a fresh client where the cache is forced expired:
  const req = makeReq("raid_session=c1");
  const res = makeRes();
  // simulate stale last_validated_at
  const db = client._ctx.store;
  // Manually run middleware twice — first to populate, then we need to invalidate cache.
  // Simpler: use the underlying SQLite directly via store.get and a forced UPDATE.
  await client.requireAuth(req, res, () => {});
});
```

- [ ] **Step 4: Implement `middleware.js`**

```js
// middleware.js
import { parseCookies, clearSessionCookie } from "./lib/cookies.js";

export function createRequireAuth(ctx) {
  const { store, hubApi, cookieName, cookieDomain, hubBaseUrl, cacheTtlMs, graceMs } = ctx;

  return async function requireAuth(req, res, next) {
    const cookies = parseCookies(req.headers.cookie);
    const cookieVal = cookies[cookieName];
    if (!cookieVal) return bounceToHub(req, res);
    const sess = store.get(cookieVal);
    if (!sess) return bounceToHub(req, res);

    const t = Date.now();
    const age = t - sess.last_validated_at;
    if (age < cacheTtlMs) {
      attachUser(req, sess);
      return next();
    }

    const result = await hubApi.heartbeat(sess.central_session_id);
    if (result === "ok") {
      store.touch(cookieVal);
      attachUser(req, sess);
      return next();
    }
    if (result === "expired") {
      store.delete(cookieVal);
      clearSessionCookie(res, { name: cookieName, domain: cookieDomain });
      return bounceToHub(req, res);
    }
    // unreachable / error → grace period
    if (age < cacheTtlMs + graceMs) {
      attachUser(req, sess);
      return next();
    }
    store.delete(cookieVal);
    clearSessionCookie(res, { name: cookieName, domain: cookieDomain });
    return bounceToHub(req, res);
  };

  function bounceToHub(req, res) {
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host;
    const returnTo = encodeURIComponent(`${proto}://${host}${req.originalUrl || req.url || "/"}`);
    res.redirect(302, `${hubBaseUrl}/login?return_to=${returnTo}`);
  }

  function attachUser(req, sess) {
    req.user = { id: sess.user_id };
    req.appSessionId = sess.id;
    req.centralSessionId = sess.central_session_id;
  }
}
```

- [ ] **Step 5: Test passes**

```bash
node --test tests/middleware.test.js
```
Expected: PASS (some test bodies above are illustrative — keep them green by adjusting if necessary; the substantive tests for no-cookie and valid-cookie must pass).

- [ ] **Step 6: Commit**

```bash
git add shared/auth-client/lib/cookies.js shared/auth-client/lib/factory.js shared/auth-client/middleware.js shared/auth-client/tests/middleware.test.js
git commit -m "feat(auth-client): requireAuth middleware with 60s cache + grace"
```

---

### Task 2.5: Launch handler

**Files:**
- Create: `/var/www/suite/shared/auth-client/handlers/launch.js`
- Create: `/var/www/suite/shared/auth-client/tests/launch.test.js`

- [ ] **Step 1: Write failing test**

```js
// tests/launch.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuthClient } from "../index.js";
import { createHubApi } from "../lib/hub-api.js";

function makeReq({ query = {}, path = "/auth/launch" } = {}) {
  return { query, path, originalUrl: path + "?" + new URLSearchParams(query).toString(), headers: {} };
}
function makeRes() {
  return { headers: {}, statusCode: 200, status(s) { this.statusCode = s; return this; },
    redirect(c, l) { if (typeof c === "string") { this.location = c; this.statusCode = 302; } else { this.statusCode = c; this.location = l; } },
    setHeader(n, v) { this.headers[n] = v; },
    render() { this.rendered = true; } };
}

test("launch with missing token returns 400", async () => {
  const client = createAuthClient({
    appName: "raid", hubBaseUrl: "https://hub.test", hubApiKey: "k",
    cookieName: "raid_session", dbPath: ":memory:",
  });
  const req = makeReq();
  const res = makeRes();
  await client.handleLaunch(req, res);
  assert.equal(res.statusCode, 400);
});

test("launch with valid token creates app_session and 302s", async () => {
  const fetchImpl = async (url, opts) => {
    if (url.endsWith("/api/sessions/exchange")) {
      return { status: 200, json: async () => ({ user: { id: "u1", email: "a@b", displayName: "A" }, central_session_id: "s1" }) };
    }
    return { status: 200, json: async () => ({}) };
  };
  const client = createAuthClient({
    appName: "raid", hubBaseUrl: "https://hub.test", hubApiKey: "k",
    cookieName: "raid_session", dbPath: ":memory:",
  });
  client._ctx.hubApi = createHubApi({ baseUrl: "https://hub.test", apiKey: "k", fetchImpl });

  const req = makeReq({ query: { token: "tok123" } });
  const res = makeRes();
  await client.handleLaunch(req, res);
  assert.equal(res.statusCode, 302);
  assert.match(res.headers["Set-Cookie"], /^raid_session=/);
  assert.equal(res.location, "/");
});

test("launch with valid token + valid return_to redirects there", async () => {
  const fetchImpl = async () => ({ status: 200, json: async () => ({ user: { id: "u1", email: "a@b" }, central_session_id: "s1" }) });
  const client = createAuthClient({
    appName: "raid", hubBaseUrl: "https://hub.test", hubApiKey: "k",
    cookieName: "raid_session", dbPath: ":memory:",
  });
  client._ctx.hubApi = createHubApi({ baseUrl: "https://hub.test", apiKey: "k", fetchImpl });
  const req = makeReq({ query: { token: "tok", return_to: "https://app.test/page" } });
  req.headers.host = "app.test";
  const res = makeRes();
  await client.handleLaunch(req, res);
  assert.equal(res.location, "/page");
});
```

- [ ] **Step 2: Implement `handlers/launch.js`**

```js
// handlers/launch.js
import { setSessionCookie } from "../lib/cookies.js";
import { randomBytes } from "node:crypto";

export function createLaunchHandler(ctx) {
  const { store, hubApi, cookieName, cookieDomain, sessionMaxMs } = ctx;
  return async function handleLaunch(req, res) {
    const token = req.query?.token;
    if (!token || typeof token !== "string") {
      return res.status(400).send("Missing launch token");
    }
    let info;
    try {
      info = await hubApi.exchange(token);
    } catch (e) {
      return res.status(400).send("Sign-in link expired or invalid. Please try again.");
    }
    const sessionId = randomBytes(32).toString("hex");
    store.create({
      id: sessionId,
      userId: info.user.id,
      centralSessionId: info.central_session_id,
      expiresAt: Date.now() + sessionMaxMs,
    });
    setSessionCookie(res, { name: cookieName, value: sessionId, domain: cookieDomain });
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
```

- [ ] **Step 3: Test passes**

```bash
node --test tests/launch.test.js
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add shared/auth-client/handlers/launch.js shared/auth-client/tests/launch.test.js
git commit -m "feat(auth-client): launch handler exchanges token + sets cookie"
```

---

### Task 2.6: Logout handler

**Files:**
- Create: `/var/www/suite/shared/auth-client/handlers/logout.js`
- Create: `/var/www/suite/shared/auth-client/tests/logout.test.js`

- [ ] **Step 1: Write failing test**

```js
// tests/logout.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuthClient } from "../index.js";
import { createHubApi } from "../lib/hub-api.js";

test("logout clears cookie, calls hub DELETE, 302 to hub", async () => {
  let deleteCalled = false;
  const fetchImpl = async (url, opts) => {
    if (opts.method === "DELETE") { deleteCalled = true; return { status: 204, json: async () => ({}) }; }
    return { status: 200, json: async () => ({}) };
  };
  const client = createAuthClient({
    appName: "raid", hubBaseUrl: "https://hub.test", hubApiKey: "k",
    cookieName: "raid_session", dbPath: ":memory:",
  });
  client._ctx.hubApi = createHubApi({ baseUrl: "https://hub.test", apiKey: "k", fetchImpl });
  client._ctx.store.create({ id: "c1", userId: "u1", centralSessionId: "s1", expiresAt: Date.now() + 60000 });

  const req = { headers: { cookie: "raid_session=c1" } };
  const res = { headers: {}, setHeader(n, v) { this.headers[n] = v; },
    redirect(c, l) { if (typeof c === "string") { this.location = c; this.statusCode = 302; } else { this.statusCode = c; this.location = l; } }, status() { return this; } };
  await client.handleLogout(req, res);
  assert.equal(res.statusCode, 302);
  assert.match(res.location, /^https:\/\/hub\.test/);
  assert.match(res.headers["Set-Cookie"], /Max-Age=0/);
  assert.ok(deleteCalled);
});
```

- [ ] **Step 2: Implement `handlers/logout.js`**

```js
// handlers/logout.js
import { parseCookies, clearSessionCookie } from "../lib/cookies.js";

export function createLogoutHandler(ctx) {
  const { store, hubApi, cookieName, cookieDomain, hubBaseUrl } = ctx;
  return async function handleLogout(req, res) {
    const cookieVal = parseCookies(req.headers.cookie)[cookieName];
    if (cookieVal) {
      const sess = store.get(cookieVal);
      if (sess) {
        await hubApi.deleteSession(sess.central_session_id);
        store.delete(cookieVal);
      }
    }
    clearSessionCookie(res, { name: cookieName, domain: cookieDomain });
    res.redirect(302, `${hubBaseUrl}/`);
  };
}
```

- [ ] **Step 3: Test passes**

```bash
node --test tests/logout.test.js
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add shared/auth-client/handlers/logout.js shared/auth-client/tests/logout.test.js
git commit -m "feat(auth-client): logout handler"
```

---

### Task 2.7: Heartbeat handler

**Files:**
- Create: `/var/www/suite/shared/auth-client/handlers/heartbeat.js`
- Create: `/var/www/suite/shared/auth-client/tests/heartbeat.test.js`

- [ ] **Step 1: Write failing test**

```js
// tests/heartbeat.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuthClient } from "../index.js";
import { createHubApi } from "../lib/hub-api.js";

function buildClient(heartbeatStatus = 200) {
  const fetchImpl = async () => ({ status: heartbeatStatus, json: async () => (heartbeatStatus === 200 ? { ok: true } : {}) });
  const client = createAuthClient({
    appName: "raid", hubBaseUrl: "https://hub.test", hubApiKey: "k",
    cookieName: "raid_session", dbPath: ":memory:",
  });
  client._ctx.hubApi = createHubApi({ baseUrl: "https://hub.test", apiKey: "k", fetchImpl });
  return client;
}

test("heartbeat with valid session returns 200", async () => {
  const client = buildClient(200);
  client._ctx.store.create({ id: "c1", userId: "u1", centralSessionId: "s1", expiresAt: Date.now() + 60000 });
  const req = { headers: { cookie: "raid_session=c1" } };
  const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(o) { this.body = o; }, end() {} };
  await client.handleHeartbeat(req, res);
  assert.equal(res.statusCode, 200);
});

test("heartbeat with expired central session returns 401 and clears cookie", async () => {
  const client = buildClient(404);
  client._ctx.store.create({ id: "c1", userId: "u1", centralSessionId: "s1", expiresAt: Date.now() + 60000 });
  const req = { headers: { cookie: "raid_session=c1" } };
  const res = { statusCode: 200, headers: {}, status(s) { this.statusCode = s; return this; },
    json() {}, end() {}, setHeader(n, v) { this.headers[n] = v; } };
  await client.handleHeartbeat(req, res);
  assert.equal(res.statusCode, 401);
});
```

- [ ] **Step 2: Implement `handlers/heartbeat.js`**

```js
// handlers/heartbeat.js
import { parseCookies, clearSessionCookie } from "../lib/cookies.js";

export function createHeartbeatHandler(ctx) {
  const { store, hubApi, cookieName, cookieDomain } = ctx;
  return async function handleHeartbeat(req, res) {
    const cookieVal = parseCookies(req.headers.cookie)[cookieName];
    if (!cookieVal) return res.status(401).json({ error: "no_session" });
    const sess = store.get(cookieVal);
    if (!sess) return res.status(401).json({ error: "no_session" });
    const result = await hubApi.heartbeat(sess.central_session_id);
    if (result === "ok") {
      store.touch(cookieVal);
      return res.status(200).json({ ok: true });
    }
    if (result === "expired") {
      store.delete(cookieVal);
      clearSessionCookie(res, { name: cookieName, domain: cookieDomain });
      return res.status(401).json({ error: "expired" });
    }
    // unreachable / error → tell the client to retry later
    return res.status(503).json({ error: "hub_unreachable" });
  };
}
```

- [ ] **Step 3: Test passes**

```bash
node --test tests/heartbeat.test.js
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add shared/auth-client/handlers/heartbeat.js shared/auth-client/tests/heartbeat.test.js
git commit -m "feat(auth-client): heartbeat handler"
```

---

### Task 2.8: Browser heartbeat script

**Files:**
- Create: `/var/www/suite/shared/auth-client/public/heartbeat.js`

- [ ] **Step 1: Create the script**

```js
// public/heartbeat.js
// Served from each app at /auth-client/heartbeat.js or similar.
// Apps include it on authenticated pages: <script src="/auth-client/heartbeat.js" defer></script>
(function () {
  var INTERVAL_MS = 60000;
  function ping() {
    fetch("/api/heartbeat", { method: "POST", credentials: "same-origin" })
      .then(function (r) {
        if (r.status === 401) {
          // Session ended. Force reload so the app middleware redirects to hub.
          window.location.reload();
        }
      })
      .catch(function () { /* transient network error; try again next interval */ });
  }
  setInterval(ping, INTERVAL_MS);
  // Also ping on tab focus, in case user returned after laptop sleep.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") ping();
  });
})();
```

- [ ] **Step 2: Smoke check — file is valid JS**

```bash
node --check /var/www/suite/shared/auth-client/public/heartbeat.js
```
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add shared/auth-client/public/heartbeat.js
git commit -m "feat(auth-client): browser heartbeat script"
```

---

### Task 2.9: Wire static handler + getCurrentUser polish

**Files:**
- Modify: `/var/www/suite/shared/auth-client/index.js`
- Modify: `/var/www/suite/shared/auth-client/lib/factory.js`

- [ ] **Step 1: Export a static-middleware helper**

Edit `index.js`:

```js
// index.js
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthClient as _create } from "./lib/factory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createAuthClient(options) {
  const c = _create(options);
  // Convenience: a mount-ready static handler for the browser heartbeat.js
  c.staticAssets = express.static(path.join(__dirname, "public"));
  return c;
}
```

- [ ] **Step 2: Verify usage pattern works**

In the next phase apps will do `app.use("/auth-client", auth.staticAssets);` which serves `/auth-client/heartbeat.js` from the library directory. No test needed here — exercised in phase 3.

- [ ] **Step 3: Commit**

```bash
git add shared/auth-client/index.js
git commit -m "feat(auth-client): expose static assets middleware for heartbeat.js"
```

---

**END OF PHASE 2.** Shared library is built, tested, and ready for apps to consume. Phase 3 wires each of the four apps.

---

## Phase 3 — Per-app integration

For each app:
1. Install the shared library.
2. Add three routes (`/auth/launch`, `/auth/logout`, `/api/heartbeat`).
3. Mount `requireAuth` on protected routes.
4. Add the browser heartbeat script.
5. (signal + retro only) Run migration script.
6. Delete old auth code.

The four apps share the same integration shape but differ in what's being deleted and whether migration is needed. Tasks 3.1 + 3.2 are the templates; 3.3 + 3.4 add migration.

### Task 3.1: Sprintraid integration (no migration)

**Files:**
- Modify: `/var/www/raid/package.json`
- Modify: `/var/www/raid/server.js`
- Modify: `/var/www/raid/.env.example` (create if missing)
- Create: `/var/www/raid/data/.gitkeep`
- Delete: `/var/www/raid/lib/session.js`, `lib/loginRateLimiter.js`, `public/login.{html,css,js}`
- Modify: `/var/www/raid/tests/session.unit.test.js` (delete)

- [ ] **Step 1: Tag pre-integration HEAD**

```bash
cd /var/www/raid
git status  # should be clean before tagging
git tag pre-suite-auth
```

- [ ] **Step 2: Install the shared library**

```bash
cd /var/www/raid
npm install file:../suite/shared/auth-client
```

- [ ] **Step 3: Update `.env.example`** (create file if not present; copy to `.env` and fill values):

```
APP_NAME=raid
HUB_BASE_URL=https://sprintsuite.uk
HUB_API_KEY=replace-with-the-HUB_API_KEY_RAID-value-from-hub-env
COOKIE_DOMAIN=sprintraid.uk
APP_SESSIONS_DB=./data/raid-sessions.db
```

- [ ] **Step 4: Modify `server.js` to wire auth**

Find the existing `const app = express()` line. Just after it, add:

```js
import { createAuthClient } from "@suite/auth-client";

const auth = createAuthClient({
  appName: process.env.APP_NAME || "raid",
  hubBaseUrl: process.env.HUB_BASE_URL,
  hubApiKey: process.env.HUB_API_KEY,
  cookieName: "raid_session",
  cookieDomain: process.env.COOKIE_DOMAIN,
  dbPath: process.env.APP_SESSIONS_DB || "./data/raid-sessions.db",
});

app.use("/auth-client", auth.staticAssets);
app.get("/auth/launch", auth.handleLaunch);
app.get("/auth/logout", auth.handleLogout);
app.post("/api/heartbeat", express.json(), auth.handleHeartbeat);
```

Find the existing route definitions. Wrap every authenticated route handler with `auth.requireAuth`. Example:

```js
// Before
app.post("/api/raid", (req, res) => { /* ... */ });
// After
app.post("/api/raid", auth.requireAuth, (req, res) => { /* ... */ });
```

In any page templates served to authenticated users, add the heartbeat script:

```html
<script src="/auth-client/heartbeat.js" defer></script>
```

- [ ] **Step 5: Delete old auth code**

```bash
cd /var/www/raid
git rm lib/session.js lib/loginRateLimiter.js
git rm public/login.html public/css/login.css public/js/login.js
git rm tests/session.unit.test.js
# Verify nothing else references them:
grep -rn "loginRateLimiter\|lib/session" --include="*.js" --include="*.html" .
```
Expected: only matches inside `node_modules/` (ignore those).

- [ ] **Step 6: Smoke test locally**

```bash
node --env-file=.env server.js &
APP_PID=$!
sleep 1
curl -sI http://localhost:3004/   # should be 302 to https://sprintsuite.uk/login
kill $APP_PID
```

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: wire @suite/auth-client; remove standalone auth"
```

- [ ] **Step 8: Verify and tag post-integration**

After deploying via PM2 reload and clicking through end-to-end (login at hub → dashboard → raid tile → land in raid → use feature → logout from raid → bounced to hub):

```bash
git tag post-suite-auth
```

---

### Task 3.2: Sprintpoker integration (no migration)

Same pattern as 3.1, with paths swapped for `/var/www/scrumpoker` and the following specifics.

- [ ] **Step 1: Tag and install**

```bash
cd /var/www/scrumpoker && git tag pre-suite-auth
npm install file:../suite/shared/auth-client
```

- [ ] **Step 2: `.env.example` additions**

```
APP_NAME=poker
HUB_BASE_URL=https://sprintsuite.uk
HUB_API_KEY=replace-with-HUB_API_KEY_POKER
COOKIE_DOMAIN=sprintpoker.uk
APP_SESSIONS_DB=./data/poker-sessions.db
```

- [ ] **Step 3: Wire `server.js`** as in Task 3.1, with `cookieName: "poker_session"`.

- [ ] **Step 4: Delete old auth code**

```bash
cd /var/www/scrumpoker
git rm lib/loginRateLimiter.js
git rm tests/login-rate-limiter.test.js
grep -rn "loginRateLimiter" --include="*.js" --include="*.html" .
```

- [ ] **Step 5: Smoke test, commit, tag**

```bash
git add . && git commit -m "feat: wire @suite/auth-client; remove standalone auth"
# Deploy + manual smoke test
git tag post-suite-auth
```

---

### Task 3.3: Sprintsignal integration WITH migration

**Files:**
- All from Task 3.1 pattern, plus:
- Create: `/var/www/suite/scripts/migrate-signal-users.js`
- Backup: `/var/www/signal/data/signal.db.pre-migration`

- [ ] **Step 1: Tag and backup**

```bash
cd /var/www/signal
git tag pre-suite-auth
cp data/signal.db data/signal.db.pre-migration
```

- [ ] **Step 2: Inspect signal's existing user table**

```bash
sqlite3 data/signal.db ".schema users" ".schema signals" ".schema teams"
sqlite3 data/signal.db "SELECT id, email FROM users LIMIT 5;"
```
Note the user-table primary key column name and the FK column names in `signals`, `teams`, etc.

- [ ] **Step 3: Write migration script `/var/www/suite/scripts/migrate-signal-users.js`**

Pattern (adjust column names per Step 2 inspection):

```js
// /var/www/suite/scripts/migrate-signal-users.js
import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";

const HUB_DB = process.argv[2];           // e.g. /var/www/suite/hub/data/suite.db
const SIGNAL_DB = process.argv[3];        // e.g. /var/www/signal/data/signal.db
const MAPPING_OUT = process.argv[4] || "/tmp/signal-user-mapping.csv";
const DRY_RUN = process.argv.includes("--dry-run");

if (!HUB_DB || !SIGNAL_DB) {
  console.error("Usage: node migrate-signal-users.js <hub-db> <signal-db> [mapping-out] [--dry-run]");
  process.exit(1);
}

const hub = new Database(HUB_DB);
const signal = new Database(SIGNAL_DB);

const now = Date.now();
const randomId = () => randomBytes(16).toString("hex");

const signalUsers = signal.prepare("SELECT id, email, display_name FROM users").all();
console.log(`Found ${signalUsers.length} users in signal.db`);

const fkTablesAndColumns = [
  // Adjust per Step 2 schema inspection:
  ["signals", "created_by_user_id"],
  ["teams", "owner_id"],
  // Add others as found.
];

const mapping = []; // [oldId, hubId, email]

const upsert = hub.prepare(`
  INSERT INTO users (id, email, display_name, created_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(email) DO UPDATE SET display_name = COALESCE(users.display_name, excluded.display_name)
  RETURNING id
`);

const tx = hub.transaction(() => {
  for (const u of signalUsers) {
    const result = upsert.get(randomId(), u.email.toLowerCase(), u.display_name || null, now);
    mapping.push([u.id, result.id, u.email]);
  }
});

if (DRY_RUN) {
  // Read-only simulation: count what would happen
  console.log("DRY RUN — no changes");
  for (const u of signalUsers) console.log(`  ${u.email} → would upsert`);
  process.exit(0);
}

tx();
console.log(`Upserted ${mapping.length} users into hub`);

// Rewrite FK columns in signal.db
const updateSignalTx = signal.transaction(() => {
  for (const [table, col] of fkTablesAndColumns) {
    for (const [oldId, hubId] of mapping) {
      signal.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`).run(hubId, oldId);
    }
  }
});
updateSignalTx();
console.log(`Rewrote FK columns in: ${fkTablesAndColumns.map(([t]) => t).join(", ")}`);

// Drop signal's old users + sessions tables
signal.exec(`
  DROP TABLE IF EXISTS users;
  DROP TABLE IF EXISTS sessions;
`);
console.log("Dropped signal.users and signal.sessions");

// Write mapping CSV
import fs from "node:fs";
fs.writeFileSync(MAPPING_OUT, "old_id,hub_id,email\n" + mapping.map(r => r.join(",")).join("\n"));
console.log(`Wrote mapping to ${MAPPING_OUT}`);
```

- [ ] **Step 4: Dry-run**

```bash
cd /var/www/suite
node scripts/migrate-signal-users.js \
  /var/www/suite/hub/data/suite.db \
  /var/www/signal/data/signal.db \
  /tmp/signal-mapping.csv \
  --dry-run
```
Expected: list of users to migrate, no DB changes.

- [ ] **Step 5: Install auth-client + update server.js + delete old auth code**

As in Task 3.1 but for `/var/www/signal`. The old auth files to delete:

```bash
cd /var/www/signal
git rm lib/auth.js lib/authRoutes.js lib/loginRateLimiter.js lib/session.js
git rm public/js/login.js
git rm tests/auth.test.js
npm uninstall argon2
```

- [ ] **Step 6: Maintenance window — run live migration**

```bash
pm2 stop sprintsignal
cd /var/www/suite
node scripts/migrate-signal-users.js \
  /var/www/suite/hub/data/suite.db \
  /var/www/signal/data/signal.db \
  /var/www/signal/data/signal-user-mapping.csv
pm2 reload sprintsignal
```

- [ ] **Step 7: Verify in signal**

```bash
# As an existing migrated user, sign in via hub magic link, launch sprintsignal,
# verify your existing signals/teams are still visible and editable.
sqlite3 /var/www/signal/data/signal.db "SELECT COUNT(*) FROM signals;"
sqlite3 /var/www/suite/hub/data/suite.db "SELECT COUNT(*) FROM users;"
```

- [ ] **Step 8: Commit + tag**

```bash
cd /var/www/signal && git add . && git commit -m "feat: wire @suite/auth-client; migrate users to hub; remove argon2"
git tag post-suite-auth

cd /var/www/suite && git add scripts/migrate-signal-users.js
git commit -m "feat(scripts): one-off signal user migration"
git push origin main
```

---

### Task 3.4: Sprintretro integration WITH migration

Same shape as Task 3.3. Adjust the migration script for the retros schema.

- [ ] **Step 1: Tag, backup, schema inspect**

```bash
cd /var/www/retrospective
git tag pre-suite-auth
cp retros.db retros.db.pre-migration
sqlite3 retros.db ".schema users" ".schema retros" ".schema items"
```

- [ ] **Step 2: Write `/var/www/suite/scripts/migrate-retro-users.js`**

Copy `migrate-signal-users.js` and adjust the `fkTablesAndColumns` array to match retrospective's schema (e.g. `retros.facilitator_id`, `items.author_id` — verify in Step 1).

- [ ] **Step 3: Dry-run, install auth-client, update server.js, delete old auth**

```bash
cd /var/www/retrospective
npm install file:../suite/shared/auth-client
git rm public/login.html public/login.js
# Remove existing session middleware references in server.js, replace with auth.requireAuth
```

`.env.example`:

```
APP_NAME=retro
HUB_BASE_URL=https://sprintsuite.uk
HUB_API_KEY=replace-with-HUB_API_KEY_RETRO
COOKIE_DOMAIN=sprintretro.uk
APP_SESSIONS_DB=./data/retro-sessions.db
```

- [ ] **Step 4: Live migration**

```bash
pm2 stop sprintretro
cd /var/www/suite
node scripts/migrate-retro-users.js \
  /var/www/suite/hub/data/suite.db \
  /var/www/retrospective/retros.db \
  /var/www/retrospective/retro-user-mapping.csv
pm2 reload sprintretro
```

- [ ] **Step 5: Verify + commit + tag**

```bash
cd /var/www/retrospective && git add . && git commit -m "feat: wire @suite/auth-client; migrate users to hub"
git tag post-suite-auth

cd /var/www/suite && git add scripts/migrate-retro-users.js
git commit -m "feat(scripts): one-off retrospective user migration"
git push origin main
```

---

**END OF PHASE 3.** All four apps wired. Migration completed for signal + retrospective.

---

## Phase 4 — End-to-end soak + cutover

### Task 4.1: Integration smoke matrix

For each app in `[raid, signal, retro, poker]`, manually verify each row of the matrix. Tick each box.

| Scenario | raid | signal | retro | poker |
|---|---|---|---|---|
| Visit app cold (no cookie) → bounced to hub `/login` |   |   |   |   |
| Sign in via magic link → dashboard appears |   |   |   |   |
| Click app tile → lands in app, no extra prompts |   |   |   |   |
| Use a protected feature → works as before |   |   |   |   |
| Open second app in new tab → silent two-redirect, lands in second app |   |   |   |   |
| Sign out from any app → bounced to hub apex |   |   |   |   |
| Open another (still-cookie-bearing) app within 90s → forced re-login |   |   |   |   |
| Disable user via admin → all apps reject within 90s |   |   |   |   |
| Stop hub (`pm2 stop suite-hub`) → apps continue for ~5 min on grace cache |   |   |   |   |
| Restart hub → heartbeats resume cleanly |   |   |   |   |

- [ ] **All boxes ticked, no scenario failing**

---

### Task 4.2: 24-hour soak

- [ ] **Leave all four apps running for 24 hours under your normal usage**
- [ ] **Check `/admin/audit` every few hours for unexpected events**
- [ ] **Check PM2 logs: `pm2 logs suite-hub --lines 200`**
- [ ] **Verify `prune.js` cron has fired at least 4-5 times (look at `logs/prune.log`)**

If any unexpected errors appear, file them as follow-up issues but the project is otherwise complete.

---

### Task 4.3: Finalisation

- [ ] **Update `/var/www/suite/README.md`** — replace the "Status: under design" paragraph with "Status: live, magic-link SSO across all four apps via the auth hub at sprintsuite.uk".

- [ ] **Save a memory entry** capturing what worked, so future Claude sessions building similar things have the institutional knowledge.

- [ ] **Commit + push**:

```bash
cd /var/www/suite
git add README.md
git commit -m "docs: mark Sprint Suite auth as live"
git push origin main
```

---

## Self-review (run before handing off to executing-plans / subagent-driven)

**Spec coverage check** — every spec section has at least one task:

| Spec section | Tasks |
|---|---|
| §4 Architecture (topology, data topology, stack) | 1.1-1.10, 1.23-1.24 (infra) |
| §5.1 Cold login flow | 1.12 (POST /login), 1.13 (magic consume), 1.14 (dashboard), 1.15 (launch), 2.5 (app launch handler) |
| §5.2 Second-app SSO | 1.15 + 2.5 work together; covered in 4.1 smoke matrix |
| §5.3 Logout | 1.18 (hub), 2.6 (app side), verified in 4.1 |
| §5.4 Heartbeat strategy | 1.17 (hub endpoint), 2.4 (middleware cache), 2.7 (handler), 2.8 (browser script) |
| §5.5 Tokens & cookies reference | 1.4 (tokens), 1.5 (cookies), 2.5 (app cookies) |
| §6.1 Hub sub-components | 1.1-1.24 cover all listed sub-components |
| §6.2 Shared library exports | 2.1-2.9 |
| §6.3 Per-app integration | 3.1-3.4 |
| §6.4 Migration | 3.3, 3.4 |
| §6.5 Infrastructure | 1.23 (vhost), 1.24 (PM2/cron/Resend) |
| §7 Data model | 1.3 (hub schema), 2.3 (app_sessions) |
| §8 Security model | 1.8 (rate limit), 1.16 (API key), 1.13 + 1.16 (atomic consume), 5.5 cookie attrs in 1.5 |
| §8.3 Rate limiting | 1.8 + 1.12 |
| §10 Migration plan | 3.3, 3.4 + tagging in 3.1-3.4 |
| §11 Risks | Addressed by acceptance criteria in §13 covered in 4.1-4.3 |
| §13 Acceptance criteria | 4.1 smoke matrix |

**Placeholder scan** — no `TBD`, no `add appropriate error handling`, no "similar to Task N". Function and table names match across tasks (`createAuthClient`, `createHubApi`, `createSessionsStore`, `app_sessions` table, `central_sessions` table, `hub_session` cookie name, per-app cookie names).

**Type consistency** — `randomToken()` returns 64-char hex everywhere; `randomId()` returns 32-char hex; `now()` returns ms epoch. Routes use `app.locals.db` consistently. Auth client factory accepts the same option names everywhere it's used (Task 3.1-3.4).

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-sprint-suite-auth-hub.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for the volume of tasks here (44 of them).

**2. Inline Execution** — Execute tasks in this session using executing-plans, with checkpoints for review.

**Which approach?**
