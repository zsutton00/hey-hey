import { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { workItemTypeStatusesSchema } from '../../../services/tasks/work-item-type-status.schema';

// Run through worktree:exec against its isolated local database.
const databaseTests =
  process.env.RUN_STATUS_MIGRATION_DB_TESTS === '1' ? describe : describe.skip;
const migration = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.10.29.232600__store_custom_status_definitions.sql',
  ),
  'utf8',
);

function section(name: string): string {
  const begin = `-- BEGIN ${name}\n`;
  const start = migration.indexOf(begin) + begin.length;
  return migration.slice(start, migration.indexOf(`-- END ${name}`));
}

// The shipped lookup, conversion function and settled-proposal upgrade, run
// against a shadow proposals table so live history is untouched.
const sql =
  section('legacy status lookup') + section('settled proposal upgrade');

databaseTests('historical type proposal status migration', () => {
  it('upgrades flat and nested approved/rejected payloads without changing decisions or other fields', async () => {
    const prisma = new PrismaClient();
    try {
      await prisma.$transaction(async (tx) => {
        // A temporary table shadows the real proposals table. The exact production
        // SQL runs without touching live history, and all temporary objects disappear when the connection closes.
        await tx.$executeRawUnsafe(
          'CREATE TEMP TABLE proposals (id TEXT, status TEXT, target_entity_type TEXT, updates JSONB, retained_original_target_content JSONB) ON COMMIT DROP',
        );
        const definition = {
          key: 'RECIPE',
          name: 'Recipe',
          sections: [],
          allowedStatuses: [
            'BACKLOG',
            'ACTIVE',
            'COMPLETED',
            'ARCHIVED',
            'SUPERSEDED',
          ],
          agentSettableStatuses: ['ACTIVE'],
          capabilities: { requiresParent: true },
        };
        for (const status of ['APPROVED', 'REJECTED']) {
          for (const nested of [false, true]) {
            const updates = nested
              ? { definition, customizationAcknowledged: true }
              : definition;
            await tx.$executeRaw`INSERT INTO proposals VALUES (${`${status}-${nested}`}, ${status}, 'WORK_ITEM_TYPE', ${JSON.stringify(updates)}::jsonb, ${JSON.stringify({ definition, evidence: 'preserved' })}::jsonb)`;
          }
        }
        // DO executes the unmodified multi-statement migration as one command.
        await tx.$executeRawUnsafe(
          'DO $migration$ BEGIN\n' + sql + '\nEND; $migration$;',
        );
        const after = await tx.$queryRaw<
          Array<{
            id: string;
            status: string;
            updates: Prisma.JsonObject;
            retained_original_target_content: Prisma.JsonObject;
          }>
        >`SELECT * FROM proposals`;
        expect(after).toHaveLength(4);
        for (const row of after) {
          expect(row.status).toBe(row.id.split('-')[0]);
          const updated = z
            .object({ statuses: workItemTypeStatusesSchema })
            .passthrough()
            .parse(
              row.id.endsWith('-true') ? row.updates.definition : row.updates,
            );
          const statuses = workItemTypeStatusesSchema.parse(updated.statuses);
          expect(statuses.map((status) => status.name)).toEqual([
            'BACKLOG',
            'ACTIVE',
            'COMPLETED',
          ]);
          expect(statuses[2]).toMatchObject({
            label: 'Completed',
            meaning: 'FINISHED',
            completionBehavior: 'COMPLETED',
          });
          expect(updated).toMatchObject({
            key: definition.key,
            name: definition.name,
            agentSettableStatuses: ['ACTIVE'],
            capabilities: { requiresParent: true, supportsSupersession: true },
          });
          expect(updated).not.toHaveProperty('allowedStatuses');
          const original = z
            .object({
              definition: z.object({ statuses: workItemTypeStatusesSchema }),
              evidence: z.string(),
            })
            .parse(row.retained_original_target_content);
          expect(original.definition.statuses).toEqual(statuses);
          expect(original.evidence).toBe('preserved');
          if (row.updates.definition) {
            expect(row.updates.customizationAcknowledged).toBe(true);
          }
        }
      });
    } finally {
      await prisma.$disconnect();
    }
  });
});
