import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

/**
 * Validates the tasks_goal_invariants CHECK constraint added in
 * V2026.04.29.3. The constraint must be enforced at the storage layer:
 *   - GOAL tasks must have due_date set
 *   - GOAL tasks must be top-level (parent_task_id IS NULL)
 *
 * These tests intentionally bypass any service-layer validation and
 * write directly through Prisma so a regression in the migration —
 * e.g. dropping the constraint or weakening it — fails here.
 */
describe('task GOAL storage invariants', () => {
  const prisma = new PrismaClient();

  const organizationId = randomUUID();
  const projectId = randomUUID();
  let parentTaskId: string;

  beforeAll(async () => {
    await prisma.$connect();

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: `Goal Invariant Test Org ${organizationId}`,
        slug: `goal-invariant-${organizationId}`,
      },
    });

    await prisma.project.create({
      data: {
        id: projectId,
        name: 'Goal Invariant Test Project',
        organizationId,
      },
    });

    const parent = await prisma.task.create({
      data: {
        id: randomUUID(),
        name: 'Goal Invariant Parent Task',
        type: 'STANDARD',
        organizationId,
        projectId,
      },
    });
    parentTaskId = parent.id;
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { organizationId } });
    await prisma.project.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it('rejects a GOAL task with no due_date', async () => {
    await expect(
      prisma.task.create({
        data: {
          id: randomUUID(),
          name: 'GOAL without due_date',
          type: 'GOAL',
          organizationId,
          projectId,
          dueDate: null,
        },
      }),
    ).rejects.toThrow(/tasks_goal_invariants/);
  });

  it('rejects a GOAL task with a parent_task_id', async () => {
    await expect(
      prisma.task.create({
        data: {
          id: randomUUID(),
          name: 'GOAL with parent',
          type: 'GOAL',
          organizationId,
          projectId,
          dueDate: new Date('2027-01-01T00:00:00Z'),
          parentTaskId,
        },
      }),
    ).rejects.toThrow(/tasks_goal_invariants/);
  });

  it('accepts a top-level GOAL task with a due_date set', async () => {
    const created = await prisma.task.create({
      data: {
        id: randomUUID(),
        name: 'Valid GOAL',
        type: 'GOAL',
        organizationId,
        projectId,
        dueDate: new Date('2027-01-01T00:00:00Z'),
      },
    });

    expect(created.type).toBe('GOAL');
    expect(created.dueDate).not.toBeNull();
    expect(created.parentTaskId).toBeNull();
  });
});
