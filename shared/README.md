# Shared Code

Cross-app modules used by all four Sprint apps.

Planned contents:
- `auth/`, Clerk JWT middleware (see ../docs/claude.md, Section 6)
- `utils/`, common helpers as they emerge

Each subpackage should be a proper npm package so apps can install it via local file reference or eventual private registry.
