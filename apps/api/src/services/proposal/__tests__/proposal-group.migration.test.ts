import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('proposal group migration', () => {
  const groupMigration = readFileSync(
    resolve(
      __dirname,
      '../../../../db/flyway/V2026.07.23.1__create_proposal_groups.sql',
    ),
    'utf8',
  );
  const leaseMigration = readFileSync(
    resolve(
      __dirname,
      '../../../../db/flyway/V2026.07.31.1__add_proposal_group_enactment_leases.sql',
    ),
    'utf8',
  );
  const publicationMigration = readFileSync(
    resolve(
      __dirname,
      '../../../../db/flyway/V2026.07.31.2__add_grouped_proposal_publication_checkpoints.sql',
    ),
    'utf8',
  );
  const dueStateCleanupMigration = readFileSync(
    resolve(
      __dirname,
      '../../../../db/flyway/V2026.08.11.3__remove_proposal_group_due_enactment_state.sql',
    ),
    'utf8',
  );

  it('defines scoped membership and same-group dependency invariants', () => {
    expect(groupMigration).toContain('CREATE TYPE "proposal_group_status"');
    expect(groupMigration).toContain(
      'CREATE TYPE "proposal_group_member_execution_state"',
    );
    expect(groupMigration).toContain(
      'CONSTRAINT "proposal_group_members_proposal_id_key" UNIQUE ("proposal_id")',
    );
    expect(groupMigration).toContain(
      'FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE RESTRICT',
    );
    expect(groupMigration).toContain(
      'CONSTRAINT "proposal_group_members_reserved_target_entity_id_key"',
    );
    expect(groupMigration).toContain(
      'FOREIGN KEY ("group_id", "dependent_member_id")',
    );
    expect(groupMigration).toContain(
      'FOREIGN KEY ("group_id", "prerequisite_member_id")',
    );
    expect(groupMigration).toContain(
      'CHECK ("dependent_member_id" <> "prerequisite_member_id")',
    );
    expect(groupMigration).toContain(
      'UNIQUE ("group_id", "dependent_member_id", "prerequisite_member_id")',
    );
  });

  it('adds durable, fenced enactment claims and a due-work index', () => {
    expect(leaseMigration).toContain(
      'ADD COLUMN IF NOT EXISTS "claim_token" TEXT',
    );
    expect(leaseMigration).toContain(
      'ADD COLUMN IF NOT EXISTS "lease_expires_at" TIMESTAMPTZ',
    );
    expect(leaseMigration).toContain(
      'ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMPTZ',
    );
    expect(leaseMigration).toContain(
      'CONSTRAINT "proposal_group_members_applying_claim_check"',
    );
    expect(leaseMigration).toContain('"execution_state" <> \'APPLYING\'');
    expect(leaseMigration).toContain(
      'CREATE INDEX IF NOT EXISTS "proposal_group_members_due_enactment_idx"',
    );
    expect(leaseMigration).toContain(
      "WHERE \"execution_state\" IN ('READY', 'RETRYABLE_FAILURE', 'APPLYING')",
    );
  });

  it('persists resumable publication payloads and monotonic checkpoints', () => {
    expect(publicationMigration).toContain(
      'ADD COLUMN IF NOT EXISTS "publication_payload" JSONB',
    );
    expect(publicationMigration).toContain(
      'ADD COLUMN IF NOT EXISTS "published_edge_count" INTEGER NOT NULL DEFAULT 0',
    );
    expect(publicationMigration).toContain(
      'ADD COLUMN IF NOT EXISTS "published_post_commit_count" INTEGER NOT NULL DEFAULT 0',
    );
    expect(publicationMigration).toContain(
      'ADD COLUMN IF NOT EXISTS "publication_completed_at" TIMESTAMPTZ',
    );
    expect(publicationMigration).toContain(
      'CHECK ("published_edge_count" >= 0)',
    );
    expect(publicationMigration).toContain(
      'CHECK ("published_post_commit_count" >= 0)',
    );
  });

  it('removes obsolete due-at scheduling while retaining fenced claim state', () => {
    expect(dueStateCleanupMigration).toContain(
      'DROP INDEX IF EXISTS "proposal_group_members_due_enactment_idx"',
    );
    expect(dueStateCleanupMigration).toContain(
      'DROP COLUMN IF EXISTS "next_attempt_at"',
    );
    expect(dueStateCleanupMigration).not.toContain('claim_token');
    expect(dueStateCleanupMigration).not.toContain('lease_expires_at');
  });
});
