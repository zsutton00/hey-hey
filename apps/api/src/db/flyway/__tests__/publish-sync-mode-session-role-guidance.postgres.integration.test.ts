import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Run through worktree:exec against its isolated local database.
const databaseTests =
  process.env.RUN_SYNC_MODE_MIGRATION_DB_TESTS === '1'
    ? describe
    : describe.skip;
const read = (name: string) =>
  readFileSync(resolve(process.cwd(), 'db/flyway', name), 'utf8');
// Statements are separated by blank lines, so each runs as its own command.
const statements = (sql: string) =>
  sql
    .split(/\n\n/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

// The exact wording the earlier migration shipped, taken from its SQL.
const shipped = (label: string): string =>
  read('V2026.10.24.053221__publish_mode_session_role_guidance.sql').match(
    new RegExp(`'([^']*)'::text AS ${label}`),
  )![1]!;
const sectionStandard = shipped('section_standard');
const createStandard = shipped('create_standard');
const editStandard = shipped('edit_standard');
const settings = (writingStandard: string) => [
  { key: 'description', writingStandard: 'Describe the mode.' },
  { key: 'settings', writingStandard },
];

databaseTests('sync in published Agent Mode role guidance', () => {
  it('updates canonical and active project copies, and keeps project-authored text', async () => {
    const prisma = new PrismaClient();
    try {
      await prisma.$transaction(async (tx) => {
        // Temporary tables shadow the real ones; the shipped SQL runs unmodified.
        await tx.$executeRawUnsafe(
          'CREATE TEMP TABLE work_item_type_template (id TEXT, type_key TEXT, section_definitions JSONB, writing_standards JSONB, updated_at TIMESTAMP) ON COMMIT DROP',
        );
        await tx.$executeRawUnsafe(
          'CREATE TEMP TABLE work_item_type (id TEXT, type_key TEXT, project_id TEXT, lifecycle_status TEXT, section_definitions JSONB, writing_standards JSONB, updated_at TIMESTAMP) ON COMMIT DROP',
        );
        const shippedStandards = {
          create: `Project intro.\n\n${createStandard}`,
          edit: `${editStandard}`,
        };
        await tx.$executeRaw`INSERT INTO work_item_type_template VALUES ('canonical', 'MODE', ${JSON.stringify(settings(sectionStandard))}::jsonb, ${JSON.stringify(shippedStandards)}::jsonb, now())`;
        await tx.$executeRaw`INSERT INTO work_item_type VALUES ('copy', 'MODE', 'project-a', 'active', ${JSON.stringify(settings(`Our rule. ${sectionStandard}`))}::jsonb, ${JSON.stringify(shippedStandards)}::jsonb, now())`;
        await tx.$executeRaw`INSERT INTO work_item_type VALUES ('rewritten', 'MODE', 'project-b', 'active', ${JSON.stringify(settings('Project wrote its own role rules.'))}::jsonb, ${JSON.stringify({ create: 'Own create.', edit: 'Own edit.' })}::jsonb, now())`;

        for (const statement of statements(
          read(
            'V2026.11.20.061500__publish_sync_in_mode_session_role_guidance.sql',
          ),
        )) {
          await tx.$executeRawUnsafe(statement);
        }

        const read5 = async (
          table: 'work_item_type_template' | 'work_item_type',
          id: string,
        ) =>
          (
            await tx.$queryRawUnsafe<
              Array<{ section_definitions: any; writing_standards: any }>
            >(
              `SELECT section_definitions, writing_standards FROM ${table} WHERE id = '${id}'`,
            )
          )[0]!;

        for (const [table, id] of [
          ['work_item_type_template', 'canonical'],
          ['work_item_type', 'copy'],
        ] as const) {
          const row = await read5(table, id);
          const text = [
            row.section_definitions[1].writingStandard,
            row.writing_standards.create,
            row.writing_standards.edit,
          ];
          for (const entry of text) {
            expect(entry).toContain('review, or sync');
            expect(entry).not.toContain('planning, or review');
          }
        }
        // Project-authored text around the shipped sentences is kept.
        expect(
          (await read5('work_item_type', 'copy')).section_definitions[1]
            .writingStandard,
        ).toContain('Our rule.');
        expect(
          (await read5('work_item_type_template', 'canonical'))
            .writing_standards.create,
        ).toContain('Project intro.');
        // A copy that never held the shipped wording is untouched.
        const rewritten = await read5('work_item_type', 'rewritten');
        expect(rewritten.section_definitions[1].writingStandard).toBe(
          'Project wrote its own role rules.',
        );
        expect(rewritten.writing_standards).toEqual({
          create: 'Own create.',
          edit: 'Own edit.',
        });
      });
    } finally {
      await prisma.$disconnect();
    }
  });
});
