---
name: prisma-flyway-contract-update
description: End-to-end database contract updates for this repository across Prisma and Flyway. Use when adding/changing/removing DB-backed fields, models, tables, enums, or relations; when fixing Prisma runtime schema errors (missing column/table/type); or when reconciling drift between Prisma schema and live PostgreSQL.
---

# Prisma Flyway Contract Update

## Overview

Enforce schema changes as a contract update across Prisma and Flyway, then prove the live DB and generated client match.

## Workflow

1. State root cause and invariant first.
Define the invariant that must hold (for example, "every Prisma-selected column exists in Postgres"), identify what broke it, and identify which caller or migration path owns the missing field.

2. Audit call sites before changing schema.
Trace reads/writes for required fields. Require real values from callers. Do not invent fallback defaults to mask missing data.

3. Update Prisma schema contract.
Edit `prisma/schema.prisma` for model/enum/relation changes and keep mapped DB names accurate (`@map`, `@@map`).
- Database naming convention is lower snake_case for tables/columns/enum type names.
- If Prisma enum/model names differ (PascalCase/camelCase), map them explicitly to DB names (`@@map("snake_case_name")`, `@map("snake_case_name")`).

4. Regenerate Prisma client immediately after schema edits.
Run:
```bash
pnpm db:generate
```
Do not use `prisma migrate *` commands in this repository.

5. Add a new forward-only Flyway migration.
Create a new file in `db/flyway/` with chronological versioning. Never edit existing `V*` or `B*` files.
- Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for backfills/drift repair.
- Use guarded `DO $$ ... IF NOT EXISTS ... $$` blocks for enum types and constraints.
- Create enum types in lower snake_case (for example `task_type`) and keep Prisma enum mapping aligned.
- Create missing indexes/FKs idempotently.
- For enum additions used in defaults, split into two migrations (add enum value first, set default second).

6. Ask before apply.
Before running any apply command (especially `migrate`), ask the user for explicit approval to apply DB changes.

7. Run Flyway with explicit CLI args every time.
Use the bundled wrapper:
```bash
bash .codex/skills/prisma-flyway-contract-update/scripts/run_flyway.sh info
bash .codex/skills/prisma-flyway-contract-update/scripts/run_flyway.sh validate
bash .codex/skills/prisma-flyway-contract-update/scripts/run_flyway.sh migrate
```
Avoid relying on project package wrappers if they are missing or misconfigured.

8. Verify live DB shape after migrate.
Run targeted SQL checks (via `psql`) for changed tables/columns/indexes/enums and confirm Flyway history contains the new migration as `Success`.

9. Handle baseline drift explicitly.
If `flyway info` shows baseline `1` and a `B...` file is `Ignored`, treat it as expected cutover behavior and create a new forward-only backfill migration. Do not edit the baseline file.

10. Finish with type safety gate.
Run:
```bash
pnpm tsc --noEmit
```
Fix errors and rerun until it passes.

## Hard Rule

- Always ask the user before running DB apply commands that mutate schema/data (for example Flyway `migrate`).
