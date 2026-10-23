# Flyway Migration Directory

This directory is the source of truth for database schema migrations after Prisma-to-Flyway cutover.

## Versions in this directory

- `B2026.02.18.0__baseline_schema.sql`: baseline snapshot before `PlanStepStatus.REFINING`.
- `V2026.02.18.1__add_plan_step_refining_status_value.sql`: adds enum value.
- `V2026.02.18.2__set_plan_steps_status_default_refining.sql`: sets default to `REFINING` in a follow-up migration.
- `V2026.02.24.1__add_coding_session_status.sql`: adds `CodingSessionStatus` enum and `coding_sessions.status` column.

## Existing database cutover (one-time)

```bash
pnpm db:flyway:baseline
pnpm db:flyway:validate
pnpm db:flyway:migrate
```

## Brand-new database bootstrap

```bash
pnpm db:flyway:validate
pnpm db:flyway:migrate
```

No baseline command is required for brand-new databases.

## Required environment variables

- `FLYWAY_URL`
- `FLYWAY_USER`
- `FLYWAY_PASSWORD`

## Linked worktrees

Linked Git worktrees use a deterministic database named from the worktree ID,
for example `hey_hey_wt_file_reference_<hash>`. The package commands load the
main checkout's local connection settings as a template, create the worktree
database when it is missing, copy the selected application schema and its data
from the main local development database with `pg_dump`/`pg_restore`, and replace both Prisma and
Flyway targets before running Flyway. The copied Flyway history is left on the
source database; only the worktree receives branch-specific migrations.

The initial dump/restore runs only when the deterministic worktree database is
absent. If the database already exists, preparation performs the normal target
checks and never restores the main database again, so worktree-only data is
preserved. A source database that is unavailable, resolves to the destination,
or cannot be restored/migrated safely produces an explicit error. A failure
during first-time cloning or Flyway initialization removes the newly created
worktree database when cleanup is possible.

```bash
pnpm worktree:context
pnpm worktree:doctor
pnpm db:worktree:ensure
pnpm db:worktree:prepare
pnpm db:flyway:migrate
pnpm db:flyway:validate
```

`db:worktree:prepare` is the public, idempotent preparation contract for an
external workspace runner. Invoke it from a linked API worktree with no
arguments; it fails closed from the main checkout so it cannot migrate the main
database. It initializes from the main database only on first creation, applies
the current checkout's migrations, and exits zero only when both steps succeed.
`db:worktree:ensure` is the lower-level clone-only command, while
`db:flyway:migrate` remains available for direct migration work. To
intentionally start over, drop the isolated database from the linked worktree
and run preparation again:

```bash
pnpm db:worktree:drop
pnpm db:worktree:prepare
```

Initialization requires `psql`, `pg_dump`, and `pg_restore`, local loopback
PostgreSQL, permission to create/drop databases, and permission to read the
main database. The dump is safe with active local connections because
`pg_dump` takes a consistent snapshot; PostgreSQL-native template cloning is
not used because it requires the source database to have no active connections.
The snapshot defaults to the schema named by `PROJECT_DATABASE_URL` (or
`public`). Set `HEY_HEY_WORKTREE_CLONE_SCHEMA` to copy a specific schema.
The source snapshot also contains its Flyway history. A linked worktree may be
older than the source and therefore lack migration files already applied there;
the wrapper ignores only those `missing` history entries for linked worktrees.
Checksums, duplicate versions, and failed migrations remain strict, and the
policy is not enabled for main, CI, or production runs.

The wrapper verifies the configured database name and the database actually
reached by PostgreSQL. A direct Flyway invocation from a linked worktree fails
if it still points at the shared database. Automatic provisioning is limited
to PostgreSQL on a loopback host.

Database removal is always explicit:

```bash
pnpm db:worktree:drop
```

The drop command only operates from a linked worktree, refuses non-loopback
PostgreSQL hosts, and permanently treats the `project` database as protected.

## Runtime notes

- `beforeEachMigrate__clear_diagram_migration_helpers.sql` clears the two
  session-local diagram guidance helpers before every migration. PostgreSQL
  retains these functions between transactions, and three historical migrations
  reuse their names. The callback supports fresh installs and batched staging
  and production upgrades without changing applied migration checksums. It is
  included by the normal `db/flyway` location in local and deployed images.
- `pnpm db:flyway:*` commands use `scripts/flyway.sh`.
- The wrapper prefers a local `flyway` binary, then falls back to `redgate/flyway:11` via Docker when Docker is available.

## Proposal ELI5 experiment rollback

To remove the proposal-owned `eli5` snapshot, first stop readers and writers that use it. Remove the field from `CreateProposalDto`, `CreateProposalRequestDto`, `UpdateProposalDto`, and `ProposalResponseDto` in `openapi/specs/schemas/proposals.yaml` and `ContextProposalSummaryDto` in `openapi/specs/schemas/entity-context.yaml`. Restore the canonical create endpoint and grouped member request schemas to `CreateProposalDto`, then regenerate the API, UI Common, and CLI models.

Remove the field from the MCP direct, batch, and grouped authoring inputs, action-authored proposal summaries, proposal admission validation, create and draft update persistence, group member snapshots, response and context-history projections, CLI proposal context rendering, and the proposal list, detail, inline, grouped, and Project Info Activity renderers. Restore the old Project Info Activity excerpt only if that behavior is still wanted.

After deployed readers and writers no longer access the column, add a new forward-only Flyway migration with `ALTER TABLE "proposals" DROP COLUMN "eli5"` and remove the Prisma field. Do not backfill, delete, or reinterpret `requestor_context`; it remains independent audit and provenance data.
