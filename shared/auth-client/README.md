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
