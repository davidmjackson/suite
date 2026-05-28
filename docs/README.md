# Documentation

Architecture and operational documents for the Sprint Suite.

## Files in this directory

- `claude.md`, integration specification for Claude Code CLI
- `clerk_setup.md`, manual runbook for Clerk dashboard setup
- `rollback.md`, recovery procedures if integration breaks production
- `workspacesetup.md`, workspace bootstrap (this directory's parent setup)

## When to use which

- **Before any integration work:** Read all three of the above plus this README
- **Setting up Clerk:** `clerk_setup.md` (manual, ~60 min)
- **Running the integration:** `claude.md` (Claude Code, ~3-4 hours per app)
- **Something broke:** `rollback.md`
