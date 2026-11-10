import { BadRequestException } from '@nestjs/common';
import { PlanFromExistingTasksAdoptionService } from '../plan-from-existing-tasks-adoption.service';

const ORG = 'org-1';
const PROJECT = 'project-1';
const FEATURE = '11111111-1111-4111-8111-111111111111';
const T1 = '22222222-2222-4222-8222-222222222221';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '22222222-2222-4222-8222-222222222223';
const EXTERNAL = '33333333-3333-4333-8333-333333333333';

type Row = {
  id: string;
  type: string;
  status: string;
  archivedAt: Date | null;
  organizationId: string;
  projectId: string;
  parentTaskId: string | null;
};

const row = (id: string, overrides: Partial<Row> = {}): Row => ({
  id,
  type: 'STANDARD',
  status: 'ACTIVE',
  archivedAt: null,
  organizationId: ORG,
  projectId: PROJECT,
  parentTaskId: FEATURE,
  ...overrides,
});

const payload = (overrides: Record<string, unknown> = {}) => ({
  proposalKind: 'PLAN_FROM_EXISTING_TASKS',
  planTitle: 'Adopted plan',
  designDocMarkdown: '# Design',
  parentFeatureId: FEATURE,
  stages: [
    { title: 'First', taskIds: [T1] },
    { title: 'Second', taskIds: [T2, T3] },
  ],
  ...overrides,
});

function setup(rows: Row[]) {
  const table = new Map(rows.map((r) => [r.id, r]));
  table.set(FEATURE, row(FEATURE, { type: 'FEATURE', parentTaskId: null }));
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    task: {
      findFirst: jest.fn(async ({ where }) => {
        const found = table.get(where.id);
        return found?.type === where.type ? { id: where.id } : null;
      }),
      findMany: jest.fn(async ({ where }) =>
        where.id.in.map((id: string) => table.get(id)).filter(Boolean),
      ),
      findUnique: jest.fn(async ({ where }) => table.get(where.id) ?? null),
    },
  };
  let nextId = 0;
  const taskService = {
    createInTransaction: jest.fn(
      async (_tx, _org, _i, dto, ..._rest: unknown[]) => {
        const id = `created-${++nextId}`;
        table.set(
          id,
          row(id, { type: dto.type, parentTaskId: dto.parentTaskId }),
        );
        return { id };
      },
    ),
    updateInTransaction: jest.fn(async (_tx, _o, _i, taskId, dto) => {
      table.get(taskId)!.parentTaskId = dto.parentTaskId;
      return { task: { id: taskId }, postCommit: { taskId } };
    }),
  };
  const designDocService = {
    createInTransaction: jest.fn(async (_tx, _dto, id) => ({ id })),
  };
  const service = new PlanFromExistingTasksAdoptionService(
    taskService as never,
    designDocService as never,
  );
  const adopt = (updates: Record<string, unknown>) =>
    service.adoptInTransaction(tx as never, {
      proposalId: 'proposal-1',
      updates,
      requestorId: 'user-1' as never,
      organizationId: ORG as never,
      projectId: PROJECT as never,
    });
  return { adopt, tx, taskService, designDocService, table, service };
}

const setup2 = () => setup([row(T1), row(T2), row(T3)]);

const reasonCodes = async (promise: Promise<unknown>) => {
  const error = (await promise.catch((e) => e)) as BadRequestException;
  expect(error).toBeInstanceOf(BadRequestException);
  return (
    error.getResponse() as { reasons: Array<{ code: string }> }
  ).reasons.map((r) => r.code);
};

describe('PlanFromExistingTasksAdoptionService', () => {
  it('creates one Plan with stages, moves ACTIVE and COMPLETED tasks without copying them, and chains stages', async () => {
    const { adopt, taskService, table } = setup([
      row(T1, { status: 'COMPLETED' }),
      row(T2),
      row(T3),
      row(EXTERNAL),
    ]);

    const result = await adopt(
      payload({
        taskPrerequisites: [
          { taskId: T3, dependsOnTaskId: T2 },
          { taskId: T3, dependsOnTaskId: T2 },
          { taskId: T2, dependsOnTaskId: EXTERNAL },
        ],
      }),
    );

    // Plan + two stages created; no Task copies.
    const created = taskService.createInTransaction.mock.calls.map(
      ([, , , dto]) => dto.type,
    );
    expect(created).toEqual(['PLAN', 'PLAN_STAGE', 'PLAN_STAGE']);

    // Same identities moved under their stage; statuses untouched.
    const [stage1, stage2] = result.stageIds;
    expect(table.get(T1)!.parentTaskId).toBe(stage1);
    expect(table.get(T2)!.parentTaskId).toBe(stage2);
    expect(table.get(T3)!.parentTaskId).toBe(stage2);
    expect(table.get(T1)!.status).toBe('COMPLETED');
    expect(table.get(EXTERNAL)!.parentTaskId).toBe(FEATURE);
    for (const [, , , , dto] of taskService.updateInTransaction.mock.calls) {
      expect(Object.keys(dto)).toEqual(['parentTaskId']);
    }

    const depends = result.edges
      .filter((e) => e.edgeType === 'DEPENDS_ON')
      .map((e) => [e.sourceEntityId, e.targetEntityId]);
    expect(depends).toEqual(
      expect.arrayContaining([
        [stage2, stage1],
        [T3, T2],
        [T2, EXTERNAL],
      ]),
    );
    // Deduplicated; nothing implied by list order alone.
    expect(depends).toHaveLength(3);
  });

  it('gives edges stable identities so a retry cannot duplicate them', async () => {
    const first = await setup([row(T1), row(T2), row(T3)]).adopt(payload());
    const second = await setup([row(T1), row(T2), row(T3)]).adopt(payload());
    const stageEdge = (r: typeof first) =>
      r.edges.find((e) => e.edgeType === 'DEPENDS_ON')!;
    expect(stageEdge(first).id).toBeDefined();
    expect(first.edges.map((e) => e.edgeType)).toEqual(
      second.edges.map((e) => e.edgeType),
    );
  });

  it.each([
    ['archived', row(T1, { archivedAt: new Date() }), 'TASK_ARCHIVED'],
    ['superseded', row(T1, { status: 'SUPERSEDED' }), 'TASK_SUPERSEDED'],
    ['non-STANDARD', row(T1, { type: 'BUG' }), 'TASK_NOT_STANDARD'],
    [
      'cross-project',
      row(T1, { projectId: 'other-project' }),
      'TASK_NOT_FOUND',
    ],
  ])('rejects a %s task before writing anything', async (_name, bad, code) => {
    const { adopt, taskService, designDocService } = setup([
      bad,
      row(T2),
      row(T3),
    ]);

    expect(await reasonCodes(adopt(payload()))).toEqual([code]);
    expect(taskService.createInTransaction).not.toHaveBeenCalled();
    expect(taskService.updateInTransaction).not.toHaveBeenCalled();
    expect(designDocService.createInTransaction).not.toHaveBeenCalled();
  });

  it('rejects a missing task and a task already inside another Plan', async () => {
    const { adopt, taskService } = setup([
      row('44444444-4444-4444-8444-444444444444', { type: 'PLAN_STAGE' }),
      row(T1, { parentTaskId: '44444444-4444-4444-8444-444444444444' }),
      row(T2),
    ]);

    expect(await reasonCodes(adopt(payload()))).toEqual([
      'TASK_ALREADY_IN_PLAN',
      'TASK_NOT_FOUND',
    ]);
    expect(taskService.createInTransaction).not.toHaveBeenCalled();
  });

  it('rejects duplicate assignments, self-dependencies and cycles', async () => {
    const { adopt } = setup([row(T1), row(T2), row(T3)]);

    expect(
      await reasonCodes(
        adopt(
          payload({
            stages: [
              { title: 'A', taskIds: [T1, T2] },
              { title: 'B', taskIds: [T2, T3] },
            ],
            taskPrerequisites: [
              { taskId: T1, dependsOnTaskId: T1 },
              { taskId: T2, dependsOnTaskId: T3 },
              { taskId: T3, dependsOnTaskId: T2 },
            ],
          }),
        ),
      ),
    ).toEqual([
      'DUPLICATE_TASK_ASSIGNMENT',
      'SELF_DEPENDENCY',
      'CYCLIC_DEPENDENCY',
    ]);
  });

  it('rejects prerequisites that name a missing endpoint or an unadopted dependent', async () => {
    const { adopt } = setup([row(T1), row(T2), row(T3), row(EXTERNAL)]);

    expect(
      await reasonCodes(
        adopt(
          payload({
            taskPrerequisites: [
              { taskId: EXTERNAL, dependsOnTaskId: T1 },
              {
                taskId: T2,
                dependsOnTaskId: '55555555-5555-4555-8555-555555555555',
              },
            ],
          }),
        ),
      ),
    ).toEqual(['PREREQUISITE_TASK_NOT_ADOPTED', 'PREREQUISITE_NOT_FOUND']);
  });

  it('rejects a missing parent Feature and malformed payloads', async () => {
    const { adopt } = setup([row(T1), row(T2), row(T3)]);

    expect(
      await reasonCodes(
        adopt(
          payload({ parentFeatureId: '66666666-6666-4666-8666-666666666666' }),
        ),
      ),
    ).toEqual(['PARENT_FEATURE_NOT_FOUND']);
    expect(await reasonCodes(adopt(payload({ stages: [] })))).toEqual([
      'INVALID_PAYLOAD',
    ]);
  });

  it('creates the Plan at its reserved identity', async () => {
    const { tx, taskService, designDocService, service } = setup2();

    await service.adoptInTransaction(tx as never, {
      proposalId: 'proposal-1',
      updates: payload(),
      requestorId: 'user-1' as never,
      organizationId: ORG as never,
      projectId: PROJECT as never,
      reservedPlanId: '77777777-7777-4777-8777-777777777777',
    });

    const [, , , , , reservedId] =
      taskService.createInTransaction.mock.calls[0]!;
    expect(reservedId).toBe('77777777-7777-4777-8777-777777777777');
    expect(designDocService.createInTransaction.mock.calls[0]![2]).toEqual(
      expect.any(String),
    );
  });

  it('rebuilds the same dependency edges from committed state for a publication retry', async () => {
    const { adopt, taskService, table, service, tx } = setup([
      row(T1),
      row(T2),
      row(T3),
      row(EXTERNAL),
    ]);
    const updates = payload({
      taskPrerequisites: [{ taskId: T3, dependsOnTaskId: EXTERNAL }],
    });
    const first = await adopt(updates);

    const rebuilt = await service.rebuildPublicationEdges({
      proposalId: 'proposal-1',
      planId: first.planId,
      updates,
      organizationId: ORG as never,
      projectId: PROJECT as never,
      db: {
        task: {
          findMany: jest.fn(async ({ where }) =>
            where.id.in
              .map((id: string) => table.get(id))
              .filter(
                (r?: Row) => r && (where.type ? r.type === where.type : true),
              ),
          ),
        },
      } as never,
    });

    expect(rebuilt).toEqual(first.edges);
    expect(taskService.createInTransaction).toHaveBeenCalledTimes(3);
    void tx;
  });

  it('refuses to republish when the adopted stage structure is gone', async () => {
    const { adopt, table, service } = setup([row(T1), row(T2), row(T3)]);
    const updates = payload();
    const first = await adopt(updates);
    table.get(T1)!.parentTaskId = FEATURE;

    await expect(
      service.rebuildPublicationEdges({
        proposalId: 'proposal-1',
        planId: first.planId,
        updates,
        organizationId: ORG as never,
        projectId: PROJECT as never,
        db: {
          task: {
            findMany: jest.fn(async ({ where }) =>
              where.id.in
                .map((id: string) => table.get(id))
                .filter(
                  (r?: Row) => r && (where.type ? r.type === where.type : true),
                ),
            ),
          },
        } as never,
      }),
    ).rejects.toThrow('no longer holds the adopted stage structure');
  });
});
