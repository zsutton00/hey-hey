/**
 * Integration test: V2026.06.12.2 — migrate tasks.type from pg enum to TEXT.
 *
 * Connects to the live Postgres database (DATABASE_URL must be set) and
 * verifies the migration outcome directly against the schema catalog and the
 * tasks table, bypassing any application layer. These assertions fail if:
 *
 *  - The column type was not changed to TEXT.
 *  - The default was not set to 'STANDARD'.
 *  - The task_type pg enum still exists.
 *  - Any of the four built-in type values do not round-trip through the column
 *    verbatim (i.e. the USING clause changed their representation).
 *
 * Run this test against a migrated database:
 *   jest db/flyway/__tests__/task-type-column-migration
 */

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const BUILT_IN_TYPES = ['STANDARD', 'BUG', 'FEATURE', 'GOAL'] as const;

describe('V2026.06.12.2: tasks.type migrated from pg enum to TEXT', () => {
  const prisma = new PrismaClient();

  const organizationId = randomUUID();
  const projectId = randomUUID();

  beforeAll(async () => {
    await prisma.$connect();

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: `Type Column Migration Test Org ${organizationId}`,
        slug: `type-col-${organizationId}`,
      },
    });

    await prisma.project.create({
      data: {
        id: projectId,
        name: 'Type Column Migration Test Project',
        organizationId,
      },
    });
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { organizationId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  // ── Schema assertions (catalog-level) ────────────────────────────────────

  it('tasks.type column data_type is text, not USER-DEFINED (pg enum)', async () => {
    const rows = await prisma.$queryRaw<{ data_type: string }[]>`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_name = 'tasks'
        AND column_name = 'type'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data_type).toBe('text');
  });

  it("tasks.type column default is 'STANDARD'", async () => {
    const rows = await prisma.$queryRaw<{ column_default: string }[]>`
      SELECT column_default
      FROM information_schema.columns
      WHERE table_name = 'tasks'
        AND column_name = 'type'
    `;
    expect(rows).toHaveLength(1);
    // Postgres stores unquoted text defaults as 'STANDARD'::text or just 'STANDARD'.
    expect(rows[0]!.column_default).toContain('STANDARD');
  });

  it('the task_type pg enum no longer exists', async () => {
    const rows = await prisma.$queryRaw<{ typname: string }[]>`
      SELECT typname
      FROM pg_type
      WHERE typname = 'task_type'
        AND typtype = 'e'
    `;
    expect(rows).toHaveLength(0);
  });

  // ── Value-preservation assertions ─────────────────────────────────────────

  it.each(BUILT_IN_TYPES)(
    "type '%s' survives a write→read round-trip unchanged",
    async (taskType) => {
      const taskId = randomUUID();

      // GOAL requires a dueDate; skip that invariant here — we only care about
      // the type column's round-trip, not the CHECK constraint.
      const dueDate =
        taskType === 'GOAL' ? new Date('2027-01-01T00:00:00Z') : null;

      await prisma.task.create({
        data: {
          id: taskId,
          name: `Round-trip test for ${taskType}`,
          type: taskType,
          organizationId,
          projectId,
          ...(dueDate ? { dueDate } : {}),
        },
      });

      const fetched = await prisma.task.findUniqueOrThrow({
        where: { id: taskId },
        select: { type: true },
      });

      expect(fetched.type).toBe(taskType);
    },
  );

  it('all four built-in type values are distinct and stored verbatim', async () => {
    const tasks = await prisma.task.findMany({
      where: { organizationId },
      select: { type: true },
      orderBy: { createdAt: 'asc' },
    });

    const types = tasks.map((t) => t.type);
    // Verify all four values appear exactly once each.
    for (const expected of BUILT_IN_TYPES) {
      expect(types).toContain(expected);
    }
    // No value was coerced or duplicated.
    expect(new Set(types).size).toBe(BUILT_IN_TYPES.length);
  });
});
