import type { TaskResponseDto } from '@hey-hey/contracts/api/models';
import { WorkStatus } from '@hey-hey/contracts/api/models';

import { PlanHierarchyRollupService } from '../plan-hierarchy-rollup.service';
import { createPlanHierarchyFakeTx } from './plan-hierarchy-fake-tx';

describe('PlanHierarchyRollupService', () => {
  const service = new PlanHierarchyRollupService({
    outgoing: jest.fn().mockResolvedValue([]),
  } as any);

  describe('stage lifecycle projection', () => {
    it('keeps an empty stage in BACKLOG and a shaping stage in REFINING', () => {
      expect(service.computeStageStatus(WorkStatus.Backlog, [])).toBe(
        WorkStatus.Backlog,
      );
      expect(
        service.computeStageStatus(WorkStatus.Refining, [WorkStatus.Active]),
      ).toBe(WorkStatus.Refining);
    });

    it('treats completed, cancelled and superseded children as terminal', () => {
      expect(
        service.computeStageStatus(WorkStatus.Active, [
          WorkStatus.Completed,
          WorkStatus.Cancelled,
          WorkStatus.Superseded,
        ]),
      ).toBe(WorkStatus.Completed);
      expect(
        service.computeStageStatus(WorkStatus.Active, [
          WorkStatus.Cancelled,
          WorkStatus.Superseded,
        ]),
      ).toBe(WorkStatus.Completed);
    });

    it('keeps a stage open while a Bug is unfinished or verifying, and completes when Tasks and Bugs are finished', () => {
      for (const bugStatus of [
        WorkStatus.Active,
        WorkStatus.Verifying,
        WorkStatus.GeneratingDetails,
      ]) {
        expect(
          service.computeStageStatus(WorkStatus.Completed, [
            WorkStatus.Completed,
            bugStatus,
          ]),
        ).toBe(WorkStatus.Active);
      }
      expect(
        service.computeStageStatus(WorkStatus.Active, [
          WorkStatus.Completed,
          WorkStatus.Completed,
        ]),
      ).toBe(WorkStatus.Completed);
    });

    it('treats a freshly generated Bug as not started', () => {
      expect(
        service.computeStageStatus(WorkStatus.Backlog, [
          WorkStatus.Backlog,
          WorkStatus.Generated,
        ]),
      ).toBe(WorkStatus.Backlog);
    });

    it('keeps a stage open while a non-terminal child remains beside superseded work', () => {
      expect(
        service.computeStageStatus(WorkStatus.Active, [
          WorkStatus.Superseded,
          WorkStatus.Active,
        ]),
      ).toBe(WorkStatus.Active);
    });

    it('projects explicit blocking before ordinary active work', () => {
      expect(
        service.computeStageStatus(WorkStatus.Active, [
          WorkStatus.Active,
          WorkStatus.Blocked,
        ]),
      ).toBe(WorkStatus.Blocked);
    });

    it('reopens a completed stage when non-terminal work appears', () => {
      expect(
        service.computeStageStatus(WorkStatus.Completed, [
          WorkStatus.Completed,
          WorkStatus.Backlog,
        ]),
      ).toBe(WorkStatus.Active);
      expect(
        service.computeStageStatus(WorkStatus.Completed, [WorkStatus.Backlog]),
      ).toBe(WorkStatus.Active);
    });
  });

  describe('plan lifecycle projection', () => {
    it('holds a fully executed plan in VERIFYING for explicit completion', () => {
      expect(
        service.computePlanStatus(WorkStatus.Active, [
          WorkStatus.Completed,
          WorkStatus.Completed,
        ]),
      ).toBe(WorkStatus.Verifying);
    });

    it('projects blocking and active stage state', () => {
      expect(
        service.computePlanStatus(WorkStatus.Ready, [WorkStatus.Blocked]),
      ).toBe(WorkStatus.Blocked);
      expect(
        service.computePlanStatus(WorkStatus.Ready, [WorkStatus.Refining]),
      ).toBe(WorkStatus.Active);
    });

    it('keeps a generated idle plan READY', () => {
      expect(
        service.computePlanStatus(WorkStatus.Ready, [WorkStatus.Backlog]),
      ).toBe(WorkStatus.Ready);
    });

    it('reopens a completed plan when non-terminal work appears', () => {
      expect(
        service.computePlanStatus(WorkStatus.Completed, [WorkStatus.Backlog]),
      ).toBe(WorkStatus.Active);
      expect(
        service.computePlanStatus(WorkStatus.Verifying, [WorkStatus.Backlog]),
      ).toBe(WorkStatus.Active);
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
          status: WorkStatus.Active,
          parentTaskId: null,
        },
        {
          id: 'stage',
          type: 'PLAN_STAGE',
          status: WorkStatus.Backlog,
          parentTaskId: 'plan',
        },
        {
          id: 'step',
          type: 'STANDARD',
          status: WorkStatus.Active,
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
  const plan = (status: TaskResponseDto['status']) => ({
    id: 'plan',
    type: 'PLAN',
    status,
    parentTaskId: null,
  });
  const stage = (id: string, status: TaskResponseDto['status']) => ({
    id,
    type: 'PLAN_STAGE',
    status,
    parentTaskId: 'plan',
  });

  it('rolls a directly completed stage up to a VERIFYING plan, never COMPLETED', async () => {
    const { tx, rows } = createPlanHierarchyFakeTx([
      plan(WorkStatus.Active),
      stage('stage-1', WorkStatus.Completed),
      stage('stage-2', WorkStatus.Completed),
    ]);

    const transitions = await service.rollUpFrom(tx, 'stage-2');

    expect(transitions).toEqual([
      expect.objectContaining({
        taskId: 'plan',
        previousStatus: WorkStatus.Active,
        newStatus: WorkStatus.Verifying,
      }),
    ]);
    expect(rows.get('plan')?.status).toBe(WorkStatus.Verifying);
    expect(rows.get('stage-2')?.status).toBe(WorkStatus.Completed);
  });

  it('moves a VERIFYING plan back to ACTIVE when a stage is reopened', async () => {
    const { tx, rows } = createPlanHierarchyFakeTx([
      plan(WorkStatus.Verifying),
      stage('stage-1', WorkStatus.Completed),
      stage('stage-2', WorkStatus.Active),
    ]);

    await service.rollUpFrom(tx, 'stage-2');

    expect(rows.get('plan')?.status).toBe(WorkStatus.Active);
  });

  it('excludes archived steps and archived stages from rollup inputs', async () => {
    const { tx, rows } = createPlanHierarchyFakeTx([
      plan(WorkStatus.Active),
      stage('stage-1', WorkStatus.Active),
      {
        ...stage('stage-archived', WorkStatus.Active),
        archivedAt: new Date(),
      },
      {
        id: 'done',
        type: 'STANDARD',
        status: WorkStatus.Completed,
        parentTaskId: 'stage-1',
      },
      {
        id: 'deleted',
        type: 'STANDARD',
        status: WorkStatus.Active,
        parentTaskId: 'stage-1',
        archivedAt: new Date(),
      },
    ]);

    await service.rollUpParent(tx, 'stage-1');

    expect(rows.get('stage-1')?.status).toBe(WorkStatus.Completed);
    expect(rows.get('plan')?.status).toBe(WorkStatus.Verifying);
  });

  it('recalculates both stages and the shared plan once when a step moves between stages', async () => {
    const { tx, rows, task } = createPlanHierarchyFakeTx([
      plan(WorkStatus.Active),
      stage('stage-1', WorkStatus.Active),
      stage('stage-2', WorkStatus.Completed),
      {
        id: 'done',
        type: 'STANDARD',
        status: WorkStatus.Completed,
        parentTaskId: 'stage-1',
      },
      {
        id: 'moved',
        type: 'STANDARD',
        status: WorkStatus.Active,
        parentTaskId: 'stage-2',
      },
    ]);

    await service.rollUp(tx, {
      taskId: 'moved',
      formerParentTaskId: 'stage-1',
    });

    expect(rows.get('stage-1')?.status).toBe(WorkStatus.Completed);
    expect(rows.get('stage-2')?.status).toBe(WorkStatus.Active);
    expect(rows.get('plan')?.status).toBe(WorkStatus.Active);
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
        status: WorkStatus.Active,
        parentTaskId: null,
      },
    ]);

    await expect(service.rollUpParent(tx, 'feature')).resolves.toEqual([]);
    await expect(service.rollUpParent(tx, null)).resolves.toEqual([]);
  });
});
