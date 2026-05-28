# Sprint Suite, Workspace Setup

> **For:** Claude Code CLI
> **Purpose:** Create the `suite` umbrella project, multi-root VS Code workspace, and put existing apps under git protection before any Clerk integration work begins.
> **Run from:** WSL Ubuntu, any working directory
> **Estimated time:** 5-10 minutes

This is a **safety and structure** task. No application code is touched. After this runs, the four existing apps are git-protected, a new umbrella project exists, and a VS Code multi-root workspace ties them together.

---

## 1. Pre-flight Checks

Run and report the output of all commands in this section before proceeding.

```bash
# Confirm we're in WSL
uname -a
cat /etc/os-release | head -3

# Confirm the four app directories exist
ls -la /var/www/scrumpoker /var/www/retrospective /var/www/signal /var/www/raid

# Confirm git is installed
git --version

# Check current git status of each app
for app in scrumpoker retrospective signal raid; do
  echo "=== /var/www/$app ==="
  if [ -d "/var/www/$app/.git" ]; then
    cd /var/www/$app && git status --short && git log --oneline -1
  else
    echo "NOT a git repo"
  fi
done

# Confirm /var/www is writable by current user
touch /var/www/.write-test && rm /var/www/.write-test && echo "writable" || echo "needs sudo"
```

**Stop and report** if:
- Any of the four app directories are missing
- `/var/www` is not writable (we'll need to address permissions before continuing)
- Git is not installed

**Do not proceed** until pre-flight is clean.

---

## 2. Protect the Existing Apps with Git

For each of the four apps, ensure git is initialised and a baseline commit exists. This is a hard prerequisite for the rollback plan to work.

```bash
for app in scrumpoker retrospective signal raid; do
  cd /var/www/$app

  if [ ! -d ".git" ]; then
    echo "=== Initialising git in /var/www/$app ==="
    git init

    # Create a sensible .gitignore if none exists
    if [ ! -f ".gitignore" ]; then
      cat > .gitignore << 'EOF'
node_modules/
.env
.env.local
.env.*.local
*.log
.DS_Store
dist/
build/
.vscode/
.idea/
EOF
    fi

    # Configure git identity locally if not set globally
    if [ -z "$(git config user.email)" ]; then
      git config user.email "dev@sprintsuite.uk"
      git config user.name "Sprint Suite Dev"
    fi

    git add -A
    git commit -m "Initial baseline before Clerk integration"
    git tag pre-clerk-baseline
    echo "✓ /var/www/$app, initialised and tagged"
  else
    echo "=== /var/www/$app already a git repo ==="
    # Add baseline tag if it doesn't exist
    if ! git rev-parse pre-clerk-baseline >/dev/null 2>&1; then
      # Commit any uncommitted changes first
      if [ -n "$(git status --porcelain)" ]; then
        git add -A
        git commit -m "Snapshot before Clerk integration"
      fi
      git tag pre-clerk-baseline
      echo "✓ tagged current HEAD as pre-clerk-baseline"
    else
      echo "  pre-clerk-baseline tag already exists, skipping"
    fi
  fi
done
```

### Verification

```bash
for app in scrumpoker retrospective signal raid; do
  echo "=== /var/www/$app ==="
  cd /var/www/$app
  git log --oneline -3
  git tag | grep pre-clerk-baseline || echo "WARNING, no baseline tag"
done
```

**Each app must have:**
- A `.git` directory
- At least one commit
- A `pre-clerk-baseline` tag

**Stop and report** if any app is missing these.

---

## 3. Create the Umbrella Project

```bash
# Create the directory structure
mkdir -p /var/www/suite/{marketing,docs,shared,infrastructure,scripts}

cd /var/www/suite
```

### 3.1 Create README

```bash
cat > /var/www/suite/README.md << 'EOF'
# Sprint Suite

Umbrella project for the Sprint agile toolkit. Centralises shared concerns (auth, infrastructure, marketing, documentation) across the four applications.

## Apps in the suite

| App | Path | Live Domain | Purpose |
|---|---|---|---|
| Sprintpoker | `/var/www/scrumpoker` | sprintpoker.uk | Planning poker |
| Sprintretro | `/var/www/retrospective` | sprintretro.uk | Retrospectives |
| Sprintsignal | `/var/www/signal` | sprintsignal.uk | Team signals |
| Sprintraid | `/var/www/raid` | sprintraid.uk | Risks, Assumptions, Issues, Dependencies |

## Domains

- `sprintsuite.uk`, umbrella brand and marketing
- `auth.sprintsuite.uk`, Clerk-hosted login (centralised identity)
- The four `.uk` domains above for the apps themselves

## Repository Layout

```
suite/
├── docs/              Architecture, runbooks, rollback plans
├── marketing/         Landing page for sprintsuite.uk
├── shared/            Shared code (auth middleware, common utilities)
├── infrastructure/    Apache configs, deployment scripts
├── scripts/           Operational scripts (health checks, etc.)
└── README.md
```

## Key Documents

All under `docs/`:
- `claude.md`, integration spec for Clerk-based auth
- `clerk_setup.md`, manual runbook for Clerk dashboard
- `rollback.md`, recovery procedures
EOF
```

### 3.2 Create .gitignore

```bash
cat > /var/www/suite/.gitignore << 'EOF'
node_modules/
.env
.env.local
.env.*.local
*.log
.DS_Store
dist/
build/
.vscode/
.idea/
*.swp
EOF
```

### 3.3 Placeholder READMEs in Subdirectories

So the directories survive the initial git commit and the intent of each is clear:

```bash
cat > /var/www/suite/marketing/README.md << 'EOF'
# Marketing Site

Landing page for `sprintsuite.uk`. To be developed.

Suggested initial content:
- Hero section introducing the Sprint suite
- Cards linking to each of the four apps
- Sign-in CTA pointing to auth.sprintsuite.uk
EOF

cat > /var/www/suite/shared/README.md << 'EOF'
# Shared Code

Cross-app modules used by all four Sprint apps.

Planned contents:
- `auth/`, Clerk JWT middleware (see ../docs/claude.md, Section 6)
- `utils/`, common helpers as they emerge

Each subpackage should be a proper npm package so apps can install it via local file reference or eventual private registry.
EOF

cat > /var/www/suite/infrastructure/README.md << 'EOF'
# Infrastructure

Server-side configuration and deployment artefacts.

Planned contents:
- `apache/`, vhost config templates for the four apps
- `pm2/`, ecosystem files for process management
- `dns/`, reference DNS records per domain
EOF

cat > /var/www/suite/scripts/README.md << 'EOF'
# Operational Scripts

Utility scripts for day-to-day operations.

Planned contents:
- `healthcheck.sh`, see ../docs/rollback.md Section 2.2
- `backup-apache-config.sh`, snapshots /etc/apache2 before changes
- `deploy.sh`, deployment helper (future)
EOF

cat > /var/www/suite/docs/README.md << 'EOF'
# Documentation

Architecture and operational documents for the Sprint Suite.

## Files in this directory

- `claude.md`, integration specification for Claude Code CLI
- `clerk_setup.md`, manual runbook for Clerk dashboard setup
- `rollback.md`, recovery procedures if integration breaks production
- `workspacesetup.md`, this file, workspace bootstrap

## When to use which

- **Before any integration work:** Read all three of the above plus this README
- **Setting up Clerk:** `clerk_setup.md` (manual, ~60 min)
- **Running the integration:** `claude.md` (Claude Code, ~3-4 hours per app)
- **Something broke:** `rollback.md`
EOF
```

### 3.4 Place the Three Architecture Documents

The three documents (`claude.md`, `clerk_setup.md`, `rollback.md`) live in `/var/www/suite/docs/`.

```bash
# Expected destination
echo "Documents should be at:"
echo "  /var/www/suite/docs/claude.md"
echo "  /var/www/suite/docs/clerk_setup.md"
echo "  /var/www/suite/docs/rollback.md"

# Verify
ls -la /var/www/suite/docs/
```

If the user doesn't have them locally, **stop and report** so they can drop the files in manually.

---

## 4. Create the Health Check Script

This is referenced by `rollback.md` Section 2.2 but lives in the umbrella project.

```bash
cat > /var/www/suite/scripts/healthcheck.sh << 'EOF'
#!/bin/bash
# Sprint Suite, Health Check
# Usage: sudo /var/www/suite/scripts/healthcheck.sh

echo "=== Sprint Suite Health Check ==="
echo "Time: $(date)"
echo ""

# HTTP status per site
echo "--- Site reachability ---"
for site in sprintpoker.uk sprintretro.uk sprintsignal.uk sprintraid.uk; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 https://$site)
  if [ "$code" = "200" ] || [ "$code" = "302" ]; then
    echo "  ✓ $site → $code"
  else
    echo "  ✗ $site → $code"
  fi
done

# Auth domain
echo ""
echo "--- Auth subdomain ---"
code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 https://auth.sprintsuite.uk)
if [ "$code" = "200" ] || [ "$code" = "302" ]; then
  echo "  ✓ auth.sprintsuite.uk → $code"
else
  echo "  ✗ auth.sprintsuite.uk → $code (not yet configured?)"
fi

# Node processes
echo ""
echo "--- Node processes (pm2) ---"
if command -v pm2 >/dev/null 2>&1; then
  pm2 list 2>/dev/null
else
  echo "  pm2 not installed yet"
fi

# Apache
echo ""
echo "--- Apache status ---"
systemctl is-active apache2

# Clerk reachability
echo ""
echo "--- External dependencies ---"
curl -s -o /dev/null -w "  Clerk API: %{http_code}\n" -m 5 https://api.clerk.com
EOF

chmod +x /var/www/suite/scripts/healthcheck.sh
```

---

## 5. Initialise Git for the Umbrella Project

```bash
cd /var/www/suite

git init

# Configure identity if needed
if [ -z "$(git config user.email)" ]; then
  git config user.email "dev@sprintsuite.uk"
  git config user.name "Sprint Suite Dev"
fi

git add -A
git commit -m "Initial suite umbrella project structure"
git tag v0.0.1-bootstrap
```

### Verification

```bash
cd /var/www/suite
git log --oneline
git tag
ls -la
ls -la docs/
ls -la scripts/
```

**Expected output:**
- One commit
- One tag (`v0.0.1-bootstrap`)
- Five subdirectories (`docs`, `marketing`, `shared`, `infrastructure`, `scripts`)
- Three architecture documents in `docs/` (assuming Section 3.4 completed)
- Executable healthcheck script in `scripts/`

---

## 6. Create the VS Code Multi-Root Workspace

```bash
cat > /var/www/suite/suite.code-workspace << 'EOF'
{
  "folders": [
    {
      "name": "🏠 Sprint Suite (Umbrella)",
      "path": "/var/www/suite"
    },
    {
      "name": "🎴 Sprintpoker",
      "path": "/var/www/scrumpoker"
    },
    {
      "name": "🔄 Sprintretro",
      "path": "/var/www/retrospective"
    },
    {
      "name": "📡 Sprintsignal",
      "path": "/var/www/signal"
    },
    {
      "name": "⚠️ Sprintraid",
      "path": "/var/www/raid"
    }
  ],
  "settings": {
    "files.exclude": {
      "**/node_modules": true,
      "**/.git": false
    },
    "search.exclude": {
      "**/node_modules": true,
      "**/dist": true,
      "**/build": true
    },
    "terminal.integrated.defaultProfile.linux": "bash",
    "editor.formatOnSave": false,
    "editor.tabSize": 2
  },
  "extensions": {
    "recommendations": [
      "ms-vscode-remote.remote-wsl",
      "dbaeumer.vscode-eslint",
      "esbenp.prettier-vscode",
      "eamodio.gitlens"
    ]
  }
}
EOF
```

---

## 7. Final Verification

Run the following and report all output:

```bash
echo "=== Directory structure ==="
tree -L 2 /var/www/suite 2>/dev/null || find /var/www/suite -maxdepth 2 -not -path '*/node_modules*'

echo ""
echo "=== Git status across all five projects ==="
for path in /var/www/suite /var/www/scrumpoker /var/www/retrospective /var/www/signal /var/www/raid; do
  echo "--- $path ---"
  cd $path
  git log --oneline -1
  git tag | head -5
done

echo ""
echo "=== Workspace file ==="
ls -la /var/www/suite/suite.code-workspace

echo ""
echo "=== Documents in place ==="
ls -la /var/www/suite/docs/

echo ""
echo "=== Health check script ==="
ls -la /var/www/suite/scripts/healthcheck.sh
```

---

## 8. Verification Checklist

Do not consider this task complete until every box is checked. Report each item explicitly.

- [ ] All four existing apps are git repositories with at least one commit
- [ ] All four existing apps have the `pre-clerk-baseline` tag
- [ ] `/var/www/suite/` exists with the five subdirectories
- [ ] `/var/www/suite/docs/` contains `claude.md`, `clerk_setup.md`, `rollback.md`
- [ ] `/var/www/suite/scripts/healthcheck.sh` exists and is executable
- [ ] `/var/www/suite/` is a git repository with at least one commit
- [ ] `/var/www/suite/suite.code-workspace` exists and is valid JSON
- [ ] Running `sudo /var/www/suite/scripts/healthcheck.sh` produces sensible output
- [ ] The user can open the workspace in VS Code (file → open workspace from file)

---

## 9. Reporting Back

After completing all sections, report to the user:

1. **What was created**, with paths
2. **What was verified**, with the relevant command output
3. **Any deviations** from this document and why
4. **The exact next step**, which is opening the workspace in VS Code:
   - In WSL: `code /var/www/suite/suite.code-workspace`
   - Or in VS Code: File → Open Workspace from File → select `suite.code-workspace`

---

## 10. What This Does NOT Do

To be explicit, this script does not:
- Install any dependencies (no npm install yet)
- Touch any application code
- Configure Apache
- Set up Clerk (that's manual, see clerk_setup.md)
- Install Node.js, pm2, or any system packages
- Take VM snapshots (user does that manually via Ionos panel)

Those steps come **after** the user runs through `clerk_setup.md`, then `claude.md` integration begins.

---

**End of workspace setup. Begin with Section 1, Pre-flight Checks.**
