import { PrismaClient, Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { workItemTypeStatusesSchema } from '../../../services/tasks/work-item-type-status.schema';

// Run through worktree:exec against its isolated local database.
const databaseTests =
  process.env.RUN_STATUS_MIGRATION_DB_TESTS === '1' ? describe : describe.skip;
const migration = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.11.23.130000__give_statuses_one_meaning.sql',
  ),
  'utf8',
);

// What V2026.10.29.232600 stored for the platform types, plus a type that was
// renamed through the editor (new names, old labels) and one the user wrote.
const platformStatuses = [
  { name: 'BACKLOG', label: 'Backlog', meaning: 'NOT_STARTED' },
  { name: 'READY', label: 'Ready', meaning: 'NOT_STARTED' },
  { name: 'ACTIVE', label: 'In progress', meaning: 'IN_PROGRESS' },
  { name: 'BLOCKED', label: 'Blocked', meaning: 'UNFINISHED' },
  { name: 'VERIFYING', label: 'Verifying', meaning: 'IN_PROGRESS' },
  {
    name: 'COMPLETED',
    label: 'Completed',
    meaning: 'FINISHED',
    completionBehavior: 'COMPLETED',
  },
  {
    name: 'CANCELLED',
    label: 'Cancelled',
    meaning: 'FINISHED',
    completionBehavior: 'CANCELLED',
  },
];
const renamedStatuses = [
  { name: 'CONSIDERING', label: 'In progress', meaning: 'IN_PROGRESS' },
  { name: 'ON_HOLD', label: 'Backlog', meaning: 'NOT_STARTED' },
  { name: 'APPLIED', label: 'In progress', meaning: 'IN_PROGRESS' },
  { name: 'REJECTED', label: 'Completed', meaning: 'FINISHED' },
  {
    name: 'NOT_PURSUING',
    label: 'Cancelled',
    meaning: 'FINISHED',
    completionBehavior: 'CANCELLED',
  },
  { name: 'Waiting', meaning: 'UNFINISHED' },
  { name: 'W'.repeat(60), label: '🚀'.repeat(60), meaning: 'NOT_STARTED' },
  { name: 'Application filed', label: 'Completed', meaning: 'UNFINISHED' },
];

databaseTests('one-meaning status migration', () => {
  it('keeps finished, cancelled and in-progress effects and never touches names or order', async () => {
    const prisma = new PrismaClient();
    try {
      await prisma.$transaction(async (tx) => {
        for (const table of ['work_item_type', 'work_item_type_template']) {
          await tx.$executeRawUnsafe(
            `CREATE TEMP TABLE ${table} (key TEXT, statuses JSONB) ON COMMIT DROP`,
          );
          await tx.$executeRaw`INSERT INTO ${Prisma.raw(table)} VALUES ('STANDARD', ${JSON.stringify(platformStatuses)}::jsonb), ('JOBS', ${JSON.stringify(renamedStatuses)}::jsonb)`;
        }
        await tx.$executeRawUnsafe(
          'CREATE TEMP TABLE proposals (id TEXT, status TEXT, target_entity_type TEXT, updates JSONB, retained_original_target_content JSONB) ON COMMIT DROP',
        );
        const definition = { key: 'JOBS', statuses: renamedStatuses };
        await tx.$executeRaw`INSERT INTO proposals VALUES ('flat', 'DRAFT', 'WORK_ITEM_TYPE', ${JSON.stringify(definition)}::jsonb, ${JSON.stringify({ definition })}::jsonb), ('nested', 'APPROVED', 'WORK_ITEM_TYPE', ${JSON.stringify({ definition })}::jsonb, ${JSON.stringify({ definition })}::jsonb)`;

        await tx.$executeRawUnsafe(
          'DO $migration$ BEGIN\n' + migration + '\nEND; $migration$;',
        );

        const types = await tx.$queryRawUnsafe<
          Array<{ key: string; statuses: unknown }>
        >('SELECT key, statuses FROM work_item_type ORDER BY key');
        const standard = workItemTypeStatusesSchema.parse(
          types.find((type) => type.key === 'STANDARD')!.statuses,
        );
        expect(standard).toEqual([
          { name: 'BACKLOG', meaning: { kind: 'CUSTOM', text: 'Backlog' } },
          { name: 'READY', meaning: { kind: 'CUSTOM', text: 'Ready' } },
          { name: 'ACTIVE', meaning: { kind: 'IN_PROGRESS' } },
          { name: 'BLOCKED', meaning: { kind: 'CUSTOM', text: 'Blocked' } },
          { name: 'VERIFYING', meaning: { kind: 'IN_PROGRESS' } },
          { name: 'COMPLETED', meaning: { kind: 'COMPLETED' } },
          { name: 'CANCELLED', meaning: { kind: 'CANCELLED' } },
        ]);

        const jobs = workItemTypeStatusesSchema.parse(
          types.find((type) => type.key === 'JOBS')!.statuses,
        );
        expect(jobs.map((status) => status.name)).toEqual(
          renamedStatuses.map((status) => status.name),
        );
        expect(jobs.map((status) => status.meaning.kind)).toEqual([
          'IN_PROGRESS',
          'CUSTOM',
          'IN_PROGRESS',
          'COMPLETED',
          'CANCELLED',
          'CUSTOM',
          'CUSTOM',
          'CUSTOM',
        ]);
        expect(jobs[5]!.meaning).toEqual({ kind: 'CUSTOM', text: 'Waiting' });
        expect(jobs[6]!.meaning).toEqual({
          kind: 'CUSTOM',
          text: '🚀'.repeat(50),
        });
        expect(jobs[7]!.meaning).toEqual({
          kind: 'CUSTOM',
          text: 'Legacy label: Completed',
        });
        for (const status of jobs) {
          expect(Object.keys(status).sort()).toEqual(['meaning', 'name']);
        }

        const templates = await tx.$queryRawUnsafe<
          Array<{ statuses: unknown }>
        >('SELECT statuses FROM work_item_type_template ORDER BY key');
        expect(templates.map((row) => row.statuses)).toEqual(
          types.map((row) => row.statuses),
        );

        const proposals = await tx.$queryRawUnsafe<
          Array<{ updates: any; retained_original_target_content: any }>
        >(
          'SELECT updates, retained_original_target_content FROM proposals ORDER BY id',
        );
        for (const row of proposals) {
          const updated = row.updates.definition ?? row.updates;
          expect(workItemTypeStatusesSchema.parse(updated.statuses)).toEqual(
            jobs,
          );
          expect(
            workItemTypeStatusesSchema.parse(
              row.retained_original_target_content.definition.statuses,
            ),
          ).toEqual(jobs);
        }
      });
    } finally {
      await prisma.$disconnect();
    }
  });
});
