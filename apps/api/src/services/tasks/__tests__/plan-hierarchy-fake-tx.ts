import { Prisma, WorkStatus } from '@prisma/client';

export interface FakeHierarchyTask {
  id: string;
  type: string;
  status: WorkStatus;
  parentTaskId: string | null;
  archivedAt?: Date | null;
}

interface FakeTaskArgs {
  where: { id: string; archivedAt?: null };
  select?: {
    parentTask?: unknown;
    subTasks?: { where?: { archivedAt?: null } };
  };
  data?: Record<string, unknown>;
}

const SCOPE = {
  organizationId: 'org',
  projectId: 'project',
  initiativeId: null,
};

/**
 * Minimal in-memory transaction client covering the task reads and writes the
 * canonical Plan rollup and TaskService status/re-parent/archive paths perform.
 */
export function createPlanHierarchyFakeTx(
  tasks: FakeHierarchyTask[],
  scope: Partial<typeof SCOPE> = {},
) {
  const rows = new Map(
    tasks.map((task) => [
      task.id,
      { ...SCOPE, ...scope, archivedAt: null, ...task },
    ]),
  );
  const row = (id: string) => rows.get(id);
  const children = (id: string, where?: { archivedAt?: null }) =>
    [...rows.values()].filter(
      (task) =>
        task.parentTaskId === id &&
        (where?.archivedAt !== null || task.archivedAt === null),
    );

  const task = {
    findUnique: jest.fn(async ({ where, select }: FakeTaskArgs) => {
      const found = row(where.id);
      if (!found) return null;
      const parent = found.parentTaskId ? row(found.parentTaskId) : undefined;
      return {
        ...found,
        parentTask: select?.parentTask && parent ? { ...parent } : null,
        subTasks: select?.subTasks
          ? children(found.id, select.subTasks.where)
          : undefined,
      };
    }),
    findFirst: jest.fn(async ({ where }: FakeTaskArgs) => {
      const found = row(where.id);
      if (!found) return null;
      if (where.archivedAt === null && found.archivedAt !== null) return null;
      return { ...found };
    }),
    findMany: jest.fn(async (): Promise<unknown[]> => []),
    update: jest.fn(async ({ where, data }: FakeTaskArgs) => {
      const found = row(where.id);
      if (!found) throw new Error(`missing task ${where.id}`);
      Object.assign(found, data);
      return { ...found };
    }),
  };

  return { tx: { task } as unknown as Prisma.TransactionClient, rows, task };
}
