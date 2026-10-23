import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../V2026.08.03.1__project_owned_work_item_type_definitions.sql',
);

const CANONICAL_KEYS = [
  'STANDARD',
  'FEATURE',
  'GOAL',
  'BUG',
  'CONTRACT',
  'workflow',
  'workflow_step',
  'TASK_MONITOR',
] as const;

describe('V2026.08.03.1: project-owned work-item type definitions', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('creates a versioned, complete canonical template catalog', () => {
    expect(sql).toContain('CREATE TABLE "work_item_type_template"');
    expect(sql).toContain('"type_key"              TEXT        NOT NULL');
    expect(sql).toContain('"revision"              INTEGER     NOT NULL');
    expect(sql).toContain(
      'CONSTRAINT "work_item_type_template_type_key_revision_key"',
    );
    expect(sql).toContain('UNIQUE ("type_key", "revision")');
    expect(sql).toContain('INSERT INTO "work_item_type_template"');

    for (const typeKey of CANONICAL_KEYS) {
      expect(sql).toContain(`'${typeKey}'`);
    }

    for (const definitionColumn of [
      'name',
      'description',
      'section_definitions',
      'allowed_parent_types',
      'allowed_child_types',
      'edge_targets',
      'allowed_statuses',
      'required_scalars',
      'forbidden_scalars',
      'parentage',
      'tracking',
      'agent_settable_statuses',
      'anchorable_report_types',
      'writing_standards',
      'capabilities',
      'graph_configuration',
    ]) {
      expect(sql).toContain(`"${definitionColumn}"`);
    }
  });

  it('adds nullable project-definition provenance fields with a template FK', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "template_key" TEXT');
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "template_revision" INTEGER',
    );
    expect(sql).toContain('CONSTRAINT "work_item_type_template_fkey"');
    expect(sql).toContain(
      'REFERENCES "work_item_type_template" ("type_key", "revision")',
    );
    expect(sql).toContain('ON DELETE RESTRICT');
  });

  it('guards project-scoped canonical-key collisions before any mutation', () => {
    const guardOffset = sql.indexOf('DO $migration$');
    const firstMutationOffset = Math.min(
      ...['CREATE TABLE', 'ALTER TABLE', 'INSERT INTO', 'UPDATE', 'DELETE FROM']
        .map((token) => sql.indexOf(token))
        .filter((offset) => offset >= 0),
    );

    expect(guardOffset).toBeGreaterThanOrEqual(0);
    expect(guardOffset).toBeLessThan(firstMutationOffset);
    expect(sql).toContain('project-scoped canonical-key collision(s)');
    expect(sql).toContain('work_item_type.project_id IS NOT NULL');
    expect(sql).toContain('RAISE EXCEPTION');
    expect(sql).toContain('USING HINT');
  });

  it('backfills the complete project-by-template cross product without conflict suppression', () => {
    expect(sql).toContain('FROM "projects" project');
    expect(sql).toContain('CROSS JOIN "work_item_type_template" template');
    expect(sql).toContain('gen_random_uuid()::TEXT');
    expect(sql).toContain('"template_key"');
    expect(sql).toContain('"template_revision"');
    expect(sql).toContain('project_count * 8');
    expect(sql).not.toContain('ON CONFLICT DO NOTHING');
    expect(sql).not.toContain('ON CONFLICT ("project_id", "type_key")');
  });

  it('verifies every project/key pair and preserves task rows', () => {
    expect(sql).not.toMatch(/(?:UPDATE|DELETE FROM|ALTER TABLE)\s+"tasks"/i);

    const backfillOffset = sql.indexOf('INSERT INTO "work_item_type"');
    const verificationOffset = sql.indexOf(
      'Project-owned canonical materialization produced',
    );

    expect(backfillOffset).toBeGreaterThanOrEqual(0);
    expect(verificationOffset).toBeGreaterThan(backfillOffset);
    expect(sql).toContain('expected.project_id');
    expect(sql).toContain('expected.type_key');
    expect(sql).toContain('COUNT(actual.id) AS row_count');
    expect(sql).toContain('BOOL_AND(actual.is_system = false)');
    expect(sql).toContain("BOOL_AND(actual.lifecycle_status = 'active')");
    expect(sql).toContain('BOOL_AND(actual.template_key = expected.type_key)');
    expect(sql).toContain('BOOL_AND(actual.template_revision = 1)');
    expect(sql).toContain(
      'Project-owned canonical materialization failed for project/key pair(s)',
    );
  });

  it('removes global effective rows and enforces project ownership after verification', () => {
    const verificationOffset = sql.indexOf(
      'Project-owned canonical materialization failed for project/key pair(s)',
    );
    const cutoverOffset = sql.indexOf('DELETE FROM "work_item_type"');

    expect(cutoverOffset).toBeGreaterThan(verificationOffset);
    expect(sql).toContain('WHERE "project_id" IS NULL');
    expect(sql).toContain(
      'DROP INDEX IF EXISTS "work_item_type_system_type_key_unique"',
    );
    expect(sql).toContain(
      'DROP INDEX IF EXISTS "work_item_type_project_type_key_unique"',
    );
    expect(sql).toContain('ALTER COLUMN "project_id" SET NOT NULL');
    expect(sql).toContain('DROP COLUMN "is_system"');
    expect(sql).toContain(
      'CONSTRAINT "work_item_type_project_type_key_unique"',
    );
    expect(sql).toContain('UNIQUE ("project_id", "type_key")');
  });
});
