# ADR-NNN: SQLite database files live in `/var/lib/<service>`, not the app deploy tree

> Renumber `NNN` to fit your existing ADR sequence.

## Status

Accepted. **Hub migrated and verified live on 2026-06-10** (`/var/www/suite/hub/data/suite.db` → `/var/lib/suite-hub/suite.db`; code tree now read-only). Raid and Poker still pending — runbooks below.

## Context

The suite runs five Node apps, all using SQLite via `better-sqlite3` in WAL mode. Database files are split across two location conventions today:

- **`/var/lib/<app>` (correct):** Signal (`/var/lib/signal`), Retro (`/var/lib/retrospective`)
- **`/var/www/<app>/data` (suboptimal):** Hub (`/var/www/suite/hub/data/suite.db`), Raid (`/var/www/raid/data/raid-sessions.db`), Poker (`/var/www/scrumpoker/data/poker-sessions.db`)

The Filesystem Hierarchy Standard is explicit: `/var/lib/<service>` holds **variable program state** (databases, persistent data a service writes), while `/var/www` holds **web content served to clients**. A SQLite DB is state, not served content.

Co-locating state inside the deploy tree costs us four concrete things:

1. **Weaker hardening.** Under `ProtectSystem=full`, an app whose DB sits in its code dir must declare `ReadWritePaths=/var/www/<app>`, which makes the service's **own code writable**. Moving the DB out lets the entire code tree stay read-only.
2. **Deploy fragility.** State living inside a git checkout is exposed to `git clean -fdx`, a fresh re-clone, or an rsync `--delete`. The `data/` dirs are gitignored, but that does not protect them from those operations.
3. **Ownership conflicts.** A `davidj`-owned checkout vs. a dedicated service user creates EACCES traps. This already bites Signal's audit log (file owned by `davidj`, service runs as `signal`). Poker is most exposed (`User=davidj, Group=www-data`).
4. **Backup blind spots.** A job pointed at `/var/lib` silently misses three apps. One convention means one runbook.

The Hub is the highest-value target: `suite.db` is the irreplaceable identity, company, and entitlement store for the whole suite, and it currently sits in the least-protected location.

## Decision

Standardize on a single convention:

- Every app's SQLite files (domain DB **and** auth-client session DB) live under **`/var/lib/<service-user>/`**, owned by the service user, mode `0750`.
- systemd uses **`StateDirectory=<service-user>`** (auto-creates the dir, sets ownership, adds it to `ReadWritePaths`) or, if set explicitly, `ReadWritePaths=/var/lib/<service-user>`. The code tree under `/var/www` becomes read-only.
- `DB_PATH` / `APP_SESSIONS_DB` are set to **absolute** `/var/lib` paths.

Migration order by value at risk:

1. **Hub first** (irreplaceable data, weakest spot). Runbook below.
2. **Raid and Poker** for consistency, when convenient. Both are session-cache-only, so a botched move forces re-launches, not data loss.
3. **Signal and Retro** already conform. No action.

## Cost & Licensing

- **N/A.** This is a filesystem convention. No new tool, service, or library is introduced.
- SQLite (public domain) and `better-sqlite3` (MIT) are unchanged.
- **Recurring cost:** zero.
- **One-time cost:** minutes per app, plus one short maintenance window for the Hub (the whole suite's auth depends on it, so it cannot move live).

## Consequences

**Positive**

- Stronger hardening: code tree read-only under `ProtectSystem=full`.
- Deploy-safe: state survives re-clone, clean, and rsync `--delete`.
- One backup runbook (`/var/lib/*`).
- Clears the ownership class of bug (Signal's audit-log EACCES).

**Negative / harder**

- Absolute paths in config (small loss of the relative-path "works from any WorkingDirectory" convenience).
- One-time maintenance window for the Hub.
- During transition the suite points at two path roots. Finish the migration; do not leave it half-done.

## Why Not the Alternatives

- **Keep `/var/www/<app>/data` (status quo for 3 apps).** Strongest case: one tree per app is simple to reason about and `chmod`; relative `DB_PATH=./data/...` works straight from `WorkingDirectory`; fine for throwaway caches. **Passed** because the case is weakest exactly at the Hub (irreplaceable data, least protection), and one convention across five apps beats per-app convenience.
- **Central shared dir, e.g. `/var/lib/sprintsuite/<app>`.** Strongest case: a single backup root, visually tidy. **Passed** because it muddies per-service ownership; `StateDirectory=` maps 1:1 to a service user, not a shared parent. Per-service dirs keep blast radius and permissions clean.
- **Move only the Hub, leave Raid and Poker.** Strongest case: least work, fixes the highest-value risk. **Passed** because it leaves the suite with three conventions instead of one. Raid and Poker are cheap to move and consistency is the whole point.

---

# Hub Migration Runbook

**Target:** `/var/www/suite/hub/data/suite.db` → `/var/lib/suite-hub/suite.db`
(`suite-hub` matches the existing service user, mirroring Signal/Retro.)

## 1. Pre-flight (verify on the box, do not trust docs)

```bash
systemctl cat suite-hub                 # confirm User, WorkingDirectory, ReadWritePaths, EnvironmentFile
grep DB_PATH /var/www/suite/hub/.env    # confirm current path
ls -la /var/www/suite/hub/data/         # confirm suite.db (+ -wal, -shm), ownership
id suite-hub                            # confirm the service user exists
```

## 2. Stop and back up

```bash
systemctl stop suite-hub
tar czf /root/suite-db-backup-$(date +%F).tgz -C /var/www/suite/hub/data \
  suite.db suite.db-wal suite.db-shm 2>/dev/null \
  || tar czf /root/suite-db-backup-$(date +%F).tgz -C /var/www/suite/hub/data suite.db
```

**Why stop first:** WAL mode means recent commits may sit in `suite.db-wal`, not the main file. Stopping the service lets `better-sqlite3` close cleanly. **Observed on the live Hub (2026-06-10):** the clean stop did *not* checkpoint — `suite.db` was days stale (224K) while a **4 MB `suite.db-wal` persisted with all recent commits**. So copying `-wal` (and `-shm`) alongside `suite.db` is **essential, not optional** — SQLite replays the WAL on first open at the new path. Do not copy `suite.db` alone. (Copy the live trio *explicitly*, not a `suite.db*` glob, so historical `*.pre-identity-v2` / `*.bak` siblings don't follow into the clean target dir.)

## 3. Copy (do not move, so rollback is trivial)

If you add `StateDirectory=suite-hub` to the unit (step 5, recommended), systemd creates `/var/lib/suite-hub` owned by the service user on next start — skip the `install -d` and just copy into it after. Otherwise create it explicitly:

```bash
install -d -o suite-hub -g suite-hub -m 0750 /var/lib/suite-hub
cp -av /var/www/suite/hub/data/suite.db* /var/lib/suite-hub/
chown suite-hub:suite-hub /var/lib/suite-hub/suite.db*
```

## 4. Update config

```ini
# /var/www/suite/hub/.env
DB_PATH=/var/lib/suite-hub/suite.db
```

(The app reads env from systemd's `EnvironmentFile`; no dotenv, no code change.)

## 5. Update the systemd unit

The hub unit **is** tracked in the repo at `hub/deploy/systemd/suite-hub.service` (the live copy is at `/etc/systemd/system/suite-hub.service` — edit whichever your deploy applies; keep them in sync):

- **Recommended:** add `StateDirectory=suite-hub` and **delete** `ReadWritePaths=/var/www/suite/hub`. `StateDirectory` creates `/var/lib/suite-hub`, owns it as the service user, and adds it to `ReadWritePaths` in one directive. With `data/` now the only thing the hub wrote in-tree (pino logs go to stdout/journald — there is no `logs/` dir), dropping `ReadWritePaths` makes the whole code tree read-only under `ProtectSystem=full`. That is the entire hardening payoff.
- Alternatively, if you created `/var/lib/suite-hub` by hand in step 3, just replace `ReadWritePaths=/var/www/suite/hub` with `ReadWritePaths=/var/lib/suite-hub`.
- While editing, delete the stale unit comment that says the hub "writes to its sqlite DB under data/ and to logs/" — the `logs/` half is no longer true post-pino.

```bash
systemctl daemon-reload
systemctl start suite-hub
```

## 6. Verify (prove it reads the moved DB, not a fresh empty one)

```bash
curl -s localhost:3000/healthz                  # {"ok":true} — confirm the real bind port first
journalctl -u suite-hub -n 50 --no-pager        # clean boot, migrations ran, no DB-open errors
```

- Sign in for real and check `/admin` shows your existing users / companies / audit events.
- Confirm new `suite.db-wal` / `suite.db-shm` siblings appear in `/var/lib/suite-hub` after a write.

## 7. Clean up (only after verified; keep the backup a while)

```bash
rm /var/www/suite/hub/data/suite.db*
# optionally remove the now-empty data/ dir
```

## Rollback (originals untouched until step 7)

```bash
systemctl stop suite-hub
# revert DB_PATH in .env, revert ReadWritePaths in the unit
systemctl daemon-reload
systemctl start suite-hub
```

## Notes

- **Migrations are safe to re-run.** They run on every boot and are idempotent (including `004`'s backfill), so booting against the moved DB needs no special handling.
- **Port discrepancy.** Docs disagree: `.env` says `3000`, Apache/`.env.example`/systemd comments say `3004`. Confirm the live bind before curling `/healthz`.
- **Raid and Poker** follow the same pattern. Full runbooks below.

---

# Raid Migration Runbook

**Target:** `/var/www/raid/data/raid-sessions.db` → `/var/lib/raid/raid-sessions.db`

**This is a session cache, not a domain DB.** Raid persists no user content. The data is fully reconstructable: if you lose it, users just re-launch from the hub. That makes the copy step (step 3) optional and means there is no real backup imperative. Still stop the service for a clean move.

## 1. Pre-flight

```bash
systemctl show raid -p User -p ExecStart -p WorkingDirectory
systemctl cat raid                      # confirm ReadWritePaths + EnvironmentFile
grep -E 'APP_SESSIONS_DB|HUB' /var/www/raid/.env
ls -la /var/www/raid/data/
```

> **Run-as user is uncertain.** The unit declares `User=raid`, but suite memory records it historically running as `davidj`. Trust `systemctl show raid -p User`, and use that user for the `chown` below.

## 2. Stop

```bash
systemctl stop raid
```

## 3. Copy (optional; skip to recreate empty and accept re-launches)

```bash
install -d -o raid -g raid -m 0750 /var/lib/raid          # use the real service user
cp -av /var/www/raid/data/raid-sessions.db* /var/lib/raid/ 2>/dev/null || true
chown raid:raid /var/lib/raid/raid-sessions.db* 2>/dev/null || true
```

## 4. Update config

```ini
# /var/www/raid/.env
APP_SESSIONS_DB=/var/lib/raid/raid-sessions.db
```

(Default is `./data/raid-sessions.db`, so this key may be absent today. Add it.)

## 5. Update the systemd unit

**Note:** unlike the hub, Raid's unit is **not** tracked in this repo. Edit the live unit on the box (`systemctl cat raid` shows its path, typically `/etc/systemd/system/raid.service`):

- Replace `ReadWritePaths=/var/www/raid` with `ReadWritePaths=/var/lib/raid`
- Optional and recommended: add `StateDirectory=raid` (creates + owns `/var/lib/raid` and adds it to `ReadWritePaths` in one directive — then the explicit `ReadWritePaths` line is unnecessary)

```bash
systemctl daemon-reload
systemctl start raid
```

## 6. Verify

```bash
curl -s localhost:3003/health           # {"ok":true,"model":...}
journalctl -u raid -n 50 --no-pager     # clean boot, session store opens at the new path
```

Launch Raid from the hub and confirm a successful sign-in plus one extraction (or just that `/` loads authed). A new `raid-sessions.db` appears under `/var/lib/raid`.

## 7. Clean up

```bash
rm -f /var/www/raid/data/raid-sessions.db*
```

**Rollback:** revert `APP_SESSIONS_DB` and `ReadWritePaths`, `daemon-reload`, restart. Or do nothing and let users re-launch.

---

# Poker Migration Runbook

**Target:** `/var/www/scrumpoker/data/poker-sessions.db` → `/var/lib/scrumpoker/poker-sessions.db`

**Also a session cache** (rooms are in-memory, lost on every restart anyway). Same reconstructable-data caveat as Raid: the copy step is optional.

Two Poker-specific complications, both flagged in the architecture doc:

1. **No confirmed `EnvironmentFile`.** The unit sets only `Environment=PORT=3000` inline; how `HUB_API_KEY` / `APP_SESSIONS_DB` reach the process on prod is unverified (memory says `/etc/scrumpoker.env`). You must establish where env is sourced before changing `APP_SESSIONS_DB`.
2. **Runs as `davidj:www-data`, not a dedicated user.** That is itself a deviation from the suite convention. This move is a good moment to consider giving Poker its own `scrumpoker` system user, but that is out of scope here. For now, own the new dir to match the live service user.

The hardening payoff is also smaller here: Poker's unit reads as a "dev server" and does not show `ProtectSystem=full` / `ReadWritePaths` in the docs, so the main wins are deploy safety and convention consistency, not blast-radius reduction.

## 1. Pre-flight

```bash
systemctl show scrumpoker -p User -p Group -p EnvironmentFiles -p ExecStart
systemctl cat scrumpoker                 # look for any EnvironmentFile / drop-ins
ls -la /var/www/scrumpoker/data/ 2>/dev/null    # may not exist until first launch
```

If `EnvironmentFiles` is empty, decide your source: add `Environment=APP_SESSIONS_DB=...` inline (mirrors how `PORT` is already set), or introduce a real `EnvironmentFile`.

## 2. Stop

```bash
systemctl stop scrumpoker
```

## 3. Copy (optional)

```bash
install -d -o davidj -g www-data -m 0750 /var/lib/scrumpoker     # match the real service user/group
cp -av /var/www/scrumpoker/data/poker-sessions.db* /var/lib/scrumpoker/ 2>/dev/null || true
chown davidj:www-data /var/lib/scrumpoker/poker-sessions.db* 2>/dev/null || true
```

## 4 + 5. Set the path and update the unit

**Note:** Poker's unit is **not** tracked in this repo either. Edit the live unit on the box (`systemctl cat scrumpoker`). Alongside the existing `Environment=PORT=3000`:

```ini
Environment=APP_SESSIONS_DB=/var/lib/scrumpoker/poker-sessions.db
StateDirectory=scrumpoker
```

(`StateDirectory=scrumpoker` creates `/var/lib/scrumpoker`, owns it as the service user, and adds it to `ReadWritePaths` in one directive. If you instead use an `EnvironmentFile`, put `APP_SESSIONS_DB` there.)

```bash
systemctl daemon-reload
systemctl start scrumpoker
```

## 6. Verify

```bash
curl -s localhost:3000/health            # {status, version, rooms, ...} — confirm the real bind port first
journalctl -u scrumpoker -n 50 --no-pager
```

Launch Poker from the hub, create a room, confirm a vote/reveal cycle. A new `poker-sessions.db` appears under `/var/lib/scrumpoker`.

## 7. Clean up

```bash
rm -f /var/www/scrumpoker/data/poker-sessions.db*
```

**Rollback:** revert the `APP_SESSIONS_DB` line and `StateDirectory`, `daemon-reload`, restart. Live rooms are wiped on any restart regardless, so time the move for a quiet period.

## Poker notes

- **Port:** prod forces `3000` inline; code default is `3005`. Confirm the live bind before the health check.
- **Don't conflate with the vhost/env mysteries.** The unresolved Apache TLS vhost and env-file location are separate open items; this runbook only moves the session DB. If launch breaks after the move, first confirm `HUB_API_KEY` / `HUB_BASE_URL` still reach the process (the env-source question), not the DB path.
