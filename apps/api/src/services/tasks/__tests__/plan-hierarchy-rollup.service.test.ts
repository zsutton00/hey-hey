import { WorkStatus } from '@prisma/client';
import { PlanHierarchyRollupService } from '../plan-hierarchy-rollup.service';
import { createPlanHierarchyFakeTx } from './plan-hierarchy-fake-tx';

describe('PlanHierarchyRollupService', () => {
  const service = new PlanHierarchyRollupService({
    outgoing: jest.fn().mockResolvedValue([]),
  } as any);

  describe('stage lifecycle projection', () => {
    it('keeps an empty stage in BACKLOG and a shaping stage in REFINING', () => {
      expect(service.computeStageStatus(WorkStatus.BACKLOG, [])).toBe(
        WorkStatus.BACKLOG,
      );
      expect(
        service.computeStageStatus(WorkStatus.REFINING, [WorkStatus.ACTIVE]),
      ).toBe(WorkStatus.REFINING);
    });

    it('treats completed and cancelled children as terminal', () => {
      expect(
        service.computeStageStatus(WorkStatus.ACTIVE, [
          WorkStatus.COMPLETED,
          WorkStatus.CANCELLED,
        ]),
      ).toBe(WorkStatus.COMPLETED);
    });

    it('projects explicit blocking before ordinary active work', () => {
      expect(
        service.computeStageStatus(WorkStatus.ACTIVE, [
          WorkStatus.ACTIVE,
          WorkStatus.BLOCKED,
        ]),
      ).toBe(WorkStatus.BLOCKED);
    });

    it('reopens a completed stage when non-terminal work appears', () => {
      expect(
        service.computeStageStatus(WorkStatus.COMPLETED, [
          WorkStatus.COMPLETED,
          WorkStatus.BACKLOG,
        ]),
      ).toBe(WorkStatus.ACTIVE);
      expect(
        service.computeStageStatus(WorkStatus.COMPLETED, [WorkStatus.BACKLOG]),
      ).toBe(WorkStatus.ACTIVE);
    });
  });

  describe('plan lifecycle projection', () => {
    it('holds a fully executed plan in VERIFYING for explicit completion', () => {
      expect(
        service.computePlanStatus(WorkStatus.ACTIVE, [
          WorkStatus.COMPLETED,
          WorkStatus.COMPLETED,
        ]),
      ).toBe(WorkStatus.VERIFYING);
    });

    it('projects blocking and active stage state', () => {
      expect(
        service.computePlanStatus(WorkStatus.READY, [WorkStatus.BLOCKED]),
      ).toBe(WorkStatus.BLOCKED);
      expect(
        service.computePlanStatus(WorkStatus.READY, [WorkStatus.REFINING]),
      ).toBe(WorkStatus.ACTIVE);
    });

    it('keeps a generated idle plan READY', () => {
      expect(
        service.computePlanStatus(WorkStatus.READY, [WorkStatus.BACKLOG]),
      ).toBe(WorkStatus.READY);
    });

    it('reopens a completed plan when non-terminal work appears', () => {
      expect(
        service.computePlanStatus(WorkStatus.COMPLETED, [WorkStatus.BACKLOG]),
      ).toBe(WorkStatus.ACTIVE);
      expect(
        service.computePlanStatus(WorkStatus.VERIFYING, [WorkStatus.BACKLOG]),
      ).toBe(WorkStatus.ACTIVE);
    });
  });
});

describe('Graph predecessor activation', () => {
  it.each(['ACTIVE', 'COMPLETED', 'CANCELLED'])(
    'respects predecessor status %s',
    async (status) => {
      const dependencies = {
        outgoing: jest
          .fn()
          .mockResolvedValue([
            { sourceNodeId: 'stage', targetNodeId: 'previous' },
          ]),
      };
      const service = new PlanHierarchyRollupService(dependencies as any);
      const { tx, task } = createPlanHierarchyFakeTx([
        {
          id: 'plan',
          type: 'PLAN',
          status: WorkStatus.ACTIVE,
          parentTaskId: null,
        },
        {
          id: 'stage',
          type: 'PLAN_STAGE',
          status: WorkStatus.BACKLOG,
          parentTaskId: 'plan',
        },
        {
          id: 'step',
          type: 'STANDARD',
          status: WorkStatus.ACTIVE,
          parentTaskId: 'stage',
        },
      ]);
      task.findMany.mockResolvedValue([
        { id: 'previous', type: 'PLAN_STAGE', status },
      ]);
      const transitions = await service.rollUpFrom(tx, 'step');
      expect(dependencies.outgoing).toHaveBeenCalledWith('org', 'project', [
        'stage',
      ]);
      expect(transitions.filter((t) => t.taskId === 'stage')).toHaveLength(
        status === 'ACTIVE' ? 0 : 1,
      );
      if (status !== 'ACTIVE') expect(transitions[0]?.newStatus).toBe('ACTIVE');
    },
  );
});

describe('PlanHierarchyRollupService.rollUpFrom', () => {
  const service = new PlanHierarchyRollupService({
    outgoing: jest.fn().mockResolvedValue([]),
  } as any);
  const plan = (status: WorkStatus) => ({
    id: 'plan',
    type: 'PLAN',
    status,
    parentTaskId: null,
  });
  const stage = (id: string, status: WorkStatus) => ({
    id,
    type: 'PLAN_STAGE',
    status,
    parentTaskId: 'plan',
  });

  it('rolls a directly completed stage up to a VERIFYING plan, never COMPLETED', async () => {
    const { tx, rows } = createPlanHierarchyFakeTx([
      plan(WorkStatus.ACTIVE),
      stage('stage-1', WorkStatus.COMPLETED),
      stage('stage-2', WorkStatus.COMPLETED),
    ]);

    const transitions = await service.rollUpFrom(tx, 'stage-2');

    expect(transitions).toEqual([
      expect.objectContaining({
        taskId: 'plan',
        previousStatus: WorkStatus.ACTIVE,
        newStatus: WorkStatus.VERIFYING,
      }),
    ]);
    expect(rows.get('plan')?.status).toBe(WorkStatus.VERIFYING);
    expect(rows.get('stage-2')?.status).toBe(WorkStatus.COMPLETED);
  });

  it('moves a VERIFYING plan back to ACTIVE when a stage is reopened', async () => {
    const { tx, rows } = createPlanHierarchyFakeTx([
      plan(WorkStatus.VERIFYING),
      stage('stage-1', WorkStatus.COMPLETED),
      stage('stage-2', WorkStatus.ACTIVE),
    ]);

    await service.rollUpFrom(tx, 'stage-2');

    expect(rows.get('plan')?.status).toBe(WorkStatus.ACTIVE);
  });

  it('excludes archived steps and archived stages from rollup inputs', async () => {
    const { tx, rows } = createPlanHierarchyFakeTx([
      plan(WorkStatus.ACTIVE),
      stage('stage-1', WorkStatus.ACTIVE),
      {
        ...stage('stage-archived', WorkStatus.ACTIVE),
        archivedAt: new Date(),
      },
      {
        id: 'done',
        type: 'STANDARD',
        status: WorkStatus.COMPLETED,
        parentTaskId: 'stage-1',
      },
      {
        id: 'deleted',
        type: 'STANDARD',
        status: WorkStatus.ACTIVE,
        parentTaskId: 'stage-1',
        archivedAt: new Date(),
      },
    ]);

    await service.rollUpParent(tx, 'stage-1');

    expect(rows.get('stage-1')?.status).toBe(WorkStatus.COMPLETED);
    expect(rows.get('plan')?.status).toBe(WorkStatus.VERIFYING);
  });

  it('recalculates both stages and the shared plan once when a step moves between stages', async () => {
    const { tx, rows, task } = createPlanHierarchyFakeTx([
      plan(WorkStatus.ACTIVE),
      stage('stage-1', WorkStatus.ACTIVE),
      stage('stage-2', WorkStatus.COMPLETED),
      {
        id: 'done',
        type: 'STANDARD',
        status: WorkStatus.COMPLETED,
        parentTaskId: 'stage-1',
      },
      {
        id: 'moved',
        type: 'STANDARD',
        status: WorkStatus.ACTIVE,
        parentTaskId: 'stage-2',
      },
    ]);

    await service.rollUp(tx, {
      taskId: 'moved',
      formerParentTaskId: 'stage-1',
    });

    expect(rows.get('stage-1')?.status).toBe(WorkStatus.COMPLETED);
    expect(rows.get('stage-2')?.status).toBe(WorkStatus.ACTIVE);
    expect(rows.get('plan')?.status).toBe(WorkStatus.ACTIVE);
    const planReads = task.findUnique.mock.calls.filter(
      ([args]) => args.where.id === 'plan',
    );
    expect(planReads).toHaveLength(1);
  });

  it('ignores parents outside the canonical hierarchy', async () => {
    const { tx } = createPlanHierarchyFakeTx([
      {
        id: 'feature',
        type: 'FEATURE',
        status: WorkStatus.ACTIVE,
        parentTaskId: null,
      },
    ]);

    await expect(service.rollUpParent(tx, 'feature')).resolves.toEqual([]);
    await expect(service.rollUpParent(tx, null)).resolves.toEqual([]);
  });
});
